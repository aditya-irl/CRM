import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryPostgres } from '../../database/postgres';
import { UserRole, UserStatus } from '@crm/shared';
import { JWT_SECRET, JWT_REFRESH_SECRET } from '../../middlewares/auth.middleware';
import { UnauthorizedError, NotFoundError } from '../../middlewares/error.middleware';
import { AuditService } from '../audit/audit.service';

export interface UserAuthResponse {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: UserRole;
  status?: UserStatus;
  assignedBranch?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export class AuthService {
  /**
   * Authenticate user with email/phone and password.
   */
  public static async login(
    identifier: string,
    pass: string,
    ip?: string,
    userAgent?: string
  ) {
    const cleanIdentifier = identifier.trim().toLowerCase();

    const result = await queryPostgres<{
      id: string;
      email: string;
      phone: string;
      password_hash: string;
      full_name: string;
      role: UserRole;
      status: UserStatus;
      assigned_branch?: string | null;
      deleted_at?: string | null;
    }>(
      `SELECT id, email, phone, password_hash, full_name, role, status, assigned_branch, deleted_at
       FROM users
       WHERE (LOWER(email) = $1 OR phone = $2) AND deleted_at IS NULL`,
      [cleanIdentifier, identifier.trim()]
    );

    const user = result.rows[0];

    if (!user) {
      await AuditService.log({
        action: 'USER_LOGIN_FAILED',
        entity: 'User',
        entityId: cleanIdentifier,
        ipAddress: ip,
        userAgent,
      });
      throw new UnauthorizedError('Invalid credentials');
    }

    if (user.status !== UserStatus.ACTIVE) {
      await AuditService.log({
        userId: user.id,
        action: 'USER_LOGIN_INACTIVE_BLOCKED',
        entity: 'User',
        entityId: user.id,
        ipAddress: ip,
        userAgent,
      });
      throw new UnauthorizedError('Your account is currently inactive. Contact your administrator.');
    }

    const isMatch = bcrypt.compareSync(pass, user.password_hash);
    if (!isMatch) {
      await AuditService.log({
        userId: user.id,
        action: 'USER_LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ipAddress: ip,
        userAgent,
      });
      throw new UnauthorizedError('Invalid credentials');
    }

    // Update last_login_at
    await queryPostgres(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      assignedBranch: user.assigned_branch,
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

    await AuditService.log({
      userId: user.id,
      action: 'USER_LOGIN_SUCCESS',
      entity: 'User',
      entityId: user.id,
      ipAddress: ip,
      userAgent,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.full_name,
        role: user.role,
        assignedBranch: user.assigned_branch,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900, // 15 mins
      },
    };
  }

  /**
   * Verify and rotate refresh token.
   */
  public static async refresh(refreshToken: string) {
    try {
      const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { id: string };

      const result = await queryPostgres<{
        id: string;
        email: string;
        phone: string;
        full_name: string;
        role: UserRole;
        status: UserStatus;
        assigned_branch?: string | null;
        deleted_at?: string | null;
      }>(
        `SELECT id, email, phone, full_name, role, status, assigned_branch, deleted_at
         FROM users
         WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
        [payload.id]
      );

      const user = result.rows[0];

      if (!user) {
        throw new UnauthorizedError('Session revoked or user inactive');
      }

      const newAccessToken = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
          fullName: user.full_name,
          assignedBranch: user.assigned_branch,
        },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      const newRefreshToken = jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
  }

  /**
   * Get current authenticated user profile.
   */
  public static async getCurrentUser(userId: string): Promise<UserAuthResponse> {
    const result = await queryPostgres<{
      id: string;
      email: string;
      phone: string;
      full_name: string;
      role: UserRole;
      status: UserStatus;
      assigned_branch?: string | null;
      last_login_at?: string | null;
      created_at: string;
    }>(
      `SELECT id, email, phone, full_name, role, status, assigned_branch, last_login_at, created_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    const user = result.rows[0];

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.full_name,
      role: user.role,
      status: user.status,
      assignedBranch: user.assigned_branch,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    };
  }
}
