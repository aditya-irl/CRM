import { Router, Request, Response, NextFunction } from 'express';
import { EMIService } from './emi.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Agent Collection Queue
router.get(
  '/queue',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await EMIService.getAgentQueue(req.user!, req.query);
      return res.json({
        success: true,
        data: result.items,
        meta: {
          total: result.total,
          count: result.items.length,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Agent Stats
router.get(
  '/stats',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await EMIService.getAgentStats(req.user!);
      return res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Add Late Payment Penalty to Overdue EMI
// Allowed: SUPER_ADMIN, ADMIN, DEALER (subject to ALLOW_DEALER_PENALTY setting + RLAC)
// Blocked: COLLECTION_AGENT (403), BRANCH_MANAGER (403), unauthenticated (401)
router.post(
  '/:emiId/penalties',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEALER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { emiId } = req.params;
      const { amount, reason } = req.body;
      const result = await EMIService.addPenalty(emiId, amount, reason, req.user!);
      return res.status(201).json({
        success: true,
        data: result,
        message: 'Late-payment penalty added successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Get All Penalties for an EMI Installment
router.get(
  '/:emiId/penalties',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER, UserRole.COLLECTION_AGENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { emiId } = req.params;
      const result = await EMIService.getEmiPenalties(emiId, req.user!);
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

// Reverse Late Payment Penalty (SUPER_ADMIN / ADMIN only)
router.post(
  '/penalties/:penaltyId/reverse',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { penaltyId } = req.params;
      const { reason } = req.body;
      const result = await EMIService.reverseOrWaivePenalty(penaltyId, 'REVERSE', reason, req.user!);
      return res.json({
        success: true,
        data: result,
        message: 'Penalty reversed successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Waive Late Payment Penalty (SUPER_ADMIN / ADMIN only)
router.post(
  '/penalties/:penaltyId/waive',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { penaltyId } = req.params;
      const { reason } = req.body;
      const result = await EMIService.reverseOrWaivePenalty(penaltyId, 'WAIVE', reason, req.user!);
      return res.json({
        success: true,
        data: result,
        message: 'Penalty waived successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
