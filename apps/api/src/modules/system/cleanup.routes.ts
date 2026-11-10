import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';
import { CleanupService } from './cleanup.service';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiter for cleanup administrative endpoints
const cleanupRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many cleanup requests. Please try again after 15 minutes.',
    },
    timestamp: new Date().toISOString(),
  },
});

// All cleanup endpoints strictly require SUPER_ADMIN authentication
router.use(authenticate);
router.use(requireRole(UserRole.SUPER_ADMIN));
router.use(cleanupRateLimiter);

/**
 * GET /api/v1/system/cleanup/preview
 * Phase 1: Strictly read-only preview of operational data, database identity, and preserved staff.
 */
router.get('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const preview = await CleanupService.getPreview(req.user!);
    return res.json({
      success: true,
      data: preview,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/cleanup/verify-session
 * Allows Super Admin to re-authenticate with their password to confirm handover authority.
 */
router.post('/verify-session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password } = req.body || {};
    const result = await CleanupService.verifyAdminSession(req.user!, password);
    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/cleanup/execute
 * Phase 2: Transactional cleanup of all operational test data.
 * Requires:
 *  - Authenticated SUPER_ADMIN
 *  - confirmationPhrase === "PURGE PRODUCTION TEST DATA"
 *  - password (verified against database)
 */
router.post('/execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { confirmationPhrase, password } = req.body || {};
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
    const userAgent = (req.headers['user-agent'] as string) || 'Unknown Agent';

    const result = await CleanupService.executeCleanup(
      req.user!,
      confirmationPhrase,
      password,
      clientIp,
      userAgent
    );

    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

