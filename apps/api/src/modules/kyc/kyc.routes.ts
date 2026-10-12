import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { KYCService } from './kyc.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import { kycUploadInitSchema, kycConfirmSchema, UserRole } from '@crm/shared';

const router = Router();

// Local development storage vault stream (Safe multi-directory path validation)
router.get('/local-vault', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawKey = req.query.key as string;
    if (!rawKey) {
      return res.status(400).send('Storage key missing');
    }

    const cwd = process.cwd();
    const candidateDirs = [
      path.resolve(cwd, 'data/storage_vault'),
      path.resolve(cwd, 'apps/api/data/storage_vault'),
      path.resolve(__dirname, '../../../../data/storage_vault'),
      path.resolve(__dirname, '../../../data/storage_vault'),
    ];

    let safePath: string | null = null;
    for (const dir of candidateDirs) {
      const base = path.resolve(dir);
      const cleanKey = (rawKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const candidate = path.resolve(base, cleanKey);
      const rel = path.relative(base, candidate);
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(candidate)) {
        safePath = candidate;
        break;
      }
    }

    if (!safePath) {
      return res.status(404).send('Document file not found in local vault');
    }

    const ext = path.extname(safePath).toLowerCase();
    const queryMime = req.query.mimeType as string | undefined;
    let mimeType = queryMime || 'application/octet-stream';
    if (!queryMime) {
      if (ext === '.pdf') mimeType = 'application/pdf';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
    }

    const safeInlineMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const isSafeInline = safeInlineMimes.includes(mimeType);
    res.setHeader('Content-Type', isSafeInline ? mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', isSafeInline ? 'inline' : 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
    const cwd = process.cwd();
    const baseDir = fs.existsSync(path.resolve(cwd, 'apps/api'))
      ? path.resolve(cwd, 'apps/api/data/storage_vault')
      : path.resolve(cwd, 'data/storage_vault');

    const cleanKey = (rawKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const safePath = path.resolve(baseDir, cleanKey);
    const rel = path.relative(baseDir, safePath);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
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

// Generate pre-signed download URL (Super Admin, Admin, Branch Manager, or Dealer)
router.get(
  '/:id/presigned-download',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
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

// Authenticated document streaming for inline viewing or download
router.get(
  '/:id/view',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await KYCService.streamKYCDocument(req.params.id, req.user!);
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

// Initialize KYC document re-upload / replacement (Admin / Branch Manager only)
router.post(
  '/:id/reupload',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await KYCService.initReuploadKYCDocument(req.params.id, req.body, req.user!);
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

// Confirm KYC document replacement (Admin / Branch Manager only)
router.post(
  '/:id/confirm-replacement',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await KYCService.confirmReplacementKYCDocument(req.params.id, req.body, req.user!);
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
