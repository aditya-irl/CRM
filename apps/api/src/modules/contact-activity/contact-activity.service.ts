import { v4 as uuidv4 } from 'uuid';
import { queryPostgres } from '../../database/postgres';
import {
  ContactMethod,
  ContactOutcome,
  CustomerResponseCategory,
  NonPaymentReason,
  PaymentCommitmentStatus,
  FollowUpPriority,
  FollowUpStatus,
  UserRole,
  IContactActivity,
  IContactActivitySummary,
  IAgentPerformanceMetrics,
  IAdminContactActivitySummary,
} from '@crm/shared';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { NotFoundError, ForbiddenError, AppError } from '../../middlewares/error.middleware';
import { AuditService } from '../audit/audit.service';

export interface CreateContactActivityInput {
  customerId: string;
  loanId?: string | null;
  emiId?: string | null;
  contactMethod: ContactMethod;
  contactMethodOther?: string | null;
  contactPhoneUsed?: string | null;
  contactOutcome: ContactOutcome;
  contactOutcomeOther?: string | null;
  customerResponseCategory?: CustomerResponseCategory | null;
  customerResponseNotes?: string | null;
  nonPaymentReason?: NonPaymentReason | null;
  nonPaymentReasonNotes?: string | null;
  promisedPaymentAmount?: number | null;
  promisedPaymentDate?: string | null;
  paymentModePromised?: string | null;
  commitmentStatus?: PaymentCommitmentStatus;
  followUpDate?: string | null;
  followUpTime?: string | null;
  followUpPriority?: FollowUpPriority;
  followUpNotes?: string | null;
  agentNotes?: string | null;
}

export interface UpdateFollowUpInput {
  followUpDate?: string | null;
  followUpTime?: string | null;
  followUpPriority?: FollowUpPriority;
  followUpStatus?: FollowUpStatus;
  followUpNotes?: string | null;
  commitmentStatus?: PaymentCommitmentStatus;
  commitmentStatusNotes?: string | null;
}

export interface ContactActivityQueryParams {
  page?: number;
  limit?: number;
  customerId?: string;
  loanId?: string;
  agentId?: string;
  contactMethod?: string;
  contactOutcome?: string;
  commitmentStatus?: string;
  followUpStatus?: string;
  startDate?: string;
  endDate?: string;
  preset?: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'CUSTOM' | 'ALL';
  search?: string;
}

export class ContactActivityService {
  /**
   * Authoritative RLAC verification: checks whether an agent is actively assigned
   * to a customer via direct customer assignment, area route assignment, or loan assignment.
   */
  public static async verifyAgentCustomerAccess(
    agentId: string,
    customerId: string,
    loanId?: string | null
  ): Promise<boolean> {
    const res = await queryPostgres(
      `SELECT 1 FROM customers c
       WHERE c.id = $1 AND c.deleted_at IS NULL AND (
         c.id IN (
           SELECT customer_id FROM collection_assignments 
           WHERE agent_id = $2 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         )
         OR c.area_route IN (
           SELECT area_route FROM collection_assignments 
           WHERE agent_id = $2 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         )
         OR EXISTS (
           SELECT 1 FROM loans l 
           WHERE l.customer_id = c.id AND l.assigned_agent_id = $2 AND l.status = 'ACTIVE'
         )
       )`,
      [customerId, agentId]
    );

    if (res.rows.length === 0) {
      return false;
    }

    if (loanId) {
      const loanCheck = await queryPostgres(
        `SELECT 1 FROM loans WHERE id = $1 AND customer_id = $2`,
        [loanId, customerId]
      );
      if (loanCheck.rows.length === 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Log a customer contact activity with rigorous validation and immutable audit logging.
   * Contact logging never creates a financial transaction, ledger entry, or balance mutation.
   */
  public static async createActivity(
    data: CreateContactActivityInput,
    user: AuthenticatedUser
  ): Promise<IContactActivity> {
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Partner store accounts cannot log agent contact activities');
    }

    // 1. Verify customer exists
    const custRes = await queryPostgres(
      `SELECT id, full_name, customer_code, primary_phone, area_route FROM customers WHERE id = $1 AND deleted_at IS NULL`,
      [data.customerId]
    );
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer record not found');
    }
    const customer = custRes.rows[0];

    // 2. Authoritative Agent Identification & RLAC Enforcement
    let effectiveAgentId = user.id;
    if (user.role === UserRole.COLLECTION_AGENT) {
      const isAuthorized = await this.verifyAgentCustomerAccess(user.id, data.customerId, data.loanId);
      if (!isAuthorized) {
        throw new ForbiddenError('You do not have authorization to log contact activities for this customer');
      }
      effectiveAgentId = user.id;
    }

    // 3. Loan & Dealer association validation
    let dealerId: string | null = null;
    let loanAccountNo: string | null = null;
    if (data.loanId) {
      const loanRes = await queryPostgres(
        `SELECT id, customer_id, dealer_id, loan_account_no, assigned_agent_id FROM loans WHERE id = $1`,
        [data.loanId]
      );
      if (loanRes.rows.length === 0) {
        throw new NotFoundError('Associated loan account not found');
      }
      const loan = loanRes.rows[0];
      if (loan.customer_id !== data.customerId) {
        throw new AppError('The specified loan does not belong to the selected customer', 400);
      }
      dealerId = loan.dealer_id || null;
      loanAccountNo = loan.loan_account_no;
    }

    // 4. Validate conditional explanation fields
    if (data.contactMethod === ContactMethod.OTHER && (!data.contactMethodOther || !data.contactMethodOther.trim())) {
      throw new AppError('A description is required when contact method is Other', 400);
    }
    if (data.contactOutcome === ContactOutcome.OTHER && (!data.contactOutcomeOther || !data.contactOutcomeOther.trim())) {
      throw new AppError('A description is required when contact outcome is Other', 400);
    }
    if (data.nonPaymentReason === NonPaymentReason.OTHER && (!data.nonPaymentReasonNotes || !data.nonPaymentReasonNotes.trim())) {
      throw new AppError('An explanation is required when non-payment reason is Other', 400);
    }

    // 5. Derive initial statuses
    let commitmentStatus = data.commitmentStatus || PaymentCommitmentStatus.NONE;
    if (
      commitmentStatus === PaymentCommitmentStatus.NONE &&
      (data.promisedPaymentAmount || data.promisedPaymentDate || data.customerResponseCategory === CustomerResponseCategory.WILL_PAY_TODAY || data.customerResponseCategory === CustomerResponseCategory.WILL_PAY_ON_SPECIFIC_DATE || data.customerResponseCategory === CustomerResponseCategory.PARTIAL_PAYMENT_PROMISED)
    ) {
      commitmentStatus = PaymentCommitmentStatus.PENDING;
    }

    let followUpStatus = FollowUpStatus.NONE;
    if (data.followUpDate) {
      followUpStatus = FollowUpStatus.PENDING;
    }

    const id = uuidv4();

    const insertSql = `
      INSERT INTO customer_contact_activities (
        id, customer_id, loan_id, emi_id, agent_id, dealer_id,
        contact_method, contact_method_other, contact_phone_used,
        contact_outcome, contact_outcome_other,
        customer_response_category, customer_response_notes,
        non_payment_reason, non_payment_reason_notes,
        promised_payment_amount, promised_payment_date, payment_mode_promised,
        commitment_status,
        follow_up_date, follow_up_time, follow_up_priority, follow_up_status,
        follow_up_notes, agent_notes,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11,
        $12, $13,
        $14, $15,
        $16, $17, $18,
        $19,
        $20, $21, $22, $23,
        $24, $25,
        $26, $26, NOW(), NOW()
      )
      RETURNING *
    `;

    const insertParams = [
      id,
      data.customerId,
      data.loanId || null,
      data.emiId || null,
      effectiveAgentId,
      dealerId,
      data.contactMethod,
      data.contactMethodOther?.trim() || null,
      data.contactPhoneUsed?.trim() || customer.primary_phone || null,
      data.contactOutcome,
      data.contactOutcomeOther?.trim() || null,
      data.customerResponseCategory || null,
      data.customerResponseNotes?.trim() || null,
      data.nonPaymentReason || null,
      data.nonPaymentReasonNotes?.trim() || null,
      data.promisedPaymentAmount || null,
      data.promisedPaymentDate || null,
      data.paymentModePromised || null,
      commitmentStatus,
      data.followUpDate || null,
      data.followUpTime || null,
      data.followUpPriority || FollowUpPriority.MEDIUM,
      followUpStatus,
      data.followUpNotes?.trim() || null,
      data.agentNotes?.trim() || null,
      user.id,
    ];

    const resultRes = await queryPostgres(insertSql, insertParams);
    const row = resultRes.rows[0];

    // 6. Record immutable audit log
    await AuditService.log({
      userId: user.id,
      action: 'CONTACT_ACTIVITY_LOGGED',
      entity: 'ContactActivity',
      entityId: id,
      newState: {
        customerId: data.customerId,
        loanId: data.loanId || null,
        agentId: effectiveAgentId,
        contactMethod: data.contactMethod,
        contactOutcome: data.contactOutcome,
        customerResponseCategory: data.customerResponseCategory,
        nonPaymentReason: data.nonPaymentReason,
        promisedPaymentAmount: data.promisedPaymentAmount,
        promisedPaymentDate: data.promisedPaymentDate,
        followUpDate: data.followUpDate,
      },
    });

    return this.mapRowToContactActivity(row, {
      customerName: customer.full_name,
      customerCode: customer.customer_code,
      primaryPhone: customer.primary_phone,
      areaRoute: customer.area_route,
      loanAccountNo,
      agentName: user.fullName,
      agentEmail: user.email,
    });
  }

  /**
   * List contact activities with comprehensive filters and strict authorization scoping.
   */
  public static async listActivities(
    user: AuthenticatedUser,
    query: ContactActivityQueryParams
  ) {
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Partner store accounts cannot access contact activities');
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 25));
    const offset = (page - 1) * limit;

    let baseSql = `
      SELECT cca.*,
             c.full_name as customer_name, c.customer_code, c.primary_phone, c.area_route,
             l.loan_account_no,
             u.full_name as agent_name, u.email as agent_email, u.phone as agent_phone,
             ub.full_name as created_by_name,
             d.store_name
      FROM customer_contact_activities cca
      JOIN customers c ON cca.customer_id = c.id
      JOIN users u ON cca.agent_id = u.id
      LEFT JOIN users ub ON cca.created_by = ub.id
      LEFT JOIN loans l ON cca.loan_id = l.id
      LEFT JOIN dealers d ON cca.dealer_id = d.id
      WHERE c.deleted_at IS NULL
    `;

    const params: any[] = [];
    let pIdx = 1;

    // Strict RLAC scoping
    if (user.role === UserRole.COLLECTION_AGENT) {
      baseSql += ` AND cca.agent_id = $${pIdx++}`;
      params.push(user.id);
    } else if (query.agentId) {
      baseSql += ` AND cca.agent_id = $${pIdx++}`;
      params.push(query.agentId);
    }

    if (query.customerId) {
      baseSql += ` AND cca.customer_id = $${pIdx++}`;
      params.push(query.customerId);
    }

    if (query.loanId) {
      baseSql += ` AND cca.loan_id = $${pIdx++}`;
      params.push(query.loanId);
    }

    if (query.contactMethod) {
      baseSql += ` AND cca.contact_method = $${pIdx++}`;
      params.push(query.contactMethod);
    }

    if (query.contactOutcome) {
      baseSql += ` AND cca.contact_outcome = $${pIdx++}`;
      params.push(query.contactOutcome);
    }

    if (query.commitmentStatus) {
      baseSql += ` AND cca.commitment_status = $${pIdx++}`;
      params.push(query.commitmentStatus);
    }

    if (query.followUpStatus) {
      baseSql += ` AND cca.follow_up_status = $${pIdx++}`;
      params.push(query.followUpStatus);
    }

    // Date range & preset filtering in Asia/Kolkata timezone
    if (query.preset === 'TODAY') {
      baseSql += ` AND DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`;
    } else if (query.preset === 'YESTERDAY') {
      baseSql += ` AND DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') = ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')`;
    } else if (query.preset === 'LAST_7_DAYS') {
      baseSql += ` AND DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') >= ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '7 days')`;
    } else if (query.preset === 'LAST_30_DAYS') {
      baseSql += ` AND DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') >= ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '30 days')`;
    } else {
      if (query.startDate) {
        baseSql += ` AND DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') >= $${pIdx++}::date`;
        params.push(query.startDate);
      }
      if (query.endDate) {
        baseSql += ` AND DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') <= $${pIdx++}::date`;
        params.push(query.endDate);
      }
    }

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      baseSql += ` AND (c.full_name ILIKE $${pIdx} OR c.customer_code ILIKE $${pIdx} OR l.loan_account_no ILIKE $${pIdx} OR cca.contact_phone_used ILIKE $${pIdx})`;
      pIdx++;
      params.push(term);
    }

    const countSql = `SELECT COUNT(*) as total FROM (${baseSql}) count_sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    baseSql += ` ORDER BY cca.created_at DESC LIMIT $${pIdx++} OFFSET $${pIdx++}`;
    params.push(limit, offset);

    const res = await queryPostgres(baseSql, params);

    return {
      activities: res.rows.map((r) => this.mapRowToContactActivity(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get Today's Activity Summary metrics in Asia/Kolkata business timezone.
   */
  public static async getTodaySummary(
    user: AuthenticatedUser,
    dateStr?: string,
    targetAgentId?: string
  ): Promise<IContactActivitySummary> {
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Partner store accounts cannot access contact activity summary');
    }

    let agentFilterSql = '';
    const params: any[] = [];
    let pIdx = 1;

    if (user.role === UserRole.COLLECTION_AGENT) {
      agentFilterSql = ` AND cca.agent_id = $${pIdx++}`;
      params.push(user.id);
    } else if (targetAgentId) {
      agentFilterSql = ` AND cca.agent_id = $${pIdx++}`;
      params.push(targetAgentId);
    }

    const dateParam = dateStr || null;
    let dateFilterSql: string;
    if (dateParam) {
      dateFilterSql = `DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') = $${pIdx++}::date`;
      params.push(dateParam);
    } else {
      dateFilterSql = `DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`;
    }

    const summarySql = `
      SELECT
        COUNT(DISTINCT cca.customer_id)::int as total_customers_contacted,
        COUNT(CASE WHEN cca.contact_method = 'PHONE_CALL' THEN 1 END)::int as total_call_attempts,
        COUNT(CASE WHEN cca.contact_method = 'PHONE_CALL' AND cca.contact_outcome = 'ANSWERED_CONVERSATION_COMPLETED' THEN 1 END)::int as calls_answered,
        COUNT(CASE WHEN cca.contact_method = 'PHONE_CALL' AND cca.contact_outcome IN ('NO_ANSWER', 'BUSY', 'SWITCHED_OFF_UNREACHABLE', 'INVALID_NUMBER') THEN 1 END)::int as calls_unanswered,
        COUNT(CASE WHEN cca.contact_method = 'WHATSAPP' THEN 1 END)::int as whatsapp_count,
        COUNT(CASE WHEN cca.contact_method = 'SMS' THEN 1 END)::int as sms_count,
        COUNT(CASE WHEN cca.contact_method = 'IN_PERSON_VISIT' THEN 1 END)::int as in_person_visits,
        COUNT(CASE WHEN cca.contact_outcome IN ('ANSWERED_CONVERSATION_COMPLETED', 'VISIT_COMPLETED') THEN 1 END)::int as successful_conversations,
        COUNT(DISTINCT CASE WHEN cca.commitment_status IN ('PENDING', 'FULFILLED') OR cca.customer_response_category IN ('WILL_PAY_TODAY', 'WILL_PAY_ON_SPECIFIC_DATE', 'PARTIAL_PAYMENT_PROMISED') THEN cca.customer_id END)::int as promised_to_pay_count
      FROM customer_contact_activities cca
      WHERE ${dateFilterSql} ${agentFilterSql}
    `;

    const summaryRes = await queryPostgres(summarySql, params);
    const row = summaryRes.rows[0] || {};

    // Follow-ups due today vs overdue
    const followUpParams: any[] = [];
    let fuIdx = 1;
    let fuAgentSql = '';
    if (user.role === UserRole.COLLECTION_AGENT) {
      fuAgentSql = ` AND cca.agent_id = $${fuIdx++}`;
      followUpParams.push(user.id);
    } else if (targetAgentId) {
      fuAgentSql = ` AND cca.agent_id = $${fuIdx++}`;
      followUpParams.push(targetAgentId);
    }

    let todayDateStrSql = dateParam ? `$${fuIdx++}::date` : `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`;
    if (dateParam) {
      followUpParams.push(dateParam);
    }

    const followUpSql = `
      SELECT
        COUNT(CASE WHEN cca.follow_up_date = ${todayDateStrSql} AND cca.follow_up_status = 'PENDING' THEN 1 END)::int as follow_ups_due_today,
        COUNT(CASE WHEN cca.follow_up_date < ${todayDateStrSql} AND cca.follow_up_status = 'PENDING' THEN 1 END)::int as follow_ups_overdue
      FROM customer_contact_activities cca
      WHERE cca.follow_up_status = 'PENDING' ${fuAgentSql}
    `;
    const followUpRes = await queryPostgres(followUpSql, followUpParams);
    const fuRow = followUpRes.rows[0] || {};

    // Resulting collections
    const colParams: any[] = [];
    let cIdx = 1;
    let colAgentSql = '';
    if (user.role === UserRole.COLLECTION_AGENT) {
      colAgentSql = ` AND (p.collected_by_agent_id = $${cIdx} OR p.agent_id = $${cIdx})`;
      cIdx++;
      colParams.push(user.id);
    } else if (targetAgentId) {
      colAgentSql = ` AND (p.collected_by_agent_id = $${cIdx} OR p.agent_id = $${cIdx})`;
      cIdx++;
      colParams.push(targetAgentId);
    }

    const colDateSql = dateParam ? `$${cIdx++}::date` : `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`;
    if (dateParam) {
      colParams.push(dateParam);
    }

    const collectionsSql = `
      SELECT
        COUNT(p.id)::int as collections_count,
        COALESCE(SUM(p.amount), 0)::numeric as collections_amount
      FROM payments p
      WHERE p.status IN ('SUCCESS', 'PENDING_APPROVAL')
        AND DATE(COALESCE(p.payment_timestamp, p.created_at) AT TIME ZONE 'Asia/Kolkata') = ${colDateSql}
        ${colAgentSql}
        AND p.customer_id IN (
          SELECT DISTINCT cca.customer_id
          FROM customer_contact_activities cca
          WHERE DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') <= ${colDateSql}
          ${user.role === UserRole.COLLECTION_AGENT ? `AND cca.agent_id = '${user.id}'` : targetAgentId ? `AND cca.agent_id = '${targetAgentId}'` : ''}
        )
    `;

    const colRes = await queryPostgres(collectionsSql, colParams);
    const colRow = colRes.rows[0] || {};

    return {
      totalCustomersContacted: Number(row.total_customers_contacted || 0),
      totalCallAttempts: Number(row.total_call_attempts || 0),
      callsAnswered: Number(row.calls_answered || 0),
      callsUnanswered: Number(row.calls_unanswered || 0),
      whatsAppCount: Number(row.whatsapp_count || 0),
      smsCount: Number(row.sms_count || 0),
      inPersonVisits: Number(row.in_person_visits || 0),
      successfulConversations: Number(row.successful_conversations || 0),
      promisedToPayCount: Number(row.promised_to_pay_count || 0),
      followUpsDueToday: Number(fuRow.follow_ups_due_today || 0),
      followUpsOverdue: Number(fuRow.follow_ups_overdue || 0),
      collectionsResultingCount: Number(colRow.collections_count || 0),
      collectionsResultingAmount: Number(colRow.collections_amount || 0),
    };
  }

  /**
   * Admin-only Monitoring Summary and Agent Performance breakdown.
   */
  public static async getAdminSummary(
    user: AuthenticatedUser,
    query: { startDate?: string; endDate?: string; agentId?: string }
  ): Promise<IAdminContactActivitySummary> {
    if (user.role === UserRole.COLLECTION_AGENT || user.role === UserRole.DEALER) {
      throw new ForbiddenError('You are not authorized to view administrator contact activity monitoring');
    }

    const overview = await this.getTodaySummary(user, query.startDate, query.agentId);

    // Fetch active agents and compute per-agent performance table
    let agentFilter = `WHERE u.role = 'COLLECTION_AGENT' AND u.status = 'ACTIVE'`;
    const agentParams: any[] = [];
    if (query.agentId) {
      agentFilter += ` AND u.id = $1`;
      agentParams.push(query.agentId);
    }

    const agentsSql = `
      SELECT u.id as agent_id, u.full_name as agent_name, u.email as agent_email, u.phone as agent_phone
      FROM users u
      ${agentFilter}
      ORDER BY u.full_name ASC
    `;
    const agentsRes = await queryPostgres(agentsSql, agentParams);

    const todayDateSql = query.startDate ? `'${query.startDate}'::date` : `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`;

    const metricsPromises = agentsRes.rows.map(async (ag) => {
      const statsRes = await queryPostgres(
        `SELECT
           COUNT(DISTINCT cca.customer_id)::int as customers_contacted,
           COUNT(CASE WHEN cca.contact_method = 'PHONE_CALL' THEN 1 END)::int as call_attempts,
           COUNT(CASE WHEN cca.contact_outcome IN ('ANSWERED_CONVERSATION_COMPLETED', 'VISIT_COMPLETED') THEN 1 END)::int as conversations_completed,
           COUNT(CASE WHEN cca.follow_up_status = 'COMPLETED' THEN 1 END)::int as follow_ups_completed,
           COUNT(CASE WHEN cca.follow_up_date < ${todayDateSql} AND cca.follow_up_status = 'PENDING' THEN 1 END)::int as follow_ups_overdue,
           COUNT(CASE WHEN cca.commitment_status IN ('PENDING', 'FULFILLED') THEN 1 END)::int as promises_made,
           COUNT(CASE WHEN cca.commitment_status = 'FULFILLED' THEN 1 END)::int as promises_fulfilled
         FROM customer_contact_activities cca
         WHERE cca.agent_id = $1
           AND DATE(cca.created_at AT TIME ZONE 'Asia/Kolkata') = ${todayDateSql}`,
        [ag.agent_id]
      );
      const s = statsRes.rows[0] || {};

      const colRes = await queryPostgres(
        `SELECT
           COUNT(p.id)::int as collections_count,
           COALESCE(SUM(p.amount), 0)::numeric as collections_amount
         FROM payments p
         WHERE (p.collected_by_agent_id = $1 OR p.agent_id = $1)
           AND p.status IN ('SUCCESS', 'PENDING_APPROVAL')
           AND DATE(COALESCE(p.payment_timestamp, p.created_at) AT TIME ZONE 'Asia/Kolkata') = ${todayDateSql}`,
        [ag.agent_id]
      );
      const c = colRes.rows[0] || {};

      return {
        agentId: ag.agent_id,
        agentName: ag.agent_name,
        agentEmail: ag.agent_email,
        agentPhone: ag.agent_phone || '',
        customersContacted: Number(s.customers_contacted || 0),
        callAttempts: Number(s.call_attempts || 0),
        conversationsCompleted: Number(s.conversations_completed || 0),
        followUpsCompleted: Number(s.follow_ups_completed || 0),
        followUpsOverdue: Number(s.follow_ups_overdue || 0),
        promisesMade: Number(s.promises_made || 0),
        promisesFulfilled: Number(s.promises_fulfilled || 0),
        collectionsCount: Number(c.collections_count || 0),
        collectionsAmount: Number(c.collections_amount || 0),
      };
    });

    const agentMetrics = await Promise.all(metricsPromises);

    return {
      overview,
      agents: agentMetrics,
    };
  }

  /**
   * Get authorized customer contact history timeline.
   */
  public static async getCustomerActivities(
    customerId: string,
    user: AuthenticatedUser
  ): Promise<IContactActivity[]> {
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Partner store accounts cannot access customer contact histories');
    }

    if (user.role === UserRole.COLLECTION_AGENT) {
      const isAuthorized = await this.verifyAgentCustomerAccess(user.id, customerId);
      if (!isAuthorized) {
        throw new ForbiddenError('You do not have permission to view contact history for this customer');
      }
    }

    const sql = `
      SELECT cca.*,
             c.full_name as customer_name, c.customer_code, c.primary_phone, c.area_route,
             l.loan_account_no,
             u.full_name as agent_name, u.email as agent_email, u.phone as agent_phone,
             ub.full_name as created_by_name,
             d.store_name
      FROM customer_contact_activities cca
      JOIN customers c ON cca.customer_id = c.id
      JOIN users u ON cca.agent_id = u.id
      LEFT JOIN users ub ON cca.created_by = ub.id
      LEFT JOIN loans l ON cca.loan_id = l.id
      LEFT JOIN dealers d ON cca.dealer_id = d.id
      WHERE cca.customer_id = $1
      ORDER BY cca.created_at DESC
    `;

    const res = await queryPostgres(sql, [customerId]);
    return res.rows.map((r) => this.mapRowToContactActivity(r));
  }

  /**
   * Update permitted follow-up or commitment fields with full audit trail.
   */
  public static async updateFollowUp(
    activityId: string,
    data: UpdateFollowUpInput,
    user: AuthenticatedUser
  ): Promise<IContactActivity> {
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Partner store accounts cannot update follow-up records');
    }

    const existingRes = await queryPostgres(
      `SELECT * FROM customer_contact_activities WHERE id = $1`,
      [activityId]
    );
    if (existingRes.rows.length === 0) {
      throw new NotFoundError('Contact activity record not found');
    }
    const current = existingRes.rows[0];

    if (user.role === UserRole.COLLECTION_AGENT && current.agent_id !== user.id) {
      throw new ForbiddenError('You can only update contact activity follow-ups that you created');
    }

    const updates: string[] = ['updated_at = NOW()', 'updated_by = $2'];
    const params: any[] = [activityId, user.id];
    let pIdx = 3;

    if (data.followUpStatus) {
      updates.push(`follow_up_status = $${pIdx++}`);
      params.push(data.followUpStatus);
      if (data.followUpStatus === FollowUpStatus.COMPLETED) {
        updates.push(`follow_up_completed_at = NOW()`);
      }
    }

    if (data.followUpDate !== undefined) {
      updates.push(`follow_up_date = $${pIdx++}`);
      params.push(data.followUpDate || null);
    }

    if (data.followUpTime !== undefined) {
      updates.push(`follow_up_time = $${pIdx++}`);
      params.push(data.followUpTime || null);
    }

    if (data.followUpPriority) {
      updates.push(`follow_up_priority = $${pIdx++}`);
      params.push(data.followUpPriority);
    }

    if (data.followUpNotes !== undefined) {
      updates.push(`follow_up_notes = $${pIdx++}`);
      params.push(data.followUpNotes?.trim() || null);
    }

    if (data.commitmentStatus) {
      updates.push(`commitment_status = $${pIdx++}`);
      params.push(data.commitmentStatus);
      if (data.commitmentStatus === PaymentCommitmentStatus.FULFILLED) {
        updates.push(`commitment_fulfilled_at = NOW()`);
      }
    }

    if (data.commitmentStatusNotes !== undefined) {
      updates.push(`commitment_status_notes = $${pIdx++}`);
      params.push(data.commitmentStatusNotes?.trim() || null);
    }

    const updateSql = `
      UPDATE customer_contact_activities
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const updatedRes = await queryPostgres(updateSql, params);
    const updated = updatedRes.rows[0];

    // Immutable audit record of the follow-up mutation
    await AuditService.log({
      userId: user.id,
      action: 'CONTACT_FOLLOW_UP_UPDATED',
      entity: 'ContactActivity',
      entityId: activityId,
      previousState: {
        followUpStatus: current.follow_up_status,
        followUpDate: current.follow_up_date,
        commitmentStatus: current.commitment_status,
      },
      newState: {
        followUpStatus: updated.follow_up_status,
        followUpDate: updated.follow_up_date,
        commitmentStatus: updated.commitment_status,
      },
    });

    return this.mapRowToContactActivity(updated);
  }

  /**
   * Export filtered contact activities as CSV for administrator reporting.
   */
  public static async exportActivitiesCsv(
    user: AuthenticatedUser,
    query: ContactActivityQueryParams
  ): Promise<string> {
    if (user.role === UserRole.COLLECTION_AGENT || user.role === UserRole.DEALER) {
      throw new ForbiddenError('You are not authorized to export contact activity reports');
    }

    const data = await this.listActivities(user, { ...query, limit: 5000 });

    const headers = [
      'Timestamp',
      'Customer Code',
      'Customer Name',
      'Phone',
      'Area Route',
      'Loan Account',
      'Agent Name',
      'Contact Method',
      'Contact Outcome',
      'Customer Response',
      'Non-Payment Reason',
      'Promised Amount',
      'Promised Date',
      'Commitment Status',
      'Follow-Up Date',
      'Follow-Up Status',
      'Follow-Up Priority',
      'Notes',
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = data.activities.map((a) => [
      escapeCsv(a.createdAt),
      escapeCsv(a.customerCode),
      escapeCsv(a.customerName),
      escapeCsv(a.contactPhoneUsed || a.primaryPhone),
      escapeCsv(a.areaRoute),
      escapeCsv(a.loanAccountNo),
      escapeCsv(a.agentName),
      escapeCsv(a.contactMethod),
      escapeCsv(a.contactOutcome),
      escapeCsv(a.customerResponseCategory),
      escapeCsv(a.nonPaymentReason),
      escapeCsv(a.promisedPaymentAmount ? `₹${a.promisedPaymentAmount}` : ''),
      escapeCsv(a.promisedPaymentDate),
      escapeCsv(a.commitmentStatus),
      escapeCsv(a.followUpDate),
      escapeCsv(a.followUpStatus),
      escapeCsv(a.followUpPriority),
      escapeCsv(a.agentNotes || a.customerResponseNotes),
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  private static mapRowToContactActivity(row: any, overrides: any = {}): IContactActivity {
    return {
      id: row.id,
      customerId: row.customer_id,
      customerName: overrides.customerName || row.customer_name,
      customerCode: overrides.customerCode || row.customer_code,
      primaryPhone: overrides.primaryPhone || row.primary_phone,
      areaRoute: overrides.areaRoute || row.area_route,
      loanId: row.loan_id || null,
      loanAccountNo: overrides.loanAccountNo || row.loan_account_no || null,
      emiId: row.emi_id || null,
      installmentNumber: row.installment_number ? Number(row.installment_number) : null,
      agentId: row.agent_id,
      agentName: overrides.agentName || row.agent_name,
      agentEmail: overrides.agentEmail || row.agent_email,
      agentPhone: overrides.agentPhone || row.agent_phone,
      dealerId: row.dealer_id || null,
      storeName: overrides.storeName || row.store_name || null,
      contactMethod: row.contact_method,
      contactMethodOther: row.contact_method_other || null,
      contactPhoneUsed: row.contact_phone_used || null,
      contactOutcome: row.contact_outcome,
      contactOutcomeOther: row.contact_outcome_other || null,
      customerResponseCategory: row.customer_response_category || null,
      customerResponseNotes: row.customer_response_notes || null,
      nonPaymentReason: row.non_payment_reason || null,
      nonPaymentReasonNotes: row.non_payment_reason_notes || null,
      promisedPaymentAmount: row.promised_payment_amount ? Number(row.promised_payment_amount) : null,
      promisedPaymentDate: row.promised_payment_date ? String(row.promised_payment_date).split('T')[0] : null,
      paymentModePromised: row.payment_mode_promised || null,
      commitmentStatus: row.commitment_status || PaymentCommitmentStatus.NONE,
      commitmentFulfilledAt: row.commitment_fulfilled_at ? new Date(row.commitment_fulfilled_at).toISOString() : null,
      commitmentStatusNotes: row.commitment_status_notes || null,
      followUpDate: row.follow_up_date ? String(row.follow_up_date).split('T')[0] : null,
      followUpTime: row.follow_up_time || null,
      followUpPriority: row.follow_up_priority || FollowUpPriority.MEDIUM,
      followUpStatus: row.follow_up_status || FollowUpStatus.NONE,
      followUpCompletedAt: row.follow_up_completed_at ? new Date(row.follow_up_completed_at).toISOString() : null,
      followUpNotes: row.follow_up_notes || null,
      agentNotes: row.agent_notes || null,
      createdBy: row.created_by,
      createdByName: overrides.createdByName || row.created_by_name || null,
      updatedBy: row.updated_by || null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
  }
}
