import { Router, Request, Response, NextFunction } from 'express';
import { CustomerService } from './customers.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import { createCustomerSchema, updateCustomerSchema, UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);

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

// Create customer (Admin / Branch Manager only)
router.post(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
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
