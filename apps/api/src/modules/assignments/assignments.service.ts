import { v4 as uuidv4 } from 'uuid';
import { queryPostgres } from '../../database/postgres';
import { UserRole } from '@crm/shared';
import { AppError, NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';

export interface CreateAssignmentDTO {
  agentId: string;
  customerId?: string | null;
  areaRoute?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export class AssignmentService {
  /**
   * Create or update customer/route assignment to a field collection agent.
   */
  public static async createAssignment(
    data: CreateAssignmentDTO,
    user: AuthenticatedUser
  ) {
    if (!data.customerId && !data.areaRoute) {
      throw new AppError('Either customerId or areaRoute must be provided for assignment', 400);
    }

    // Verify agent exists and is a collection agent
    const agentRes = await queryPostgres(
      'SELECT id, full_name, role, status FROM users WHERE id = $1 AND deleted_at IS NULL',
      [data.agentId]
    );

    if (agentRes.rows.length === 0) {
      throw new NotFoundError('Assigned agent user not found');
    }

    const agent = agentRes.rows[0];
    if (agent.role !== UserRole.COLLECTION_AGENT) {
      throw new AppError('User must have COLLECTION_AGENT role to receive collection assignments', 400);
    }

    // Verify customer exists if customerId provided
    if (data.customerId) {
      const custRes = await queryPostgres(
        'SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL',
        [data.customerId]
      );
      if (custRes.rows.length === 0) {
        throw new NotFoundError('Customer not found');
      }

      // Single active assignment rule: Deactivate previous active assignment for the same customer
      await queryPostgres(
        'UPDATE collection_assignments SET is_active = FALSE, effective_to = CURRENT_DATE WHERE customer_id = $1 AND is_active = TRUE',
        [data.customerId]
      );
    }

    const id = uuidv4();

    const sql = `
      INSERT INTO collection_assignments (
        id, agent_id, customer_id, area_route, assigned_by, effective_from, effective_to, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
      RETURNING *
    `;

    const result = await queryPostgres(sql, [
      id,
      data.agentId,
      data.customerId || null,
      data.areaRoute || null,
      user.id,
      data.effectiveFrom,
      data.effectiveTo || null,
    ]);

    const created = result.rows[0];

    await AuditService.log({
      userId: user.id,
      action: 'COLLECTION_ASSIGNMENT_CREATED',
      entity: 'CollectionAssignment',
      entityId: id,
      newState: {
        agentId: data.agentId,
        customerId: data.customerId,
        areaRoute: data.areaRoute,
        effectiveFrom: data.effectiveFrom,
      },
    });

    return {
      id: created.id,
      agentId: created.agent_id,
      customerId: created.customer_id,
      areaRoute: created.area_route,
      assignedBy: created.assigned_by,
      effectiveFrom: created.effective_from,
      effectiveTo: created.effective_to,
      isActive: Boolean(created.is_active),
      createdAt: created.created_at,
    };
  }

  /**
   * List assignments with agent and customer metadata.
   */
  public static async listAssignments(query?: { agentId?: string; isActive?: boolean }) {
    let sql = `
      SELECT ca.*, 
             u.full_name as agent_name, u.phone as agent_phone,
             c.full_name as customer_name, c.customer_code,
             assigner.full_name as assigned_by_name
      FROM collection_assignments ca
      JOIN users u ON ca.agent_id = u.id
      LEFT JOIN customers c ON ca.customer_id = c.id
      JOIN users assigner ON ca.assigned_by = assigner.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (query?.agentId) {
      sql += ` AND ca.agent_id = $${paramIndex++}`;
      params.push(query.agentId);
    }

    if (query?.isActive !== undefined) {
      sql += ` AND ca.is_active = $${paramIndex++}`;
      params.push(query.isActive);
    }

    sql += ` ORDER BY ca.created_at DESC`;

    const result = await queryPostgres(sql, params);
    return result.rows.map((row: any) => ({
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentPhone: row.agent_phone,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerCode: row.customer_code,
      areaRoute: row.area_route,
      assignedByName: row.assigned_by_name,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
    }));
  }

  /**
   * View agent collection portfolio (Scoping: Agent can only view their own).
   */
  public static async getAgentPortfolio(agentId: string, user: AuthenticatedUser) {
    if (user.role === UserRole.COLLECTION_AGENT && user.id !== agentId) {
      throw new ForbiddenError('You can only view your own collection portfolio');
    }

    const assignments = await this.listAssignments({ agentId, isActive: true });
    return assignments;
  }

  /**
   * Deactivate an assignment.
   */
  public static async deactivateAssignment(id: string, user: AuthenticatedUser) {
    const existing = await queryPostgres(
      'SELECT * FROM collection_assignments WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      throw new NotFoundError('Assignment not found');
    }

    const current = existing.rows[0];

    const result = await queryPostgres(
      'UPDATE collection_assignments SET is_active = FALSE, effective_to = CURRENT_DATE WHERE id = $1 RETURNING *',
      [id]
    );

    await AuditService.log({
      userId: user.id,
      action: 'COLLECTION_ASSIGNMENT_DEACTIVATED',
      entity: 'CollectionAssignment',
      entityId: id,
      previousState: current,
      newState: { isActive: false, effectiveTo: new Date().toISOString().split('T')[0] },
    });

    return result.rows[0];
  }
}
