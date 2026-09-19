import { v4 as uuidv4 } from 'uuid';
import { queryPostgres } from '../../database/postgres';

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
   * Retrieve immutable audit logs (Admin/Super Admin only).
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
      logs: result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        previousState: row.previous_state,
        newState: row.new_state,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        userFullName: row.user_full_name,
        userEmail: row.user_email,
        userRole: row.user_role,
      })),
      total,
      limit: lim,
      offset: off,
    };
  }
}
