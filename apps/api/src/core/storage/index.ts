import { StorageProvider } from './storage.provider';
import { S3StorageProvider } from './s3.storage';
import { LocalStorageProvider } from './local.storage';
import { env } from '../../config/env';

let storageInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!storageInstance) {
    if (env.STORAGE_PROVIDER === 's3' && env.AWS_ACCESS_KEY_ID) {
      storageInstance = new S3StorageProvider();
    } else {
      storageInstance = new LocalStorageProvider();
    }
  }
  return storageInstance;
}

export * from './storage.provider';
export * from './s3.storage';
export * from './local.storage';
