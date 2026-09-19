import { Router, Request, Response, NextFunction } from 'express';
import { KYCService } from './kyc.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import { kycUploadInitSchema, kycConfirmSchema, UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);

// Generate pre-signed upload URL (Admin, Branch Manager, or assigned Collection Agent)
router.post(
  '/presigned-upload',
  validateBody(kycUploadInitSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { customerId, docType, fileName, mimeType, fileSizeBytes } = req.body;
      const result = await KYCService.generatePresignedUploadUrl(
        customerId,
        docType,
        fileName,
        mimeType,
        fileSizeBytes,
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

// Confirm uploaded document metadata
router.post(
  '/confirm',
  validateBody(kycConfirmSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await KYCService.confirmKYCDocument(req.body, req.user!);
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

// Generate pre-signed download URL (Strict Admin & Branch Manager ONLY; blocked for agents)
router.get(
  '/:id/presigned-download',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await KYCService.generatePresignedDownloadUrl(req.params.id, req.user!);
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

// List KYC documents for a customer (Masked for collection agents)
router.get(
  '/customer/:customerId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await KYCService.getKYCDocumentsForCustomer(req.params.customerId, req.user!);
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
// Delete KYC document (Admin / Branch Manager only)
router.delete(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await KYCService.deleteKYCDocument(req.params.id, req.user!);
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
