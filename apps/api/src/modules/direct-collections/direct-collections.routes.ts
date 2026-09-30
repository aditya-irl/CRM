import { Router, Request, Response, NextFunction } from 'express';
import { DirectCollectionsService } from './direct-collections.service';
import { authenticate } from '../../middlewares/auth.middleware';
import { validateQuery } from '../../middlewares/validate.middleware';
import { directCollectionsFilterSchema } from '@crm/shared';

const router = Router();

router.use(authenticate);

/**
 * GET /api/v1/direct-collections/summary
 * Retrieve overall direct customer collection metrics
 */
router.get(
  '/summary',
  validateQuery(directCollectionsFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await DirectCollectionsService.getDirectCollectionsSummary(
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
 * GET /api/v1/direct-collections/:id
 * Retrieve single direct payment record with allocations, borrower, and loan details
 */
router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await DirectCollectionsService.getDirectPaymentById(
        req.params.id,
        req.user!
      );
      return res.json({
        success: true,
        data: detail,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/direct-collections
 * Retrieve complete direct customer collections ledger with summary and paginated records
 */
router.get(
  '/',
  validateQuery(directCollectionsFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await DirectCollectionsService.getDirectCollections(
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
