import { queryPostgres } from '../../database/postgres';
import {
  IDashboardStats,
  LoanStatus,
  PaymentStatus,
  PaymentMode,
  UserRole,
  getBusinessDate,
} from '@crm/shared';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { ForbiddenError, BadRequestError } from '../../middlewares/error.middleware';

export interface DailyCollectionFilters {
  date?: string;
  startDate?: string;
  endDate?: string;
  agentId?: string;
  mode?: string;
  route?: string;
  page?: number;
  limit?: number;
}

export interface OverdueParFilters {
  bucket?: '1-30' | '31-60' | '61-90' | '90+' | 'ALL';
  route?: string;
  agentId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export class ReportService {
  /**
   * Executive dashboard financial metrics with live PostgreSQL queries, Asia/Kolkata timezone handling,
   * and strict role-based portfolio scoping.
   */
  public static async getDashboardStats(user?: AuthenticatedUser): Promise<IDashboardStats> {
    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const isAgent = user?.role === UserRole.COLLECTION_AGENT;

    // 1. Total Active Loans and Total Outstanding
    let loansSql = `
      SELECT 
        COUNT(*)::int as total_active_loans,
        COALESCE(SUM(l.outstanding_balance), 0)::numeric as total_outstanding
      FROM loans l
      JOIN customers c ON l.customer_id = c.id
      WHERE l.status = 'ACTIVE' AND c.deleted_at IS NULL
    `;
    const loansParams: any[] = [];
    if (isAgent) {
      loansSql += ` AND (
        l.assigned_agent_id = $1 
        OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = $1 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
        OR c.area_route IN (SELECT area_route FROM collection_assignments WHERE agent_id = $1 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
      )`;
      loansParams.push(user!.id);
    }
    const loansRes = await queryPostgres(loansSql, loansParams);
    const loansRow = loansRes.rows[0];

    // 2. Today's Expected Collection
    let expectedSql = `
      SELECT COALESCE(SUM(e.expected_amount), 0)::numeric as today_expected
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      WHERE l.status = 'ACTIVE' AND c.deleted_at IS NULL AND (e.status = 'DUE_TODAY' OR e.due_date = $1)
    `;
    const expectedParams: any[] = [businessToday];
    if (isAgent) {
      expectedSql += ` AND (
        l.assigned_agent_id = $2 
        OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = $2 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
        OR c.area_route IN (SELECT area_route FROM collection_assignments WHERE agent_id = $2 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
      )`;
      expectedParams.push(user!.id);
    }
    const todayExpectedRes = await queryPostgres(expectedSql, expectedParams);
    const todayExpectedRow = todayExpectedRes.rows[0];

    // 3. Today's Collected Amount (Asia/Kolkata timezone)
    let collectedSql = `
      SELECT COALESCE(SUM(amount), 0)::numeric as today_collected
      FROM payments
      WHERE DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date
        AND status = 'SUCCESS' 
        AND is_reversal = FALSE
    `;
    const collectedParams: any[] = [businessToday];
    if (isAgent) {
      collectedSql += ` AND collected_by_agent_id = $2`;
      collectedParams.push(user!.id);
    }
    const todayCollectedRes = await queryPostgres(collectedSql, collectedParams);
    const todayCollectedRow = todayCollectedRes.rows[0];

    // 4. Overdue Amount and Overdue Customers Count
    let overdueSql = `
      SELECT 
        COALESCE(SUM(e.remaining_amount + e.penalty_amount), 0)::numeric as total_overdue_amount,
        COUNT(DISTINCT e.customer_id)::int as total_overdue_customers
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      WHERE l.status = 'ACTIVE' AND c.deleted_at IS NULL AND (e.status = 'OVERDUE' OR e.days_overdue > 0)
    `;
    const overdueParams: any[] = [];
    if (isAgent) {
      overdueSql += ` AND (
        l.assigned_agent_id = $1 
        OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = $1 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
        OR c.area_route IN (SELECT area_route FROM collection_assignments WHERE agent_id = $1 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
      )`;
      overdueParams.push(user!.id);
    }
    const overdueRes = await queryPostgres(overdueSql, overdueParams);
    const overdueRow = overdueRes.rows[0];

    // 5. Aging Buckets (PAR - Portfolio at Risk)
    const getAgingBucket = async (minDays: number, maxDays?: number) => {
      let agingSql = `
        SELECT COALESCE(SUM(e.remaining_amount), 0)::numeric as amount
        FROM emi_installments e 
        JOIN loans l ON e.loan_id = l.id
        JOIN customers c ON e.customer_id = c.id
        WHERE l.status = 'ACTIVE' AND c.deleted_at IS NULL AND e.status != 'PAID'
      `;
      const p: any[] = [];
      let idx = 1;
      if (maxDays !== undefined) {
        agingSql += ` AND e.days_overdue BETWEEN $${idx++} AND $${idx++}`;
        p.push(minDays, maxDays);
      } else {
        agingSql += ` AND e.days_overdue >= $${idx++}`;
        p.push(minDays);
      }

      if (isAgent) {
        agingSql += ` AND (
          l.assigned_agent_id = $${idx} 
          OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = $${idx} AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
          OR c.area_route IN (SELECT area_route FROM collection_assignments WHERE agent_id = $${idx} AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
        )`;
        p.push(user!.id);
      }

      const res = await queryPostgres(agingSql, p);
      return Number(res.rows[0]?.amount || 0);
    };

    const [bucket0To30, bucket31To60, bucket61To90, bucket90Plus] = await Promise.all([
      getAgingBucket(1, 30),
      getAgingBucket(31, 60),
      getAgingBucket(61, 90),
      getAgingBucket(91),
    ]);

    // 6. Recent Payments
    let recentSql = `
      SELECT p.id, p.receipt_number, p.amount::numeric, p.payment_mode, p.payment_timestamp,
             p.status, p.is_reversal,
             l.loan_account_no, c.full_name as customer_name, u.full_name as collected_by_name
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.collected_by_agent_id = u.id
      WHERE 1=1
    `;
    const recentParams: any[] = [];
    if (isAgent) {
      recentSql += ` AND p.collected_by_agent_id = $1`;
      recentParams.push(user!.id);
    }
    recentSql += ` ORDER BY p.payment_timestamp DESC LIMIT 8`;
    const recentPaymentsRes = await queryPostgres(recentSql, recentParams);

    const todayExpected = Number(todayExpectedRow?.today_expected || 0);
    const todayCollected = Number(todayCollectedRow?.today_collected || 0);
    const todayPending = Math.max(0, todayExpected - todayCollected);
    const efficiency = todayExpected > 0 ? Math.min(100, Math.round((todayCollected / todayExpected) * 100)) : 100;

    return {
      totalActiveLoans: Number(loansRow?.total_active_loans || 0),
      totalOutstandingAmount: Number(loansRow?.total_outstanding || 0),
      todayExpectedCollection: todayExpected,
      todayCollectedAmount: todayCollected,
      todayPendingCollection: todayPending,
      totalOverdueAmount: Number(overdueRow?.total_overdue_amount || 0),
      totalOverdueCustomers: Number(overdueRow?.total_overdue_customers || 0),
      collectionEfficiencyPercent: efficiency,
      agingBuckets: {
        bucket0To30,
        bucket31To60,
        bucket61To90,
        bucket90Plus,
      },
      recentPayments: recentPaymentsRes.rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
      })),
    };
  }

  /**
   * Daily collection ledger report with filters for date range, agent, route, and payment mode.
   */
  public static async getDailyCollectionReport(
    filters: DailyCollectionFilters,
    user?: AuthenticatedUser
  ) {
    const isAgent = user?.role === UserRole.COLLECTION_AGENT;
    let sql = `
      SELECT p.id, p.receipt_number, p.amount::numeric, p.payment_mode, p.reference_number,
             p.payment_timestamp, p.status, p.is_reversal,
             l.loan_account_no, c.full_name as customer_name, c.customer_code, c.area_route, c.primary_phone,
             u.full_name as collected_by_name
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.collected_by_agent_id = u.id
      WHERE p.status = 'SUCCESS' AND p.is_reversal = FALSE
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Date filtering
    if (filters.startDate && filters.endDate) {
      sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') BETWEEN $${paramIndex++}::date AND $${paramIndex++}::date`;
      params.push(filters.startDate, filters.endDate);
    } else if (filters.date) {
      sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $${paramIndex++}::date`;
      params.push(filters.date);
    } else if (!filters.startDate && !filters.endDate) {
      const today = getBusinessDate(undefined, 'Asia/Kolkata');
      sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $${paramIndex++}::date`;
      params.push(today);
    }

    // Agent scoping / filter
    if (isAgent) {
      sql += ` AND p.collected_by_agent_id = $${paramIndex++}`;
      params.push(user!.id);
    } else if (filters.agentId) {
      sql += ` AND p.collected_by_agent_id = $${paramIndex++}`;
      params.push(filters.agentId);
    }

    if (filters.mode) {
      sql += ` AND p.payment_mode = $${paramIndex++}`;
      params.push(filters.mode);
    }

    if (filters.route) {
      sql += ` AND c.area_route = $${paramIndex++}`;
      params.push(filters.route);
    }

    // Total metrics query before pagination
    const totalSql = `
      SELECT 
        COUNT(*)::int as total_count,
        COALESCE(SUM(amount), 0)::numeric as total_collected,
        COALESCE(SUM(CASE WHEN payment_mode = 'CASH' THEN amount ELSE 0 END), 0)::numeric as cash_collected,
        COALESCE(SUM(CASE WHEN payment_mode = 'UPI' THEN amount ELSE 0 END), 0)::numeric as upi_collected,
        COALESCE(SUM(CASE WHEN payment_mode = 'BANK_TRANSFER' THEN amount ELSE 0 END), 0)::numeric as bank_transfer_collected,
        COALESCE(SUM(CASE WHEN payment_mode = 'CHEQUE' THEN amount ELSE 0 END), 0)::numeric as cheque_collected
      FROM (${sql}) sub
    `;
    const totalsRes = await queryPostgres(totalSql, params);
    const totals = totalsRes.rows[0];

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = filters.limit ? Math.min(200, Math.max(1, Number(filters.limit))) : 100;
    const offset = (page - 1) * limit;

    sql += ` ORDER BY p.payment_timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const res = await queryPostgres(sql, params);
    const records = res.rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
    }));

    return {
      date: filters.date || filters.startDate || getBusinessDate(undefined, 'Asia/Kolkata'),
      totalCount: Number(totals?.total_count || 0),
      totalCollected: Number(totals?.total_collected || 0),
      modeBreakdown: {
        cash: Number(totals?.cash_collected || 0),
        upi: Number(totals?.upi_collected || 0),
        bankTransfer: Number(totals?.bank_transfer_collected || 0),
        cheque: Number(totals?.cheque_collected || 0),
      },
      records,
      page,
      limit,
      totalPages: Math.ceil(Number(totals?.total_count || 0) / limit),
    };
  }

  /**
   * Overdue and Portfolio-at-Risk (PAR) aging report.
   */
  public static async getOverdueParReport(
    filters: OverdueParFilters,
    user?: AuthenticatedUser
  ) {
    const isAgent = user?.role === UserRole.COLLECTION_AGENT;

    let baseSql = `
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      LEFT JOIN users u ON l.assigned_agent_id = u.id
      WHERE l.status = 'ACTIVE' AND c.deleted_at IS NULL AND e.status != 'PAID' AND (e.status = 'OVERDUE' OR e.days_overdue > 0)
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (isAgent) {
      baseSql += ` AND (
        l.assigned_agent_id = $${paramIndex} 
        OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = $${paramIndex} AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
        OR c.area_route IN (SELECT area_route FROM collection_assignments WHERE agent_id = $${paramIndex} AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE))
      )`;
      params.push(user!.id);
      paramIndex++;
    } else if (filters.agentId) {
      baseSql += ` AND (l.assigned_agent_id = $${paramIndex++} OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = $${paramIndex - 1} AND is_active = TRUE))`;
      params.push(filters.agentId);
    }

    if (filters.route) {
      baseSql += ` AND c.area_route = $${paramIndex++}`;
      params.push(filters.route);
    }

    if (filters.search) {
      const s = `%${filters.search}%`;
      baseSql += ` AND (c.full_name ILIKE $${paramIndex} OR c.primary_phone ILIKE $${paramIndex} OR c.customer_code ILIKE $${paramIndex} OR l.loan_account_no ILIKE $${paramIndex})`;
      params.push(s);
      paramIndex++;
    }

    // Compute PAR Summary across buckets
    const summarySql = `
      SELECT 
        COUNT(DISTINCT e.id)::int as total_overdue_installments,
        COUNT(DISTINCT l.id)::int as total_overdue_loans,
        COUNT(DISTINCT c.id)::int as total_overdue_customers,
        COALESCE(SUM(e.remaining_amount + e.penalty_amount), 0)::numeric as total_overdue_amount,
        COALESCE(SUM(e.remaining_amount), 0)::numeric as total_principal_interest_overdue,
        COALESCE(SUM(e.penalty_amount), 0)::numeric as total_penalty_overdue,
        -- Bucket 1-30
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 1 AND 30 THEN e.id END)::int as par_1_30_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 1 AND 30 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as par_1_30_amount,
        -- Bucket 31-60
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 31 AND 60 THEN e.id END)::int as par_31_60_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 31 AND 60 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as par_31_60_amount,
        -- Bucket 61-90
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 61 AND 90 THEN e.id END)::int as par_61_90_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 61 AND 90 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as par_61_90_amount,
        -- Bucket 90+
        COUNT(DISTINCT CASE WHEN e.days_overdue > 90 THEN e.id END)::int as par_90_plus_count,
        COALESCE(SUM(CASE WHEN e.days_overdue > 90 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as par_90_plus_amount
      ${baseSql}
    `;
    const summaryRes = await queryPostgres(summarySql, params);
    const summary = summaryRes.rows[0];

    // Filter by specific bucket if requested
    let itemizedSql = `
      SELECT 
        e.id as installment_id,
        e.installment_number,
        e.due_date,
        e.expected_amount::numeric,
        e.paid_amount::numeric,
        e.remaining_amount::numeric,
        e.penalty_amount::numeric,
        (e.remaining_amount + e.penalty_amount)::numeric as total_overdue_amount,
        e.days_overdue,
        e.status as emi_status,
        e.last_payment_date,
        l.id as loan_id,
        l.loan_account_no,
        l.outstanding_balance::numeric as loan_outstanding,
        c.id as customer_id,
        c.customer_code,
        c.full_name as customer_name,
        c.primary_phone,
        c.area_route,
        u.full_name as assigned_agent_name
      ${baseSql}
    `;

    if (filters.bucket === '1-30') {
      itemizedSql += ` AND e.days_overdue BETWEEN 1 AND 30`;
    } else if (filters.bucket === '31-60') {
      itemizedSql += ` AND e.days_overdue BETWEEN 31 AND 60`;
    } else if (filters.bucket === '61-90') {
      itemizedSql += ` AND e.days_overdue BETWEEN 61 AND 90`;
    } else if (filters.bucket === '90+') {
      itemizedSql += ` AND e.days_overdue > 90`;
    }

    const countSql = `SELECT COUNT(*) as total FROM (${itemizedSql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const offset = (page - 1) * limit;

    itemizedSql += ` ORDER BY e.days_overdue DESC, e.due_date ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const recordsRes = await queryPostgres(itemizedSql, params);
    const records = recordsRes.rows.map((r) => ({
      installmentId: r.installment_id,
      installmentNumber: Number(r.installment_number),
      dueDate: r.due_date instanceof Date ? r.due_date.toISOString().slice(0, 10) : String(r.due_date),
      expectedAmount: Number(r.expected_amount),
      paidAmount: Number(r.paid_amount),
      remainingAmount: Number(r.remaining_amount),
      penaltyAmount: Number(r.penalty_amount),
      totalOverdueAmount: Number(r.total_overdue_amount),
      daysOverdue: Number(r.days_overdue),
      status: r.emi_status,
      lastPaymentDate: r.last_payment_date ? (r.last_payment_date instanceof Date ? r.last_payment_date.toISOString().slice(0, 10) : String(r.last_payment_date)) : null,
      loanId: r.loan_id,
      loanAccountNo: r.loan_account_no,
      loanOutstanding: Number(r.loan_outstanding),
      customerId: r.customer_id,
      customerCode: r.customer_code,
      customerName: r.customer_name,
      primaryPhone: r.primary_phone,
      areaRoute: r.area_route,
      assignedAgentName: r.assigned_agent_name,
    }));

    return {
      summary: {
        totalOverdueAmount: Number(summary?.total_overdue_amount || 0),
        totalPrincipalInterestOverdue: Number(summary?.total_principal_interest_overdue || 0),
        totalPenaltyOverdue: Number(summary?.total_penalty_overdue || 0),
        totalOverdueInstallments: Number(summary?.total_overdue_installments || 0),
        totalOverdueLoans: Number(summary?.total_overdue_loans || 0),
        totalOverdueCustomers: Number(summary?.total_overdue_customers || 0),
        parBuckets: {
          par1To30: {
            count: Number(summary?.par_1_30_count || 0),
            amount: Number(summary?.par_1_30_amount || 0),
          },
          par31To60: {
            count: Number(summary?.par_31_60_count || 0),
            amount: Number(summary?.par_31_60_amount || 0),
          },
          par61To90: {
            count: Number(summary?.par_61_90_count || 0),
            amount: Number(summary?.par_61_90_amount || 0),
          },
          par90Plus: {
            count: Number(summary?.par_90_plus_count || 0),
            amount: Number(summary?.par_90_plus_amount || 0),
          },
        },
      },
      records,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Agent performance rankings based on collection efficiency, lifetime collections, and activity.
   */
  public static async getAgentPerformanceReport() {
    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const res = await queryPostgres(`
      SELECT 
        u.id as agent_id,
        u.full_name as agent_name,
        u.phone as agent_phone,
        u.assigned_branch,
        (SELECT COUNT(DISTINCT ca.customer_id)::int FROM collection_assignments ca WHERE ca.agent_id = u.id AND ca.is_active = TRUE AND (ca.effective_to IS NULL OR ca.effective_to >= CURRENT_DATE)) as assigned_customers_count,
        (SELECT COALESCE(SUM(p.amount), 0)::numeric FROM payments p WHERE p.collected_by_agent_id = u.id AND p.status = 'SUCCESS' AND p.is_reversal = FALSE) as total_lifetime_collected,
        (SELECT COUNT(*)::int FROM payments p WHERE p.collected_by_agent_id = u.id AND p.status = 'SUCCESS' AND p.is_reversal = FALSE) as total_payments_collected_count,
        (SELECT COALESCE(SUM(p.amount), 0)::numeric FROM payments p WHERE p.collected_by_agent_id = u.id AND p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date) as today_collected,
        (SELECT COUNT(*)::int FROM call_logs cl WHERE cl.agent_id = u.id) as total_calls_logged,
        (SELECT COUNT(DISTINCT e.id)::int 
         FROM emi_installments e 
         JOIN loans l ON e.loan_id = l.id 
         JOIN customers c ON e.customer_id = c.id
         WHERE l.status = 'ACTIVE' AND e.status != 'PAID' AND (e.status = 'OVERDUE' OR e.days_overdue > 0)
           AND (l.assigned_agent_id = u.id OR c.id IN (SELECT customer_id FROM collection_assignments WHERE agent_id = u.id AND is_active = TRUE))
        ) as active_overdue_emis_count
      FROM users u
      WHERE u.role = 'COLLECTION_AGENT' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      ORDER BY total_lifetime_collected DESC
    `, [businessToday]);

    return res.rows.map((r) => ({
      ...r,
      total_lifetime_collected: Number(r.total_lifetime_collected),
      today_collected: Number(r.today_collected),
      assigned_customers_count: Number(r.assigned_customers_count),
      total_payments_collected_count: Number(r.total_payments_collected_count),
      total_calls_logged: Number(r.total_calls_logged),
      active_overdue_emis_count: Number(r.active_overdue_emis_count),
    }));
  }

  /**
   * Generate sanitized, stream-safe CSV export for authorized entities.
   */
  public static async generateCsvExport(
    type: 'daily-collections' | 'overdue-par' | 'agent-performance' | 'customers',
    filters: any,
    user: AuthenticatedUser
  ): Promise<{ filename: string; csvContent: string }> {
    // Only Admin / Super Admin / Branch Manager can export organization-wide records
    if (user.role === UserRole.COLLECTION_AGENT && type !== 'daily-collections') {
      throw new ForbiddenError('Collection agents can only export their own daily collection records');
    }

    const sanitizeField = (val: unknown): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const todayStr = getBusinessDate(undefined, 'Asia/Kolkata');

    if (type === 'daily-collections') {
      const report = await this.getDailyCollectionReport({ ...filters, limit: 10000, page: 1 }, user);
      const headers = [
        'Receipt Number',
        'Date & Time',
        'Customer Code',
        'Customer Name',
        'Primary Phone',
        'Loan Account',
        'Area / Route',
        'Amount (INR)',
        'Payment Mode',
        'Reference No',
        'Collected By',
        'Status',
      ];

      const rows = report.records.map((r) => [
        sanitizeField(r.receipt_number),
        sanitizeField(r.payment_timestamp),
        sanitizeField(r.customer_code),
        sanitizeField(r.customer_name),
        sanitizeField(r.primary_phone),
        sanitizeField(r.loan_account_no),
        sanitizeField(r.area_route),
        sanitizeField(Number(r.amount).toFixed(2)),
        sanitizeField(r.payment_mode),
        sanitizeField(r.reference_number || ''),
        sanitizeField(r.collected_by_name),
        sanitizeField(r.status),
      ]);

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      return {
        filename: `daily_collections_${filters.date || todayStr}.csv`,
        csvContent,
      };
    }

    if (type === 'overdue-par') {
      const report = await this.getOverdueParReport({ ...filters, limit: 10000, page: 1 }, user);
      const headers = [
        'Loan Account',
        'Customer Code',
        'Customer Name',
        'Primary Phone',
        'Area / Route',
        'Installment No',
        'Due Date',
        'Days Overdue',
        'Expected Amount (INR)',
        'Paid Amount (INR)',
        'Remaining Amount (INR)',
        'Penalty (INR)',
        'Total Overdue (INR)',
        'Assigned Agent',
      ];

      const rows = report.records.map((r) => [
        sanitizeField(r.loanAccountNo),
        sanitizeField(r.customerCode),
        sanitizeField(r.customerName),
        sanitizeField(r.primaryPhone),
        sanitizeField(r.areaRoute),
        sanitizeField(r.installmentNumber),
        sanitizeField(r.dueDate),
        sanitizeField(r.daysOverdue),
        sanitizeField(Number(r.expectedAmount).toFixed(2)),
        sanitizeField(Number(r.paidAmount).toFixed(2)),
        sanitizeField(Number(r.remainingAmount).toFixed(2)),
        sanitizeField(Number(r.penaltyAmount).toFixed(2)),
        sanitizeField(Number(r.totalOverdueAmount).toFixed(2)),
        sanitizeField(r.assignedAgentName || 'Unassigned'),
      ]);

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      return {
        filename: `overdue_par_report_${todayStr}.csv`,
        csvContent,
      };
    }

    if (type === 'agent-performance') {
      const report = await this.getAgentPerformanceReport();
      const headers = [
        'Agent Name',
        'Phone',
        'Assigned Branch',
        'Active Assigned Customers',
        'Lifetime Collected (INR)',
        'Total Payments Count',
        'Today Collected (INR)',
        'Total Calls Logged',
        'Active Overdue EMIs in Portfolio',
      ];

      const rows = report.map((r) => [
        sanitizeField(r.agent_name),
        sanitizeField(r.agent_phone),
        sanitizeField(r.assigned_branch || 'N/A'),
        sanitizeField(r.assigned_customers_count),
        sanitizeField(Number(r.total_lifetime_collected).toFixed(2)),
        sanitizeField(r.total_payments_collected_count),
        sanitizeField(Number(r.today_collected).toFixed(2)),
        sanitizeField(r.total_calls_logged),
        sanitizeField(r.active_overdue_emis_count),
      ]);

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      return {
        filename: `agent_performance_report_${todayStr}.csv`,
        csvContent,
      };
    }

    if (type === 'customers') {
      const res = await queryPostgres(`
        SELECT c.customer_code, c.full_name, c.primary_phone, c.area_route, c.city, c.state, c.pincode,
               c.is_active, c.created_at,
               (SELECT COUNT(*) FROM loans l WHERE l.customer_id = c.id AND l.status = 'ACTIVE') as active_loans_count,
               (SELECT COALESCE(SUM(l.outstanding_balance), 0) FROM loans l WHERE l.customer_id = c.id AND l.status = 'ACTIVE') as total_outstanding
        FROM customers c
        WHERE c.deleted_at IS NULL
        ORDER BY c.created_at DESC
        LIMIT 10000
      `);

      const headers = [
        'Customer Code',
        'Full Name',
        'Primary Phone',
        'Area / Route',
        'City',
        'State',
        'Pincode',
        'Active Loans',
        'Total Outstanding (INR)',
        'Status',
        'Registration Date',
      ];

      const rows = res.rows.map((r) => [
        sanitizeField(r.customer_code),
        sanitizeField(r.full_name),
        sanitizeField(r.primary_phone),
        sanitizeField(r.area_route),
        sanitizeField(r.city),
        sanitizeField(r.state),
        sanitizeField(r.pincode),
        sanitizeField(r.active_loans_count),
        sanitizeField(Number(r.total_outstanding).toFixed(2)),
        sanitizeField(r.is_active ? 'ACTIVE' : 'INACTIVE'),
        sanitizeField(r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : String(r.created_at)),
      ]);

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      return {
        filename: `customers_export_${todayStr}.csv`,
        csvContent,
      };
    }

    throw new BadRequestError(`Unsupported export type: ${type}`);
  }
}
