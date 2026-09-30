import { queryPostgres } from '../../database/postgres';
import {
  UserRole,
  CollectionSource,
  PaymentMode,
  PaymentStatus,
  IAgentCollectionMetric,
  IAgentCollectionSummary,
  IAgentCollectionRecord,
  IAgentCollectionLedgerResponse,
  getBusinessDate,
} from '@crm/shared';
import { ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import Decimal from 'decimal.js';

export interface AgentCollectionsFilterQuery {
  agentId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export class AgentCollectionsService {
  /**
   * Helper to validate and enforce Row-Level Access Control (RLAC) for collection agents.
   * SUPER_ADMIN, ADMIN, BRANCH_MANAGER have full organization-wide visibility.
   * COLLECTION_AGENT is restricted exclusively to their own agent ID.
   */
  private static enforceAgentScope(filters: AgentCollectionsFilterQuery, user: AuthenticatedUser): string | undefined {
    if (user.role === UserRole.COLLECTION_AGENT) {
      if (filters.agentId && filters.agentId !== user.id) {
        throw new ForbiddenError('Collection agents can only access their own collection records');
      }
      return user.id;
    }
    return filters.agentId;
  }

  /**
   * Retrieve complete recovery agent collections ledger with summary metrics, agent breakdown, and paginated records.
   */
  public static async getAgentCollections(
    filters: AgentCollectionsFilterQuery,
    user: AuthenticatedUser
  ): Promise<IAgentCollectionLedgerResponse> {
    const effectiveAgentId = this.enforceAgentScope(filters, user);
    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    // 1. Build Base WHERE conditions for payments
    const whereClauses = [`p.collection_source = 'RECOVERY_AGENT'`];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (effectiveAgentId) {
      whereClauses.push(`p.agent_id = $${paramIndex++}`);
      queryParams.push(effectiveAgentId);
    }

    if (filters.startDate && filters.endDate) {
      whereClauses.push(
        `DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') BETWEEN $${paramIndex++}::date AND $${paramIndex++}::date`
      );
      queryParams.push(filters.startDate, filters.endDate);
    } else if (filters.startDate) {
      whereClauses.push(`DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') >= $${paramIndex++}::date`);
      queryParams.push(filters.startDate);
    } else if (filters.endDate) {
      whereClauses.push(`DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') <= $${paramIndex++}::date`);
      queryParams.push(filters.endDate);
    }

    if (filters.search) {
      whereClauses.push(`(
        c.full_name ILIKE $${paramIndex}
        OR c.customer_code ILIKE $${paramIndex}
        OR l.loan_account_no ILIKE $${paramIndex}
        OR p.receipt_number ILIKE $${paramIndex}
        OR u.full_name ILIKE $${paramIndex}
        OR u.phone ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 2. Fetch Overall Summary Aggregate (Active Collections only: status = SUCCESS and is_reversal = FALSE)
    const summarySql = `
      SELECT 
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN p.amount ELSE 0 END), 0)::numeric as total_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN 1 END)::int as payment_count,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $${paramIndex}::date THEN p.amount ELSE 0 END), 0)::numeric as today_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $${paramIndex}::date THEN 1 END)::int as today_count,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $${paramIndex}::date) THEN p.amount ELSE 0 END), 0)::numeric as month_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $${paramIndex}::date) THEN 1 END)::int as month_count
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.agent_id = u.id
      ${whereSql}
    `;
    const summaryRes = await queryPostgres(summarySql, [...queryParams, businessToday]);
    const summaryRow = summaryRes.rows[0];

    const totalCollectionsNum = Number(summaryRow?.total_collections || 0);
    const paymentCountNum = Number(summaryRow?.payment_count || 0);
    const todayCollectionsNum = Number(summaryRow?.today_collections || 0);
    const todayCountNum = Number(summaryRow?.today_count || 0);
    const monthCollectionsNum = Number(summaryRow?.month_collections || 0);
    const monthCountNum = Number(summaryRow?.month_count || 0);
    const averageCollectionNum =
      paymentCountNum > 0
        ? new Decimal(totalCollectionsNum).dividedBy(paymentCountNum).toDecimalPlaces(2).toNumber()
        : 0;

    // 3. Fetch Agent Breakdown (Grouped per Recovery Agent)
    let agentBreakdownSql = `
      SELECT 
        u.id as agent_id,
        u.full_name as agent_name,
        u.email as agent_email,
        u.phone as agent_phone,
        u.status,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN p.amount ELSE 0 END), 0)::numeric as total_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN 1 END)::int as payment_count,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date THEN p.amount ELSE 0 END), 0)::numeric as today_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date THEN 1 END)::int as today_count,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $1::date) THEN p.amount ELSE 0 END), 0)::numeric as month_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $1::date) THEN 1 END)::int as month_count
      FROM users u
      LEFT JOIN payments p ON p.agent_id = u.id AND p.collection_source = 'RECOVERY_AGENT'
      WHERE u.role = 'COLLECTION_AGENT'
    `;
    const agentBreakdownParams: any[] = [businessToday];
    let aIdx = 2;

    if (effectiveAgentId) {
      agentBreakdownSql += ` AND u.id = $${aIdx++}`;
      agentBreakdownParams.push(effectiveAgentId);
    }

    agentBreakdownSql += `
      GROUP BY u.id, u.full_name, u.email, u.phone, u.status
      ORDER BY total_collections DESC, u.full_name ASC
    `;
    const agentBreakdownRes = await queryPostgres(agentBreakdownSql, agentBreakdownParams);
    const agentBreakdown: IAgentCollectionMetric[] = agentBreakdownRes.rows.map((r: any) => {
      const tot = Number(r.total_collections || 0);
      const cnt = Number(r.payment_count || 0);
      return {
        agentId: r.agent_id,
        agentName: r.agent_name,
        agentEmail: r.agent_email,
        agentPhone: r.agent_phone,
        status: r.status,
        totalCollections: tot,
        paymentCount: cnt,
        todayCollections: Number(r.today_collections || 0),
        todayCount: Number(r.today_count || 0),
        monthCollections: Number(r.month_collections || 0),
        monthCount: Number(r.month_count || 0),
        averageCollection: cnt > 0 ? new Decimal(tot).dividedBy(cnt).toDecimalPlaces(2).toNumber() : 0,
      };
    });

    const summary: IAgentCollectionSummary = {
      totalCollections: totalCollectionsNum,
      paymentCount: paymentCountNum,
      todayCollections: todayCollectionsNum,
      todayCount: todayCountNum,
      monthCollections: monthCollectionsNum,
      monthCount: monthCountNum,
      averageCollection: averageCollectionNum,
      agentBreakdown,
    };

    // 4. Fetch Paginated Records and Count
    const countSql = `
      SELECT COUNT(*)::int as total_rows
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.agent_id = u.id
      ${whereSql}
    `;
    const countRes = await queryPostgres(countSql, queryParams);
    const totalCount = Number(countRes.rows[0]?.total_rows || 0);

    const recordsSql = `
      SELECT 
        p.id,
        p.receipt_number,
        p.amount::numeric,
        p.payment_mode,
        p.collection_source,
        p.agent_id,
        p.payment_timestamp,
        p.status,
        p.is_reversal,
        p.reversal_reason,
        p.reference_number,
        p.notes,
        l.id as loan_id,
        l.loan_account_no,
        c.id as customer_id,
        c.full_name as customer_name,
        c.customer_code,
        c.primary_phone as customer_phone,
        c.area_route,
        u.full_name as agent_name
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.agent_id = u.id
      ${whereSql}
      ORDER BY p.payment_timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const recordsRes = await queryPostgres(recordsSql, [...queryParams, limit, offset]);

    const records: IAgentCollectionRecord[] = recordsRes.rows.map((r: any) => ({
      id: r.id,
      receiptNumber: r.receipt_number,
      loanId: r.loan_id,
      loanAccountNo: r.loan_account_no,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerCode: r.customer_code,
      customerPhone: r.customer_phone,
      areaRoute: r.area_route,
      amount: Number(r.amount),
      paymentMode: r.payment_mode as PaymentMode,
      collectionSource: r.collection_source as CollectionSource,
      agentId: r.agent_id,
      agentName: r.agent_name,
      paymentTimestamp: r.payment_timestamp,
      status: r.status as PaymentStatus,
      isReversal: Boolean(r.is_reversal) || r.status === 'REVERSED',
      reversalReason: r.reversal_reason,
      referenceNumber: r.reference_number,
      notes: r.notes,
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
   * Retrieve recovery agent collections summary KPIs and breakdown only.
   */
  public static async getAgentCollectionsSummary(
    filters: Pick<AgentCollectionsFilterQuery, 'agentId' | 'startDate' | 'endDate'>,
    user: AuthenticatedUser
  ): Promise<IAgentCollectionSummary> {
    const full = await this.getAgentCollections({ ...filters, page: 1, limit: 1 }, user);
    return full.summary;
  }

  /**
   * Retrieve collection metrics and recent transactions for a single recovery agent.
   */
  public static async getSingleAgentCollections(
    agentId: string,
    user: AuthenticatedUser
  ) {
    if (user.role === UserRole.COLLECTION_AGENT && agentId !== user.id) {
      throw new ForbiddenError('Collection agents can only access their own collection records');
    }

    // Verify agent exists and has COLLECTION_AGENT role
    const agentCheck = await queryPostgres(
      `SELECT id, full_name, email, phone, role, status FROM users WHERE id = $1`,
      [agentId]
    );
    if (agentCheck.rows.length === 0) {
      throw new NotFoundError('Recovery agent not found');
    }
    const agent = agentCheck.rows[0];

    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');

    // Aggregate summary for this agent
    const summarySql = `
      SELECT 
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN p.amount ELSE 0 END), 0)::numeric as total_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN 1 END)::int as payment_count,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $2::date THEN p.amount ELSE 0 END), 0)::numeric as today_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $2::date THEN 1 END)::int as today_count,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $2::date) THEN p.amount ELSE 0 END), 0)::numeric as month_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $2::date) THEN 1 END)::int as month_count
      FROM payments p
      WHERE p.agent_id = $1 AND p.collection_source = 'RECOVERY_AGENT'
    `;
    const summaryRes = await queryPostgres(summarySql, [agentId, businessToday]);
    const summaryRow = summaryRes.rows[0];

    const tot = Number(summaryRow?.total_collections || 0);
    const cnt = Number(summaryRow?.payment_count || 0);

    // Recent 20 collections for this agent
    const recentSql = `
      SELECT 
        p.id,
        p.receipt_number,
        p.amount::numeric,
        p.payment_mode,
        p.payment_timestamp,
        p.status,
        p.is_reversal,
        p.reversal_reason,
        l.loan_account_no,
        c.full_name as customer_name,
        c.customer_code,
        c.primary_phone as customer_phone
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      WHERE p.agent_id = $1 AND p.collection_source = 'RECOVERY_AGENT'
      ORDER BY p.payment_timestamp DESC
      LIMIT 20
    `;
    const recentRes = await queryPostgres(recentSql, [agentId]);

    return {
      agentId,
      agentName: agent.full_name,
      agentEmail: agent.email,
      agentPhone: agent.phone,
      status: agent.status,
      totalCollections: tot,
      paymentCount: cnt,
      todayCollections: Number(summaryRow?.today_collections || 0),
      todayCount: Number(summaryRow?.today_count || 0),
      monthCollections: Number(summaryRow?.month_collections || 0),
      monthCount: Number(summaryRow?.month_count || 0),
      averageCollection: cnt > 0 ? new Decimal(tot).dividedBy(cnt).toDecimalPlaces(2).toNumber() : 0,
      recentCollections: recentRes.rows.map((r: any) => ({
        id: r.id,
        receiptNumber: r.receipt_number,
        amount: Number(r.amount),
        paymentMode: r.payment_mode,
        paymentTimestamp: r.payment_timestamp,
        status: r.status,
        isReversal: Boolean(r.is_reversal) || r.status === 'REVERSED',
        reversalReason: r.reversal_reason,
        loanAccountNo: r.loan_account_no,
        customerName: r.customer_name,
        customerCode: r.customer_code,
        customerPhone: r.customer_phone,
      })),
    };
  }
}
