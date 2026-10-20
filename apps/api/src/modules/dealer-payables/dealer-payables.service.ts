import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import {
  UserRole,
  DealerStatus,
  DealerPayableStatus,
  IDealerPayableSummary,
  IDealerPayableDealerBreakdown,
  IDealerPayableEligibleLoan,
  IDealerPayablePayment,
  IDealerPayablesLedgerResponse,
} from '@crm/shared';
import { AppError, ForbiddenError, NotFoundError, BadRequestError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

export interface DealerPayablesFilterQuery {
  dealerId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface RecordCompanyPaymentInput {
  dealerId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber?: string | null;
  notes?: string | null;
  allocations?: Array<{
    loanId: string;
    amountAllocated: number;
  }>;
}

export class DealerPayablesService {
  /**
   * Helper to enforce RBAC permissions.
   * SUPER_ADMIN, ADMIN, BRANCH_MANAGER have full access.
   * COLLECTION_AGENT is blocked.
   */
  private static checkAccess(user: AuthenticatedUser) {
    if (user.role === UserRole.COLLECTION_AGENT) {
      throw new ForbiddenError('Collection agents are not authorized to access dealer payables');
    }
  }

  /**
   * Retrieve dealer payables summary metrics and dealer breakdown.
   */
  public static async getDealerPayablesSummary(
    filters: Pick<DealerPayablesFilterQuery, 'dealerId' | 'startDate' | 'endDate'>,
    user: AuthenticatedUser
  ): Promise<IDealerPayableSummary> {
    this.checkAccess(user);

    // Dealer RLAC: Force dealerId to authenticated dealer
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) throw new ForbiddenError('Dealer context missing');
      filters.dealerId = user.dealerId;
    }

    let sql = `
      SELECT
        d.id as dealer_id,
        d.dealer_code,
        d.store_name,
        d.owner_name,
        d.phone,
        d.area_city,
        d.status,
        COALESCE(COUNT(DISTINCT CASE WHEN l.status IN ('ACTIVE', 'CLOSED') THEN l.id END), 0)::int as eligible_loans_count,
        COALESCE(SUM(CASE WHEN l.status IN ('ACTIVE', 'CLOSED') THEN l.net_disbursed_amount ELSE 0 END), 0)::numeric as total_payable,
        COALESCE((
          SELECT SUM(dpp.amount)
          FROM dealer_payable_payments dpp
          WHERE dpp.dealer_id = d.id AND dpp.status = 'COMPLETED'
        ), 0)::numeric as total_paid,
        (
          SELECT MAX(dpp.payment_date)
          FROM dealer_payable_payments dpp
          WHERE dpp.dealer_id = d.id AND dpp.status = 'COMPLETED'
        ) as last_payment_date
      FROM dealers d
      LEFT JOIN loans l ON l.dealer_id = d.id
    `;

    const params: any[] = [];
    if (filters.dealerId) {
      sql += ` WHERE d.id = $1`;
      params.push(filters.dealerId);
    }

    sql += `
      GROUP BY d.id, d.dealer_code, d.store_name, d.owner_name, d.phone, d.area_city, d.status
      ORDER BY total_payable DESC, d.store_name ASC
    `;

    const res = await queryPostgres(sql, params);

    let aggPayable = new Decimal(0);
    let aggPaid = new Decimal(0);

    const dealers: IDealerPayableDealerBreakdown[] = res.rows.map((r: any) => {
      const totPay = new Decimal(r.total_payable || 0);
      const totPd = new Decimal(r.total_paid || 0);
      const diff = totPay.minus(totPd);
      const remaining = diff.isNegative() ? 0 : diff.toNumber();

      aggPayable = aggPayable.plus(totPay);
      aggPaid = aggPaid.plus(totPd);

      let pStatus: DealerPayableStatus = DealerPayableStatus.PENDING;
      if (totPay.isZero() || remaining === 0) {
        pStatus = DealerPayableStatus.PAID;
      } else if (totPd.greaterThan(0)) {
        pStatus = DealerPayableStatus.PARTIALLY_PAID;
      }

      return {
        dealerId: r.dealer_id,
        dealerCode: r.dealer_code,
        storeName: r.store_name,
        ownerName: r.owner_name,
        phone: r.phone,
        areaCity: r.area_city,
        status: r.status as DealerStatus,
        eligibleLoansCount: Number(r.eligible_loans_count || 0),
        totalPayable: totPay.toNumber(),
        alreadyPaid: totPd.toNumber(),
        remainingPayable: remaining,
        payoutStatus: pStatus,
        lastPaymentDate: r.last_payment_date ? new Date(r.last_payment_date).toISOString().slice(0, 10) : null,
      };
    });

    const aggRemDiff = aggPayable.minus(aggPaid);
    const aggRemaining = aggRemDiff.isNegative() ? 0 : aggRemDiff.toNumber();

    return {
      totalPayable: aggPayable.toNumber(),
      totalPaid: aggPaid.toNumber(),
      remainingPayable: aggRemaining,
      dealersCount: dealers.length,
      dealers,
    };
  }

  /**
   * Retrieve eligible disbursed loans for a given dealer that contribute to the payable amount.
   */
  public static async getEligibleLoansForDealer(
    dealerId: string,
    user: AuthenticatedUser
  ): Promise<IDealerPayableEligibleLoan[]> {
    this.checkAccess(user);

    if (user.role === UserRole.DEALER && user.dealerId !== dealerId) {
      throw new ForbiddenError('You do not have access to another dealer\'s data');
    }

    const dealerCheck = await queryPostgres(`SELECT id FROM dealers WHERE id = $1`, [dealerId]);
    if (dealerCheck.rows.length === 0) {
      throw new NotFoundError('Partner store not found');
    }

    const sql = `
      SELECT
        l.id as loan_id,
        l.loan_account_no,
        l.customer_id,
        c.full_name as customer_name,
        c.customer_code,
        l.device_brand,
        l.device_model,
        l.device_name,
        l.disbursement_date,
        l.principal_amount::numeric,
        l.down_payment::numeric,
        l.net_disbursed_amount::numeric,
        COALESCE((
          SELECT SUM(dpa.amount_allocated)
          FROM dealer_payable_allocations dpa
          JOIN dealer_payable_payments dpp ON dpa.payout_id = dpp.id
          WHERE dpa.loan_id = l.id AND dpp.status = 'COMPLETED'
        ), 0)::numeric as amount_allocated
      FROM loans l
      JOIN customers c ON l.customer_id = c.id
      WHERE l.dealer_id = $1
        AND l.status IN ('ACTIVE', 'CLOSED')
        AND l.net_disbursed_amount > 0
      ORDER BY l.disbursement_date ASC, l.created_at ASC
    `;

    const res = await queryPostgres(sql, [dealerId]);

    return res.rows.map((r: any) => {
      const netDisb = new Decimal(r.net_disbursed_amount || 0);
      const allocated = new Decimal(r.amount_allocated || 0);
      const rem = netDisb.minus(allocated);
      const remainingPayable = rem.isNegative() ? 0 : rem.toNumber();

      let pStatus: DealerPayableStatus = DealerPayableStatus.PENDING;
      if (remainingPayable === 0) {
        pStatus = DealerPayableStatus.PAID;
      } else if (allocated.greaterThan(0)) {
        pStatus = DealerPayableStatus.PARTIALLY_PAID;
      }

      const devName = r.device_name || (r.device_brand && r.device_model ? `${r.device_brand} ${r.device_model}` : (r.device_brand || r.device_model || null));

      return {
        loanId: r.loan_id,
        loanAccountNo: r.loan_account_no,
        customerId: r.customer_id,
        customerName: r.customer_name,
        customerCode: r.customer_code,
        deviceBrand: r.device_brand || null,
        deviceModel: r.device_model || null,
        deviceName: devName,
        disbursementDate: r.disbursement_date ? new Date(r.disbursement_date).toISOString().slice(0, 10) : '',
        principalAmount: Number(r.principal_amount),
        downPayment: Number(r.down_payment),
        netDisbursedAmount: netDisb.toNumber(),
        amountAllocated: allocated.toNumber(),
        remainingPayable,
        payoutStatus: pStatus,
      };
    });
  }

  /**
   * Retrieve company-to-dealer payments ledger with summary and pagination.
   */
  public static async getDealerPayablePayments(
    filters: DealerPayablesFilterQuery,
    user: AuthenticatedUser
  ): Promise<IDealerPayablesLedgerResponse> {
    this.checkAccess(user);

    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) throw new ForbiddenError('Dealer context missing');
      filters.dealerId = user.dealerId;
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    const summary = await this.getDealerPayablesSummary(
      { dealerId: filters.dealerId, startDate: filters.startDate, endDate: filters.endDate },
      user
    );

    const whereClauses: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (filters.dealerId) {
      whereClauses.push(`dpp.dealer_id = $${paramIndex++}`);
      queryParams.push(filters.dealerId);
    }

    if (filters.startDate && filters.endDate) {
      whereClauses.push(`dpp.payment_date BETWEEN $${paramIndex++}::date AND $${paramIndex++}::date`);
      queryParams.push(filters.startDate, filters.endDate);
    } else if (filters.startDate) {
      whereClauses.push(`dpp.payment_date >= $${paramIndex++}::date`);
      queryParams.push(filters.startDate);
    } else if (filters.endDate) {
      whereClauses.push(`dpp.payment_date <= $${paramIndex++}::date`);
      queryParams.push(filters.endDate);
    }

    if (filters.search) {
      whereClauses.push(`(
        dpp.payout_number ILIKE $${paramIndex}
        OR dpp.reference_number ILIKE $${paramIndex}
        OR d.store_name ILIKE $${paramIndex}
        OR d.dealer_code ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*)::int as total_rows
      FROM dealer_payable_payments dpp
      JOIN dealers d ON dpp.dealer_id = d.id
      ${whereSql}
    `;
    const countRes = await queryPostgres(countSql, queryParams);
    const totalCount = Number(countRes.rows[0]?.total_rows || 0);

    const recordsSql = `
      SELECT
        dpp.id,
        dpp.payout_number,
        dpp.dealer_id,
        dpp.amount::numeric,
        dpp.payment_date,
        dpp.payment_method,
        dpp.reference_number,
        dpp.notes,
        dpp.status,
        dpp.is_reversal,
        dpp.reversal_reason,
        dpp.reversed_at,
        dpp.created_by,
        dpp.created_at,
        dpp.updated_at,
        d.store_name as dealer_store_name,
        d.dealer_code,
        d.owner_name,
        d.phone,
        u.full_name as created_by_name,
        (SELECT COUNT(*)::int FROM dealer_payable_allocations WHERE payout_id = dpp.id) as allocations_count
      FROM dealer_payable_payments dpp
      JOIN dealers d ON dpp.dealer_id = d.id
      LEFT JOIN users u ON dpp.created_by = u.id
      ${whereSql}
      ORDER BY dpp.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const recordsRes = await queryPostgres(recordsSql, [...queryParams, limit, offset]);

    const records: IDealerPayablePayment[] = recordsRes.rows.map((r: any) => ({
      id: r.id,
      payoutNumber: r.payout_number,
      dealerId: r.dealer_id,
      dealerStoreName: r.dealer_store_name,
      dealerCode: r.dealer_code,
      ownerName: r.owner_name,
      phone: r.phone,
      amount: Number(r.amount),
      paymentDate: r.payment_date ? new Date(r.payment_date).toISOString().slice(0, 10) : '',
      paymentMethod: r.payment_method,
      referenceNumber: r.reference_number,
      notes: r.notes,
      status: r.status,
      isReversal: Boolean(r.is_reversal),
      reversalReason: r.reversal_reason,
      reversedAt: r.reversed_at,
      createdBy: r.created_by,
      createdByName: r.created_by_name || 'Administrator',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      allocationsCount: Number(r.allocations_count || 0),
    }));

    return {
      summary,
      records,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    };
  }

  /**
   * Retrieve single company payout details by ID with allocated loan details.
   */
  public static async getDealerPayablePaymentById(
    id: string,
    user: AuthenticatedUser
  ): Promise<IDealerPayablePayment & { allocations: any[] }> {
    this.checkAccess(user);

    const sql = `
      SELECT
        dpp.id,
        dpp.payout_number,
        dpp.dealer_id,
        dpp.amount::numeric,
        dpp.payment_date,
        dpp.payment_method,
        dpp.reference_number,
        dpp.notes,
        dpp.status,
        dpp.is_reversal,
        dpp.reversal_reason,
        dpp.reversed_at,
        dpp.created_by,
        dpp.created_at,
        dpp.updated_at,
        d.store_name as dealer_store_name,
        d.dealer_code,
        d.owner_name,
        d.phone,
        u.full_name as created_by_name
      FROM dealer_payable_payments dpp
      JOIN dealers d ON dpp.dealer_id = d.id
      LEFT JOIN users u ON dpp.created_by = u.id
      WHERE dpp.id = $1
    `;

    const res = await queryPostgres(sql, [id]);
    if (res.rows.length === 0) {
      throw new NotFoundError('Company payout record not found');
    }
    const r = res.rows[0];

    // Dealer tenant isolation: dealer can only see their own store's payouts
    if (user.role === UserRole.DEALER && r.dealer_id !== user.dealerId) {
      throw new ForbiddenError('You do not have access to another dealer\'s company payment details');
    }

    // Fetch allocations with loan and customer details
    const allocSql = `
      SELECT
        dpa.id,
        dpa.payout_id,
        dpa.loan_id,
        dpa.amount_allocated::numeric,
        dpa.created_at,
        l.loan_account_no,
        l.device_name,
        l.device_brand,
        l.device_model,
        c.full_name as customer_name,
        c.customer_code
      FROM dealer_payable_allocations dpa
      JOIN loans l ON dpa.loan_id = l.id
      JOIN customers c ON l.customer_id = c.id
      WHERE dpa.payout_id = $1
      ORDER BY dpa.created_at ASC
    `;
    const allocRes = await queryPostgres(allocSql, [id]);

    const allocations = allocRes.rows.map((a: any) => ({
      id: a.id,
      payoutId: a.payout_id,
      loanId: a.loan_id,
      amountAllocated: Number(a.amount_allocated),
      loanAccountNo: a.loan_account_no,
      deviceName: a.device_name || (a.device_brand && a.device_model ? `${a.device_brand} ${a.device_model}` : null),
      customerName: a.customer_name,
      customerCode: a.customer_code,
      createdAt: a.created_at,
    }));

    return {
      id: r.id,
      payoutNumber: r.payout_number,
      dealerId: r.dealer_id,
      dealerStoreName: r.dealer_store_name,
      dealerCode: r.dealer_code,
      ownerName: r.owner_name,
      phone: r.phone,
      amount: Number(r.amount),
      paymentDate: r.payment_date ? new Date(r.payment_date).toISOString().slice(0, 10) : '',
      paymentMethod: r.payment_method,
      referenceNumber: r.reference_number,
      notes: r.notes,
      status: r.status,
      isReversal: Boolean(r.is_reversal),
      reversalReason: r.reversal_reason,
      reversedAt: r.reversed_at,
      createdBy: r.created_by,
      createdByName: r.created_by_name || 'Administrator',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      allocationsCount: allocations.length,
      allocations,
    };
  }

  /**
   * Record a company payment to a dealer for eligible financed products.
   * Transactional, concurrency-safe, overpayment prevention, audit logged.
   */
  public static async recordCompanyPayment(
    input: RecordCompanyPaymentInput,
    user: AuthenticatedUser
  ): Promise<IDealerPayablePayment> {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.BRANCH_MANAGER
    ) {
      throw new ForbiddenError('Only authorized administrators and managers can record company payments to dealers');
    }

    if (!input.dealerId) {
      throw new BadRequestError('Dealer ID is required');
    }

    const paymentAmount = new Decimal(input.amount || 0);
    if (paymentAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestError('Payment amount must be greater than zero');
    }

    return await runPostgresTransaction(async (client) => {
      // 1. Lock and verify dealer
      const dealerRes = await client.query(
        `SELECT id, dealer_code, store_name, status FROM dealers WHERE id = $1 FOR UPDATE`,
        [input.dealerId]
      );
      if (dealerRes.rows.length === 0) {
        throw new NotFoundError('Partner store not found');
      }
      const dealer = dealerRes.rows[0];

      // 2. Lock all eligible disbursed loans for this dealer
      const eligibleLoansRes = await client.query(
        `SELECT
          l.id,
          l.loan_account_no,
          l.net_disbursed_amount::numeric,
          COALESCE((
            SELECT SUM(dpa.amount_allocated)
            FROM dealer_payable_allocations dpa
            JOIN dealer_payable_payments dpp ON dpa.payout_id = dpp.id
            WHERE dpa.loan_id = l.id AND dpp.status = 'COMPLETED'
          ), 0)::numeric as amount_allocated
        FROM loans l
        WHERE l.dealer_id = $1
          AND l.status IN ('ACTIVE', 'CLOSED')
          AND l.net_disbursed_amount > 0
        ORDER BY l.disbursement_date ASC, l.created_at ASC
        FOR UPDATE OF l`,
        [input.dealerId]
      );

      let totalRemainingPayable = new Decimal(0);
      const eligibleLoans = eligibleLoansRes.rows.map((row) => {
        const netDisb = new Decimal(row.net_disbursed_amount || 0);
        const alloc = new Decimal(row.amount_allocated || 0);
        const rem = netDisb.minus(alloc);
        const unallocated = rem.isNegative() ? new Decimal(0) : rem;
        totalRemainingPayable = totalRemainingPayable.plus(unallocated);
        return {
          id: row.id,
          loanAccountNo: row.loan_account_no,
          netDisbursedAmount: netDisb,
          unallocatedPayable: unallocated,
        };
      });

      // 3. Prevent Overpayment
      if (paymentAmount.greaterThan(totalRemainingPayable)) {
        throw new BadRequestError(
          `Payment amount (₹${paymentAmount.toFixed(2)}) exceeds the total outstanding payable to this dealer (₹${totalRemainingPayable.toFixed(2)})`
        );
      }

      // 4. Generate unique payout reference number using atomic advisory lock + MAX sequence
      const year = new Date(input.paymentDate || Date.now()).getFullYear();
      try {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`dealer_payout_seq_${year}`]);
      } catch {
        // Graceful fallback for SQLite test environments where pg_advisory_xact_lock does not exist
      }

      const maxRes = await client.query(
        `SELECT COALESCE(MAX(CAST(SPLIT_PART(payout_number, '-', 3) AS INTEGER)), 1000) as max_seq
         FROM dealer_payable_payments
         WHERE payout_number LIKE $1`,
        [`DPAY-${year}-%`]
      );
      const seq = parseInt(maxRes.rows[0]?.max_seq || '1000', 10) + 1;
      const payoutNumber = `DPAY-${year}-${String(seq).padStart(5, '0')}`;
      const payoutId = uuidv4();

      // 5. Insert Company Payout Record
      await client.query(
        `INSERT INTO dealer_payable_payments (
          id, payout_number, dealer_id, amount, payment_date, payment_method,
          reference_number, notes, status, is_reversal, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'COMPLETED', FALSE, $9, NOW(), NOW())`,
        [
          payoutId,
          payoutNumber,
          input.dealerId,
          paymentAmount.toNumber(),
          input.paymentDate,
          input.paymentMethod,
          input.referenceNumber || null,
          input.notes || null,
          user.id,
        ]
      );

      // 6. Allocate payment across eligible loans
      let unallocatedToApply = paymentAmount;

      if (input.allocations && input.allocations.length > 0) {
        // Specific allocations provided
        let sumSpecific = new Decimal(0);
        for (const sa of input.allocations) {
          const sAmt = new Decimal(sa.amountAllocated);
          if (sAmt.lessThanOrEqualTo(0)) continue;
          sumSpecific = sumSpecific.plus(sAmt);

          const matchingLoan = eligibleLoans.find((l) => l.id === sa.loanId);
          if (!matchingLoan) {
            throw new BadRequestError(`Loan ${sa.loanId} is not an eligible loan for this dealer`);
          }
          if (sAmt.greaterThan(matchingLoan.unallocatedPayable)) {
            throw new BadRequestError(
              `Allocated amount for loan ${matchingLoan.loanAccountNo} (₹${sAmt.toFixed(2)}) exceeds its unallocated balance (₹${matchingLoan.unallocatedPayable.toFixed(2)})`
            );
          }

          await client.query(
            `INSERT INTO dealer_payable_allocations (id, payout_id, loan_id, amount_allocated, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [uuidv4(), payoutId, sa.loanId, sAmt.toNumber()]
          );
        }

        if (!sumSpecific.equals(paymentAmount)) {
          throw new BadRequestError(
            `Sum of allocated amounts (₹${sumSpecific.toFixed(2)}) must equal total payment amount (₹${paymentAmount.toFixed(2)})`
          );
        }
      } else {
        // Automatic FIFO Allocation
        for (const loan of eligibleLoans) {
          if (unallocatedToApply.lessThanOrEqualTo(0)) break;
          if (loan.unallocatedPayable.lessThanOrEqualTo(0)) continue;

          const toAlloc = Decimal.min(unallocatedToApply, loan.unallocatedPayable);
          await client.query(
            `INSERT INTO dealer_payable_allocations (id, payout_id, loan_id, amount_allocated, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [uuidv4(), payoutId, loan.id, toAlloc.toNumber()]
          );
          unallocatedToApply = unallocatedToApply.minus(toAlloc);
        }
      }

      // 7. Audit Trail
      await AuditService.logWithClient(client, {
        userId: user.id,
        action: 'DEALER_PAYABLE_PAYMENT_RECORDED',
        entity: 'DealerPayable',
        entityId: payoutId,
        previousState: { dealerId: input.dealerId },
        newState: {
          payoutNumber,
          dealerId: input.dealerId,
          amount: paymentAmount.toNumber(),
          paymentMethod: input.paymentMethod,
          referenceNumber: input.referenceNumber,
          paymentDate: input.paymentDate,
        },
      });

      // 8. Notification to Dealer
      const dealerUsers = await client.query(
        `SELECT id FROM users WHERE dealer_id = $1 AND status = 'ACTIVE'`,
        [input.dealerId]
      );
      for (const dUser of dealerUsers.rows) {
        await client.query(
          `INSERT INTO notifications (
            id, recipient_user_id, channel, type, title, body, status, scheduled_for, metadata, created_at
          ) VALUES ($1, $2, 'IN_APP', 'DEALER_PAYMENT_RECORDED', $3, $4, 'PENDING', NOW(), $5, NOW())`,
          [
            uuidv4(),
            dUser.id,
            `Company Payment Recorded: ₹${paymentAmount.toFixed(2)}`,
            `The company has recorded a payment of ₹${paymentAmount.toFixed(2)} (${input.paymentMethod}, Ref: ${input.referenceNumber || 'N/A'}) toward your store's financed product payables.`,
            JSON.stringify({ payoutId, payoutNumber, amount: paymentAmount.toNumber(), dealerId: input.dealerId }),
          ]
        );
      }

      return {
        id: payoutId,
        payoutNumber,
        dealerId: input.dealerId,
        dealerStoreName: dealer.store_name,
        dealerCode: dealer.dealer_code,
        amount: paymentAmount.toNumber(),
        paymentDate: input.paymentDate,
        paymentMethod: input.paymentMethod,
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || null,
        status: 'COMPLETED',
        isReversal: false,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Reverse a company payout with immutable audit log.
   */
  public static async reverseCompanyPayment(
    paymentId: string,
    reason: string,
    user: AuthenticatedUser
  ) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN) {
      throw new ForbiddenError('Only Super Admin and Admin can reverse dealer payments');
    }

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Reversal reason is required');
    }

    return await runPostgresTransaction(async (client) => {
      const payRes = await client.query(
        `SELECT * FROM dealer_payable_payments WHERE id = $1 FOR UPDATE`,
        [paymentId]
      );
      if (payRes.rows.length === 0) {
        throw new NotFoundError('Dealer payment record not found');
      }

      const p = payRes.rows[0];
      if (p.is_reversal || p.status === 'REVERSED') {
        throw new BadRequestError('This payment is already reversed');
      }

      await client.query(
        `UPDATE dealer_payable_payments
         SET status = 'REVERSED', is_reversal = TRUE, reversal_reason = $1, reversed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [reason.trim(), paymentId]
      );

      await AuditService.logWithClient(client, {
        userId: user.id,
        action: 'DEALER_PAYABLE_PAYMENT_REVERSED',
        entity: 'DealerPayable',
        entityId: paymentId,
        previousState: { status: p.status },
        newState: { status: 'REVERSED', reason: reason.trim() },
      });

      return { success: true, message: 'Dealer payment reversed successfully' };
    });
  }
}
