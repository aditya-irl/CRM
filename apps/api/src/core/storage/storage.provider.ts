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

export interface StorageOptions {
  abortSignal?: AbortSignal;
}

export interface StorageProvider {
  upload(params: UploadParams, options?: StorageOptions): Promise<{ key: string; location?: string }>;
  delete(key: string, options?: StorageOptions): Promise<void>;
  getSignedUrl(params: PresignedUrlParams): Promise<string>;
  exists(key: string, options?: StorageOptions): Promise<boolean>;
  getStream?(key: string, options?: StorageOptions): Promise<{ stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number }>;
}

export const MAX_KYC_URL_EXPIRY_SECONDS = 300;
