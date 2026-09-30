import { Router, Request, Response, NextFunction } from 'express';
import { AgentCollectionsService } from './agent-collections.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateQuery } from '../../middlewares/validate.middleware';
import { agentCollectionsFilterSchema, UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);
router.use(requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT));

/**
 * GET /api/v1/agent-collections/summary
 * Retrieve overall collection metrics and agent-wise breakdown
 */
router.get(
  '/summary',
  validateQuery(agentCollectionsFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await AgentCollectionsService.getAgentCollectionsSummary(
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
 * GET /api/v1/agent-collections/agents/:id
 * Retrieve collection metrics and recent collections for a single recovery agent
 */
router.get(
  '/agents/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const metrics = await AgentCollectionsService.getSingleAgentCollections(
        req.params.id,
        req.user!
      );
      return res.json({
        success: true,
        data: metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/agent-collections
 * Retrieve complete recovery agent collections ledger with summary and paginated records
 */
router.get(
  '/',
  validateQuery(agentCollectionsFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await AgentCollectionsService.getAgentCollections(
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
