import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { KYCService } from './kyc.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import { kycUploadInitSchema, kycConfirmSchema, UserRole } from '@crm/shared';

const router = Router();

// Local development storage vault stream (Safe path validation)
router.get('/local-vault', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawKey = req.query.key as string;
    if (!rawKey) {
      return res.status(400).send('Storage key missing');
    }
    const baseDir = path.resolve(process.cwd(), 'data/storage_vault');
    const safePath = path.resolve(baseDir, rawKey);
    if (!safePath.startsWith(baseDir)) {
      return res.status(403).send('Invalid file path');
    }
    if (!fs.existsSync(safePath)) {
      return res.status(404).send('Document file not found in local vault');
    }
    const ext = path.extname(safePath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', 'inline');
    const stream = fs.createReadStream(safePath);
    return stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// Local development file upload receiver
router.put('/local-vault', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawKey = req.query.key as string;
    if (!rawKey) {
      return res.status(400).send('Storage key missing');
    }
    const baseDir = path.resolve(process.cwd(), 'data/storage_vault');
    const safePath = path.resolve(baseDir, rawKey);
    if (!safePath.startsWith(baseDir)) {
      return res.status(403).send('Invalid file path');
    }
    const parent = path.dirname(safePath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    const writeStream = fs.createWriteStream(safePath);
    req.pipe(writeStream);
    writeStream.on('finish', () => {
      res.status(200).json({ success: true, key: rawKey });
    });
    writeStream.on('error', (err) => next(err));
  } catch (err) {
    next(err);
  }
});

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
