import { Router, Request, Response, NextFunction } from 'express';
import { AuditService } from './audit.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const entity = req.query.entity as string | undefined;
      const entityId = req.query.entityId as string | undefined;
      const userId = req.query.userId as string | undefined;

      const result = await AuditService.getLogs(limit, offset, entity, entityId, userId);

      return res.json({
        success: true,
        data: result.logs,
        meta: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const log = await AuditService.getLogById(req.params.id);
      return res.json({
        success: true,
        data: log,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
