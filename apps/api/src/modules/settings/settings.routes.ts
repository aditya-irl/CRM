import { Router, Request, Response, NextFunction } from 'express';
import { SettingsService } from './settings.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const router = Router();

// Retrieve dealer penalty setting
router.get(
  '/dealer-penalty',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await SettingsService.getDealerPenaltySetting();
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

// Toggle dealer penalty setting (SUPER_ADMIN only)
router.patch(
  '/dealer-penalty',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { allowDealerPenalty } = req.body;
      const data = await SettingsService.setDealerPenaltySetting(allowDealerPenalty, req.user!);
      return res.json({
        success: true,
        data,
        message: `Dealer late-payment penalty permission updated to ${data.allowDealerPenalty ? 'ENABLED' : 'DISABLED'}`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
