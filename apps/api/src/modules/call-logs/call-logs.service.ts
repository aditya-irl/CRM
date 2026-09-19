import { v4 as uuidv4 } from 'uuid';
import { queryPostgres } from '../../database/postgres';
import { CallOutcome, UserRole } from '@crm/shared';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { AuditService } from '../audit/audit.service';

export class CallLogService {
  /**
   * Helper to verify if an agent has authorized access to a customer.
   */
  public static async verifyAgentCustomerAccess(agentId: string, customerId: string): Promise<boolean> {
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
    return res.rows.length > 0;
  }

  /**
   * Log customer field/recovery call interaction in PostgreSQL with immutable audit tracking and RLAC.
   */
  public static async createCallLog(
    data: {
      customerId: string;
      loanId?: string | null;
      emiId?: string | null;
      outcome: CallOutcome;
      promisedPaymentDate?: string | null;
      nextFollowUpDate?: string | null;
      notes: string;
      contactPhoneUsed: string;
    },
    user: AuthenticatedUser
  ) {
    const custRes = await queryPostgres(
      'SELECT id, full_name, area_route FROM customers WHERE id = $1 AND deleted_at IS NULL',
      [data.customerId]
    );
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    // Enforce RLAC: Field collection agents can only log calls for assigned customers
    if (user.role === UserRole.COLLECTION_AGENT) {
      const isAuthorized = await this.verifyAgentCustomerAccess(user.id, data.customerId);
      if (!isAuthorized) {
        throw new ForbiddenError('You do not have permission to log call interactions for this customer');
      }
    }

    const id = uuidv4();

    const insertSql = `
      INSERT INTO call_logs (
        id, customer_id, loan_id, emi_id, agent_id, call_timestamp,
        outcome, promised_payment_date, next_follow_up_date, notes,
        contact_phone_used, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, NOW())
      RETURNING id, call_timestamp
    `;

    const res = await queryPostgres(insertSql, [
      id,
      data.customerId,
      data.loanId || null,
      data.emiId || null,
      user.id,
      data.outcome,
      data.promisedPaymentDate || null,
      data.nextFollowUpDate || null,
      data.notes.trim(),
      data.contactPhoneUsed.trim(),
    ]);

    await AuditService.log({
      userId: user.id,
      action: 'CALL_LOGGED',
      entity: 'CallLog',
      entityId: id,
      newState: {
        customerId: data.customerId,
        loanId: data.loanId,
        outcome: data.outcome,
        promisedPaymentDate: data.promisedPaymentDate,
        nextFollowUpDate: data.nextFollowUpDate,
      },
    });

    return {
      id,
      customerId: data.customerId,
      loanId: data.loanId || null,
      emiId: data.emiId || null,
      agentId: user.id,
      outcome: data.outcome,
      promisedPaymentDate: data.promisedPaymentDate || null,
      nextFollowUpDate: data.nextFollowUpDate || null,
      notes: data.notes,
      contactPhoneUsed: data.contactPhoneUsed,
      callTimestamp: res.rows[0].call_timestamp,
    };
  }

  /**
   * List interaction call logs for a customer with RLAC enforcement.
   */
  public static async listCustomerCallLogs(customerId: string, user: AuthenticatedUser) {
    const custRes = await queryPostgres(
      'SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL',
      [customerId]
    );
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    if (user.role === UserRole.COLLECTION_AGENT) {
      const isAuthorized = await this.verifyAgentCustomerAccess(user.id, customerId);
      if (!isAuthorized) {
        throw new ForbiddenError('You do not have permission to view call logs for this customer');
      }
    }

    const sql = `
      SELECT cl.*, u.full_name as agent_name, u.phone as agent_phone
      FROM call_logs cl
      JOIN users u ON cl.agent_id = u.id
      WHERE cl.customer_id = $1
      ORDER BY cl.call_timestamp DESC
    `;

    const res = await queryPostgres(sql, [customerId]);
    return res.rows;
  }

  /**
   * List call logs with pagination, filters, and role-based scoping.
   */
  public static async listCallLogs(
    user: AuthenticatedUser,
    query: {
      page?: number;
      limit?: number;
      customerId?: string;
      agentId?: string;
      outcome?: string;
      startDate?: string;
      endDate?: string;
    }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    let sql = `
      SELECT cl.*, 
             c.full_name as customer_name, c.customer_code, c.area_route,
             u.full_name as agent_name, u.phone as agent_phone,
             l.loan_account_no
      FROM call_logs cl
      JOIN customers c ON cl.customer_id = c.id
      JOIN users u ON cl.agent_id = u.id
      LEFT JOIN loans l ON cl.loan_id = l.id
      WHERE c.deleted_at IS NULL
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (user.role === UserRole.COLLECTION_AGENT) {
      sql += ` AND cl.agent_id = $${paramIndex++}`;
      params.push(user.id);
    } else if (query.agentId) {
      sql += ` AND cl.agent_id = $${paramIndex++}`;
      params.push(query.agentId);
    }

    if (query.customerId) {
      sql += ` AND cl.customer_id = $${paramIndex++}`;
      params.push(query.customerId);
    }

    if (query.outcome) {
      sql += ` AND cl.outcome = $${paramIndex++}`;
      params.push(query.outcome);
    }

    if (query.startDate) {
      sql += ` AND DATE(cl.call_timestamp AT TIME ZONE 'Asia/Kolkata') >= $${paramIndex++}::date`;
      params.push(query.startDate);
    }

    if (query.endDate) {
      sql += ` AND DATE(cl.call_timestamp AT TIME ZONE 'Asia/Kolkata') <= $${paramIndex++}::date`;
      params.push(query.endDate);
    }

    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    sql += ` ORDER BY cl.call_timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const res = await queryPostgres(sql, params);

    return {
      callLogs: res.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
