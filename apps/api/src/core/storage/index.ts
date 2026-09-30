import { StorageProvider } from './storage.provider';
import { S3StorageProvider } from './s3.storage';
import { LocalStorageProvider } from './local.storage';
import { env } from '../../config/env';

let storageInstance: StorageProvider | null = null;

/**
 * Returns the active storage provider singleton.
 *
 * Production enforcement:
 *   - STORAGE_PROVIDER must be 's3' in production.
 *   - AWS_ACCESS_KEY_ID must be set when using S3.
 *   - Local storage is strictly forbidden in production (files are lost on restart).
 *
 * Development/test:
 *   - Defaults to LocalStorageProvider when STORAGE_PROVIDER is not 's3'.
 */
export function getStorageProvider(): StorageProvider {
  if (!storageInstance) {
    if (env.NODE_ENV === 'production') {
      // Hard block: production must use S3 — local disk storage is not persistent
      if (env.STORAGE_PROVIDER !== 's3') {
        throw new Error(
          '[FATAL] STORAGE_PROVIDER must be "s3" in production. ' +
          'Local filesystem storage is not safe for production (files are lost on container/server restart). ' +
          'Set STORAGE_PROVIDER=s3 and configure AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET.'
        );
      }
      if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
        throw new Error(
          '[FATAL] AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required when STORAGE_PROVIDER=s3 in production.'
        );
      }
      storageInstance = new S3StorageProvider();
    } else if (env.STORAGE_PROVIDER === 's3' && env.AWS_ACCESS_KEY_ID) {
      storageInstance = new S3StorageProvider();
    } else {
      storageInstance = new LocalStorageProvider();
    }
  }
  return storageInstance;
}

/**
 * Reset the storage singleton — for use in tests only.
 * Allows tests to verify storage configuration enforcement with different env states.
 */
export function resetStorageProvider(): void {
  storageInstance = null;
}

export * from './storage.provider';
export * from './s3.storage';
export * from './local.storage';
