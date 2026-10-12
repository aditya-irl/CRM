import { Router, Request, Response, NextFunction } from 'express';
import { PortalService } from './portal.service';
import { portalRateLimiter } from '../../middlewares/rate-limit.middleware';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const router = Router();

function extractPortalToken(req: Request): string | undefined {
  let token = req.query.token as string | undefined;
  if (!token && typeof req.headers['x-portal-token'] === 'string') {
    token = req.headers['x-portal-token'];
  }
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer cpt_')) {
    token = req.headers.authorization.slice(7).trim();
  }
  return token?.trim();
}

/**
 * GET /api/v1/portal/loan
 * Public customer endpoint for viewing personal loan and EMI repayment schedule.
 * Authenticated SOLELY by high-entropy opaque portal token.
 * Does NOT require admin JWT.
 * Rate limited via portalRateLimiter.
 */
router.get('/loan', portalRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to access the customer loan portal',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const data = await PortalService.getPortalLoanData(token);

    return res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/portal/kyc
 * Customer endpoint for listing borrower's own KYC documents.
 * Authenticated via opaque portal token.
 */
router.get('/kyc', portalRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to access customer KYC documents',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const docs = await PortalService.getPortalKYCDocuments(token);

    return res.json({
      success: true,
      data: docs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/portal/kyc/:id/presigned-download
 * Customer endpoint for retrieving short-lived presigned download URL for own KYC document.
 */
router.get('/kyc/:id/presigned-download', portalRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to view customer KYC document',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await PortalService.getPortalKYCDownloadUrl(token, req.params.id);

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
 * GET /api/v1/portal/kyc/:id/view
 * Customer endpoint for direct authenticated streaming of borrower's own KYC document.
 */
router.get('/kyc/:id/view', portalRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to view customer KYC document',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await PortalService.streamPortalKYCDocument(token, req.params.id);
    const safeInlineMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const isSafeInline = safeInlineMimes.includes(result.mimeType);
    const safeFilename = (result.docNumberMasked || result.docType || 'document').replace(/[^a-zA-Z0-9_\-\.]/g, '_');

    res.setHeader('Content-Type', isSafeInline ? result.mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${isSafeInline ? 'inline' : 'attachment'}; filename="${safeFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.contentLength) {
      res.setHeader('Content-Length', result.contentLength);
    }

    return (result.stream as any).pipe(res);
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
