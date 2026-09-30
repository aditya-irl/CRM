import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@crm/shared';
import { queryPostgres } from '../database/postgres';
import { env } from '../config/env';
import { UnauthorizedError, ForbiddenError } from './error.middleware';

// Fail fast if JWT secrets are not configured — never fall back to an in-source default.
if (!env.JWT_SECRET) {
  throw new Error('[FATAL] JWT_SECRET environment variable is not set. Configure it before starting the server.');
}
if (!env.JWT_REFRESH_SECRET) {
  throw new Error('[FATAL] JWT_REFRESH_SECRET environment variable is not set. Configure it before starting the server.');
}

export const JWT_SECRET: string = env.JWT_SECRET;
export const JWT_REFRESH_SECRET: string = env.JWT_REFRESH_SECRET;

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  assignedBranch?: string | null;
  dealerId?: string | null;
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
      dealer_id?: string | null;
      deleted_at?: string | null;
    }>(
      'SELECT id, email, full_name, role, status, assigned_branch, dealer_id, deleted_at FROM users WHERE id = $1',
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
      dealerId: user.dealer_id || null,
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
