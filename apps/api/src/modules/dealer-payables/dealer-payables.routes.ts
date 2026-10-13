import { Router, Request, Response, NextFunction } from 'express';
import { DealerPayablesService } from './dealer-payables.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);

/**
 * GET /api/v1/dealer-payables/summary
 * Retrieve company-to-dealer payables summary and dealer-wise breakdown.
 * Admin sees all stores; Dealer sees only their own store.
 */
router.get(
  '/summary',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await DealerPayablesService.getDealerPayablesSummary(
        req.query as any,
        req.user!
      );
      return res.json({
        success: true,
        data: summary,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/dealer-payables/dealers/:id/eligible-loans
 * Retrieve eligible disbursed loans for a given dealer contributing to payables.
 */
router.get(
  '/dealers/:id/eligible-loans',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loans = await DealerPayablesService.getEligibleLoansForDealer(
        req.params.id,
        req.user!
      );
      return res.json({
        success: true,
        data: loans,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/dealer-payables/payments
 * Retrieve company payments made to dealers with pagination and search.
 */
router.get(
  ['/', '/payments'],
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await DealerPayablesService.getDealerPayablePayments(
        req.query as any,
        req.user!
      );
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

/**
 * POST /api/v1/dealer-payables
 * POST /api/v1/dealer-payables/payments
 * Record a company payment made to a dealer for eligible financed products.
 * Restricted to Super Admin, Admin, and Branch Manager.
 */
router.post(
  ['/', '/payments'],
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await DealerPayablesService.recordCompanyPayment(
        req.body,
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

/**
 * POST /api/v1/dealer-payables/:id/reverse
 * POST /api/v1/dealer-payables/payments/:id/reverse
 * Reverse an erroneous company payment record with reason.
 */
router.post(
  ['/:id/reverse', '/payments/:id/reverse'],
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reason = req.body?.reason || 'Payment reversed by administrator';
      const result = await DealerPayablesService.reverseCompanyPayment(
        req.params.id,
        reason,
        req.user!
      );
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

export default router;
