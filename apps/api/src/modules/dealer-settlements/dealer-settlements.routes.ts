import { Router, Request, Response, NextFunction } from 'express';
import { DealerSettlementsService } from './dealer-settlements.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody, validateQuery } from '../../middlewares/validate.middleware';
import {
  createDealerSettlementSchema,
  dealerSettlementsFilterSchema,
  reverseDealerSettlementSchema,
  UserRole,
} from '@crm/shared';

const router = Router();

// Financial dealer settlement endpoints require authentication
router.use(authenticate);
router.use(requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER));

/**
 * GET /api/v1/dealer-settlements/summary
 * Retrieve high-level reconciliation summary KPIs and breakdown by dealer
 */
router.get(
  '/summary',
  validateQuery(dealerSettlementsFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await DealerSettlementsService.getDealerSettlementsSummary(
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
 * GET /api/v1/dealer-settlements/dealers/:id/unsettled-collections
 * Retrieve eligible unsettled / partially settled collection receipts for a dealer
 */
router.get(
  '/dealers/:id/unsettled-collections',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const unsettled = await DealerSettlementsService.getUnsettledCollectionsForDealer(
        req.params.id,
        req.user!
      );
      return res.json({
        success: true,
        data: unsettled,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/dealer-settlements/:id
 * Retrieve single settlement detail with full allocated receipts
 */
router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settlement = await DealerSettlementsService.getSettlementById(
        req.params.id,
        req.user!
      );
      return res.json({
        success: true,
        data: settlement,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/dealer-settlements
 * Retrieve complete dealer settlements ledger with summary and paginated settlement rows
 */
router.get(
  '/',
  validateQuery(dealerSettlementsFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await DealerSettlementsService.getDealerSettlements(
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
 * POST /api/v1/dealer-settlements
 * Record a new dealer settlement remitted by a partner store
 */
router.post(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(createDealerSettlementSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settlement = await DealerSettlementsService.createSettlement(
        req.body,
        req.user!
      );
      return res.status(201).json({
        success: true,
        data: settlement,
        message: 'Dealer settlement recorded successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/dealer-settlements/:id/reverse
 * Reverse a completed dealer settlement and restore unsettled collection balance
 */
router.post(
  '/:id/reverse',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(reverseDealerSettlementSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settlement = await DealerSettlementsService.reverseSettlement(
        req.params.id,
        req.body.reason,
        req.user!
      );
      return res.json({
        success: true,
        data: settlement,
        message: 'Dealer settlement reversed successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
