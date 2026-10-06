import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UsersService } from './users.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole, UserStatus } from '@crm/shared';
import { ValidationError } from '../../middlewares/error.middleware';

const router = Router();

router.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  phone: z.string().regex(/^[0-9+()-\s]{10,15}$/, 'Invalid phone number'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  role: z.nativeEnum(UserRole),
  status: z.nativeEnum(UserStatus).optional(),
  assignedBranch: z.string().optional().nullable(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().regex(/^[0-9+()-\s]{10,15}$/).optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  assignedBranch: z.string().optional().nullable(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const createAgentSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  phone: z.string().regex(/^[0-9+()-\s]{10,15}$/, 'Invalid phone number'),
  loginId: z.string().min(3, 'Login ID must be at least 3 characters'),
  status: z.nativeEnum(UserStatus).optional(),
  assignedBranch: z.string().optional().nullable(),
  areaRoute: z.string().optional().nullable(),
});

const updateAgentStatusSchema = z.object({
  status: z.nativeEnum(UserStatus),
});

// Create Collection Agent with automatic temporary password provisioning
router.post(
  '/agents',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createAgentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request payload',
          parsed.error.errors.map((e) => ({ field: e.path.join('.'), issue: e.message }))
        );
      }

      const result = await UsersService.createAgent(parsed.data, req.user!);
      return res.status(201).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Reset Collection Agent Password (generates new secure temporary password)
router.post(
  '/agents/:id/reset-password',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await UsersService.resetAgentPassword(req.params.id, req.user!);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Toggle Collection Agent Status (Active / Inactive)
router.patch(
  '/agents/:id/status',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateAgentStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request payload',
          parsed.error.errors.map((e) => ({ field: e.path.join('.'), issue: e.message }))
        );
      }

      const result = await UsersService.updateAgentStatus(req.params.id, parsed.data.status, req.user!);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Create user
router.post(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request payload',
          parsed.error.errors.map((e) => ({ field: e.path.join('.'), issue: e.message }))
        );
      }

      const user = await UsersService.createUser(parsed.data, req.user!);
      return res.status(201).json({
        success: true,
        data: user,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// List users
router.get(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const role = req.query.role as UserRole | undefined;
      const status = req.query.status as UserStatus | undefined;
      const search = req.query.search as string | undefined;

      const result = await UsersService.listUsers({ page, limit, role, status, search });
      return res.json({
        success: true,
        data: result.users,
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Get user by ID
router.get(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await UsersService.getUserById(req.params.id);
      return res.json({
        success: true,
        data: user,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Update user
router.patch(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request payload',
          parsed.error.errors.map((e) => ({ field: e.path.join('.'), issue: e.message }))
        );
      }

      const updated = await UsersService.updateUser(req.params.id, parsed.data, req.user!);
      return res.json({
        success: true,
        data: updated,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Reset password
router.patch(
  '/:id/password',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request payload',
          parsed.error.errors.map((e) => ({ field: e.path.join('.'), issue: e.message }))
        );
      }

      await UsersService.resetPassword(req.params.id, parsed.data.password, req.user!);
      return res.json({
        success: true,
        message: 'Password reset successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Reset user / agent password with secure temporary password generation
router.post(
  '/:id/reset-password',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await UsersService.resetAgentPassword(req.params.id, req.user!);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Delete user
router.delete(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await UsersService.deleteUser(req.params.id, req.user!);
      return res.json({
        success: true,
        message: 'User deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
