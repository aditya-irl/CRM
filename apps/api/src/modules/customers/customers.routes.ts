import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CustomerService } from './customers.service';
import { authenticate, requireRole, JWT_SECRET, AuthenticatedUser } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import { createCustomerSchema, updateCustomerSchema, onboardCustomerSchema, customerPhotoUploadSchema, UserRole } from '@crm/shared';
import { queryPostgres } from '../../database/postgres';

const router = Router();

// Authenticated customer photograph streaming endpoint
// Supports standard Authorization Bearer header as well as ?token=... query parameter for browser <img> tags
router.get('/:id/photo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication token required to view customer photograph' },
      });
    }

    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired authentication token' },
      });
    }

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
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User account is inactive or no longer exists' },
      });
    }

    const authUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      assignedBranch: user.assigned_branch,
      dealerId: user.dealer_id,
    };

    const result = await CustomerService.streamCustomerPhoto(req.params.id, authUser);
    if ('redirectUrl' in result && result.redirectUrl) {
      return res.redirect(result.redirectUrl);
    }

    const normMime = (result.mimeType || 'image/jpeg').toLowerCase().trim();
    res.setHeader('Content-Type', normMime === 'image/jpg' ? 'image/jpeg' : normMime);
    res.setHeader('Content-Disposition', 'inline; filename="customer_photo"');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.contentLength) {
      res.setHeader('Content-Length', result.contentLength);
    }
    return (result.stream as any).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.use(authenticate);

// Upload customer photograph (Super Admin, Admin, Branch Manager, Dealer, Collection Agent)
router.post(
  '/:id/photo',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER, UserRole.COLLECTION_AGENT),
  validateBody(customerPhotoUploadSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
      const result = await CustomerService.uploadCustomerPhoto(
        req.params.id,
        {
          fileName: req.body.fileName,
          mimeType: req.body.mimeType,
          fileBuffer,
        },
        req.user!
      );
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

// List customers with pagination, search, and agent RLAC scoping
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await CustomerService.listCustomers(req.user!, req.query);
    return res.json({
      success: true,
      data: result.customers,
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
});

// Get customer by ID (RLAC protected against IDOR)
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await CustomerService.getCustomerById(req.params.id, req.user!);
    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// Atomic Customer + Loan Onboarding (Admin / Branch Manager / Dealer)
router.post(
  '/onboard',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  validateBody(onboardCustomerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const headerKey = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      const idempotencyKey = headerKey ? headerKey.trim() : req.body.idempotencyKey;
      const result = await CustomerService.onboardCustomer(
        { ...req.body, ...(idempotencyKey ? { idempotencyKey } : {}) },
        req.user!
      );
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

// Create customer (Admin / Branch Manager / Dealer)
router.post(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  validateBody(createCustomerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await CustomerService.createCustomer(req.body, req.user!);
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

// Update customer (Admin / Branch Manager only)
router.patch(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(updateCustomerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await CustomerService.updateCustomer(req.params.id, req.body, req.user!);
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

// Delete / de-activate customer (Admin only)
router.delete(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await CustomerService.deleteCustomer(req.params.id, req.user!);
      return res.json({
        success: true,
        message: 'Customer deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
