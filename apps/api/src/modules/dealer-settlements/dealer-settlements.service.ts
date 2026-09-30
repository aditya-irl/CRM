import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import {
  UserRole,
  DealerStatus,
  SettlementStatus,
  SettlementPaymentMethod,
  IDealerSettlement,
  IDealerSettlementAllocation,
  IDealerReconciliation,
  IDealerSettlementsSummary,
  IDealerUnsettledCollection,
  IDealerSettlementsLedgerResponse,
  getBusinessDate,
} from '@crm/shared';
import { AppError, ForbiddenError, NotFoundError, BadRequestError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

export interface DealerSettlementsFilterQuery {
  dealerId?: string;
  startDate?: string;
  endDate?: string;
  status?: SettlementStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateDealerSettlementInput {
  dealerId: string;
  amount: number;
  settlementDate: string;
  paymentMethod: string;
  referenceNumber?: string | null;
  notes?: string | null;
  allocations?: Array<{
    paymentId: string;
    amountAllocated: number;
  }>;
}

export class DealerSettlementsService {
  /**
   * Helper to enforce RBAC permissions.
   * SUPER_ADMIN, ADMIN, BRANCH_MANAGER have full access.
   * COLLECTION_AGENT is blocked.
   */
  private static checkAccess(user: AuthenticatedUser) {
    if (user.role === UserRole.COLLECTION_AGENT) {
      throw new ForbiddenError('Collection agents are not authorized to manage dealer settlements');
    }
  }

  /**
   * Retrieve complete dealer settlements ledger with summary metrics, dealer reconciliation, and paginated records.
   */
  public static async getDealerSettlements(
    filters: DealerSettlementsFilterQuery,
    user: AuthenticatedUser
  ): Promise<IDealerSettlementsLedgerResponse> {
    this.checkAccess(user);

    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) throw new ForbiddenError('Dealer context missing');
      filters.dealerId = user.dealerId;
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    // 1. Calculate Overall Summary Metrics
    const summary = await this.getDealerSettlementsSummary(
      { dealerId: filters.dealerId, startDate: filters.startDate, endDate: filters.endDate },
      user
    );

    // 2. Build WHERE clauses for Settlements Query
    const whereClauses: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (filters.dealerId) {
      whereClauses.push(`ds.dealer_id = $${paramIndex++}`);
      queryParams.push(filters.dealerId);
    }

    if (filters.startDate && filters.endDate) {
      whereClauses.push(`ds.settlement_date BETWEEN $${paramIndex++}::date AND $${paramIndex++}::date`);
      queryParams.push(filters.startDate, filters.endDate);
    } else if (filters.startDate) {
      whereClauses.push(`ds.settlement_date >= $${paramIndex++}::date`);
      queryParams.push(filters.startDate);
    } else if (filters.endDate) {
      whereClauses.push(`ds.settlement_date <= $${paramIndex++}::date`);
      queryParams.push(filters.endDate);
    }

    if (filters.status) {
      whereClauses.push(`ds.status = $${paramIndex++}`);
      queryParams.push(filters.status);
    }

    if (filters.search) {
      whereClauses.push(`(
        ds.settlement_number ILIKE $${paramIndex}
        OR ds.reference_number ILIKE $${paramIndex}
        OR d.store_name ILIKE $${paramIndex}
        OR d.dealer_code ILIKE $${paramIndex}
        OR d.owner_name ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 3. Count Total Matching Settlements
    const countSql = `
      SELECT COUNT(*)::int as total_rows
      FROM dealer_settlements ds
      JOIN dealers d ON ds.dealer_id = d.id
      ${whereSql}
    `;
    const countRes = await queryPostgres(countSql, queryParams);
    const totalCount = Number(countRes.rows[0]?.total_rows || 0);

    // 4. Fetch Paginated Settlement Rows
    const recordsSql = `
      SELECT 
        ds.id,
        ds.settlement_number,
        ds.dealer_id,
        ds.amount::numeric,
        ds.settlement_date,
        ds.payment_method,
        ds.reference_number,
        ds.notes,
        ds.status,
        ds.is_reversal,
        ds.reversal_reason,
        ds.reversed_at,
        ds.created_by,
        ds.created_at,
        ds.updated_at,
        d.store_name as dealer_store_name,
        d.dealer_code,
        d.owner_name,
        d.phone,
        u.full_name as created_by_name,
        (SELECT COUNT(*)::int FROM dealer_settlement_allocations WHERE settlement_id = ds.id) as allocations_count
      FROM dealer_settlements ds
      JOIN dealers d ON ds.dealer_id = d.id
      LEFT JOIN users u ON ds.created_by = u.id
      ${whereSql}
      ORDER BY ds.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const recordsRes = await queryPostgres(recordsSql, [...queryParams, limit, offset]);

    const records: IDealerSettlement[] = recordsRes.rows.map((r: any) => ({
      id: r.id,
      settlementNumber: r.settlement_number,
      dealerId: r.dealer_id,
      dealerStoreName: r.dealer_store_name,
      dealerCode: r.dealer_code,
      ownerName: r.owner_name,
      phone: r.phone,
      amount: Number(r.amount),
      settlementDate: r.settlement_date ? new Date(r.settlement_date).toISOString().slice(0, 10) : '',
      paymentMethod: r.payment_method as SettlementPaymentMethod,
      referenceNumber: r.reference_number,
      notes: r.notes,
      status: r.status as SettlementStatus,
      isReversal: Boolean(r.is_reversal),
      reversalReason: r.reversal_reason,
      reversedAt: r.reversed_at,
      createdBy: r.created_by,
      createdByName: r.created_by_name || 'System Admin',
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
   * Retrieve aggregate reconciliation metrics and partner store reconciliation table.
   */
  public static async getDealerSettlementsSummary(
    filters: Pick<DealerSettlementsFilterQuery, 'dealerId' | 'startDate' | 'endDate'>,
    user: AuthenticatedUser
  ): Promise<IDealerSettlementsSummary> {
    this.checkAccess(user);

    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) throw new ForbiddenError('Dealer context missing');
      filters.dealerId = user.dealerId;
    }

    // 1. Calculate store-by-store reconciliation
    let reconciliationSql = `
      SELECT 
        d.id as dealer_id,
        d.dealer_code,
        d.store_name,
        d.owner_name,
        d.phone,
        d.area_city,
        d.status,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN p.amount ELSE 0 END), 0)::numeric as total_collections,
        COALESCE((
          SELECT SUM(ds.amount) 
          FROM dealer_settlements ds 
          WHERE ds.dealer_id = d.id AND ds.status = 'COMPLETED'
        ), 0)::numeric as total_settled,
        COALESCE((
          SELECT COUNT(*) 
          FROM dealer_settlements ds 
          WHERE ds.dealer_id = d.id AND ds.status = 'COMPLETED'
        ), 0)::int as settlement_count,
        (
          SELECT MAX(ds.settlement_date) 
          FROM dealer_settlements ds 
          WHERE ds.dealer_id = d.id AND ds.status = 'COMPLETED'
        ) as last_settlement_date
      FROM dealers d
      LEFT JOIN payments p ON p.dealer_id = d.id AND p.collection_source = 'DEALER'
    `;

    const params: any[] = [];
    if (filters.dealerId) {
      reconciliationSql += ` WHERE d.id = $1`;
      params.push(filters.dealerId);
    }

    reconciliationSql += `
      GROUP BY d.id, d.dealer_code, d.store_name, d.owner_name, d.phone, d.area_city, d.status
      ORDER BY d.store_name ASC
    `;

    const reconciliationRes = await queryPostgres(reconciliationSql, params);

    let aggCollections = new Decimal(0);
    let aggSettled = new Decimal(0);
    let aggSettlementCount = 0;

    const dealerReconciliation: IDealerReconciliation[] = reconciliationRes.rows.map((r: any) => {
      const totCol = new Decimal(r.total_collections || 0);
      const totSet = new Decimal(r.total_settled || 0);
      const diff = totCol.minus(totSet);
      const outstanding = diff.isNegative() ? 0 : diff.toNumber();

      aggCollections = aggCollections.plus(totCol);
      aggSettled = aggSettled.plus(totSet);
      aggSettlementCount += Number(r.settlement_count || 0);

      let recStatus: 'FULLY_RECONCILED' | 'PENDING_SETTLEMENT' | 'NO_COLLECTIONS' = 'PENDING_SETTLEMENT';
      if (totCol.isZero()) {
        recStatus = 'NO_COLLECTIONS';
      } else if (outstanding === 0) {
        recStatus = 'FULLY_RECONCILED';
      }

      return {
        dealerId: r.dealer_id,
        dealerCode: r.dealer_code,
        storeName: r.store_name,
        ownerName: r.owner_name,
        phone: r.phone,
        areaCity: r.area_city,
        status: r.status as DealerStatus,
        totalCollections: totCol.toNumber(),
        totalSettled: totSet.toNumber(),
        outstandingSettlement: outstanding,
        settlementCount: Number(r.settlement_count || 0),
        lastSettlementDate: r.last_settlement_date ? new Date(r.last_settlement_date).toISOString().slice(0, 10) : null,
        reconciliationStatus: recStatus,
      };
    });

    const aggOutstandingDiff = aggCollections.minus(aggSettled);
    const aggOutstanding = aggOutstandingDiff.isNegative() ? 0 : aggOutstandingDiff.toNumber();

    return {
      totalCollections: aggCollections.toNumber(),
      totalSettled: aggSettled.toNumber(),
      outstandingSettlement: aggOutstanding,
      settlementCount: aggSettlementCount,
      dealerReconciliation,
    };
  }

  /**
   * Retrieve eligible unsettled or partially settled payment collections for a given dealer.
   */
  public static async getUnsettledCollectionsForDealer(
    dealerId: string,
    user: AuthenticatedUser
  ): Promise<IDealerUnsettledCollection[]> {
    this.checkAccess(user);

    if (user.role === UserRole.DEALER && user.dealerId !== dealerId) {
      throw new ForbiddenError('You do not have access to another dealer\'s data');
    }

    // Verify dealer exists
    const dealerCheck = await queryPostgres(`SELECT id FROM dealers WHERE id = $1`, [dealerId]);
    if (dealerCheck.rows.length === 0) {
      throw new NotFoundError('Partner store not found');
    }

    const sql = `
      SELECT 
        p.id as payment_id,
        p.receipt_number,
        p.amount::numeric as amount_collected,
        p.payment_timestamp,
        p.payment_mode,
        l.id as loan_id,
        l.loan_account_no,
        c.id as customer_id,
        c.full_name as customer_name,
        c.customer_code,
        c.primary_phone as customer_phone,
        COALESCE((
          SELECT SUM(dsa.amount_allocated) 
          FROM dealer_settlement_allocations dsa 
          JOIN dealer_settlements ds ON dsa.settlement_id = ds.id 
          WHERE dsa.payment_id = p.id AND ds.status = 'COMPLETED'
        ), 0)::numeric as amount_settled
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      WHERE p.dealer_id = $1 
        AND p.collection_source = 'DEALER' 
        AND p.status = 'SUCCESS' 
        AND p.is_reversal = FALSE
      ORDER BY p.payment_timestamp ASC
    `;

    const res = await queryPostgres(sql, [dealerId]);

    const unsettled: IDealerUnsettledCollection[] = [];
    for (const r of res.rows) {
      const col = new Decimal(r.amount_collected || 0);
      const set = new Decimal(r.amount_settled || 0);
      const rem = col.minus(set);

      if (rem.greaterThan(0)) {
        unsettled.push({
          paymentId: r.payment_id,
          receiptNumber: r.receipt_number,
          loanId: r.loan_id,
          loanAccountNo: r.loan_account_no,
          customerId: r.customer_id,
          customerName: r.customer_name,
          customerCode: r.customer_code,
          customerPhone: r.customer_phone,
          paymentDate: r.payment_timestamp,
          paymentMode: r.payment_mode,
          amountCollected: col.toNumber(),
          amountSettled: set.toNumber(),
          amountRemaining: rem.toNumber(),
        });
      }
    }

    return unsettled;
  }

  /**
   * Retrieve a single settlement by ID including dealer info and allocated collections breakdown.
   */
  public static async getSettlementById(
    id: string,
    user: AuthenticatedUser
  ): Promise<IDealerSettlement> {
    this.checkAccess(user);

    const settlementSql = `
      SELECT 
        ds.id,
        ds.settlement_number,
        ds.dealer_id,
        ds.amount::numeric,
        ds.settlement_date,
        ds.payment_method,
        ds.reference_number,
        ds.notes,
        ds.status,
        ds.is_reversal,
        ds.reversal_reason,
        ds.reversed_at,
        ds.created_by,
        ds.created_at,
        ds.updated_at,
        d.store_name as dealer_store_name,
        d.dealer_code,
        d.owner_name,
        d.phone,
        u.full_name as created_by_name
      FROM dealer_settlements ds
      JOIN dealers d ON ds.dealer_id = d.id
      LEFT JOIN users u ON ds.created_by = u.id
      WHERE ds.id = $1
    `;
    const res = await queryPostgres(settlementSql, [id]);
    if (res.rows.length === 0) {
      throw new NotFoundError('Settlement record not found');
    }
    const r = res.rows[0];

    if (user.role === UserRole.DEALER && r.dealer_id !== user.dealerId) {
      throw new ForbiddenError('You do not have access to another dealer\'s settlement');
    }

    // Fetch allocations
    const allocSql = `
      SELECT 
        dsa.id,
        dsa.settlement_id,
        dsa.payment_id,
        dsa.amount_allocated::numeric,
        dsa.created_at,
        p.receipt_number,
        p.amount::numeric as amount_collected,
        p.payment_timestamp as payment_date,
        c.full_name as customer_name,
        c.customer_code,
        l.loan_account_no
      FROM dealer_settlement_allocations dsa
      JOIN payments p ON dsa.payment_id = p.id
      JOIN customers c ON p.customer_id = c.id
      JOIN loans l ON p.loan_id = l.id
      WHERE dsa.settlement_id = $1
      ORDER BY dsa.created_at ASC
    `;
    const allocRes = await queryPostgres(allocSql, [id]);
    const allocations: IDealerSettlementAllocation[] = allocRes.rows.map((a: any) => ({
      id: a.id,
      settlementId: a.settlement_id,
      paymentId: a.payment_id,
      amountAllocated: Number(a.amount_allocated),
      receiptNumber: a.receipt_number,
      customerName: a.customer_name,
      customerCode: a.customer_code,
      loanAccountNo: a.loan_account_no,
      paymentDate: a.payment_date,
      amountCollected: Number(a.amount_collected),
      createdAt: a.created_at,
    }));

    return {
      id: r.id,
      settlementNumber: r.settlement_number,
      dealerId: r.dealer_id,
      dealerStoreName: r.dealer_store_name,
      dealerCode: r.dealer_code,
      ownerName: r.owner_name,
      phone: r.phone,
      amount: Number(r.amount),
      settlementDate: r.settlement_date ? new Date(r.settlement_date).toISOString().slice(0, 10) : '',
      paymentMethod: r.payment_method as SettlementPaymentMethod,
      referenceNumber: r.reference_number,
      notes: r.notes,
      status: r.status as SettlementStatus,
      isReversal: Boolean(r.is_reversal),
      reversalReason: r.reversal_reason,
      reversedAt: r.reversed_at,
      createdBy: r.created_by,
      createdByName: r.created_by_name || 'System Admin',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      allocationsCount: allocations.length,
      allocations,
    };
  }

  /**
   * Create a dealer settlement with atomic row-locking, over-settlement prevention, and receipt allocations.
   */
  public static async createSettlement(
    payload: CreateDealerSettlementInput,
    user: AuthenticatedUser
  ): Promise<IDealerSettlement> {
    this.checkAccess(user);

    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Dealers cannot record settlements');
    }

    const settlementAmount = new Decimal(payload.amount);
    if (settlementAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestError('Settlement amount must be greater than 0');
    }

    return await runPostgresTransaction(async (client) => {
      // 1. Lock dealer row
      const dealerRes = await client.query(
        `SELECT id, store_name, dealer_code, status FROM dealers WHERE id = $1 FOR UPDATE`,
        [payload.dealerId]
      );
      if (dealerRes.rows.length === 0) {
        throw new NotFoundError('Partner store not found');
      }
      const dealer = dealerRes.rows[0];

      // 2. Calculate total active collections for this dealer
      const colRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric as total_collections
         FROM payments 
         WHERE dealer_id = $1 
           AND collection_source = 'DEALER' 
           AND status = 'SUCCESS' 
           AND is_reversal = FALSE`,
        [payload.dealerId]
      );
      const totalCollections = new Decimal(colRes.rows[0]?.total_collections || 0);

      // 3. Calculate total completed settlements for this dealer
      const setRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric as total_settled
         FROM dealer_settlements 
         WHERE dealer_id = $1 AND status = 'COMPLETED'`,
        [payload.dealerId]
      );
      const totalSettled = new Decimal(setRes.rows[0]?.total_settled || 0);

      // 4. Over-settlement validation
      const availableUnsettled = totalCollections.minus(totalSettled);
      if (settlementAmount.greaterThan(availableUnsettled)) {
        throw new BadRequestError(
          `Settlement amount (₹${settlementAmount.toFixed(2)}) exceeds available unsettled dealer collections (₹${availableUnsettled.toFixed(2)})`
        );
      }

      // 5. Query and Lock eligible individual collection payments
      const eligiblePaymentsRes = await client.query(
        `SELECT 
           p.id,
           p.amount::numeric as amount_collected,
           p.receipt_number,
           p.payment_timestamp,
           COALESCE((
             SELECT SUM(dsa.amount_allocated) 
             FROM dealer_settlement_allocations dsa 
             JOIN dealer_settlements ds ON dsa.settlement_id = ds.id 
             WHERE dsa.payment_id = p.id AND ds.status = 'COMPLETED'
           ), 0)::numeric as amount_settled
         FROM payments p
         WHERE p.dealer_id = $1 
           AND p.collection_source = 'DEALER' 
           AND p.status = 'SUCCESS' 
           AND p.is_reversal = FALSE
         ORDER BY p.payment_timestamp ASC
         FOR UPDATE OF p`,
        [payload.dealerId]
      );

      const eligiblePayments = eligiblePaymentsRes.rows.map((p) => {
        const col = new Decimal(p.amount_collected);
        const set = new Decimal(p.amount_settled);
        const rem = col.minus(set);
        return {
          id: p.id,
          receiptNumber: p.receipt_number,
          amountCollected: col,
          amountSettled: set,
          amountRemaining: rem,
        };
      }).filter((p) => p.amountRemaining.greaterThan(0));

      // 6. Build allocations list
      const finalAllocations: Array<{ paymentId: string; amountAllocated: Decimal }> = [];

      if (payload.allocations && payload.allocations.length > 0) {
        // Explicit allocation path
        let explicitTotal = new Decimal(0);

        for (const alloc of payload.allocations) {
          const allocAmt = new Decimal(alloc.amountAllocated);
          if (allocAmt.lessThanOrEqualTo(0)) {
            throw new BadRequestError(`Allocated amount for payment ${alloc.paymentId} must be positive`);
          }

          const matchedPayment = eligiblePayments.find((ep) => ep.id === alloc.paymentId);
          if (!matchedPayment) {
            throw new BadRequestError(`Payment ${alloc.paymentId} is not an eligible unsettled collection for this dealer`);
          }

          if (allocAmt.greaterThan(matchedPayment.amountRemaining)) {
            throw new BadRequestError(
              `Allocation of ₹${allocAmt.toFixed(2)} on receipt ${matchedPayment.receiptNumber} exceeds its remaining balance of ₹${matchedPayment.amountRemaining.toFixed(2)}`
            );
          }

          finalAllocations.push({
            paymentId: alloc.paymentId,
            amountAllocated: allocAmt,
          });
          explicitTotal = explicitTotal.plus(allocAmt);
        }

        if (!explicitTotal.equals(settlementAmount)) {
          throw new BadRequestError(
            `Sum of allocated amounts (₹${explicitTotal.toFixed(2)}) does not match total settlement amount (₹${settlementAmount.toFixed(2)})`
          );
        }
      } else {
        // Auto oldest-first allocation path
        let remainingToAllocate = new Decimal(settlementAmount);

        for (const ep of eligiblePayments) {
          if (remainingToAllocate.isZero()) break;

          const allocForThis = Decimal.min(remainingToAllocate, ep.amountRemaining);
          finalAllocations.push({
            paymentId: ep.id,
            amountAllocated: allocForThis,
          });
          remainingToAllocate = remainingToAllocate.minus(allocForThis);
        }

        if (remainingToAllocate.greaterThan(0)) {
          throw new BadRequestError('Failed to allocate full settlement amount across available collection receipts');
        }
      }

      // 7. Generate sequential settlement number (STL-YYYY-XXXXXX)
      const currentYear = new Date(payload.settlementDate || Date.now()).getFullYear();
      const seqRes = await client.query(
        `SELECT COUNT(*)::int as cnt FROM dealer_settlements WHERE EXTRACT(YEAR FROM settlement_date) = $1`,
        [currentYear]
      );
      const nextSeq = (Number(seqRes.rows[0]?.cnt || 0) + 1).toString().padStart(6, '0');
      const settlementNumber = `STL-${currentYear}-${nextSeq}`;

      const settlementId = uuidv4();

      // 8. Insert into dealer_settlements
      await client.query(
        `INSERT INTO dealer_settlements (
           id, settlement_number, dealer_id, amount, settlement_date, payment_method,
           reference_number, notes, status, is_reversal, created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'COMPLETED', FALSE, $9, NOW(), NOW())`,
        [
          settlementId,
          settlementNumber,
          payload.dealerId,
          settlementAmount.toNumber(),
          payload.settlementDate,
          payload.paymentMethod,
          payload.referenceNumber || null,
          payload.notes || null,
          user.id,
        ]
      );

      // 9. Insert into dealer_settlement_allocations
      for (const alloc of finalAllocations) {
        const allocId = uuidv4();
        await client.query(
          `INSERT INTO dealer_settlement_allocations (
             id, settlement_id, payment_id, amount_allocated, created_at
           ) VALUES ($1, $2, $3, $4, NOW())`,
          [allocId, settlementId, alloc.paymentId, alloc.amountAllocated.toNumber()]
        );
      }

      // 10. Write Audit Log
      await AuditService.logWithClient(client, {
        userId: user.id,
        action: 'DEALER_SETTLEMENT_CREATED',
        entity: 'DealerSettlement',
        entityId: settlementId,
        newState: {
          settlementNumber,
          dealerId: payload.dealerId,
          dealerStoreName: dealer.store_name,
          amount: settlementAmount.toNumber(),
          settlementDate: payload.settlementDate,
          paymentMethod: payload.paymentMethod,
          referenceNumber: payload.referenceNumber,
          allocationsCount: finalAllocations.length,
        },
      });

      return {
        id: settlementId,
        settlementNumber,
        dealerId: payload.dealerId,
        dealerStoreName: dealer.store_name,
        dealerCode: dealer.dealer_code,
        amount: settlementAmount.toNumber(),
        settlementDate: payload.settlementDate,
        paymentMethod: payload.paymentMethod,
        referenceNumber: payload.referenceNumber || null,
        notes: payload.notes || null,
        status: SettlementStatus.COMPLETED,
        isReversal: false,
        createdBy: user.id,
        createdByName: user.fullName || 'Admin User',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        allocationsCount: finalAllocations.length,
      };
    });
  }

  /**
   * Reverse a completed dealer settlement and restore the unsettled balance.
   */
  public static async reverseSettlement(
    id: string,
    reason: string,
    user: AuthenticatedUser
  ): Promise<IDealerSettlement> {
    this.checkAccess(user);

    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Dealers cannot reverse settlements');
    }

    if (!reason || reason.trim().length < 5) {
      throw new BadRequestError('Reversal reason is mandatory and must be at least 5 characters');
    }

    return await runPostgresTransaction(async (client) => {
      // 1. Lock and fetch settlement
      const res = await client.query(
        `SELECT ds.*, d.store_name, d.dealer_code 
         FROM dealer_settlements ds
         JOIN dealers d ON ds.dealer_id = d.id
         WHERE ds.id = $1 
         FOR UPDATE`,
        [id]
      );

      if (res.rows.length === 0) {
        throw new NotFoundError('Settlement record not found');
      }
      const settlement = res.rows[0];

      if (settlement.status === 'REVERSED') {
        throw new BadRequestError('Settlement has already been reversed');
      }

      if (settlement.status !== 'COMPLETED') {
        throw new BadRequestError('Only COMPLETED settlements can be reversed');
      }

      // 2. Mark settlement as REVERSED
      await client.query(
        `UPDATE dealer_settlements 
         SET status = 'REVERSED', 
             is_reversal = TRUE, 
             reversal_reason = $1, 
             reversed_at = NOW(), 
             updated_at = NOW() 
         WHERE id = $2`,
        [reason.trim(), id]
      );

      // 3. Write Audit Log
      await AuditService.logWithClient(client, {
        userId: user.id,
        action: 'DEALER_SETTLEMENT_REVERSED',
        entity: 'DealerSettlement',
        entityId: id,
        previousState: {
          status: 'COMPLETED',
          amount: Number(settlement.amount),
        },
        newState: {
          status: 'REVERSED',
          reversalReason: reason.trim(),
          amount: Number(settlement.amount),
        },
      });

      return {
        id: settlement.id,
        settlementNumber: settlement.settlement_number,
        dealerId: settlement.dealer_id,
        dealerStoreName: settlement.store_name,
        dealerCode: settlement.dealer_code,
        amount: Number(settlement.amount),
        settlementDate: settlement.settlement_date ? new Date(settlement.settlement_date).toISOString().slice(0, 10) : '',
        paymentMethod: settlement.payment_method,
        referenceNumber: settlement.reference_number,
        notes: settlement.notes,
        status: SettlementStatus.REVERSED,
        isReversal: true,
        reversalReason: reason.trim(),
        reversedAt: new Date().toISOString(),
        createdBy: settlement.created_by,
        createdAt: settlement.created_at,
        updatedAt: new Date().toISOString(),
      };
    });
  }
}
