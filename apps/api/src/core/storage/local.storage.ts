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

  public async getSignedUrl(params: PresignedUrlParams): Promise<string> {
    const effectiveExpiry = Math.min(params.expiresInSeconds, MAX_KYC_URL_EXPIRY_SECONDS);
    const signature = crypto.randomBytes(16).toString('hex');
    return `https://s3-secure-vault.internal/loans-bucket/${params.key}?X-Amz-Expires=${effectiveExpiry}&X-Amz-Signature=${signature}`;
  }

  public async exists(key: string): Promise<boolean> {
    const fullPath = path.join(this.baseDir, key);
    return fs.existsSync(fullPath);
  }
}
