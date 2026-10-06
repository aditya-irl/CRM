import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StorageProvider, UploadParams, PresignedUrlParams, MAX_KYC_URL_EXPIRY_SECONDS } from './storage.provider';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor() {
    this.baseDir = path.resolve(process.cwd(), 'data/storage_vault');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  public async upload(params: UploadParams): Promise<{ key: string; location?: string }> {
    const fullPath = path.join(this.baseDir, params.key);
    const parent = path.dirname(fullPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    const data = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body);
    fs.writeFileSync(fullPath, data);

    return { key: params.key, location: fullPath };
  }

  public async delete(key: string): Promise<void> {
    const fullPath = path.join(this.baseDir, key);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
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
    // Routable local-vault URL for development & testing
    return `/api/v1/kyc/local-vault?key=${encodeURIComponent(params.key)}&operation=${params.operation}&X-Dev-Expires=${effectiveExpiry}&X-Dev-Token=${token}`;
  }

  public async exists(key: string): Promise<boolean> {
    const fullPath = path.join(this.baseDir, key);
    return fs.existsSync(fullPath);
  }
}
