import { queryPostgres } from '../../database/postgres';
import { EMIStatus, UserRole, getBusinessDate } from '@crm/shared';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';

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
      sql += ` AND (e.status = 'OVERDUE' OR e.days_overdue > 0)`;
    } else if (filters.status === 'UPCOMING') {
      sql += ` AND e.status = 'UPCOMING' AND e.due_date > $${paramIndex++}`;
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

    // Dynamic ordering: default is business priority (Overdue -> Due Today -> Upcoming)
    if (filters.sortBy === 'days_overdue') {
      const order = filters.sortOrder === 'ASC' ? 'ASC' : 'DESC';
      sql += ` ORDER BY e.days_overdue ${order}, e.due_date ASC`;
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
        WHEN e.status = 'OVERDUE' THEN 1 
        WHEN e.status = 'DUE_TODAY' THEN 2 
        ELSE 3 
      END, e.days_overdue DESC, e.due_date ASC`;
    }

    sql += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const res = await queryPostgres(sql, params);

    const items = res.rows.map((r) => ({
      installmentId: r.installment_id,
      installmentNumber: Number(r.installment_number),
      dueDate: r.due_date,
      expectedAmount: Number(r.expected_amount),
      paidAmount: Number(r.paid_amount),
      remainingAmount: Number(r.remaining_amount),
      penaltyAmount: Number(r.penalty_amount),
      status: r.emi_status,
      daysOverdue: Number(r.days_overdue),
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
    }));

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
             COUNT(CASE WHEN e.status = 'OVERDUE' OR e.days_overdue > 0 THEN 1 END) as overdue_count,
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
}
