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
  dealerId?: string | null;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export class AuthService {
  /**
   * Authenticate user with email/phone/dealerCode and password.
   */
  public static async login(
    identifier: string,
    pass: string,
    ip?: string,
    userAgent?: string
  ) {
    const cleanIdentifier = identifier.trim().toLowerCase();

    // Check if identifier matches dealer code format (e.g. DLR-0001 or DLR-000001)
    let dlrPad4: string | null = null;
    let dlrPad6: string | null = null;
    const dlrMatch = cleanIdentifier.match(/^dlr-?(\d+)$/i);
    if (dlrMatch) {
      const numStr = dlrMatch[1];
      dlrPad4 = `dlr-${numStr.padStart(4, '0')}`;
      dlrPad6 = `dlr-${numStr.padStart(6, '0')}`;
    }

    const result = await queryPostgres<{
      id: string;
      email: string;
      phone: string;
      password_hash: string;
      full_name: string;
      role: UserRole;
      status: UserStatus;
      assigned_branch?: string | null;
      dealer_id?: string | null;
      must_change_password?: boolean;
      deleted_at?: string | null;
    }>(
      `SELECT u.id, u.email, u.phone, u.password_hash, u.full_name, u.role, u.status,
              u.assigned_branch, u.dealer_id, u.must_change_password, u.deleted_at
       FROM users u
       LEFT JOIN dealers d ON u.dealer_id = d.id
       WHERE (
         LOWER(u.email) = $1
         OR LOWER(SPLIT_PART(u.email, '@', 1)) = $1
         OR u.phone = $2
         OR LOWER(d.dealer_code) = $1
         OR ($3::text IS NOT NULL AND LOWER(d.dealer_code) = $3)
         OR ($4::text IS NOT NULL AND LOWER(d.dealer_code) = $4)
       ) AND u.deleted_at IS NULL`,
      [cleanIdentifier, identifier.trim(), dlrPad4, dlrPad6]
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
      dealerId: user.dealer_id || null,
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
        dealerId: user.dealer_id || null,
        mustChangePassword: user.must_change_password || false,
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
        dealer_id?: string | null;
        deleted_at?: string | null;
      }>(
        `SELECT id, email, phone, full_name, role, status, assigned_branch, dealer_id, deleted_at
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
          dealerId: user.dealer_id || null,
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
      dealer_id?: string | null;
      must_change_password?: boolean;
      last_login_at?: string | null;
      created_at: string;
    }>(
      `SELECT id, email, phone, full_name, role, status, assigned_branch, dealer_id, must_change_password, last_login_at, created_at
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
      dealerId: user.dealer_id || null,
      mustChangePassword: user.must_change_password || false,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    };
  }

  /**
   * Change authenticated user's password and clear must_change_password flag.
   */
  public static async changePassword(
    userId: string,
    currentPass: string,
    newPass: string,
    ip?: string,
    userAgent?: string
  ) {
    if (!newPass || newPass.length < 6) {
      throw new UnauthorizedError('New password must be at least 6 characters');
    }

    const result = await queryPostgres<{
      id: string;
      password_hash: string;
      status: UserStatus;
    }>(
      `SELECT id, password_hash, status FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    const user = result.rows[0];
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedError('Account is inactive');
    }

    const isMatch = bcrypt.compareSync(currentPass, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    const newHash = bcrypt.hashSync(newPass, 10);

    await queryPostgres(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2',
      [newHash, user.id]
    );

    await AuditService.log({
      userId: user.id,
      action: 'USER_PASSWORD_CHANGED',
      entity: 'User',
      entityId: user.id,
      ipAddress: ip,
      userAgent,
    });

    return {
      success: true,
      message: 'Password changed successfully',
      mustChangePassword: false,
    };
  }
}

