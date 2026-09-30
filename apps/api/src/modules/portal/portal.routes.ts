import { Router, Request, Response, NextFunction } from 'express';
import { PortalService } from './portal.service';
import { portalRateLimiter } from '../../middlewares/rate-limit.middleware';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const router = Router();

/**
 * GET /api/v1/portal/loan
 * Public customer endpoint for viewing personal loan and EMI repayment schedule.
 * Authenticated SOLELY by high-entropy opaque portal token.
 * Does NOT require admin JWT.
 * Rate limited via portalRateLimiter.
 */
router.get('/loan', portalRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token = req.query.token as string | undefined;

    if (!token && typeof req.headers['x-portal-token'] === 'string') {
      token = req.headers['x-portal-token'];
    }

    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer cpt_')) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (!token || !token.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to access the customer loan portal',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const data = await PortalService.getPortalLoanData(token.trim());

    return res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Admin Management Endpoints (Protected with RBAC) ──────────────────────────

/**
 * POST /api/v1/portal/loans/:loanId/link
 * Generate or issue an active customer portal link for a loan.
 */
router.post(
  '/loans/:loanId/link',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await PortalService.generatePortalLink(req.params.loanId, req.user!);
      return res.status(201).json({
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
 * POST /api/v1/portal/loans/:loanId/regenerate
 * Regenerate customer portal link, invalidating any previous active tokens.
 */
router.post(
  '/loans/:loanId/regenerate',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await PortalService.generatePortalLink(req.params.loanId, req.user!, {
        regenerate: true,
      });
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
 * POST /api/v1/portal/loans/:loanId/revoke
 * Revoke existing active portal link for a loan.
 */
router.post(
  '/loans/:loanId/revoke',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await PortalService.revokePortalLink(req.params.loanId, req.user!);
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
 * GET /api/v1/portal/loans/:loanId/link
 * Retrieve active portal link status metadata for a loan.
 */
router.get(
  '/loans/:loanId/link',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await PortalService.getActivePortalLinkStatus(req.params.loanId);
      return res.json({
        success: true,
        data: status,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
