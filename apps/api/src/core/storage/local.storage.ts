import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StorageProvider, UploadParams, PresignedUrlParams, MAX_KYC_URL_EXPIRY_SECONDS } from './storage.provider';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor() {
    this.baseDir = this.determinePrimaryBaseDir();
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private determinePrimaryBaseDir(): string {
    const cwd = process.cwd();
    // If running from repo root
    if (fs.existsSync(path.resolve(cwd, 'apps/api'))) {
      return path.resolve(cwd, 'apps/api/data/storage_vault');
    }
    // If running from apps/api directory or container
    return path.resolve(cwd, 'data/storage_vault');
  }

  private getCandidateBaseDirs(): string[] {
    const cwd = process.cwd();
    return [
      this.baseDir,
      path.resolve(cwd, 'apps/api/data/storage_vault'),
      path.resolve(cwd, 'data/storage_vault'),
      path.resolve(__dirname, '../../../../data/storage_vault'),
      path.resolve(__dirname, '../../../data/storage_vault'),
    ];
  }

  public resolvePath(key: string): string {
    const candidateDirs = this.getCandidateBaseDirs();
    for (const dir of candidateDirs) {
      const candidatePath = path.resolve(dir, key);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
    return path.resolve(this.baseDir, key);
  }

  public async upload(params: UploadParams): Promise<{ key: string; location?: string }> {
    const fullPath = path.resolve(this.baseDir, params.key);
    const parent = path.dirname(fullPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    const data = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body);
    fs.writeFileSync(fullPath, data);

    return { key: params.key, location: fullPath };
  }

  public async delete(key: string): Promise<void> {
    const candidateDirs = this.getCandidateBaseDirs();
    for (const dir of candidateDirs) {
      const fullPath = path.resolve(dir, key);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }
  }

  /**
   * Development/test only: returns a local dev URL.
   * This is NOT a real presigned URL and will NOT work in production.
   * Set STORAGE_PROVIDER=s3 with valid AWS credentials for production.
   */
  public async getSignedUrl(params: PresignedUrlParams): Promise<string> {
    const effectiveExpiry = Math.min(params.expiresInSeconds, MAX_KYC_URL_EXPIRY_SECONDS);
    const token = crypto.randomBytes(16).toString('hex');
    const mimeQuery = params.mimeType ? `&mimeType=${encodeURIComponent(params.mimeType)}` : '';
    // Routable local-vault URL for development & testing
    return `/api/v1/kyc/local-vault?key=${encodeURIComponent(params.key)}&operation=${params.operation}&X-Dev-Expires=${effectiveExpiry}&X-Dev-Token=${token}${mimeQuery}`;
  }

  public async exists(key: string): Promise<boolean> {
    if (!key) return false;
    const resolved = this.resolvePath(key);
    return fs.existsSync(resolved);
  }

  public async getStream(key: string): Promise<{ stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
    const fullPath = this.resolvePath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error('Document file not found in storage vault');
    }

    const stat = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';

    return {
      stream: fs.createReadStream(fullPath),
      contentType: mimeType,
      contentLength: stat.size,
    };
  }
}
