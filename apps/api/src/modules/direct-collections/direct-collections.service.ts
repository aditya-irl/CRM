import { queryPostgres } from '../../database/postgres';
import {
  UserRole,
  CollectionSource,
  PaymentMode,
  PaymentStatus,
  IDirectCollectionSummary,
  IDirectCollectionRecord,
  IDirectCollectionLedgerResponse,
  IDirectCollectionDetail,
  getBusinessDate,
} from '@crm/shared';
import { ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import Decimal from 'decimal.js';

export interface DirectCollectionsFilterQuery {
  startDate?: string;
  endDate?: string;
  paymentMode?: PaymentMode;
  status?: PaymentStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export class DirectCollectionsService {
  /**
   * Enforces RBAC permissions.
   * SUPER_ADMIN, ADMIN, BRANCH_MANAGER have full organization-wide visibility.
   * COLLECTION_AGENT is blocked.
   */
  private static checkAccess(user: AuthenticatedUser) {
    if (user.role === UserRole.COLLECTION_AGENT) {
      throw new ForbiddenError('Collection agents are not authorized to access the direct customer collections ledger');
    }
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Dealers are not authorized to access the direct customer collections ledger');
    }
  }

  /**
   * Retrieve complete direct customer collections ledger with summary metrics and paginated records.
   */
  public static async getDirectCollections(
    filters: DirectCollectionsFilterQuery,
    user: AuthenticatedUser
  ): Promise<IDirectCollectionLedgerResponse> {
    this.checkAccess(user);

    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    // 1. Build Base WHERE conditions for direct payments (strictly enforce dealer_id IS NULL and agent_id IS NULL)
    const whereClauses = [
      `p.collection_source = 'DIRECT_CUSTOMER'`,
      `p.dealer_id IS NULL`,
      `p.agent_id IS NULL`,
    ];
    const queryParams: any[] = [];
    let paramIndex = 1;

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

    if (filters.paymentMode) {
      whereClauses.push(`p.payment_mode = $${paramIndex++}`);
      queryParams.push(filters.paymentMode);
    }

    if (filters.status) {
      whereClauses.push(`p.status = $${paramIndex++}`);
      queryParams.push(filters.status);
    }

    if (filters.search) {
      whereClauses.push(`(
        c.full_name ILIKE $${paramIndex}
        OR c.customer_code ILIKE $${paramIndex}
        OR c.primary_phone ILIKE $${paramIndex}
        OR l.loan_account_no ILIKE $${paramIndex}
        OR p.receipt_number ILIKE $${paramIndex}
        OR p.reference_number ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 2. Fetch Summary Aggregate (Active Collections only: status = SUCCESS and is_reversal = FALSE)
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

    const summary: IDirectCollectionSummary = {
      totalCollections: totalCollectionsNum,
      paymentCount: paymentCountNum,
      todayCollections: todayCollectionsNum,
      todayCount: todayCountNum,
      monthCollections: monthCollectionsNum,
      monthCount: monthCountNum,
      averageCollection: averageCollectionNum,
    };

    // 3. Count Total Matching Direct Payments
    const countSql = `
      SELECT COUNT(*)::int as total_rows
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      ${whereSql}
    `;
    const countRes = await queryPostgres(countSql, queryParams);
    const totalCount = Number(countRes.rows[0]?.total_rows || 0);

    // 4. Fetch Paginated Records
    const recordsSql = `
      SELECT 
        p.id,
        p.receipt_number,
        p.amount::numeric,
        p.payment_mode,
        p.collection_source,
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
        c.area_route
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      ${whereSql}
      ORDER BY p.payment_timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const recordsRes = await queryPostgres(recordsSql, [...queryParams, limit, offset]);

    const records: IDirectCollectionRecord[] = recordsRes.rows.map((r: any) => ({
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
   * Retrieve summary metrics for direct customer collections.
   */
  public static async getDirectCollectionsSummary(
    filters: Pick<DirectCollectionsFilterQuery, 'startDate' | 'endDate'>,
    user: AuthenticatedUser
  ): Promise<IDirectCollectionSummary> {
    const full = await this.getDirectCollections({ ...filters, page: 1, limit: 1 }, user);
    return full.summary;
  }

  /**
   * Retrieve single direct payment record with customer, loan, waterfall allocation, and reversal metadata.
   */
  public static async getDirectPaymentById(
    id: string,
    user: AuthenticatedUser
  ): Promise<IDirectCollectionDetail> {
    this.checkAccess(user);

    const paymentSql = `
      SELECT 
        p.id,
        p.receipt_number,
        p.amount::numeric,
        p.payment_mode,
        p.collection_source,
        p.payment_timestamp,
        p.status,
        p.is_reversal,
        p.reversal_reason,
        p.reference_number,
        p.emi_id,
        p.notes,
        l.id as loan_id,
        l.loan_account_no,
        l.principal_amount::numeric as loan_principal,
        l.outstanding_balance::numeric as loan_outstanding,
        c.id as customer_id,
        c.full_name as customer_name,
        c.customer_code,
        c.primary_phone as customer_phone,
        c.address_line1 as customer_address,
        c.area_route
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      WHERE p.id = $1 
        AND p.collection_source = 'DIRECT_CUSTOMER'
        AND p.dealer_id IS NULL
        AND p.agent_id IS NULL
    `;
    const res = await queryPostgres(paymentSql, [id]);
    if (res.rows.length === 0) {
      throw new NotFoundError('Direct customer payment not found');
    }
    const r = res.rows[0];

    // Fetch waterfall allocation details from emi_installments
    let allocRows: any[] = [];
    if (r.emi_id) {
      const allocRes = await queryPostgres(
        `SELECT 
           e.id,
           e.installment_number,
           e.principal_component::numeric as principal_component,
           e.interest_component::numeric as interest_component,
           e.penalty_amount::numeric as penalty_component,
           e.paid_amount::numeric as total_amount
         FROM emi_installments e
         WHERE e.id = $1`,
        [r.emi_id]
      );
      allocRows = allocRes.rows;
    } else {
      const allocRes = await queryPostgres(
        `SELECT 
           e.id,
           e.installment_number,
           e.principal_component::numeric as principal_component,
           e.interest_component::numeric as interest_component,
           e.penalty_amount::numeric as penalty_component,
           e.paid_amount::numeric as total_amount
         FROM emi_installments e
         WHERE e.loan_id = $1 AND e.paid_amount > 0
         ORDER BY e.installment_number ASC`,
        [r.loan_id]
      );
      allocRows = allocRes.rows;
    }

    const allocations = allocRows.map((a: any) => ({
      id: a.id,
      installmentNumber: Number(a.installment_number),
      principalComponent: Number(a.principal_component),
      interestComponent: Number(a.interest_component),
      penaltyComponent: Number(a.penalty_component),
      totalAmount: Number(a.total_amount),
    }));

    return {
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
      paymentTimestamp: r.payment_timestamp,
      status: r.status as PaymentStatus,
      isReversal: Boolean(r.is_reversal) || r.status === 'REVERSED',
      reversalReason: r.reversal_reason,
      referenceNumber: r.reference_number,
      notes: r.notes,
      customer: {
        id: r.customer_id,
        name: r.customer_name,
        code: r.customer_code,
        phone: r.customer_phone,
        address: r.customer_address,
        route: r.area_route,
      },
      loan: {
        id: r.loan_id,
        accountNo: r.loan_account_no,
        principalAmount: Number(r.loan_principal),
        outstandingBalance: Number(r.loan_outstanding),
      },
      allocations,
    };
  }
}
