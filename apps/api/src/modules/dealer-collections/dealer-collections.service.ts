import { queryPostgres } from '../../database/postgres';
import {
  UserRole,
  DealerStatus,
  CollectionSource,
  PaymentMode,
  PaymentStatus,
  IDealerCollectionMetric,
  IDealerCollectionSummary,
  IDealerCollectionRecord,
  IDealerCollectionLedgerResponse,
  getBusinessDate,
} from '@crm/shared';
import { AppError, ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import Decimal from 'decimal.js';

export interface DealerCollectionsFilterQuery {
  dealerId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export class DealerCollectionsService {
  /**
   * Helper to check RBAC authorization for financial dealer reports.
   * ADMIN, SUPER_ADMIN, BRANCH_MANAGER have full access.
   * COLLECTION_AGENT is blocked.
   */
  private static checkAccess(user: AuthenticatedUser) {
    if (user.role === UserRole.COLLECTION_AGENT) {
      throw new ForbiddenError('Collection agents are not authorized to access the dealer collections ledger');
    }
  }

  /**
   * Retrieve complete dealer collections ledger with summary metrics, dealer breakdown, and paginated records.
   */
  public static async getDealerCollections(
    filters: DealerCollectionsFilterQuery,
    user: AuthenticatedUser
  ): Promise<IDealerCollectionLedgerResponse> {
    this.checkAccess(user);

    // Dealer RLAC: Force dealerId to authenticated dealer
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) throw new ForbiddenError('Dealer context missing');
      filters.dealerId = user.dealerId;
    }

    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    // 1. Build Base WHERE conditions for payments
    let whereClauses = [`p.collection_source = 'DEALER'`];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (filters.dealerId) {
      whereClauses.push(`p.dealer_id = $${paramIndex++}`);
      queryParams.push(filters.dealerId);
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
        OR d.store_name ILIKE $${paramIndex}
        OR d.dealer_code ILIKE $${paramIndex}
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
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $${paramIndex}::date) THEN p.amount ELSE 0 END), 0)::numeric as month_collections
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN dealers d ON p.dealer_id = d.id
      ${whereSql}
    `;
    const summaryRes = await queryPostgres(summarySql, [...queryParams, businessToday]);
    const summaryRow = summaryRes.rows[0];

    const totalCollectionsNum = Number(summaryRow?.total_collections || 0);
    const paymentCountNum = Number(summaryRow?.payment_count || 0);
    const todayCollectionsNum = Number(summaryRow?.today_collections || 0);
    const monthCollectionsNum = Number(summaryRow?.month_collections || 0);
    const averageCollectionNum =
      paymentCountNum > 0
        ? new Decimal(totalCollectionsNum).dividedBy(paymentCountNum).toDecimalPlaces(2).toNumber()
        : 0;

    // 3. Fetch Dealer Breakdown (Grouped per Partner Store)
    // If dealerId filter is supplied, fetch for that dealer; otherwise fetch all dealers
    let dealerBreakdownSql = `
      SELECT 
        d.id as dealer_id,
        d.dealer_code,
        d.store_name,
        d.owner_name,
        d.phone,
        d.area_city,
        d.status,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN p.amount ELSE 0 END), 0)::numeric as total_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN 1 END)::int as payment_count,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $1::date THEN p.amount ELSE 0 END), 0)::numeric as today_collections,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $1::date) THEN p.amount ELSE 0 END), 0)::numeric as month_collections
      FROM dealers d
      LEFT JOIN payments p ON p.dealer_id = d.id AND p.collection_source = 'DEALER'
    `;
    const dealerBreakdownParams: any[] = [businessToday];
    let dIdx = 2;

    if (filters.dealerId) {
      dealerBreakdownSql += ` WHERE d.id = $${dIdx++}`;
      dealerBreakdownParams.push(filters.dealerId);
    }

    dealerBreakdownSql += `
      GROUP BY d.id, d.dealer_code, d.store_name, d.owner_name, d.phone, d.area_city, d.status
      ORDER BY total_collections DESC, d.store_name ASC
    `;
    const dealerBreakdownRes = await queryPostgres(dealerBreakdownSql, dealerBreakdownParams);
    const dealerBreakdown: IDealerCollectionMetric[] = dealerBreakdownRes.rows.map((r: any) => {
      const tot = Number(r.total_collections || 0);
      const cnt = Number(r.payment_count || 0);
      return {
        dealerId: r.dealer_id,
        dealerCode: r.dealer_code,
        storeName: r.store_name,
        ownerName: r.owner_name,
        phone: r.phone,
        areaCity: r.area_city,
        status: r.status as DealerStatus,
        totalCollections: tot,
        paymentCount: cnt,
        todayCollections: Number(r.today_collections || 0),
        monthCollections: Number(r.month_collections || 0),
        averageCollection: cnt > 0 ? new Decimal(tot).dividedBy(cnt).toDecimalPlaces(2).toNumber() : 0,
      };
    });

    const summary: IDealerCollectionSummary = {
      totalCollections: totalCollectionsNum,
      paymentCount: paymentCountNum,
      todayCollections: todayCollectionsNum,
      monthCollections: monthCollectionsNum,
      averageCollection: averageCollectionNum,
      dealerBreakdown,
    };

    // 4. Fetch Paginated Records and Count
    const countSql = `
      SELECT COUNT(*)::int as total_rows
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN dealers d ON p.dealer_id = d.id
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
        p.dealer_id,
        p.payment_timestamp,
        p.status,
        p.is_reversal,
        p.reference_number,
        p.notes,
        l.id as loan_id,
        l.loan_account_no,
        c.id as customer_id,
        c.full_name as customer_name,
        c.customer_code,
        c.primary_phone as customer_phone,
        c.area_route,
        d.store_name as dealer_store_name,
        d.dealer_code
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN dealers d ON p.dealer_id = d.id
      ${whereSql}
      ORDER BY p.payment_timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const recordsRes = await queryPostgres(recordsSql, [...queryParams, limit, offset]);

    const records: IDealerCollectionRecord[] = recordsRes.rows.map((r: any) => ({
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
      dealerId: r.dealer_id,
      dealerStoreName: r.dealer_store_name,
      dealerCode: r.dealer_code,
      paymentTimestamp: r.payment_timestamp,
      status: r.status as PaymentStatus,
      isReversal: Boolean(r.is_reversal),
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
   * Retrieve dealer collections summary KPIs and breakdown only.
   */
  public static async getDealerCollectionsSummary(
    filters: Pick<DealerCollectionsFilterQuery, 'dealerId' | 'startDate' | 'endDate'>,
    user: AuthenticatedUser
  ): Promise<IDealerCollectionSummary> {
    const full = await this.getDealerCollections({ ...filters, page: 1, limit: 1 }, user);
    return full.summary;
  }

  /**
   * Retrieve collection metrics and recent transactions for a single dealer (for Dealer 360).
   */
  public static async getSingleDealerCollections(
    dealerId: string,
    user: AuthenticatedUser
  ) {
    this.checkAccess(user);

    if (user.role === UserRole.DEALER && user.dealerId !== dealerId) {
      throw new ForbiddenError('You do not have access to another dealer\'s data');
    }

    // Verify dealer exists
    const dealerCheck = await queryPostgres(
      `SELECT id, store_name, dealer_code, status FROM dealers WHERE id = $1`,
      [dealerId]
    );
    if (dealerCheck.rows.length === 0) {
      throw new NotFoundError('Partner store not found');
    }

    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');

    // Aggregate summary
    const summarySql = `
      SELECT 
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN p.amount ELSE 0 END), 0)::numeric as total_collections,
        COUNT(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE THEN 1 END)::int as payment_count,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $2::date THEN p.amount ELSE 0 END), 0)::numeric as today_collections,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' AND p.is_reversal = FALSE AND DATE_TRUNC('month', p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = DATE_TRUNC('month', $2::date) THEN p.amount ELSE 0 END), 0)::numeric as month_collections
      FROM payments p
      WHERE p.dealer_id = $1 AND p.collection_source = 'DEALER'
    `;
    const summaryRes = await queryPostgres(summarySql, [dealerId, businessToday]);
    const summaryRow = summaryRes.rows[0];

    const tot = Number(summaryRow?.total_collections || 0);
    const cnt = Number(summaryRow?.payment_count || 0);

    // Recent 20 collections
    const recentSql = `
      SELECT 
        p.id,
        p.receipt_number,
        p.amount::numeric,
        p.payment_mode,
        p.payment_timestamp,
        p.status,
        p.is_reversal,
        l.loan_account_no,
        c.full_name as customer_name,
        c.customer_code,
        c.primary_phone as customer_phone
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      WHERE p.dealer_id = $1 AND p.collection_source = 'DEALER'
      ORDER BY p.payment_timestamp DESC
      LIMIT 20
    `;
    const recentRes = await queryPostgres(recentSql, [dealerId]);

    return {
      dealerId,
      dealerCode: dealerCheck.rows[0].dealer_code,
      storeName: dealerCheck.rows[0].store_name,
      status: dealerCheck.rows[0].status as DealerStatus,
      totalCollections: tot,
      paymentCount: cnt,
      todayCollections: Number(summaryRow?.today_collections || 0),
      monthCollections: Number(summaryRow?.month_collections || 0),
      averageCollection: cnt > 0 ? new Decimal(tot).dividedBy(cnt).toDecimalPlaces(2).toNumber() : 0,
      recentCollections: recentRes.rows.map((r: any) => ({
        id: r.id,
        receiptNumber: r.receipt_number,
        amount: Number(r.amount),
        paymentMode: r.payment_mode,
        paymentTimestamp: r.payment_timestamp,
        status: r.status,
        isReversal: Boolean(r.is_reversal),
        loanAccountNo: r.loan_account_no,
        customerName: r.customer_name,
        customerCode: r.customer_code,
        customerPhone: r.customer_phone,
      })),
    };
  }
}
