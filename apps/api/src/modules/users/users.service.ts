import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { queryPostgres } from '../../database/postgres';
import { UserRole, UserStatus } from '@crm/shared';
import { AppError, NotFoundError, ConflictError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';

import { DealerService } from '../dealers/dealers.service';

export interface CreateUserData {
  email: string;
  phone: string;
  password: string;
  fullName: string;
  role: UserRole;
  status?: UserStatus;
  assignedBranch?: string | null;
}

export interface CreateAgentData {
  fullName: string;
  phone: string;
  loginId: string;
  status?: UserStatus;
  assignedBranch?: string | null;
  areaRoute?: string | null;
}

export interface AgentCredentialsResponse {
  agentId: string;
  loginId: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
  user: {
    id: string;
    email: string;
    phone: string;
    fullName: string;
    role: UserRole;
    status: UserStatus;
    assignedBranch?: string | null;
  };
}

export interface UpdateUserData {
  fullName?: string;
  phone?: string;
  role?: UserRole;
  status?: UserStatus;
  assignedBranch?: string | null;
}

export interface UserResponse {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  assignedBranch?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export class UsersService {
  /**
   * Create a new user (Admin / Super Admin only).
   */
  public static async createUser(
    data: CreateUserData,
    creator?: AuthenticatedUser
  ): Promise<UserResponse> {
    const emailNorm = data.email.trim().toLowerCase();
    const phoneNorm = data.phone.trim();

    // Check duplicate email or phone
    const existing = await queryPostgres(
      'SELECT id, email, phone FROM users WHERE (email = $1 OR phone = $2) AND deleted_at IS NULL',
      [emailNorm, phoneNorm]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].email === emailNorm) {
        throw new ConflictError('A user with this email address already exists');
      }
      throw new ConflictError('A user with this phone number already exists');
    }

    const id = uuidv4();
    const saltRounds = 10;
    const passwordHash = bcrypt.hashSync(data.password, saltRounds);
    const role = data.role || UserRole.COLLECTION_AGENT;
    const status = data.status || UserStatus.ACTIVE;
    const assignedBranch = data.assignedBranch || null;

    const sql = `
      INSERT INTO users (
        id, email, phone, password_hash, full_name, role, status, assigned_branch, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING id, email, phone, full_name, role, status, assigned_branch, last_login_at, created_at, updated_at
    `;

    const result = await queryPostgres(sql, [
      id,
      emailNorm,
      phoneNorm,
      passwordHash,
      data.fullName.trim(),
      role,
      status,
      assignedBranch,
    ]);

    const created = result.rows[0];

    // Audit log
    await AuditService.log({
      userId: creator?.id || id,
      action: 'USER_CREATED',
      entity: 'User',
      entityId: id,
      newState: {
        id,
        email: emailNorm,
        fullName: data.fullName,
        role,
        status,
        assignedBranch,
      },
    });

    return {
      id: created.id,
      email: created.email,
      phone: created.phone,
      fullName: created.full_name,
      role: created.role as UserRole,
      status: created.status as UserStatus,
      assignedBranch: created.assigned_branch,
      lastLoginAt: created.last_login_at,
      createdAt: created.created_at,
      updatedAt: created.updated_at,
    };
  }

  /**
   * List users with filtering and pagination.
   */
  public static async listUsers(query: {
    page?: number;
    limit?: number;
    role?: UserRole;
    status?: UserStatus;
    search?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    let sql = `
      SELECT id, email, phone, full_name, role, status, assigned_branch, last_login_at, created_at, updated_at
      FROM users
      WHERE deleted_at IS NULL
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (query.role) {
      sql += ` AND role = $${paramIndex++}`;
      params.push(query.role);
    }

    if (query.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(query.status);
    }

    if (query.search) {
      sql += ` AND (full_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`;
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await queryPostgres(sql, params);

    return {
      users: result.rows.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        fullName: u.full_name,
        role: u.role as UserRole,
        status: u.status as UserStatus,
        assignedBranch: u.assigned_branch,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single user by ID.
   */
  public static async getUserById(id: string): Promise<UserResponse> {
    const result = await queryPostgres(
      `SELECT id, email, phone, full_name, role, status, assigned_branch, last_login_at, created_at, updated_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    const u = result.rows[0];
    return {
      id: u.id,
      email: u.email,
      phone: u.phone,
      fullName: u.full_name,
      role: u.role as UserRole,
      status: u.status as UserStatus,
      assignedBranch: u.assigned_branch,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    };
  }

  /**
   * Update user details or status.
   */
  public static async updateUser(
    id: string,
    data: UpdateUserData,
    updater: AuthenticatedUser
  ): Promise<UserResponse> {
    const current = await this.getUserById(id);

    const updates: string[] = [];
    const params: any[] = [id];
    let paramIndex = 2;

    if (data.fullName !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      params.push(data.fullName.trim());
    }
    if (data.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      params.push(data.phone.trim());
    }
    if (data.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      params.push(data.role);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(data.status);
    }
    if (data.assignedBranch !== undefined) {
      updates.push(`assigned_branch = $${paramIndex++}`);
      params.push(data.assignedBranch);
    }

    if (updates.length === 0) {
      return current;
    }

    updates.push(`updated_at = NOW()`);

    const sql = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, email, phone, full_name, role, status, assigned_branch, last_login_at, created_at, updated_at
    `;

    const result = await queryPostgres(sql, params);
    const updated = result.rows[0];

    await AuditService.log({
      userId: updater.id,
      action: 'USER_UPDATED',
      entity: 'User',
      entityId: id,
      previousState: current as any,
      newState: data as any,
    });

    return {
      id: updated.id,
      email: updated.email,
      phone: updated.phone,
      fullName: updated.full_name,
      role: updated.role as UserRole,
      status: updated.status as UserStatus,
      assignedBranch: updated.assigned_branch,
      lastLoginAt: updated.last_login_at,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    };
  }

  /**
   * Reset user password (Admin / Super Admin only).
   */
  public static async resetPassword(
    id: string,
    newPass: string,
    updater: AuthenticatedUser
  ): Promise<void> {
    if (!newPass || newPass.length < 6) {
      throw new AppError('Password must be at least 6 characters', 400);
    }

    await this.getUserById(id);
    const hash = bcrypt.hashSync(newPass, 10);

    await queryPostgres(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL',
      [hash, id]
    );

    await AuditService.log({
      userId: updater.id,
      action: 'USER_PASSWORD_RESET',
      entity: 'User',
      entityId: id,
    });
  }

  /**
   * Soft-delete a user.
   */
  public static async deleteUser(id: string, deleter: AuthenticatedUser): Promise<void> {
    await this.getUserById(id);

    await queryPostgres(
      'UPDATE users SET deleted_at = NOW(), status = $1, updated_at = NOW() WHERE id = $2',
      [UserStatus.INACTIVE, id]
    );

    await AuditService.log({
      userId: deleter.id,
      action: 'USER_DELETED',
      entity: 'User',
      entityId: id,
    });
  }

  /**
   * Provision a new Collection Agent with a cryptographically secure temporary password.
   * Mirrors Dealer credential provisioning:
   * - Secure random temporary password (never stored in plaintext).
   * - Stored only as bcrypt hash.
   * - must_change_password = true.
   * - Returned ONCE in response for credential modal & WhatsApp share.
   * - Not retrievable later.
   */
  public static async createAgent(
    data: CreateAgentData,
    creator: AuthenticatedUser
  ): Promise<AgentCredentialsResponse> {
    const loginIdNorm = data.loginId.trim().toLowerCase();
    const phoneNorm = data.phone.trim();

    // Check duplicate email/loginId or phone
    const existing = await queryPostgres(
      'SELECT id, email, phone FROM users WHERE (LOWER(email) = $1 OR phone = $2) AND deleted_at IS NULL',
      [loginIdNorm, phoneNorm]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].email.toLowerCase() === loginIdNorm) {
        throw new ConflictError('A user or agent with this Login ID / email already exists');
      }
      throw new ConflictError('A user or agent with this phone number already exists');
    }

    const tempPassword = DealerService.generateTempPassword(data.fullName);
    const passwordHash = bcrypt.hashSync(tempPassword, 10);
    const id = uuidv4();
    const status = data.status || UserStatus.ACTIVE;
    const assignedBranch = data.assignedBranch?.trim() || null;

    const sql = `
      INSERT INTO users (
        id, email, phone, password_hash, full_name, role, status,
        assigned_branch, must_change_password, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW(), NOW())
      RETURNING id, email, phone, full_name, role, status, assigned_branch, must_change_password, created_at, updated_at
    `;

    const result = await queryPostgres(sql, [
      id,
      loginIdNorm,
      phoneNorm,
      passwordHash,
      data.fullName.trim(),
      UserRole.COLLECTION_AGENT,
      status,
      assignedBranch,
    ]);

    const created = result.rows[0];

    // If an areaRoute is specified, create active route assignment
    if (data.areaRoute && data.areaRoute.trim()) {
      const assignmentId = uuidv4();
      await queryPostgres(
        `INSERT INTO collection_assignments (
          id, agent_id, area_route, assigned_by, effective_from, is_active, created_at
        ) VALUES ($1, $2, $3, $4, CURRENT_DATE, TRUE, NOW())`,
        [assignmentId, id, data.areaRoute.trim(), creator.id]
      );
    }

    // Write immutable audit log (NEVER log password)
    await AuditService.log({
      userId: creator.id,
      action: 'AGENT_CREATED',
      entity: 'User',
      entityId: id,
      newState: {
        id,
        loginId: loginIdNorm,
        phone: phoneNorm,
        fullName: data.fullName.trim(),
        role: UserRole.COLLECTION_AGENT,
        status,
        assignedBranch,
        areaRoute: data.areaRoute?.trim() || null,
      },
    });

    return {
      agentId: created.id,
      loginId: created.email,
      temporaryPassword: tempPassword,
      mustChangePassword: true,
      user: {
        id: created.id,
        email: created.email,
        phone: created.phone,
        fullName: created.full_name,
        role: created.role as UserRole,
        status: created.status as UserStatus,
        assignedBranch: created.assigned_branch,
      },
    };
  }

  /**
   * Reset a Collection Agent's password and issue a new secure temporary password.
   * Mirrors Dealer reset password flow.
   */
  public static async resetAgentPassword(
    agentId: string,
    currentUser: AuthenticatedUser
  ): Promise<AgentCredentialsResponse> {
    const userRes = await queryPostgres(
      'SELECT id, email, phone, full_name, role, status, assigned_branch FROM users WHERE id = $1 AND deleted_at IS NULL',
      [agentId]
    );

    if (userRes.rows.length === 0) {
      throw new NotFoundError('Agent user account not found');
    }

    const agent = userRes.rows[0];

    const tempPassword = DealerService.generateTempPassword(agent.full_name);
    const passwordHash = bcrypt.hashSync(tempPassword, 10);

    await queryPostgres(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL',
      [passwordHash, agentId]
    );

    // Audit log (NEVER log password)
    await AuditService.log({
      userId: currentUser.id,
      action: 'AGENT_PASSWORD_RESET',
      entity: 'User',
      entityId: agentId,
      newState: {
        agentId,
        loginId: agent.email,
        phone: agent.phone,
      },
    });

    return {
      agentId: agent.id,
      loginId: agent.email,
      temporaryPassword: tempPassword,
      mustChangePassword: true,
      user: {
        id: agent.id,
        email: agent.email,
        phone: agent.phone,
        fullName: agent.full_name,
        role: agent.role as UserRole,
        status: agent.status as UserStatus,
        assignedBranch: agent.assigned_branch,
      },
    };
  }

  /**
   * Toggle agent active / inactive status.
   */
  public static async updateAgentStatus(
    agentId: string,
    status: UserStatus,
    currentUser: AuthenticatedUser
  ): Promise<{ id: string; status: UserStatus }> {
    const current = await this.getUserById(agentId);

    await queryPostgres(
      'UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL',
      [status, agentId]
    );

    const action = status === UserStatus.ACTIVE ? 'AGENT_ACTIVATED' : 'AGENT_DEACTIVATED';

    await AuditService.log({
      userId: currentUser.id,
      action,
      entity: 'User',
      entityId: agentId,
      previousState: { status: current.status },
      newState: { status },
    });

    return {
      id: agentId,
      status,
    };
  }
}
