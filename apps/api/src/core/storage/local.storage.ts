import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StorageProvider, UploadParams, PresignedUrlParams, MAX_KYC_URL_EXPIRY_SECONDS, StorageOptions } from './storage.provider';

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
      path.resolve(__dirname, '../../../../apps/api/data/storage_vault'),
      path.resolve(__dirname, '../../../apps/api/data/storage_vault'),
    ];
  }

  public sanitizeAndValidateKey(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('Invalid storage key: key must be a non-empty string');
    }

    const trimmed = key.trim();
    if (!trimmed) {
      throw new Error('Invalid storage key: key cannot be empty');
    }

    if (trimmed.includes('\0')) {
      throw new Error('Invalid storage key: null bytes are not permitted');
    }

    // Reject absolute paths, leading slashes/backslashes, and Windows drive letters
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('\\') ||
      path.isAbsolute(trimmed) ||
      /^[a-zA-Z]:/.test(trimmed)
    ) {
      throw new Error('Invalid storage key: absolute paths are not permitted');
    }

    // Normalize all backslashes to forward slashes for uniform path resolution
    const normalized = trimmed.replace(/\\/g, '/');

    // Check for URL-encoded traversal patterns (%2e%2e, %2f, etc.)
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded !== normalized) {
        const decodedNorm = decoded.replace(/\\/g, '/');
        if (
          decodedNorm.startsWith('/') ||
          decodedNorm.startsWith('\\') ||
          path.isAbsolute(decodedNorm) ||
          /^[a-zA-Z]:/.test(decodedNorm)
        ) {
          throw new Error('Invalid storage key: absolute paths are not permitted');
        }
        if (decodedNorm.split('/').includes('..')) {
          throw new Error('Invalid storage key: path traversal detected');
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('Invalid storage key')) throw err;
    }

    // Verify individual path segments
    const segments = normalized.split('/');
    if (segments.includes('..')) {
      throw new Error('Invalid storage key: path traversal detected');
    }

    return normalized;
  }

  /**
   * Resolves a key within a base directory and verifies that the resulting
   * path remains strictly contained within that base directory (defense-in-depth).
   */
  public getSafePath(dir: string, key: string): string {
    const cleanKey = this.sanitizeAndValidateKey(key);
    const base = path.resolve(dir);
    const target = path.resolve(base, cleanKey);
    const rel = path.relative(base, target);

    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Invalid storage key: path traversal detected');
    }

    // If target exists on disk, check for symlink escape
    if (fs.existsSync(target)) {
      try {
        const realBase = fs.realpathSync(base);
        const realTarget = fs.realpathSync(target);
        const realRel = path.relative(realBase, realTarget);
        if (realRel === '' || realRel.startsWith('..') || path.isAbsolute(realRel)) {
          throw new Error('Invalid storage key: symlink traversal detected');
        }
      } catch (err: any) {
        if (err?.message?.includes('traversal')) {
          throw err;
        }
      }
    }

    return target;
  }

  public resolvePath(key: string): string {
    const candidateDirs = this.getCandidateBaseDirs();
    for (const dir of candidateDirs) {
      try {
        const candidatePath = this.getSafePath(dir, key);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      } catch (err: any) {
        // If traversal or invalid key detected, re-throw immediately
        if (err?.message?.includes('Invalid storage key')) {
          throw err;
        }
      }
    }
    return this.getSafePath(this.baseDir, key);
  }

  public async upload(params: UploadParams, _options?: StorageOptions): Promise<{ key: string; location?: string }> {
    const fullPath = this.getSafePath(this.baseDir, params.key);
    const parent = path.dirname(fullPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    const data = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body);
    fs.writeFileSync(fullPath, data);

    const cleanKey = this.sanitizeAndValidateKey(params.key);
    return { key: cleanKey, location: fullPath };
  }

  public async delete(key: string, _options?: StorageOptions): Promise<void> {
    const candidateDirs = this.getCandidateBaseDirs();
    for (const dir of candidateDirs) {
      const fullPath = this.getSafePath(dir, key);
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
    const cleanKey = this.sanitizeAndValidateKey(params.key);
    // Ensure containment
    this.getSafePath(this.baseDir, cleanKey);

    const token = crypto.randomBytes(16).toString('hex');
    const mimeQuery = params.mimeType ? `&mimeType=${encodeURIComponent(params.mimeType)}` : '';
    // Routable local-vault URL for development & testing
    return `/api/v1/kyc/local-vault?key=${encodeURIComponent(cleanKey)}&operation=${params.operation}&X-Dev-Expires=${effectiveExpiry}&X-Dev-Token=${token}${mimeQuery}`;
  }

  public async exists(key: string, _options?: StorageOptions): Promise<boolean> {
    if (!key || typeof key !== 'string') return false;
    try {
      const candidateDirs = this.getCandidateBaseDirs();
      for (const dir of candidateDirs) {
        const candidatePath = this.getSafePath(dir, key);
        if (fs.existsSync(candidatePath)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  public async getStream(key: string, _options?: StorageOptions): Promise<{ stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
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
