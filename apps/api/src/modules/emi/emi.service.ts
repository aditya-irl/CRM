import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';
import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import { EMIStatus, UserRole, getBusinessDate, getDaysDifference, toFixed2, computeEmiStatus } from '@crm/shared';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AppError, NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

export class EMIService {
  /**
   * Fetch collection queue for agent / admin with RLAC scoping, status filters, and pagination.
   */
  public static async getAgentQueue(
    user: AuthenticatedUser,
    filters: {
      status?: string;
      route?: string;
      search?: string;
      page?: number;
      limit?: number;
      sortBy?: 'due_date' | 'days_overdue' | 'amount' | 'route';
      sortOrder?: 'ASC' | 'DESC';
    }
  ) {
    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    let sql = `
      SELECT 
        e.id as installment_id,
        e.installment_number,
        TO_CHAR(e.due_date, 'YYYY-MM-DD') as due_date,
        e.expected_amount,
        e.paid_amount,
        e.remaining_amount,
        e.penalty_amount,
        e.status as emi_status,
        e.days_overdue,
        l.id as loan_id,
        l.loan_account_no,
        l.total_installments,
        l.outstanding_balance as total_loan_outstanding,
        c.id as customer_id,
        c.customer_code,
        c.full_name as customer_name,
        c.primary_phone,
        c.area_route,
        c.address_line1 || ', ' || c.city as address_summary,
        (SELECT cl.outcome FROM call_logs cl WHERE cl.customer_id = c.id ORDER BY cl.call_timestamp DESC LIMIT 1) as last_call_outcome,
        (SELECT TO_CHAR(cl.promised_payment_date, 'YYYY-MM-DD') FROM call_logs cl WHERE cl.customer_id = c.id ORDER BY cl.call_timestamp DESC LIMIT 1) as promised_payment_date
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      WHERE e.status != 'PAID' AND l.status = 'ACTIVE'
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Agent assignment scoping
    if (user.role === UserRole.COLLECTION_AGENT) {
      sql += ` AND (
        l.assigned_agent_id = $${paramIndex} 
        OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = $${paramIndex} AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
        OR c.area_route IN (SELECT area_route FROM collection_assignments WHERE agent_id = $${paramIndex} AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
      )`;
      params.push(user.id);
      paramIndex++;
    }

    if (filters.status === 'DUE_TODAY') {
      sql += ` AND (e.status = 'DUE_TODAY' OR e.due_date = $${paramIndex++})`;
      params.push(businessToday);
    } else if (filters.status === 'OVERDUE') {
      sql += ` AND (e.status = 'OVERDUE' OR e.days_overdue > 0 OR e.due_date < $${paramIndex++})`;
      params.push(businessToday);
    } else if (filters.status === 'UPCOMING') {
      sql += ` AND (e.status = 'UPCOMING' OR e.status = 'PARTIALLY_PAID') AND e.due_date > $${paramIndex++}`;
      params.push(businessToday);
    }

    if (filters.route) {
      sql += ` AND c.area_route = $${paramIndex++}`;
      params.push(filters.route);
    }

    if (filters.search) {
      const s = `%${filters.search}%`;
      sql += ` AND (c.full_name ILIKE $${paramIndex} OR c.primary_phone ILIKE $${paramIndex} OR c.customer_code ILIKE $${paramIndex} OR l.loan_account_no ILIKE $${paramIndex})`;
      params.push(s);
      paramIndex++;
    }

    // Count query
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    if (filters.sortBy === 'days_overdue') {
      const order = filters.sortOrder === 'ASC' ? 'ASC' : 'DESC';
      sql += ` ORDER BY GREATEST(e.days_overdue, GREATEST(0, ('${businessToday}'::date - e.due_date))) ${order}, e.due_date ASC`;
    } else if (filters.sortBy === 'due_date') {
      const order = filters.sortOrder === 'DESC' ? 'DESC' : 'ASC';
      sql += ` ORDER BY e.due_date ${order}`;
    } else if (filters.sortBy === 'amount') {
      const order = filters.sortOrder === 'ASC' ? 'ASC' : 'DESC';
      sql += ` ORDER BY e.remaining_amount ${order}`;
    } else if (filters.sortBy === 'route') {
      const order = filters.sortOrder === 'DESC' ? 'DESC' : 'ASC';
      sql += ` ORDER BY c.area_route ${order}, e.due_date ASC`;
    } else {
      sql += ` ORDER BY CASE
        WHEN e.status = 'OVERDUE' OR e.due_date < '${businessToday}' THEN 1
        WHEN e.status = 'DUE_TODAY' OR e.due_date = '${businessToday}' THEN 2
        ELSE 3
      END, GREATEST(e.days_overdue, GREATEST(0, ('${businessToday}'::date - e.due_date))) DESC, e.due_date ASC`;
    }

    sql += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const res = await queryPostgres(sql, params);

    const items = res.rows.map((r) => {
      const evalResult = computeEmiStatus({
        dueDate: r.due_date,
        expectedAmount: Number(r.expected_amount),
        paidAmount: Number(r.paid_amount),
        remainingAmount: Number(r.remaining_amount),
        penaltyAmount: Number(r.penalty_amount || 0),
        businessToday,
      });

      return {
        installmentId: r.installment_id,
        installmentNumber: Number(r.installment_number),
        dueDate: r.due_date,
        expectedAmount: Number(r.expected_amount),
        paidAmount: Number(r.paid_amount),
        remainingAmount: Number(r.remaining_amount),
        penaltyAmount: Number(r.penalty_amount || 0),
        status: evalResult.status,
        daysOverdue: evalResult.daysOverdue,
        loanId: r.loan_id,
        loanAccountNo: r.loan_account_no,
        totalInstallments: Number(r.total_installments),
        totalOutstandingLoan: Number(r.total_loan_outstanding),
        customerId: r.customer_id,
        customerCode: r.customer_code,
        customerName: r.customer_name,
        primaryPhone: r.primary_phone,
        areaRoute: r.area_route,
        addressSummary: r.address_summary,
        lastCallOutcome: r.last_call_outcome,
        promisedPaymentDate: r.promised_payment_date || null,
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Fetch daily collection metrics and target progress for an agent.
   */
  public static async getAgentStats(user: AuthenticatedUser) {
    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');

    // Today's collected by this agent
    const collectedRes = await queryPostgres(
      `SELECT COALESCE(SUM(amount), 0) as total_collected
       FROM payments
       WHERE collected_by_agent_id = $1 
         AND DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $2::date
         AND status = 'SUCCESS' 
         AND is_reversal = FALSE`,
      [user.id, businessToday]
    );

    const totalCollected = Number(collectedRes.rows[0]?.total_collected || 0);

    // Today's expected collection for this agent's queue
    let expectedSql = `
      SELECT COALESCE(SUM(e.expected_amount), 0) as total_expected,
             COUNT(CASE WHEN e.status = 'OVERDUE' OR e.days_overdue > 0 OR e.due_date < $1 THEN 1 END) as overdue_count,
             COUNT(CASE WHEN e.status = 'DUE_TODAY' OR e.due_date = $1 THEN 1 END) as due_today_count
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      WHERE e.status != 'PAID' AND l.status = 'ACTIVE'
    `;
    const params: any[] = [businessToday];

    if (user.role === UserRole.COLLECTION_AGENT) {
      expectedSql += ` AND (
        l.assigned_agent_id = $2
        OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = $2 AND is_active = TRUE)
        OR c.area_route IN (SELECT area_route FROM collection_assignments WHERE agent_id = $2 AND is_active = TRUE)
      )`;
      params.push(user.id);
    }

    const expectedRes = await queryPostgres(expectedSql, params);
    const expRow = expectedRes.rows[0];

    const target = Number(expRow?.total_expected || 0);
    const pending = Math.max(0, target - totalCollected);
    const efficiency = target > 0 ? Math.round((totalCollected / target) * 100) : 100;

    return {
      todayTarget: target,
      todayCollected: totalCollected,
      todayPending: pending,
      collectionEfficiency: efficiency,
      dueTodayCount: Number(expRow?.due_today_count || 0),
      overdueCount: Number(expRow?.overdue_count || 0),
    };
  }

  /**
   * Add a manual late-payment penalty to an overdue EMI installment.
   * Performs authoritative server-side overdue validation, role RBAC, and dealer RLAC.
   */
  public static async addPenalty(
    emiId: string,
    amount: number | string,
    reason: string,
    user: AuthenticatedUser
  ) {
    // 1. Role validation
    if (user.role === UserRole.COLLECTION_AGENT) {
      throw new ForbiddenError('Collection agents are not permitted to add late-payment penalties');
    }

    if (user.role === UserRole.DEALER) {
      const allowed = await SettingsService.isDealerPenaltyAllowed();
      if (!allowed) {
        throw new ForbiddenError('Dealer late-payment penalty creation is disabled by Super Admin');
      }
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
    } else if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenError('You are not authorized to add late-payment penalties');
    }

    // 2. Input validation
    const numAmount = Number(amount);
    if (isNaN(numAmount) || !isFinite(numAmount) || numAmount <= 0) {
      throw new AppError('Penalty amount must be a positive number', 400);
    }

    const penaltyDec = new Decimal(numAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    if (penaltyDec.lessThanOrEqualTo(0)) {
      throw new AppError('Penalty amount must be greater than zero', 400);
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new AppError('Reason is required', 400);
    }

    const trimmedReason = reason.trim();
    const penaltyId = uuidv4();
    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');

    // 3. Atomic transaction execution with row-level locks
    const result = await runPostgresTransaction(async (client) => {
      const emiRes = await client.query(
        `SELECT e.*, l.id as loan_id, l.dealer_id as loan_dealer_id, l.status as loan_status,
                l.outstanding_balance as loan_outstanding, l.loan_account_no,
                c.id as customer_id, c.full_name as customer_name
         FROM emi_installments e
         JOIN loans l ON e.loan_id = l.id
         JOIN customers c ON e.customer_id = c.id
         WHERE e.id = $1
         FOR UPDATE`,
        [emiId]
      );

      if (emiRes.rows.length === 0) {
        throw new NotFoundError('EMI installment not found');
      }

      const emi = emiRes.rows[0];

      // 4. Dealer RLAC check: dealer can only add penalty for loans originated by their store
      if (user.role === UserRole.DEALER && emi.loan_dealer_id !== user.dealerId) {
        throw new ForbiddenError('You are not authorized to add a penalty to another partner store\'s loan');
      }

      // 5. Authoritative server-side overdue validation
      if (emi.loan_status !== 'ACTIVE') {
        throw new AppError(`Cannot add penalty to a loan in ${emi.loan_status} status`, 400);
      }

      if (emi.status === EMIStatus.PAID || Number(emi.remaining_amount) <= 0) {
        throw new AppError('Cannot add penalty to a fully paid installment', 400);
      }

      const dueDate = getBusinessDate(emi.due_date, 'Asia/Kolkata');
      const daysDiff = getDaysDifference(dueDate, businessToday);

      if (daysDiff <= 0) {
        throw new AppError(
          `Penalty can only be applied to overdue installments (due date: ${dueDate}, business today: ${businessToday})`,
          400
        );
      }

      // 6. Insert immutable penalty record into emi_penalties
      await client.query(
        `INSERT INTO emi_penalties (
          id, emi_installment_id, loan_id, amount, paid_amount, status, reason,
          created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 0, 'ACTIVE', $5, $6, NOW(), NOW())`,
        [
          penaltyId,
          emi.id,
          emi.loan_id,
          penaltyDec.toNumber(),
          trimmedReason,
          user.id,
        ]
      );

      // 7. Update emi_installments penalty_amount
      const currentPenalty = new Decimal(emi.penalty_amount || 0);
      const newPenaltyAmount = currentPenalty.plus(penaltyDec).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

      await client.query(
        `UPDATE emi_installments
         SET penalty_amount = $1, updated_at = NOW()
         WHERE id = $2`,
        [newPenaltyAmount.toNumber(), emi.id]
      );

      // 8. Update loans outstanding_balance
      const currentLoanBalance = new Decimal(emi.loan_outstanding);
      const newLoanBalance = currentLoanBalance.plus(penaltyDec).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

      await client.query(
        `UPDATE loans
         SET outstanding_balance = $1, updated_at = NOW()
         WHERE id = $2`,
        [newLoanBalance.toNumber(), emi.loan_id]
      );

      // 9. Record immutable audit log
      await AuditService.logWithClient(client, {
        userId: user.id,
        action: 'PENALTY_ADDED',
        entity: 'EMIPenalty',
        entityId: penaltyId,
        newState: {
          penaltyId,
          emiId: emi.id,
          loanId: emi.loan_id,
          loanAccountNo: emi.loan_account_no,
          installmentNumber: emi.installment_number,
          amount: penaltyDec.toNumber(),
          reason: trimmedReason,
          dueDate,
          daysOverdue: Math.max(Number(emi.days_overdue), daysDiff),
          newPenaltyAmount: newPenaltyAmount.toNumber(),
          newLoanOutstanding: newLoanBalance.toNumber(),
          actorRole: user.role,
          dealerId: user.dealerId || null,
        },
      });

      return {
        penalty: {
          id: penaltyId,
          emiInstallmentId: emi.id,
          loanId: emi.loan_id,
          amount: penaltyDec.toNumber(),
          paidAmount: 0,
          status: 'ACTIVE',
          reason: trimmedReason,
          createdBy: user.id,
          createdAt: new Date().toISOString(),
        },
        installment: {
          id: emi.id,
          installmentNumber: Number(emi.installment_number),
          dueDate,
          daysOverdue: Math.max(Number(emi.days_overdue), daysDiff),
          expectedAmount: Number(emi.expected_amount),
          paidAmount: Number(emi.paid_amount),
          remainingAmount: Number(emi.remaining_amount),
          penaltyAmount: newPenaltyAmount.toNumber(),
          totalDue: new Decimal(emi.remaining_amount).plus(newPenaltyAmount).toNumber(),
          status: emi.status,
        },
        loan: {
          id: emi.loan_id,
          loanAccountNo: emi.loan_account_no,
          outstandingBalance: newLoanBalance.toNumber(),
        },
      };
    });

    return result;
  }

  /**
   * Fetch all penalties for a given EMI installment with RLAC checks.
   */
  public static async getEmiPenalties(emiId: string, user: AuthenticatedUser) {
    const emiRes = await queryPostgres(
      `SELECT e.id, e.installment_number, e.expected_amount, e.paid_amount, e.remaining_amount,
              e.penalty_amount, e.status, e.days_overdue,
              l.id as loan_id, l.dealer_id, l.assigned_agent_id, c.id as customer_id
       FROM emi_installments e
       JOIN loans l ON e.loan_id = l.id
       JOIN customers c ON e.customer_id = c.id
       WHERE e.id = $1`,
      [emiId]
    );

    if (emiRes.rows.length === 0) {
      throw new NotFoundError('EMI installment not found');
    }

    const emi = emiRes.rows[0];

    // RLAC checks
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId || emi.dealer_id !== user.dealerId) {
        throw new ForbiddenError('You are not authorized to view penalties for another partner store');
      }
    } else if (user.role === UserRole.COLLECTION_AGENT) {
      const isDirectAgent = emi.assigned_agent_id === user.id;
      if (!isDirectAgent) {
        const assignRes = await queryPostgres(
          `SELECT id FROM collection_assignments
           WHERE agent_id = $1 AND customer_id = $2 AND is_active = TRUE
           LIMIT 1`,
          [user.id, emi.customer_id]
        );
        if (assignRes.rows.length === 0) {
          throw new ForbiddenError('You are not authorized to view penalties for this customer');
        }
      }
    }

    const penRes = await queryPostgres(
      `SELECT p.*, u.full_name as created_by_name, ru.full_name as reversed_by_name
       FROM emi_penalties p
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN users ru ON p.reversed_by = ru.id
       WHERE p.emi_installment_id = $1
       ORDER BY p.created_at ASC`,
      [emiId]
    );

    const penalties = penRes.rows.map((p) => ({
      id: p.id,
      emiInstallmentId: p.emi_installment_id,
      loanId: p.loan_id,
      amount: Number(p.amount),
      paidAmount: Number(p.paid_amount || 0),
      status: p.status,
      reason: p.reason,
      createdBy: p.created_by,
      createdByName: p.created_by_name,
      createdAt: p.created_at,
      reversedBy: p.reversed_by,
      reversedByName: p.reversed_by_name,
      reversedAt: p.reversed_at,
      reversalReason: p.reversal_reason,
    }));

    const activePenaltyTotal = penalties
      .filter((p) => p.status === 'ACTIVE')
      .reduce((sum, p) => sum + (p.amount - p.paidAmount), 0);

    return {
      emiId,
      installmentNumber: Number(emi.installment_number),
      penaltyAmount: Number(emi.penalty_amount),
      activePenaltyTotal: toFixed2(activePenaltyTotal),
      penalties,
    };
  }

  /**
   * Reverse or waive a late-payment penalty (ADMIN / SUPER_ADMIN only).
   */
  public static async reverseOrWaivePenalty(
    penaltyId: string,
    action: 'REVERSE' | 'WAIVE',
    reason: string,
    user: AuthenticatedUser
  ) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN) {
      throw new ForbiddenError('Only administrators can reverse or waive penalties');
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new AppError('Reason is required', 400);
    }

    const targetStatus = action === 'WAIVE' ? 'WAIVED' : 'REVERSED';
    const auditAction = action === 'WAIVE' ? 'PENALTY_WAIVED' : 'PENALTY_REVERSED';

    const result = await runPostgresTransaction(async (client) => {
      const penRes = await client.query(
        `SELECT p.*, e.id as emi_id, e.penalty_amount, e.expected_amount, e.paid_amount, e.remaining_amount,
                l.id as loan_id, l.outstanding_balance, l.loan_account_no
         FROM emi_penalties p
         JOIN emi_installments e ON p.emi_installment_id = e.id
         JOIN loans l ON p.loan_id = l.id
         WHERE p.id = $1
         FOR UPDATE`,
        [penaltyId]
      );

      if (penRes.rows.length === 0) {
        throw new NotFoundError('Penalty not found');
      }

      const pen = penRes.rows[0];

      if (pen.status !== 'ACTIVE') {
        throw new AppError(`Cannot ${action.toLowerCase()} a penalty in ${pen.status} status`, 400);
      }

      // Unpaid portion of this penalty to unwind
      const penAmount = new Decimal(pen.amount);
      const penPaid = new Decimal(pen.paid_amount || 0);
      const unpaidPortion = penAmount.minus(penPaid);

      // 1. Update penalty status
      await client.query(
        `UPDATE emi_penalties
         SET status = $1, reversed_by = $2, reversed_at = NOW(), reversal_reason = $3, updated_at = NOW()
         WHERE id = $4`,
        [targetStatus, user.id, reason.trim(), penaltyId]
      );

      // 2. Adjust emi_installments penalty_amount
      const currentEmiPenalty = new Decimal(pen.penalty_amount || 0);
      const newEmiPenalty = Decimal.max(0, currentEmiPenalty.minus(unpaidPortion)).toDecimalPlaces(
        2,
        Decimal.ROUND_HALF_EVEN
      );

      await client.query(
        `UPDATE emi_installments
         SET penalty_amount = $1, updated_at = NOW()
         WHERE id = $2`,
        [newEmiPenalty.toNumber(), pen.emi_id]
      );

      // 3. Adjust loans outstanding_balance
      const currentLoanBalance = new Decimal(pen.outstanding_balance);
      const newLoanBalance = Decimal.max(0, currentLoanBalance.minus(unpaidPortion)).toDecimalPlaces(
        2,
        Decimal.ROUND_HALF_EVEN
      );

      await client.query(
        `UPDATE loans
         SET outstanding_balance = $1, updated_at = NOW()
         WHERE id = $2`,
        [newLoanBalance.toNumber(), pen.loan_id]
      );

      // 4. Immutable Audit Record
      await AuditService.logWithClient(client, {
        userId: user.id,
        action: auditAction,
        entity: 'EMIPenalty',
        entityId: penaltyId,
        newState: {
          penaltyId,
          emiId: pen.emi_id,
          loanId: pen.loan_id,
          loanAccountNo: pen.loan_account_no,
          originalAmount: penAmount.toNumber(),
          unpaidPortionUnwound: unpaidPortion.toNumber(),
          status: targetStatus,
          reason: reason.trim(),
          newEmiPenalty: newEmiPenalty.toNumber(),
          newLoanOutstanding: newLoanBalance.toNumber(),
        },
      });

      return {
        penaltyId,
        status: targetStatus,
        unpaidPortionUnwound: unpaidPortion.toNumber(),
        newEmiPenalty: newEmiPenalty.toNumber(),
        newLoanOutstanding: newLoanBalance.toNumber(),
      };
    });

    return result;
  }
}
