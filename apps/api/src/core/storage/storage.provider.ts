export interface UploadParams {
  key: string;
  body: Buffer | Uint8Array | string;
  mimeType: string;
  isPrivate?: boolean;
}

export interface PresignedUrlParams {
  key: string;
  expiresInSeconds: number; // Strict max 300s for KYC compliance
  operation: 'getObject' | 'putObject';
  mimeType?: string;
}

export interface StorageProvider {
  upload(params: UploadParams): Promise<{ key: string; location?: string }>;
  delete(key: string): Promise<void>;
  getSignedUrl(params: PresignedUrlParams): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export const MAX_KYC_URL_EXPIRY_SECONDS = 300;
