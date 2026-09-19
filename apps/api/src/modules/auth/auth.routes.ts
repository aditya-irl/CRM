import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { validateBody } from '../../middlewares/validate.middleware';
import { loginSchema } from '@crm/shared';
import { authenticate } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';

const router = Router();

router.post('/login', validateBody(loginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const result = await AuthService.login(email, password, ip, userAgent);

    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: { code: 'REFRESH_TOKEN_REQUIRED', message: 'refreshToken is required' },
        timestamp: new Date().toISOString(),
      });
    }

    const tokens = await AuthService.refresh(refreshToken);
    return res.json({
      success: true,
      data: tokens,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await AuthService.getCurrentUser(req.user!.id);
    return res.json({
      success: true,
      data: user,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    await AuditService.log({
      userId: req.user!.id,
      action: 'USER_LOGOUT',
      entity: 'User',
      entityId: req.user!.id,
      ipAddress: ip,
      userAgent,
    });

    return res.json({
      success: true,
      message: 'Logged out successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
