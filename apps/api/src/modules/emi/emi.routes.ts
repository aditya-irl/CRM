import { Router, Request, Response, NextFunction } from 'express';
import { EMIService } from './emi.service';
import { authenticate } from '../../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/queue', async (req: Request, res: Response, next: NextFunction) => {
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
});

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
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
});

export default router;
