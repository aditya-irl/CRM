import { Router, Request, Response, NextFunction } from 'express';
import { PortalService } from './portal.service';
import { PortalPaymentService } from './portal-payment.service';
import {
  portalReadLimiter,
  portalInvalidTokenLimiter,
  portalPaymentOrderLimiter,
  portalPaymentVerifyLimiter,
  extractPortalToken,
} from '../../middlewares/rate-limit.middleware';
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
router.get('/loan', portalInvalidTokenLimiter, portalReadLimiter, async (req: Request, res: Response, next: NextFunction) => {
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

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

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
router.get('/kyc', portalInvalidTokenLimiter, portalReadLimiter, async (req: Request, res: Response, next: NextFunction) => {
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
router.get('/kyc/:id/presigned-download', portalInvalidTokenLimiter, portalReadLimiter, async (req: Request, res: Response, next: NextFunction) => {
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
router.get('/kyc/:id/view', portalInvalidTokenLimiter, portalReadLimiter, async (req: Request, res: Response, next: NextFunction) => {
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

/**
 * GET /api/v1/portal/profile
 * Customer endpoint for retrieving borrower's registered identity, contact, address, photograph, and KYC documents.
 * Authenticated strictly via opaque portal token.
 */
router.get('/profile', portalInvalidTokenLimiter, portalReadLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to access your profile',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const data = await PortalService.getPortalCustomerProfile(token);

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
 * GET /api/v1/portal/photo
 * Customer endpoint for direct authenticated streaming of borrower's own photograph.
 */
router.get('/photo', portalInvalidTokenLimiter, portalReadLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to view customer photo',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await PortalService.streamPortalCustomerPhoto(token);
    const safeInlineMimes = ['image/jpeg', 'image/png', 'image/webp'];
    const isSafeInline = safeInlineMimes.includes(result.mimeType);

    res.setHeader('Content-Type', isSafeInline ? result.mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${isSafeInline ? 'inline' : 'attachment'}; filename="customer_photo"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.contentLength) {
      res.setHeader('Content-Length', result.contentLength);
    }

    return (result.stream as any).pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/portal/verify/confirm
 * Customer endpoint to confirm that displayed details are correct.
 */
router.post('/verify/confirm', portalInvalidTokenLimiter, portalReadLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to confirm your details',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const section = req.body?.section;
    const result = await PortalService.confirmPortalProfile(token, section);

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
 * POST /api/v1/portal/verify/report-issue
 * Customer endpoint to report an issue or discrepancy in a section.
 */
router.post('/verify/report-issue', portalInvalidTokenLimiter, portalReadLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to report an issue',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const { section, explanation } = req.body || {};
    const result = await PortalService.reportPortalIssue(token, { section, explanation });

    return res.status(201).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Customer Cashfree Payment Endpoints ─────────────────────────────────────

/**
 * POST /api/v1/portal/payment/orders
 * Customer endpoint to initiate a secure Cashfree Payment order for an EMI installment.
 * Authenticated purely via high-entropy customer portal token.
 * Authoritative amount is strictly calculated on server.
 */
router.post('/payment/orders', portalInvalidTokenLimiter, portalPaymentOrderLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to create a payment order',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const { installmentNumber, emiId } = req.body || {};
    const result = await PortalPaymentService.createEmiOrder(token, {
      installmentNumber: installmentNumber !== undefined ? Number(installmentNumber) : undefined,
      emiId: typeof emiId === 'string' ? emiId : undefined,
    });

    return res.status(201).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/portal/payment/orders/:orderId/verify
 * Customer endpoint to verify payment status server-to-server after return from Cashfree checkout.
 * Authenticated via customer portal token.
 */
router.get('/payment/orders/:orderId/verify', portalInvalidTokenLimiter, portalPaymentVerifyLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractPortalToken(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PORTAL_TOKEN_REQUIRED',
          message: 'A valid portal token is required to verify payment status',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await PortalPaymentService.verifyOrder(token, req.params.orderId);

    return res.json({
      success: true,
      data: result,
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

/**
 * GET /api/v1/portal/verification-requests
 * Staff endpoint to list customer KYC correction requests.
 */
router.get(
  '/verification-requests',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await PortalService.listCorrectionRequests(req.user!, {
        status: req.query.status as string,
        section: req.query.section as string,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

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

/**
 * GET /api/v1/portal/customers/:customerId/verifications
 * Staff endpoint to fetch a customer's verification status and correction history.
 */
router.get(
  '/customers/:customerId/verifications',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await PortalService.getCustomerVerifications(req.params.customerId, req.user!);
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

/**
 * PATCH /api/v1/portal/verification-requests/:requestId/review
 * Staff endpoint to review, resolve, or reject a customer correction request.
 */
router.patch(
  '/verification-requests/:requestId/review',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, resolutionNotes } = req.body || {};
      const data = await PortalService.reviewCorrectionRequest(req.params.requestId, req.user!, {
        status,
        resolutionNotes,
      });

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

export default router;
