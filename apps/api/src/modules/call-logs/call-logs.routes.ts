import { Router, Request, Response, NextFunction } from 'express';
import { CallLogService } from './call-logs.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import { createCallLogSchema, UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);
router.use(requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT));

router.post('/', validateBody(createCallLogSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await CallLogService.createCallLog(req.body, req.user!);
    return res.status(201).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await CallLogService.listCallLogs(req.user!, req.query);
    return res.json({
      success: true,
      data: result.callLogs,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/customer/:customerId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = await CallLogService.listCustomerCallLogs(req.params.customerId, req.user!);
    return res.json({
      success: true,
      data: logs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

