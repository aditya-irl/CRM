import { v4 as uuidv4 } from 'uuid';
import { queryPostgres } from '../../database/postgres';
import { NotFoundError } from '../../middlewares/error.middleware';
import { IAuditLogDetail, redactSensitiveData, computeAuditDiff } from '@crm/shared';

export interface LogAuditParams {
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export class AuditService {
  /**
   * Write an immutable audit log entry using an active transaction client.
   */
  public static async logWithClient(client: import('pg').PoolClient, params: LogAuditParams): Promise<void> {
    const id = uuidv4();
    const sql = `
      INSERT INTO audit_logs (
        id, user_id, action, entity, entity_id, previous_state, new_state, ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    `;
    await client.query(sql, [
      id,
      params.userId || null,
      params.action,
      params.entity,
      params.entityId,
      params.previousState ? JSON.stringify(params.previousState) : null,
      params.newState ? JSON.stringify(params.newState) : null,
      params.ipAddress || null,
      params.userAgent || null,
    ]);
  }

  /**
   * Write an immutable audit log entry to PostgreSQL.
   */
  public static async log(params: LogAuditParams): Promise<void> {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO audit_logs (
          id, user_id, action, entity, entity_id, previous_state, new_state, ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `;
      await queryPostgres(sql, [
        id,
        params.userId || null,
        params.action,
        params.entity,
        params.entityId,
        params.previousState ? JSON.stringify(params.previousState) : null,
        params.newState ? JSON.stringify(params.newState) : null,
        params.ipAddress || null,
        params.userAgent || null,
      ]);
    } catch (err) {
      console.error('[AuditService] Failed to write audit log:', err);
    }
  }

  /**
   * Retrieve immutable audit logs list (Admin/Super Admin only).
   */
  public static async getLogs(
    limit = 50,
    offset = 0,
    entity?: string,
    entityId?: string,
    userId?: string
  ) {
    const lim = Math.min(100, Math.max(1, limit));
    const off = Math.max(0, offset);

    let sql = `
      SELECT 
        a.id, a.user_id, a.action, a.entity, a.entity_id as "entityId",
        a.previous_state, a.new_state, a.ip_address, a.user_agent, a.created_at,
        u.full_name as user_full_name, u.email as user_email, u.role as user_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (entity) {
      sql += ` AND a.entity = $${paramIndex++}`;
      params.push(entity);
    }

    if (entityId) {
      sql += ` AND a.entity_id = $${paramIndex++}`;
      params.push(entityId);
    }

    if (userId) {
      sql += ` AND a.user_id = $${paramIndex++}`;
      params.push(userId);
    }

    // Count query
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    sql += ` ORDER BY a.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(lim, off);

    const result = await queryPostgres(sql, params);

    return {
      logs: result.rows.map((row) => {
        let prev = row.previous_state;
        let next = row.new_state;
        if (typeof prev === 'string') {
          try { prev = JSON.parse(prev); } catch { /* noop */ }
        }
        if (typeof next === 'string') {
          try { next = JSON.parse(next); } catch { /* noop */ }
        }
        return {
          id: row.id,
          userId: row.user_id,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          previousState: prev ? redactSensitiveData(prev) : null,
          newState: next ? redactSensitiveData(next) : null,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          createdAt: row.created_at,
          userFullName: row.user_full_name,
          userEmail: row.user_email,
          userRole: row.user_role,
        };
      }),
      total,
      limit: lim,
      offset: off,
    };
  }

  /**
   * Retrieve a single audit log entry with complete enriched details, actor context,
   * target resource resolution, visual diff, and recursive sensitive data redaction.
   */
  public static async getLogById(id: string): Promise<IAuditLogDetail> {
    const sql = `
      SELECT 
        a.id, a.user_id, a.action, a.entity, a.entity_id as "entityId",
        a.previous_state, a.new_state, a.ip_address, a.user_agent, a.created_at,
        u.full_name as user_full_name, u.email as user_email, u.role as user_role, u.dealer_id as user_dealer_id,
        d.store_name as dealer_store_name, d.owner_name as dealer_owner_name
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN dealers d ON u.dealer_id = d.id
      WHERE a.id = $1
    `;

    const res = await queryPostgres(sql, [id]);
    if (res.rows.length === 0) {
      throw new NotFoundError(`Audit log entry with ID '${id}' not found`);
    }

    const row = res.rows[0];

    // Safely parse JSON states
    let rawPrevState: Record<string, any> | null = null;
    let rawNextState: Record<string, any> | null = null;

    if (row.previous_state) {
      try {
        rawPrevState = typeof row.previous_state === 'string' ? JSON.parse(row.previous_state) : row.previous_state;
      } catch {
        rawPrevState = { raw: row.previous_state };
      }
    }

    if (row.new_state) {
      try {
        rawNextState = typeof row.new_state === 'string' ? JSON.parse(row.new_state) : row.new_state;
      } catch {
        rawNextState = { raw: row.new_state };
      }
    }

    // Redact sensitive keys recursively
    const previousState = rawPrevState ? redactSensitiveData(rawPrevState) : null;
    const newState = rawNextState ? redactSensitiveData(rawNextState) : null;

    // Compute diff
    const changes = computeAuditDiff(previousState, newState);

    // Resolve target resource metadata
    let entityAccountNo: string | null = null;
    let customerId: string | null = null;
    let customerName: string | null = null;
    let loanId: string | null = null;
    let loanAccountNo: string | null = null;
    let dealerId: string | null = null;
    let dealerName: string | null = null;

    // Check states first
    const combinedState = { ...(previousState || {}), ...(newState || {}) };
    if (combinedState.loanAccountNo) loanAccountNo = String(combinedState.loanAccountNo);
    if (combinedState.loan_account_no) loanAccountNo = String(combinedState.loan_account_no);
    if (combinedState.customerId) customerId = String(combinedState.customerId);
    if (combinedState.customer_id) customerId = String(combinedState.customer_id);
    if (combinedState.customerName) customerName = String(combinedState.customerName);
    if (combinedState.customer_name) customerName = String(combinedState.customer_name);
    if (combinedState.loanId) loanId = String(combinedState.loanId);
    if (combinedState.loan_id) loanId = String(combinedState.loan_id);
    if (combinedState.dealerId) dealerId = String(combinedState.dealerId);
    if (combinedState.dealer_id) dealerId = String(combinedState.dealer_id);
    if (combinedState.receiptNumber) entityAccountNo = String(combinedState.receiptNumber);
    if (combinedState.receipt_number) entityAccountNo = String(combinedState.receipt_number);
    if (combinedState.settlementNumber) entityAccountNo = String(combinedState.settlementNumber);
    if (combinedState.settlement_number) entityAccountNo = String(combinedState.settlement_number);
    if (combinedState.customerCode) entityAccountNo = String(combinedState.customerCode);
    if (combinedState.customer_code) entityAccountNo = String(combinedState.customer_code);

    // Fallback lightweight lookup in DB if entity ID is present
    try {
      if (row.entity === 'Customer') {
        const cRes = await queryPostgres(
          'SELECT customer_code, full_name, primary_phone FROM customers WHERE id = $1',
          [row.entityId]
        );
        if (cRes.rows.length > 0) {
          entityAccountNo = entityAccountNo || cRes.rows[0].customer_code;
          customerId = customerId || row.entityId;
          customerName = customerName || cRes.rows[0].full_name;
        }
      } else if (row.entity === 'Loan') {
        const lRes = await queryPostgres(
          `SELECT l.loan_account_no, l.customer_id, c.full_name as cust_name, l.dealer_id, d.store_name
           FROM loans l
           LEFT JOIN customers c ON l.customer_id = c.id
           LEFT JOIN dealers d ON l.dealer_id = d.id
           WHERE l.id = $1`,
          [row.entityId]
        );
        if (lRes.rows.length > 0) {
          loanAccountNo = loanAccountNo || lRes.rows[0].loan_account_no;
          entityAccountNo = entityAccountNo || lRes.rows[0].loan_account_no;
          loanId = loanId || row.entityId;
          customerId = customerId || lRes.rows[0].customer_id;
          customerName = customerName || lRes.rows[0].cust_name;
          dealerId = dealerId || lRes.rows[0].dealer_id;
          dealerName = dealerName || lRes.rows[0].store_name;
        }
      } else if (row.entity === 'Payment') {
        const pRes = await queryPostgres(
          `SELECT p.receipt_number, p.loan_id, l.loan_account_no, p.customer_id, c.full_name as cust_name, p.dealer_id, d.store_name
           FROM payments p
           LEFT JOIN loans l ON p.loan_id = l.id
           LEFT JOIN customers c ON p.customer_id = c.id
           LEFT JOIN dealers d ON p.dealer_id = d.id
           WHERE p.id = $1`,
          [row.entityId]
        );
        if (pRes.rows.length > 0) {
          entityAccountNo = entityAccountNo || pRes.rows[0].receipt_number;
          loanId = loanId || pRes.rows[0].loan_id;
          loanAccountNo = loanAccountNo || pRes.rows[0].loan_account_no;
          customerId = customerId || pRes.rows[0].customer_id;
          customerName = customerName || pRes.rows[0].cust_name;
          dealerId = dealerId || pRes.rows[0].dealer_id;
          dealerName = dealerName || pRes.rows[0].store_name;
        }
      } else if (row.entity === 'Dealer') {
        const dRes = await queryPostgres('SELECT store_name FROM dealers WHERE id = $1', [row.entityId]);
        if (dRes.rows.length > 0) {
          dealerId = dealerId || row.entityId;
          dealerName = dealerName || dRes.rows[0].store_name;
          entityAccountNo = entityAccountNo || dRes.rows[0].store_name;
        }
      }
    } catch {
      // Non-fatal if DB lookup fails
    }

    if (!entityAccountNo) {
      entityAccountNo = loanAccountNo || null;
    }

    // Determine severity
    const actionUpper = (row.action || '').toUpperCase();
    let severity: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO';
    if (
      actionUpper.includes('DELETE') ||
      actionUpper.includes('CANCEL') ||
      actionUpper.includes('REVOKE') ||
      actionUpper.includes('REVERSAL') ||
      actionUpper.includes('SECURITY') ||
      actionUpper.includes('BREACH')
    ) {
      severity = 'CRITICAL';
    } else if (
      actionUpper.includes('UPDATE') ||
      actionUpper.includes('REGENERATE') ||
      actionUpper.includes('OVERRIDE') ||
      actionUpper.includes('DISCOUNT')
    ) {
      severity = 'WARNING';
    }

    // Determine status
    let status = 'SUCCESS';
    if (combinedState.status) status = String(combinedState.status);
    else if (combinedState.loanStatus) status = String(combinedState.loanStatus);

    // Extract request/technical details
    const httpMethod = combinedState.httpMethod || combinedState.method || null;
    const endpoint = combinedState.endpoint || combinedState.path || combinedState.apiPath || null;
    const requestId = combinedState.requestId || combinedState.correlationId || null;

    // Extract metadata
    const metadata = combinedState.metadata || (combinedState.details ? combinedState.details : null);

    return {
      id: row.id,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      severity,
      status,
      actor: {
        userId: row.user_id || null,
        userName: row.user_full_name || null,
        userEmail: row.user_email || null,
        userRole: row.user_role || null,
        dealerId: row.user_dealer_id || null,
        dealerStoreName: row.dealer_store_name || null,
        ipAddress: row.ip_address || null,
        userAgent: row.user_agent || null,
      },
      target: {
        entity: row.entity,
        entityId: row.entityId,
        entityAccountNo,
        customerId,
        customerName,
        loanId,
        loanAccountNo,
        dealerId,
        dealerName,
      },
      previousState,
      newState,
      changes,
      requestDetails: {
        httpMethod: typeof httpMethod === 'string' ? httpMethod : null,
        endpoint: typeof endpoint === 'string' ? endpoint : null,
        requestId: typeof requestId === 'string' ? requestId : null,
        ipAddress: row.ip_address || null,
        userAgent: row.user_agent || null,
      },
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
    };
  }
}

