import { Router, Request, Response, NextFunction } from 'express';
import { DealerCollectionsService } from './dealer-collections.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateQuery } from '../../middlewares/validate.middleware';
import { dealerCollectionsFilterSchema, UserRole } from '@crm/shared';

const router = Router();

// Financial report endpoints require authentication and Management / Admin / Dealer role
router.use(authenticate);
router.use(requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER));

/**
 * GET /api/v1/dealer-collections/summary
 * Retrieve high-level summary KPIs and breakdown by dealer
 */
router.get(
  '/summary',
  validateQuery(dealerCollectionsFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await DealerCollectionsService.getDealerCollectionsSummary(
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
 * GET /api/v1/dealer-collections/dealers/:id
 * Retrieve collection metrics and recent transactions for a single dealer (Dealer 360)
 */
router.get(
  '/dealers/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await DealerCollectionsService.getSingleDealerCollections(
        req.params.id,
        req.user!
      );
      return res.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/dealer-collections
 * Retrieve complete dealer collections ledger with summary and paginated collection rows
 */
router.get(
  '/',
  validateQuery(dealerCollectionsFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await DealerCollectionsService.getDealerCollections(
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

export default router;
