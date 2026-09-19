import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@crm/shared';
import { queryPostgres } from '../database/postgres';
import { env } from '../config/env';
import { UnauthorizedError, ForbiddenError } from './error.middleware';

export const JWT_SECRET = env.JWT_SECRET || 'crm_super_secret_jwt_key_2026';
export const JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET || 'crm_super_secret_refresh_key_2026';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  assignedBranch?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = authHeader.split(' ')[1];
  let payload: { id: string };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { id: string };
  } catch (err) {
    return next(new UnauthorizedError('Invalid or expired token'));
  }

  try {
    // Verify user exists and is ACTIVE in PostgreSQL database
    const userResult = await queryPostgres<{
      id: string;
      email: string;
      full_name: string;
      role: UserRole;
      status: string;
      assigned_branch?: string | null;
      deleted_at?: string | null;
    }>(
      'SELECT id, email, full_name, role, status, assigned_branch, deleted_at FROM users WHERE id = $1',
      [payload.id]
    );

    const user = userResult.rows[0];

    if (!user || user.deleted_at || user.status !== 'ACTIVE') {
      return next(new UnauthorizedError('User account is inactive, deleted, or no longer exists'));
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      assignedBranch: user.assigned_branch,
    };
    next();
  } catch (dbErr) {
    return next(dbErr);
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError(`Action requires one of the following roles: ${allowedRoles.join(', ')}`));
    }
    next();
  };
}
