import { queryPostgres } from '../../database/postgres';
import {
  IDashboardStats,
  IFinanceDashboardStats,
  IFinanceReportResponse,
  IFinanceReportSummary,
  FinanceReportCategory,
  FinanceReportType,
  LoanStatus,
  PaymentStatus,
  PaymentMode,
  CollectionSource,
  UserRole,
  getBusinessDate,
} from '@crm/shared';
import Decimal from 'decimal.js';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { ForbiddenError, BadRequestError } from '../../middlewares/error.middleware';
import { GoogleSheetsService, ISheetExportResult } from './google-sheets.service';

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

export interface FinanceReportFilters {
  category?: FinanceReportCategory;
  reportType?: FinanceReportType;
  startDate?: string;
  endDate?: string;
  dealerId?: string;
  agentId?: string;
  collectionSource?: CollectionSource;
  paymentMode?: PaymentMode;
  paymentStatus?: PaymentStatus;
  loanStatus?: LoanStatus;
  bucket?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Resolves date presets in Asia/Kolkata business timezone
 */
export function resolveDateRange(
  preset?: string,
  startDate?: string,
  endDate?: string
): { startDate: string; endDate: string; preset: string } {
  const today = getBusinessDate(undefined, 'Asia/Kolkata');
  if (startDate && endDate) {
    return { startDate, endDate, preset: preset || 'custom' };
  }

  const [y, m, d] = today.split('-').map(Number);
  const now = new Date(Date.UTC(y, m - 1, d));

  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today, preset: 'today' };
    case 'yesterday': {
      const yDate = new Date(now);
      yDate.setUTCDate(yDate.getUTCDate() - 1);
      const yStr = yDate.toISOString().slice(0, 10);
      return { startDate: yStr, endDate: yStr, preset: 'yesterday' };
    }
    case 'this-week': {
      const dayOfWeek = now.getUTCDay();
      const diffToMonday = (dayOfWeek + 6) % 7;
      const monday = new Date(now);
      monday.setUTCDate(monday.getUTCDate() - diffToMonday);
      return { startDate: monday.toISOString().slice(0, 10), endDate: today, preset: 'this-week' };
    }
    case 'this-month': {
      const startOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
      return { startDate: startOfMonth, endDate: today, preset: 'this-month' };
    }
    case 'last-month': {
      const lastMonthDate = new Date(Date.UTC(y, m - 2, 1));
      const lmY = lastMonthDate.getUTCFullYear();
      const lmM = lastMonthDate.getUTCMonth() + 1;
      const lastDayOfLm = new Date(Date.UTC(lmY, lmM, 0)).getUTCDate();
      return {
        startDate: `${lmY}-${String(lmM).padStart(2, '0')}-01`,
        endDate: `${lmY}-${String(lmM).padStart(2, '0')}-${String(lastDayOfLm).padStart(2, '0')}`,
        preset: 'last-month',
      };
    }
    case 'this-quarter': {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const startOfQuarter = `${y}-${String(qStartMonth).padStart(2, '0')}-01`;
      return { startDate: startOfQuarter, endDate: today, preset: 'this-quarter' };
    }
    case 'this-year': {
      return { startDate: `${y}-01-01`, endDate: `${y}-12-31`, preset: 'this-year' };
    }
    case 'all': {
      return { startDate: '2020-01-01', endDate: '2099-12-31', preset: 'all' };
    }
    default: {
      const startOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
      return { startDate: startOfMonth, endDate: today, preset: 'this-month' };
    }
  }
}

export class ReportService {
  /**
   * Executive Command Finance Dashboard (Task 8)
   */
  public static async getFinanceDashboard(
    user: AuthenticatedUser,
    query: {
      preset?: string;
      startDate?: string;
      endDate?: string;
    } = {}
  ): Promise<IFinanceDashboardStats> {
    if (user.role === UserRole.COLLECTION_AGENT) {
      throw new ForbiddenError('Collection agents cannot access the executive finance dashboard');
    }

    const { startDate, endDate, preset } = resolveDateRange(query.preset, query.startDate, query.endDate);
    const todayStr = getBusinessDate(undefined, 'Asia/Kolkata');
    const monthStart = `${todayStr.slice(0, 7)}-01`;

    // 1. Top KPIs: Disbursed Amount in period
    const disbursedRes = await queryPostgres(`
      SELECT 
        COALESCE(SUM(principal_amount), 0)::numeric as total_disbursed,
        COUNT(*)::int as loan_count
      FROM loans
      WHERE disbursement_date BETWEEN $1 AND $2
        AND status IN ('ACTIVE', 'CLOSED', 'DEFAULTED')
    `, [startDate, endDate]);
    const totalDisbursed = Number(disbursedRes.rows[0]?.total_disbursed || 0);
    const disbursedLoanCount = Number(disbursedRes.rows[0]?.loan_count || 0);

    // Active Portfolio & Active Loans
    const activeLoansRes = await queryPostgres(`
      SELECT 
        COALESCE(SUM(outstanding_balance), 0)::numeric as active_portfolio,
        COUNT(*)::int as active_count
      FROM loans
      WHERE status = 'ACTIVE'
    `);
    const activePortfolio = Number(activeLoansRes.rows[0]?.active_portfolio || 0);
    const activeLoanCount = Number(activeLoansRes.rows[0]?.active_count || 0);

    // Total Collections in period (Excluding reversals)
    const collectionsRes = await queryPostgres(`
      SELECT 
        COALESCE(SUM(amount), 0)::numeric as total_collections,
        COUNT(*)::int as collection_count,
        COALESCE(SUM(CASE WHEN collection_source = 'DIRECT_CUSTOMER' THEN amount ELSE 0 END), 0)::numeric as direct_amount,
        COUNT(CASE WHEN collection_source = 'DIRECT_CUSTOMER' THEN id ELSE NULL END)::int as direct_count,
        COALESCE(SUM(CASE WHEN collection_source = 'DEALER' THEN amount ELSE 0 END), 0)::numeric as dealer_amount,
        COUNT(CASE WHEN collection_source = 'DEALER' THEN id ELSE NULL END)::int as dealer_count,
        COALESCE(SUM(CASE WHEN collection_source = 'RECOVERY_AGENT' THEN amount ELSE 0 END), 0)::numeric as agent_amount,
        COUNT(CASE WHEN collection_source = 'RECOVERY_AGENT' THEN id ELSE NULL END)::int as agent_count
      FROM payments
      WHERE status = 'SUCCESS' 
        AND (is_reversal IS FALSE OR is_reversal IS NULL)
        AND DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata') BETWEEN $1::date AND $2::date
    `, [startDate, endDate]);
    const colRow = collectionsRes.rows[0] || {};
    const totalCollections = Number(colRow.total_collections || 0);
    const collectionCount = Number(colRow.collection_count || 0);

    // Overdue summary
    const overdueRes = await queryPostgres(`
      SELECT 
        COALESCE(SUM(e.remaining_amount + e.penalty_amount), 0)::numeric as total_overdue,
        COUNT(DISTINCT e.loan_id)::int as overdue_loans,
        COUNT(DISTINCT e.customer_id)::int as overdue_customers
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      WHERE l.status = 'ACTIVE' 
        AND c.deleted_at IS NULL 
        AND e.status != 'PAID'
        AND (e.status = 'OVERDUE' OR e.days_overdue > 0)
    `);
    const odRow = overdueRes.rows[0] || {};
    const totalOverdueAmount = Number(odRow.total_overdue || 0);
    const overdueLoanCount = Number(odRow.overdue_loans || 0);
    const overdueCustomerCount = Number(odRow.overdue_customers || 0);

    // Total Due in Period for Collection Efficiency
    const dueRes = await queryPostgres(`
      SELECT COALESCE(SUM(e.expected_amount), 0)::numeric as total_due
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      WHERE l.status IN ('ACTIVE', 'CLOSED')
        AND e.due_date BETWEEN $1 AND $2
    `, [startDate, endDate]);
    const totalDueAmount = Number(dueRes.rows[0]?.total_due || 0);
    const collectionEfficiencyPercent = totalDueAmount > 0
      ? Math.min(100, Math.round((totalCollections / totalDueAmount) * 100))
      : (totalCollections > 0 ? 100 : 100);

    // Source breakdown shares
    const directAmt = Number(colRow.direct_amount || 0);
    const directCnt = Number(colRow.direct_count || 0);
    const dealerAmt = Number(colRow.dealer_amount || 0);
    const dealerCnt = Number(colRow.dealer_count || 0);
    const agentAmt = Number(colRow.agent_amount || 0);
    const agentCnt = Number(colRow.agent_count || 0);

    const directShare = totalCollections > 0 ? Math.round((directAmt / totalCollections) * 100) : 0;
    const dealerShare = totalCollections > 0 ? Math.round((dealerAmt / totalCollections) * 100) : 0;
    const agentShare = totalCollections > 0 ? Math.round((agentAmt / totalCollections) * 100) : 0;

    // 2. Trends: Collections by date
    const trendRes = await queryPostgres(`
      SELECT 
        DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata')::text as date,
        COALESCE(SUM(amount), 0)::numeric as total,
        COALESCE(SUM(CASE WHEN collection_source = 'DIRECT_CUSTOMER' THEN amount ELSE 0 END), 0)::numeric as direct,
        COALESCE(SUM(CASE WHEN collection_source = 'DEALER' THEN amount ELSE 0 END), 0)::numeric as dealer,
        COALESCE(SUM(CASE WHEN collection_source = 'RECOVERY_AGENT' THEN amount ELSE 0 END), 0)::numeric as agent
      FROM payments
      WHERE status = 'SUCCESS' 
        AND (is_reversal IS FALSE OR is_reversal IS NULL)
        AND DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata') BETWEEN $1::date AND $2::date
      GROUP BY DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata')
      ORDER BY date ASC
      LIMIT 31
    `, [startDate, endDate]);

    const disbTrendRes = await queryPostgres(`
      SELECT 
        disbursement_date::text as date,
        COALESCE(SUM(principal_amount), 0)::numeric as amount,
        COUNT(*)::int as count
      FROM loans
      WHERE disbursement_date BETWEEN $1 AND $2
        AND status IN ('ACTIVE', 'CLOSED', 'DEFAULTED')
      GROUP BY disbursement_date
      ORDER BY date ASC
      LIMIT 31
    `, [startDate, endDate]);

    // 3. Portfolio Summary & Aging Buckets
    const portRes = await queryPostgres(`
      SELECT 
        (SELECT COALESCE(SUM(outstanding_balance), 0)::numeric FROM loans WHERE status = 'ACTIVE') as total_outstanding_principal,
        (SELECT COALESCE(SUM(remaining_amount), 0)::numeric FROM emi_installments e JOIN loans l ON e.loan_id = l.id WHERE l.status = 'ACTIVE' AND e.status != 'PAID') as total_outstanding_interest_principal,
        (SELECT COUNT(*)::int FROM loans WHERE status = 'ACTIVE') as active_loans,
        (SELECT COUNT(*)::int FROM loans WHERE status = 'CLOSED') as closed_loans,
        (SELECT COUNT(*)::int FROM customers WHERE deleted_at IS NULL) as total_customers
    `);
    const portRow = portRes.rows[0] || {};

    const agingRes = await queryPostgres(`
      SELECT 
        COUNT(CASE WHEN e.days_overdue = 0 THEN e.id END)::int as current_count,
        COALESCE(SUM(CASE WHEN e.days_overdue = 0 THEN e.remaining_amount ELSE 0 END), 0)::numeric as current_amount,
        COUNT(CASE WHEN e.days_overdue BETWEEN 1 AND 30 THEN e.id END)::int as dpd_1_30_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 1 AND 30 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as dpd_1_30_amount,
        COUNT(CASE WHEN e.days_overdue BETWEEN 31 AND 60 THEN e.id END)::int as dpd_31_60_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 31 AND 60 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as dpd_31_60_amount,
        COUNT(CASE WHEN e.days_overdue BETWEEN 61 AND 90 THEN e.id END)::int as dpd_61_90_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 61 AND 90 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as dpd_61_90_amount,
        COUNT(CASE WHEN e.days_overdue > 90 THEN e.id END)::int as dpd_90_plus_count,
        COALESCE(SUM(CASE WHEN e.days_overdue > 90 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as dpd_90_plus_amount
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      WHERE l.status = 'ACTIVE' AND c.deleted_at IS NULL AND e.status != 'PAID'
    `);
    const agRow = agingRes.rows[0] || {};

    // 4. Dealer Reconciliation Summary & Table
    const dealerSummaryRes = await queryPostgres(`
      SELECT 
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM payments WHERE collection_source = 'DEALER' AND status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL)) as total_collected,
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM dealer_settlements WHERE status = 'COMPLETED' AND (is_reversal IS FALSE OR is_reversal IS NULL)) as total_settled
    `);
    const totalCollectedThroughDealers = Number(dealerSummaryRes.rows[0]?.total_collected || 0);
    const totalDealerSettled = Number(dealerSummaryRes.rows[0]?.total_settled || 0);
    const outstandingDealerRemittance = Math.max(0, new Decimal(totalCollectedThroughDealers).minus(totalDealerSettled).toNumber());

    const dealersTableRes = await queryPostgres(`
      SELECT 
        d.id as dealer_id,
        d.store_name,
        d.dealer_code,
        d.owner_name,
        d.status,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p 
          WHERE p.dealer_id = d.id AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)
        ), 0)::numeric as customer_collections,
        COALESCE((
          SELECT COUNT(p.id) FROM payments p 
          WHERE p.dealer_id = d.id AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)
        ), 0)::int as collection_count,
        COALESCE((
          SELECT SUM(s.amount) FROM dealer_settlements s 
          WHERE s.dealer_id = d.id AND s.status = 'COMPLETED' AND (s.is_reversal IS FALSE OR s.is_reversal IS NULL)
        ), 0)::numeric as settled_amount,
        (
          SELECT MAX(s.settlement_date)::text FROM dealer_settlements s 
          WHERE s.dealer_id = d.id AND s.status = 'COMPLETED' AND (s.is_reversal IS FALSE OR s.is_reversal IS NULL)
        ) as last_settlement_date
      FROM dealers d
      ORDER BY customer_collections DESC
    `);

    let unsettledDealersCount = 0;
    const itemizedDealers = dealersTableRes.rows.map((r) => {
      const col = Number(r.customer_collections || 0);
      const set = Number(r.settled_amount || 0);
      const out = Math.max(0, new Decimal(col).minus(set).toNumber());
      if (out > 0) unsettledDealersCount++;
      return {
        dealerId: r.dealer_id,
        storeName: r.store_name,
        dealerCode: r.dealer_code,
        ownerName: r.owner_name,
        customerCollections: col,
        settled: set,
        outstanding: out,
        collectionCount: Number(r.collection_count || 0),
        lastSettlementDate: r.last_settlement_date || null,
        status: r.status,
      };
    });

    // 5. Recovery Agent Summary & Table
    const agentSummaryRes = await queryPostgres(`
      SELECT 
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM payments WHERE collection_source = 'RECOVERY_AGENT' AND status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL)) as total_agent_collections,
        (SELECT COUNT(id)::int FROM payments WHERE collection_source = 'RECOVERY_AGENT' AND status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL)) as payment_count,
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM payments WHERE collection_source = 'RECOVERY_AGENT' AND status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL) AND DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date) as today_collections,
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM payments WHERE collection_source = 'RECOVERY_AGENT' AND status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL) AND DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata') >= $2::date) as month_collections
    `, [todayStr, monthStart]);
    const agentSumRow = agentSummaryRes.rows[0] || {};

    const agentsTableRes = await queryPostgres(`
      SELECT 
        u.id as agent_id,
        u.full_name as agent_name,
        u.phone as agent_phone,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p 
          WHERE (p.collected_by_agent_id = u.id OR p.agent_id = u.id) AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)
        ), 0)::numeric as collections,
        COALESCE((
          SELECT COUNT(p.id) FROM payments p 
          WHERE (p.collected_by_agent_id = u.id OR p.agent_id = u.id) AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)
        ), 0)::int as payment_count,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p 
          WHERE (p.collected_by_agent_id = u.id OR p.agent_id = u.id) AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL) AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date
        ), 0)::numeric as today_collections,
        COALESCE((
          SELECT SUM(p.amount) FROM payments p 
          WHERE (p.collected_by_agent_id = u.id OR p.agent_id = u.id) AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL) AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') >= $2::date
        ), 0)::numeric as month_collections
      FROM users u
      WHERE u.role = 'COLLECTION_AGENT' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      ORDER BY collections DESC
    `, [todayStr, monthStart]);

    const itemizedAgents = agentsTableRes.rows.map((r) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      agentPhone: r.agent_phone,
      collections: Number(r.collections || 0),
      paymentCount: Number(r.payment_count || 0),
      todayCollections: Number(r.today_collections || 0),
      monthCollections: Number(r.month_collections || 0),
    }));

    // 6. Direct Customer Summary
    const directSummaryRes = await queryPostgres(`
      SELECT 
        COALESCE(SUM(amount), 0)::numeric as total_direct,
        COUNT(id)::int as payment_count,
        COALESCE(SUM(CASE WHEN DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date THEN amount ELSE 0 END), 0)::numeric as today_collections,
        COALESCE(SUM(CASE WHEN DATE(payment_timestamp AT TIME ZONE 'Asia/Kolkata') >= $2::date THEN amount ELSE 0 END), 0)::numeric as month_collections
      FROM payments
      WHERE collection_source = 'DIRECT_CUSTOMER' AND status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL)
    `, [todayStr, monthStart]);
    const dirRow = directSummaryRes.rows[0] || {};
    const totalDirect = Number(dirRow.total_direct || 0);
    const directCount = Number(dirRow.payment_count || 0);
    const avgDirect = directCount > 0 ? new Decimal(totalDirect).dividedBy(directCount).toDecimalPlaces(2).toNumber() : 0;

    // 7. Recovery Queue Summary
    const queueRes = await queryPostgres(`
      SELECT 
        COUNT(DISTINCT e.id)::int as total_accounts,
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 1 AND 30 THEN e.id END)::int as dpd_1_30,
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 31 AND 60 THEN e.id END)::int as dpd_31_60,
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 61 AND 90 THEN e.id END)::int as dpd_61_90,
        COUNT(DISTINCT CASE WHEN e.days_overdue > 90 THEN e.id END)::int as dpd_90_plus,
        COUNT(DISTINCT CASE WHEN l.assigned_agent_id IS NOT NULL OR ca.id IS NOT NULL THEN e.id END)::int as assigned_count,
        COUNT(DISTINCT CASE WHEN l.assigned_agent_id IS NULL AND ca.id IS NULL THEN e.id END)::int as unassigned_count
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      LEFT JOIN collection_assignments ca ON ca.customer_id = c.id AND ca.is_active = TRUE
      WHERE l.status = 'ACTIVE' AND c.deleted_at IS NULL AND e.status != 'PAID' AND (e.status = 'OVERDUE' OR e.days_overdue > 0)
    `);
    const qRow = queueRes.rows[0] || {};

    // 8. Operational Metrics
    const opMetricsRes = await queryPostgres(`
      SELECT 
        (SELECT COALESCE(AVG(principal_amount), 0)::numeric FROM loans) as avg_loan,
        (SELECT COALESCE(AVG(expected_amount), 0)::numeric FROM emi_installments) as avg_emi,
        (SELECT COALESCE(AVG(amount), 0)::numeric FROM payments WHERE status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL)) as avg_payment,
        (SELECT COUNT(DISTINCT customer_id)::int FROM loans WHERE status = 'ACTIVE') as active_customers,
        (SELECT COUNT(*)::int FROM dealers WHERE status = 'ACTIVE') as active_dealers,
        (SELECT COUNT(*)::int FROM users WHERE role = 'COLLECTION_AGENT' AND status = 'ACTIVE' AND deleted_at IS NULL) as active_agents
    `);
    const opRow = opMetricsRes.rows[0] || {};

    // 9. Recent Collections (6)
    const recentColRes = await queryPostgres(`
      SELECT 
        p.id, p.receipt_number, p.payment_timestamp, p.amount::numeric,
        p.collection_source, p.payment_mode, p.status, p.is_reversal,
        l.loan_account_no, c.full_name as customer_name, c.customer_code,
        d.store_name as dealer_store_name, ag.full_name as agent_name
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      LEFT JOIN dealers d ON p.dealer_id = d.id
      LEFT JOIN users ag ON p.agent_id = ag.id
      ORDER BY p.payment_timestamp DESC
      LIMIT 6
    `);
    const recentCollections = recentColRes.rows.map((r) => {
      let collectedThrough = 'Direct Customer';
      if (r.collection_source === 'DEALER') {
        collectedThrough = r.dealer_store_name || 'Dealer';
      } else if (r.collection_source === 'RECOVERY_AGENT') {
        collectedThrough = r.agent_name || 'Recovery Agent';
      }
      return {
        id: r.id,
        receiptNumber: r.receipt_number,
        paymentTimestamp: r.payment_timestamp instanceof Date ? r.payment_timestamp.toISOString() : String(r.payment_timestamp),
        customerName: r.customer_name,
        customerCode: r.customer_code,
        loanAccountNo: r.loan_account_no,
        amount: Number(r.amount),
        collectionSource: r.collection_source,
        collectedThrough,
        paymentMode: r.payment_mode,
        status: r.status,
        isReversal: Boolean(r.is_reversal),
      };
    });

    // 10. Recent Settlements (6)
    const recentSetRes = await queryPostgres(`
      SELECT 
        s.id, s.settlement_number, s.settlement_date, s.amount::numeric,
        s.payment_method, s.status,
        d.store_name as dealer_store_name, d.dealer_code
      FROM dealer_settlements s
      JOIN dealers d ON s.dealer_id = d.id
      ORDER BY s.settlement_date DESC, s.created_at DESC
      LIMIT 6
    `);
    const recentSettlements = recentSetRes.rows.map((r) => ({
      id: r.id,
      settlementNumber: r.settlement_number,
      settlementDate: r.settlement_date instanceof Date ? r.settlement_date.toISOString().slice(0, 10) : String(r.settlement_date),
      dealerStoreName: r.dealer_store_name,
      dealerCode: r.dealer_code,
      amount: Number(r.amount),
      paymentMethod: r.payment_method,
      status: r.status,
    }));

    return {
      period: { startDate, endDate, preset },
      topKpis: {
        totalDisbursed,
        disbursedLoanCount,
        activePortfolio,
        activeLoanCount,
        totalCollections,
        collectionCount,
        totalOverdueAmount,
        overdueLoanCount,
        overdueCustomerCount,
        collectionEfficiencyPercent,
        totalDueAmount,
      },
      sourceBreakdown: {
        directCustomer: { amount: directAmt, count: directCnt, sharePercent: directShare },
        dealer: { amount: dealerAmt, count: dealerCnt, sharePercent: dealerShare },
        recoveryAgent: { amount: agentAmt, count: agentCnt, sharePercent: agentShare },
      },
      trends: {
        collections: trendRes.rows.map((r) => ({
          date: r.date,
          total: Number(r.total),
          direct: Number(r.direct),
          dealer: Number(r.dealer),
          agent: Number(r.agent),
        })),
        disbursements: disbTrendRes.rows.map((r) => ({
          date: r.date,
          amount: Number(r.amount),
          count: Number(r.count),
        })),
      },
      portfolioSummary: {
        totalOutstandingPrincipal: Number(portRow.total_outstanding_principal || 0),
        totalOutstandingInterest: Number(portRow.total_outstanding_interest_principal || 0),
        totalOverdue: totalOverdueAmount,
        activeLoans: Number(portRow.active_loans || 0),
        closedLoans: Number(portRow.closed_loans || 0),
        overdueLoans: overdueLoanCount,
        totalCustomers: Number(portRow.total_customers || 0),
      },
      agingBuckets: {
        current: { count: Number(agRow.current_count || 0), amount: Number(agRow.current_amount || 0) },
        dpd1To30: { count: Number(agRow.dpd_1_30_count || 0), amount: Number(agRow.dpd_1_30_amount || 0) },
        dpd31To60: { count: Number(agRow.dpd_31_60_count || 0), amount: Number(agRow.dpd_31_60_amount || 0) },
        dpd61To90: { count: Number(agRow.dpd_61_90_count || 0), amount: Number(agRow.dpd_61_90_amount || 0) },
        dpd90Plus: { count: Number(agRow.dpd_90_plus_count || 0), amount: Number(agRow.dpd_90_plus_amount || 0) },
      },
      dealerReconciliation: {
        totalCollectedThroughDealers,
        totalDealerSettled,
        outstandingDealerRemittance,
        unsettledDealersCount,
        dealers: itemizedDealers,
      },
      recoveryAgentSummary: {
        totalAgentCollections: Number(agentSumRow.total_agent_collections || 0),
        paymentCount: Number(agentSumRow.payment_count || 0),
        todayCollections: Number(agentSumRow.today_collections || 0),
        monthCollections: Number(agentSumRow.month_collections || 0),
        agents: itemizedAgents,
      },
      directCustomerSummary: {
        totalDirectCollections: totalDirect,
        paymentCount: directCount,
        todayCollections: Number(dirRow.today_collections || 0),
        monthCollections: Number(dirRow.month_collections || 0),
        averagePayment: avgDirect,
      },
      overdueSummary: {
        totalOverdueAmount,
        overdueLoanCount,
        overdueCustomerCount,
        averageOverdueAmount: overdueLoanCount > 0 ? new Decimal(totalOverdueAmount).dividedBy(overdueLoanCount).toDecimalPlaces(2).toNumber() : 0,
        recoveryQueue: {
          totalAccounts: Number(qRow.total_accounts || 0),
          dpd1To30: Number(qRow.dpd_1_30 || 0),
          dpd31To60: Number(qRow.dpd_31_60 || 0),
          dpd61To90: Number(qRow.dpd_61_90 || 0),
          dpd90Plus: Number(qRow.dpd_90_plus || 0),
          assignedCount: Number(qRow.assigned_count || 0),
          unassignedCount: Number(qRow.unassigned_count || 0),
        },
      },
      operationalMetrics: {
        averageLoanAmount: Number(Number(opRow.avg_loan || 0).toFixed(2)),
        averageEmiAmount: Number(Number(opRow.avg_emi || 0).toFixed(2)),
        averagePaymentAmount: Number(Number(opRow.avg_payment || 0).toFixed(2)),
        activeCustomersCount: Number(opRow.active_customers || 0),
        activeDealersCount: Number(opRow.active_dealers || 0),
        activeAgentsCount: Number(opRow.active_agents || 0),
      },
      recentCollections,
      recentSettlements,
    };
  }

  /**
   * Unified Custom Finance & Operations Report (Task 8)
   */
  public static async getCustomReport(
    user: AuthenticatedUser,
    filters: FinanceReportFilters
  ): Promise<IFinanceReportResponse> {
    if (user.role === UserRole.COLLECTION_AGENT) {
      throw new ForbiddenError('Collection agents cannot access executive reports');
    }

    const category = filters.category || 'collections';
    const reportType = filters.reportType || 'all-collections';
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    // 1. COLLECTIONS CATEGORY
    if (category === 'collections') {
      let sql = `
        SELECT p.id, p.receipt_number, p.amount::numeric, p.payment_mode, p.reference_number,
               p.collection_source, p.dealer_id, p.agent_id,
               p.payment_timestamp, p.status, p.is_reversal, p.reversal_reason,
               l.loan_account_no, c.full_name as customer_name, c.customer_code, c.primary_phone, c.area_route,
               u.full_name as collected_by_name,
               d.store_name as dealer_store_name, d.dealer_code,
               ag.full_name as source_agent_name
        FROM payments p
        JOIN loans l ON p.loan_id = l.id
        JOIN customers c ON p.customer_id = c.id
        JOIN users u ON p.collected_by_agent_id = u.id
        LEFT JOIN dealers d ON p.dealer_id = d.id
        LEFT JOIN users ag ON p.agent_id = ag.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let idx = 1;

      if (reportType === 'direct-collections') {
        sql += ` AND p.collection_source = 'DIRECT_CUSTOMER'`;
      } else if (reportType === 'dealer-collections') {
        sql += ` AND p.collection_source = 'DEALER'`;
        if (filters.dealerId) {
          sql += ` AND p.dealer_id = $${idx++}`;
          params.push(filters.dealerId);
        }
      } else if (reportType === 'agent-collections') {
        sql += ` AND p.collection_source = 'RECOVERY_AGENT'`;
        if (filters.agentId) {
          sql += ` AND (p.agent_id = $${idx} OR p.collected_by_agent_id = $${idx})`;
          params.push(filters.agentId);
          idx++;
        }
      } else if (filters.collectionSource) {
        sql += ` AND p.collection_source = $${idx++}`;
        params.push(filters.collectionSource);
      }

      if (filters.paymentMode) {
        sql += ` AND p.payment_mode = $${idx++}`;
        params.push(filters.paymentMode);
      }

      if (filters.paymentStatus) {
        sql += ` AND p.status = $${idx++}`;
        params.push(filters.paymentStatus);
      }

      if (filters.startDate && filters.endDate) {
        sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') BETWEEN $${idx++}::date AND $${idx++}::date`;
        params.push(filters.startDate, filters.endDate);
      } else if (filters.startDate) {
        sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') >= $${idx++}::date`;
        params.push(filters.startDate);
      } else if (filters.endDate) {
        sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') <= $${idx++}::date`;
        params.push(filters.endDate);
      }

      if (filters.search) {
        const s = `%${filters.search}%`;
        sql += ` AND (c.full_name ILIKE $${idx} OR c.primary_phone ILIKE $${idx} OR p.receipt_number ILIKE $${idx} OR l.loan_account_no ILIKE $${idx})`;
        params.push(s);
        idx++;
      }

      // Summary aggregate
      const sumSql = `
        SELECT 
          COUNT(*)::int as record_count,
          COALESCE(SUM(CASE WHEN status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL) THEN amount ELSE 0 END), 0)::numeric as total_amount,
          COALESCE(AVG(CASE WHEN status = 'SUCCESS' AND (is_reversal IS FALSE OR is_reversal IS NULL) THEN amount ELSE NULL END), 0)::numeric as average_amount
        FROM (${sql}) sub
      `;
      const sumRes = await queryPostgres(sumSql, params);
      const sumRow = sumRes.rows[0] || {};

      sql += ` ORDER BY p.payment_timestamp DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(limit, offset);

      const recordsRes = await queryPostgres(sql, params);
      const total = Number(sumRow.record_count || 0);

      return {
        category,
        reportType,
        summary: {
          totalAmount: Number(sumRow.total_amount || 0),
          recordCount: total,
          averageAmount: Number(Number(sumRow.average_amount || 0).toFixed(2)),
          startDate: filters.startDate,
          endDate: filters.endDate,
        },
        records: recordsRes.rows.map((r) => ({
          ...r,
          amount: Number(r.amount),
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    // 2. LOANS CATEGORY
    if (category === 'loans') {
      let sql = `
        SELECT l.id, l.loan_account_no, l.principal_amount::numeric, l.down_payment::numeric,
               l.annual_interest_rate::numeric, l.tenure_months, l.interest_calc_method,
               l.installment_frequency, l.disbursement_date, l.status as loan_status,
               l.outstanding_balance::numeric, l.emi_amount::numeric,
               COALESCE((
                 SELECT SUM(ei.remaining_amount + ei.penalty_amount)
                 FROM emi_installments ei
                 WHERE ei.loan_id = l.id AND (ei.status = 'OVERDUE' OR ei.days_overdue > 0)
               ), 0)::numeric as overdue_amount,
               c.full_name as customer_name, c.customer_code, c.primary_phone, c.area_route,
               d.store_name as dealer_store_name, d.dealer_code,
               u.full_name as assigned_agent_name
        FROM loans l
        JOIN customers c ON l.customer_id = c.id
        LEFT JOIN dealers d ON l.dealer_id = d.id
        LEFT JOIN users u ON l.assigned_agent_id = u.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let idx = 1;

      if (reportType === 'disbursements') {
        if (filters.startDate && filters.endDate) {
          sql += ` AND l.disbursement_date BETWEEN $${idx++} AND $${idx++}`;
          params.push(filters.startDate, filters.endDate);
        }
      } else if (reportType === 'active-portfolio') {
        sql += ` AND l.status = 'ACTIVE'`;
      } else if (reportType === 'closed-loans') {
        sql += ` AND l.status = 'CLOSED'`;
      } else if (reportType === 'overdue-loans') {
        sql += ` AND l.status = 'ACTIVE' AND l.id IN (
          SELECT loan_id FROM emi_installments WHERE status != 'PAID' AND (status = 'OVERDUE' OR days_overdue > 0)
        )`;
      } else if (filters.loanStatus) {
        sql += ` AND l.status = $${idx++}`;
        params.push(filters.loanStatus);
      }

      if (filters.dealerId) {
        sql += ` AND l.dealer_id = $${idx++}`;
        params.push(filters.dealerId);
      }

      if (filters.agentId) {
        sql += ` AND l.assigned_agent_id = $${idx++}`;
        params.push(filters.agentId);
      }

      if (filters.search) {
        const s = `%${filters.search}%`;
        sql += ` AND (c.full_name ILIKE $${idx} OR c.primary_phone ILIKE $${idx} OR l.loan_account_no ILIKE $${idx})`;
        params.push(s);
        idx++;
      }

      const sumSql = `
        SELECT 
          COUNT(*)::int as record_count,
          COALESCE(SUM(principal_amount), 0)::numeric as total_principal,
          COALESCE(SUM(outstanding_balance), 0)::numeric as total_outstanding,
          COALESCE(AVG(principal_amount), 0)::numeric as avg_principal
        FROM (${sql}) sub
      `;
      const sumRes = await queryPostgres(sumSql, params);
      const sumRow = sumRes.rows[0] || {};

      sql += ` ORDER BY l.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(limit, offset);

      const recordsRes = await queryPostgres(sql, params);
      const total = Number(sumRow.record_count || 0);

      return {
        category,
        reportType,
        summary: {
          totalAmount: reportType === 'active-portfolio' || reportType === 'overdue-loans'
            ? Number(sumRow.total_outstanding || 0)
            : Number(sumRow.total_principal || 0),
          recordCount: total,
          averageAmount: Number(Number(sumRow.avg_principal || 0).toFixed(2)),
          startDate: filters.startDate,
          endDate: filters.endDate,
        },
        records: recordsRes.rows.map((r) => ({
          ...r,
          principalAmount: Number(r.principal_amount),
          outstandingBalance: Number(r.outstanding_balance),
          emiAmount: Number(r.emi_amount || 0),
          overdueAmount: Number(r.overdue_amount || 0),
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    // 3. DEALER CATEGORY
    if (category === 'dealer') {
      if (reportType === 'dealer-settlements') {
        let sql = `
          SELECT s.id, s.settlement_number, s.dealer_id, s.amount::numeric, s.settlement_date,
                 s.payment_method, s.reference_number, s.status, s.is_reversal, s.reversal_reason,
                 d.store_name as dealer_store_name, d.dealer_code, d.owner_name, d.phone as dealer_phone,
                 u.full_name as created_by_name
          FROM dealer_settlements s
          JOIN dealers d ON s.dealer_id = d.id
          LEFT JOIN users u ON s.created_by = u.id
          WHERE 1=1
        `;
        const params: any[] = [];
        let idx = 1;

        if (filters.dealerId) {
          sql += ` AND s.dealer_id = $${idx++}`;
          params.push(filters.dealerId);
        }

        if (filters.startDate && filters.endDate) {
          sql += ` AND s.settlement_date BETWEEN $${idx++} AND $${idx++}`;
          params.push(filters.startDate, filters.endDate);
        }

        if (filters.search) {
          const s = `%${filters.search}%`;
          sql += ` AND (d.store_name ILIKE $${idx} OR d.dealer_code ILIKE $${idx} OR s.settlement_number ILIKE $${idx})`;
          params.push(s);
          idx++;
        }

        const sumSql = `
          SELECT 
            COUNT(*)::int as record_count,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND (is_reversal IS FALSE OR is_reversal IS NULL) THEN amount ELSE 0 END), 0)::numeric as total_amount,
            COALESCE(AVG(CASE WHEN status = 'COMPLETED' AND (is_reversal IS FALSE OR is_reversal IS NULL) THEN amount ELSE NULL END), 0)::numeric as avg_amount
          FROM (${sql}) sub
        `;
        const sumRes = await queryPostgres(sumSql, params);
        const sumRow = sumRes.rows[0] || {};

        sql += ` ORDER BY s.settlement_date DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const recordsRes = await queryPostgres(sql, params);
        const total = Number(sumRow.record_count || 0);

        return {
          category,
          reportType,
          summary: {
            totalAmount: Number(sumRow.total_amount || 0),
            recordCount: total,
            averageAmount: Number(Number(sumRow.avg_amount || 0).toFixed(2)),
            startDate: filters.startDate,
            endDate: filters.endDate,
          },
          records: recordsRes.rows.map((r) => ({
            ...r,
            amount: Number(r.amount),
          })),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      }

      // Default: dealer reconciliation & outstanding
      const dealersRes = await queryPostgres(`
        SELECT 
          d.id as dealer_id,
          d.store_name,
          d.dealer_code,
          d.owner_name,
          d.phone,
          d.area_city,
          d.status,
          COALESCE((
            SELECT SUM(p.amount) FROM payments p 
            WHERE p.dealer_id = d.id AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)
          ), 0)::numeric as customer_collections,
          COALESCE((
            SELECT COUNT(p.id) FROM payments p 
            WHERE p.dealer_id = d.id AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)
          ), 0)::int as collection_count,
          COALESCE((
            SELECT SUM(s.amount) FROM dealer_settlements s 
            WHERE s.dealer_id = d.id AND s.status = 'COMPLETED' AND (s.is_reversal IS FALSE OR s.is_reversal IS NULL)
          ), 0)::numeric as settled_amount,
          COALESCE((
            SELECT COUNT(s.id) FROM dealer_settlements s 
            WHERE s.dealer_id = d.id AND s.status = 'COMPLETED' AND (s.is_reversal IS FALSE OR s.is_reversal IS NULL)
          ), 0)::int as settlement_count,
          (
            SELECT MAX(s.settlement_date)::text FROM dealer_settlements s 
            WHERE s.dealer_id = d.id AND s.status = 'COMPLETED' AND (s.is_reversal IS FALSE OR s.is_reversal IS NULL)
          ) as last_settlement_date
        FROM dealers d
        ORDER BY customer_collections DESC
      `);

      let totalCol = new Decimal(0);
      let totalSet = new Decimal(0);
      let totalOut = new Decimal(0);

      const items = dealersRes.rows.map((r) => {
        const c = new Decimal(r.customer_collections || 0);
        const s = new Decimal(r.settled_amount || 0);
        const o = Decimal.max(0, c.minus(s));

        totalCol = totalCol.plus(c);
        totalSet = totalSet.plus(s);
        totalOut = totalOut.plus(o);

        return {
          dealerId: r.dealer_id,
          storeName: r.store_name,
          dealerCode: r.dealer_code,
          ownerName: r.owner_name,
          phone: r.phone,
          areaCity: r.area_city,
          status: r.status,
          customerCollections: c.toNumber(),
          collectionCount: Number(r.collection_count || 0),
          settledAmount: s.toNumber(),
          outstandingAmount: o.toNumber(),
          settlementCount: Number(r.settlement_count || 0),
          lastSettlementDate: r.last_settlement_date || null,
        };
      });

      const filteredItems = reportType === 'dealer-outstanding'
        ? items.filter((d) => d.outstandingAmount > 0)
        : items;

      const total = filteredItems.length;
      const paginatedRecords = filteredItems.slice(offset, offset + limit);

      return {
        category,
        reportType,
        summary: {
          totalAmount: reportType === 'dealer-outstanding' ? totalOut.toNumber() : totalCol.toNumber(),
          recordCount: total,
          averageAmount: total > 0 ? (totalCol.dividedBy(total)).toDecimalPlaces(2).toNumber() : 0,
        },
        records: paginatedRecords,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    // 4. RECOVERY CATEGORY
    if (category === 'recovery') {
      if (reportType === 'agent-performance') {
        const agents = await this.getAgentPerformanceReport();
        const total = agents.length;
        const totalCollected = agents.reduce((acc, a) => acc + a.total_lifetime_collected, 0);

        return {
          category,
          reportType,
          summary: {
            totalAmount: totalCollected,
            recordCount: total,
            averageAmount: total > 0 ? Number((totalCollected / total).toFixed(2)) : 0,
          },
          records: agents.slice(offset, offset + limit),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      }

      // Default: recovery queue
      const parReport = await this.getOverdueParReport({
        bucket: filters.bucket as any,
        search: filters.search,
        page,
        limit,
      }, user);

      return {
        category,
        reportType,
        summary: {
          totalAmount: parReport.summary.totalOverdueAmount,
          recordCount: parReport.total,
          averageAmount: parReport.total > 0 ? Number((parReport.summary.totalOverdueAmount / parReport.total).toFixed(2)) : 0,
        },
        records: parReport.records,
        total: parReport.total,
        page,
        limit,
        totalPages: parReport.totalPages,
      };
    }

    throw new BadRequestError(`Unsupported report category: ${category}`);
  }

  /**
   * Legacy / Executive Dashboard stats (Maintained for backward compatibility)
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
        AND (is_reversal IS FALSE OR is_reversal IS NULL)
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

    // 5. Aging Buckets
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
   * Daily collection ledger report (Maintained for backward compatibility)
   */
  public static async getDailyCollectionReport(
    filters: DailyCollectionFilters,
    user?: AuthenticatedUser
  ) {
    const isAgent = user?.role === UserRole.COLLECTION_AGENT;
    let sql = `
      SELECT p.id, p.receipt_number, p.amount::numeric, p.payment_mode, p.reference_number,
             p.collection_source, p.dealer_id, p.agent_id,
             p.payment_timestamp, p.status, p.is_reversal,
             l.loan_account_no, c.full_name as customer_name, c.customer_code, c.area_route, c.primary_phone,
             u.full_name as collected_by_name
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.collected_by_agent_id = u.id
      WHERE p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)
    `;
    const params: any[] = [];
    let paramIndex = 1;

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

    const totalSql = `
      SELECT 
        COUNT(*)::int as total_count,
        COALESCE(SUM(amount), 0)::numeric as total_collected,
        COALESCE(SUM(CASE WHEN payment_mode = 'CASH' THEN amount ELSE 0 END), 0)::numeric as cash_collected,
        COALESCE(SUM(CASE WHEN payment_mode = 'UPI' THEN amount ELSE 0 END), 0)::numeric as upi_collected,
        COALESCE(SUM(CASE WHEN payment_mode = 'BANK_TRANSFER' THEN amount ELSE 0 END), 0)::numeric as bank_transfer_collected,
        COALESCE(SUM(CASE WHEN payment_mode = 'CHEQUE' THEN amount ELSE 0 END), 0)::numeric as cheque_collected,
        COALESCE(SUM(CASE WHEN collection_source = 'DIRECT_CUSTOMER' THEN amount ELSE 0 END), 0)::numeric as direct_collected,
        COALESCE(SUM(CASE WHEN collection_source = 'DEALER' THEN amount ELSE 0 END), 0)::numeric as dealer_collected,
        COALESCE(SUM(CASE WHEN collection_source = 'RECOVERY_AGENT' THEN amount ELSE 0 END), 0)::numeric as agent_collected
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
      sourceBreakdown: {
        directCustomer: Number(totals?.direct_collected || 0),
        dealer: Number(totals?.dealer_collected || 0),
        recoveryAgent: Number(totals?.agent_collected || 0),
      },
      records,
      page,
      limit,
      totalPages: Math.ceil(Number(totals?.total_count || 0) / limit),
    };
  }

  /**
   * Overdue and Portfolio-at-Risk (PAR) aging report (Maintained for backward compatibility)
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

    const summarySql = `
      SELECT 
        COUNT(DISTINCT e.id)::int as total_overdue_installments,
        COUNT(DISTINCT l.id)::int as total_overdue_loans,
        COUNT(DISTINCT c.id)::int as total_overdue_customers,
        COALESCE(SUM(e.remaining_amount + e.penalty_amount), 0)::numeric as total_overdue_amount,
        COALESCE(SUM(e.remaining_amount), 0)::numeric as total_principal_interest_overdue,
        COALESCE(SUM(e.penalty_amount), 0)::numeric as total_penalty_overdue,
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 1 AND 30 THEN e.id END)::int as par_1_30_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 1 AND 30 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as par_1_30_amount,
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 31 AND 60 THEN e.id END)::int as par_31_60_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 31 AND 60 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as par_31_60_amount,
        COUNT(DISTINCT CASE WHEN e.days_overdue BETWEEN 61 AND 90 THEN e.id END)::int as par_61_90_count,
        COALESCE(SUM(CASE WHEN e.days_overdue BETWEEN 61 AND 90 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as par_61_90_amount,
        COUNT(DISTINCT CASE WHEN e.days_overdue > 90 THEN e.id END)::int as par_90_plus_count,
        COALESCE(SUM(CASE WHEN e.days_overdue > 90 THEN e.remaining_amount + e.penalty_amount ELSE 0 END), 0)::numeric as par_90_plus_amount
      ${baseSql}
    `;
    const summaryRes = await queryPostgres(summarySql, params);
    const summary = summaryRes.rows[0];

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
   * Agent performance rankings (Maintained for backward compatibility)
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
        (SELECT COALESCE(SUM(p.amount), 0)::numeric FROM payments p WHERE p.collected_by_agent_id = u.id AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)) as total_lifetime_collected,
        (SELECT COUNT(*)::int FROM payments p WHERE p.collected_by_agent_id = u.id AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)) as total_payments_collected_count,
        (SELECT COALESCE(SUM(p.amount), 0)::numeric FROM payments p WHERE p.collected_by_agent_id = u.id AND p.status = 'SUCCESS' AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL) AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date) as today_collected,
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
   * Safe CSV field escaping with protection against CSV / Formula Injection (CWE-1236)
   */
  public static sanitizeCsvField(val: unknown): string {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  /**
   * Unified export data provider supporting Collections, Loans, Dealer, and Recovery
   */
  public static async getExportData(
    typeOrCategory: string,
    filters: any = {},
    user: AuthenticatedUser
  ): Promise<{
    sheetTitle: string;
    filenamePrefix: string;
    headers: string[];
    rows: (string | number)[][];
    rawRecords: any[];
  }> {
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Dealers are not authorized to export executive reports');
    }
    if (user.role === UserRole.COLLECTION_AGENT && typeOrCategory !== 'daily-collections') {
      throw new ForbiddenError('Collection agents cannot export organization-wide reports');
    }

    const type = typeOrCategory.toLowerCase();

    // 1. COLLECTIONS
    if (
      type === 'collections' ||
      type === 'all-collections' ||
      type === 'direct-collections' ||
      type === 'dealer-collections' ||
      type === 'agent-collections'
    ) {
      const reportType = (
        ['all-collections', 'direct-collections', 'dealer-collections', 'agent-collections'].includes(type)
          ? type
          : 'all-collections'
      ) as FinanceReportType;

      const report = await this.getCustomReport(user, {
        ...filters,
        category: 'collections',
        reportType,
        limit: 10000,
        page: 1,
      });

      const headers = [
        'Receipt Number',
        'Payment Date & Time',
        'Customer Code',
        'Customer Name',
        'Customer Phone',
        'Loan Number',
        'Amount (INR)',
        'Payment Mode',
        'Collection Source',
        'Dealer / Store',
        'Recovery Agent',
        'Payment Status',
      ];

      const rows = report.records.map((r: any) => [
        r.receipt_number,
        r.payment_timestamp,
        r.customer_code,
        r.customer_name,
        r.primary_phone,
        r.loan_account_no,
        Number(r.amount).toFixed(2),
        r.payment_mode,
        r.collection_source,
        r.dealer_store_name || '-',
        r.source_agent_name || '-',
        r.is_reversal ? 'REVERSED' : r.status,
      ]);

      return {
        sheetTitle: 'Collections',
        filenamePrefix: type === 'collections' ? 'collections' : type,
        headers,
        rows,
        rawRecords: report.records,
      };
    }

    // 2. LOANS
    if (
      type === 'loans' ||
      type === 'disbursements' ||
      type === 'active-portfolio' ||
      type === 'closed-loans' ||
      type === 'overdue-loans'
    ) {
      const reportType = (
        ['disbursements', 'active-portfolio', 'closed-loans', 'overdue-loans'].includes(type)
          ? type
          : 'disbursements'
      ) as FinanceReportType;

      const report = await this.getCustomReport(user, {
        ...filters,
        category: 'loans',
        reportType,
        limit: 10000,
        page: 1,
      });

      const headers = [
        'Loan Number',
        'Customer Code',
        'Customer Name',
        'Customer Phone',
        'Dealer / Store',
        'Financed Amount (INR)',
        'Tenure (Months)',
        'EMI Amount (INR)',
        'Outstanding Amount (INR)',
        'Overdue Amount (INR)',
        'Loan Status',
        'Disbursement Date',
      ];

      const rows = report.records.map((r: any) => [
        r.loan_account_no,
        r.customer_code,
        r.customer_name,
        r.primary_phone,
        r.dealer_store_name || '-',
        Number(r.principal_amount || r.principalAmount || 0).toFixed(2),
        r.tenure_months,
        Number(r.emi_amount || r.emiAmount || 0).toFixed(2),
        Number(r.outstanding_balance || r.outstandingBalance || 0).toFixed(2),
        Number(r.overdue_amount || r.overdueAmount || 0).toFixed(2),
        r.loan_status,
        r.disbursement_date,
      ]);

      return {
        sheetTitle: 'Loans',
        filenamePrefix: type === 'loans' ? 'loans' : type,
        headers,
        rows,
        rawRecords: report.records,
      };
    }

    // 3. DEALER
    if (
      type === 'dealers' ||
      type === 'dealer' ||
      type === 'dealer-reconciliation' ||
      type === 'dealer-outstanding' ||
      type === 'dealer-settlements'
    ) {
      if (type === 'dealer-settlements') {
        const report = await this.getCustomReport(user, {
          ...filters,
          category: 'dealer',
          reportType: 'dealer-settlements',
          limit: 10000,
          page: 1,
        });

        const headers = [
          'Settlement Number',
          'Settlement Date',
          'Store Name',
          'Dealer Code',
          'Owner Name',
          'Phone',
          'Amount (INR)',
          'Payment Method',
          'Reference No',
          'Status',
        ];

        const rows = report.records.map((r: any) => [
          r.settlement_number,
          r.settlement_date,
          r.dealer_store_name,
          r.dealer_code,
          r.owner_name,
          r.dealer_phone,
          Number(r.amount).toFixed(2),
          r.payment_method,
          r.reference_number || '',
          r.is_reversal ? 'REVERSED' : r.status,
        ]);

        return {
          sheetTitle: 'Dealer Settlements',
          filenamePrefix: 'dealer_settlements',
          headers,
          rows,
          rawRecords: report.records,
        };
      }

      const reportType = (
        type === 'dealer-outstanding' ? 'dealer-outstanding' : 'dealer-reconciliation'
      ) as FinanceReportType;

      const report = await this.getCustomReport(user, {
        ...filters,
        category: 'dealer',
        reportType,
        limit: 10000,
        page: 1,
      });

      const headers = [
        'Dealer / Store',
        'Dealer Code',
        'Owner Name',
        'Phone',
        'Area / City',
        'Total Customer Collections (INR)',
        'Collection Count',
        'Unsettled Amount (INR)',
        'Settled Amount (INR)',
        'Outstanding Settlement Amount (INR)',
        'Settlement Count',
        'Last Settlement Date',
        'Status',
      ];

      const rows = report.records.map((r: any) => [
        r.storeName || r.store_name,
        r.dealerCode || r.dealer_code,
        r.ownerName || r.owner_name,
        r.phone,
        r.areaCity || r.area_city,
        Number(r.customerCollections || r.customer_collections || 0).toFixed(2),
        r.collectionCount || r.collection_count || 0,
        Number(r.outstandingAmount || r.outstanding_amount || 0).toFixed(2),
        Number(r.settledAmount || r.settled_amount || 0).toFixed(2),
        Number(r.outstandingAmount || r.outstanding_amount || 0).toFixed(2),
        r.settlementCount || r.settlement_count || 0,
        r.lastSettlementDate || r.last_settlement_date || '-',
        r.status,
      ]);

      return {
        sheetTitle: 'Dealer Collections',
        filenamePrefix: type === 'dealers' || type === 'dealer' ? 'dealer_collections' : type,
        headers,
        rows,
        rawRecords: report.records,
      };
    }

    // 4. RECOVERY
    if (
      type === 'recovery' ||
      type === 'agent-performance' ||
      type === 'recovery-queue'
    ) {
      if (type === 'recovery-queue') {
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
          r.loanAccountNo,
          r.customerCode,
          r.customerName,
          r.primaryPhone,
          r.areaRoute,
          r.installmentNumber,
          r.dueDate,
          r.daysOverdue,
          Number(r.expectedAmount).toFixed(2),
          Number(r.paidAmount).toFixed(2),
          Number(r.remainingAmount).toFixed(2),
          Number(r.penaltyAmount).toFixed(2),
          Number(r.totalOverdueAmount).toFixed(2),
          r.assignedAgentName || 'Unassigned',
        ]);

        return {
          sheetTitle: 'Recovery Queue',
          filenamePrefix: 'recovery_queue',
          headers,
          rows,
          rawRecords: report.records,
        };
      }

      const report = await this.getAgentPerformanceReport();
      const headers = [
        'Recovery Agent',
        'Phone',
        'Assigned Branch / Area',
        'Active Assigned Customers',
        'Total Lifetime Collected (INR)',
        'Total Payments Collected Count',
        'Today Collected (INR)',
        'Total Calls Logged',
        'Active Overdue EMIs in Portfolio',
      ];

      const rows = report.map((r: any) => [
        r.agent_name || r.agentName,
        r.agent_phone || r.agentPhone,
        r.assigned_branch || r.assignedBranch || 'N/A',
        r.assigned_customers_count || r.assignedCustomersCount || 0,
        Number(r.total_lifetime_collected || r.totalLifetimeCollected || 0).toFixed(2),
        r.total_payments_collected_count || r.totalPaymentsCollectedCount || 0,
        Number(r.today_collected || r.todayCollected || 0).toFixed(2),
        r.total_calls_logged || r.totalCallsLogged || 0,
        r.active_overdue_emis_count || r.activeOverdueEmisCount || 0,
      ]);

      return {
        sheetTitle: 'Recovery',
        filenamePrefix: type === 'recovery' ? 'recovery' : type,
        headers,
        rows,
        rawRecords: report,
      };
    }

    // 5. LEGACY / DAILY COLLECTIONS
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
        r.receipt_number,
        r.payment_timestamp,
        r.customer_code,
        r.customer_name,
        r.primary_phone,
        r.loan_account_no,
        r.area_route,
        Number(r.amount).toFixed(2),
        r.payment_mode,
        r.reference_number || '',
        r.collected_by_name,
        r.status,
      ]);

      return {
        sheetTitle: 'Daily Collections',
        filenamePrefix: `daily_collections_${filters.date || getBusinessDate(undefined, 'Asia/Kolkata')}`,
        headers,
        rows,
        rawRecords: report.records,
      };
    }

    // 6. LEGACY / OVERDUE PAR
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
        r.loanAccountNo,
        r.customerCode,
        r.customerName,
        r.primaryPhone,
        r.areaRoute,
        r.installmentNumber,
        r.dueDate,
        r.daysOverdue,
        Number(r.expectedAmount).toFixed(2),
        Number(r.paidAmount).toFixed(2),
        Number(r.remainingAmount).toFixed(2),
        Number(r.penaltyAmount).toFixed(2),
        Number(r.totalOverdueAmount).toFixed(2),
        r.assignedAgentName || 'Unassigned',
      ]);

      return {
        sheetTitle: 'Overdue PAR',
        filenamePrefix: 'overdue_par_report',
        headers,
        rows,
        rawRecords: report.records,
      };
    }

    // 7. LEGACY / CUSTOMERS
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
        r.customer_code,
        r.full_name,
        r.primary_phone,
        r.area_route,
        r.city,
        r.state,
        r.pincode,
        r.active_loans_count,
        Number(r.total_outstanding).toFixed(2),
        r.is_active ? 'ACTIVE' : 'INACTIVE',
        r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : String(r.created_at),
      ]);

      return {
        sheetTitle: 'Customers',
        filenamePrefix: 'customers_export',
        headers,
        rows,
        rawRecords: res.rows,
      };
    }

    throw new BadRequestError(`Unsupported export report type or category: ${typeOrCategory}`);
  }

  /**
   * Generate sanitized, stream-safe CSV export for authorized entities
   */
  public static async generateCsvExport(
    typeOrCategory: string,
    filters: any,
    user: AuthenticatedUser
  ): Promise<{ filename: string; csvContent: string; recordCount: number }> {
    const todayStr = getBusinessDate(undefined, 'Asia/Kolkata');
    const exportData = await this.getExportData(typeOrCategory, filters, user);

    const sanitizedHeaders = exportData.headers.map((h) => {
      if (h.includes(',') || h.includes('"') || h.includes('\n')) {
        return `"${h.replace(/"/g, '""')}"`;
      }
      return h;
    });
    const sanitizedRows = exportData.rows.map((row) =>
      row.map((cell) => this.sanitizeCsvField(cell))
    );

    const csvContent = [
      sanitizedHeaders.join(','),
      ...sanitizedRows.map((r) => r.join(',')),
    ].join('\n');

    const filename = `${exportData.filenamePrefix}_${todayStr}.csv`;

    return {
      filename,
      csvContent,
      recordCount: exportData.rows.length,
    };
  }

  /**
   * Export reporting data directly to Google Sheets
   */
  public static async exportToGoogleSheets(
    typeOrCategory: string,
    filters: any,
    user: AuthenticatedUser
  ): Promise<ISheetExportResult & { recordCount: number }> {
    const exportData = await this.getExportData(typeOrCategory, filters, user);

    const result = await GoogleSheetsService.exportReport({
      sheetTitle: exportData.sheetTitle,
      headers: exportData.headers,
      rows: exportData.rows,
    });

    return {
      ...result,
      recordCount: exportData.rows.length,
    };
  }
}

