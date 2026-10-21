import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider, UploadParams, PresignedUrlParams, MAX_KYC_URL_EXPIRY_SECONDS, StorageOptions } from './storage.provider';
import { env } from '../../config/env';

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(customConfig?: { bucket?: string; region?: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string }) {
    this.bucket = customConfig?.bucket || process.env.AWS_S3_BUCKET || process.env.B2_BUCKET_NAME || process.env.B2_BUCKET || env.AWS_S3_BUCKET;

    let region = customConfig?.region || process.env.AWS_REGION || process.env.B2_REGION || env.AWS_REGION;
    let endpoint = (customConfig?.endpoint || process.env.AWS_S3_ENDPOINT || process.env.B2_ENDPOINT || env.AWS_S3_ENDPOINT)?.trim();

    if (endpoint) {
      // Auto-correct common Backblaze B2 endpoint typos (e.g. .co instead of .com)
      endpoint = endpoint.replace(/\.backblazeb2\.co(\/.*)?$/i, '.backblazeb2.com$1');

      // Ensure endpoint has protocol
      if (!/^https?:\/\//i.test(endpoint)) {
        endpoint = `https://${endpoint}`;
      }

      // Validate URL parsing, protocol, and hostname
      try {
        const parsed = new URL(endpoint);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error(`Invalid protocol ${parsed.protocol}. Only http: and https: are supported.`);
        }
        if (!parsed.hostname || parsed.hostname.includes(' ')) {
          throw new Error(`Invalid hostname ${parsed.hostname}.`);
        }
      } catch (err: any) {
        throw new Error(`[FATAL] Malformed storage endpoint "${endpoint}": ${err.message}`);
      }

      // Auto-detect region for Backblaze B2 endpoints (e.g. s3.us-east-005.backblazeb2.com -> us-east-005)
      // if region was left at default 'ap-south-1' or not explicitly set
      const b2Match = endpoint.match(/s3\.([a-z0-9\-]+)\.backblazeb2\.com/i);
      if (b2Match && (!process.env.AWS_REGION || region === 'ap-south-1')) {
        region = b2Match[1];
      }
    }

    const config: any = {
      region,
      // For custom endpoints like Backblaze B2 or MinIO, forcePathStyle: true avoids DNS delays and SSL wildcard cert issues
      forcePathStyle: Boolean(endpoint),
    };

    if (endpoint) {
      config.endpoint = endpoint;
    }

    const accessKeyId = customConfig?.accessKeyId || process.env.AWS_ACCESS_KEY_ID || process.env.B2_APPLICATION_KEY_ID || process.env.B2_KEY_ID || env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = customConfig?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || process.env.B2_APPLICATION_KEY || process.env.B2_KEY || env.AWS_SECRET_ACCESS_KEY;
    if (accessKeyId && secretAccessKey) {
      config.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    this.client = new S3Client(config);
  }

  public async upload(params: UploadParams, options?: StorageOptions): Promise<{ key: string; location?: string }> {
    const cleanKey = params.key.trim().replace(/^[\/\\]+/, '');
    const cmdParams: any = {
      Bucket: this.bucket,
      Key: cleanKey,
      Body: Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body),
      ContentType: params.mimeType,
    };
    if (!env.AWS_S3_ENDPOINT) {
      cmdParams.ServerSideEncryption = 'AES256';
    }
    const cmd = new PutObjectCommand(cmdParams);

    await this.client.send(cmd, options?.abortSignal ? { abortSignal: options.abortSignal } : undefined);
    return { key: cleanKey };
  }

  public async delete(key: string, options?: StorageOptions): Promise<void> {
    const cleanKey = key.trim().replace(/^[\/\\]+/, '');
    const cmd = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });
    await this.client.send(cmd, options?.abortSignal ? { abortSignal: options.abortSignal } : undefined);
  }

  public async getSignedUrl(params: PresignedUrlParams): Promise<string> {
    // Strict compliance rule: maximum URL expiry is 300 seconds (5 mins)
    const effectiveExpiry = Math.min(params.expiresInSeconds, MAX_KYC_URL_EXPIRY_SECONDS);
    const cleanKey = params.key.trim().replace(/^[\/\\]+/, '');

    if (params.operation === 'getObject') {
      const getCmdParams: any = {
        Bucket: this.bucket,
        Key: cleanKey,
        ResponseContentDisposition: 'inline',
      };
      if (params.mimeType) {
        getCmdParams.ResponseContentType = params.mimeType;
      }
      const cmd = new GetObjectCommand(getCmdParams);
      return getSignedUrl(this.client, cmd, { expiresIn: effectiveExpiry });
    } else {
      // PutObject presigned URL:
      // Do not include ServerSideEncryption in presigned PUT:
      // 1. AWS S3 requires client to send x-amz-server-side-encryption header if signed, failing browser uploads without it.
      // 2. Compatible S3 providers (Backblaze B2, Cloudflare R2, MinIO) reject it.
      // 3. AWS S3 automatically enforces default AES-256 encryption at bucket level.
      const cmd = new PutObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
        ContentType: params.mimeType,
      });
      return getSignedUrl(this.client, cmd, { expiresIn: effectiveExpiry });
    }
  }

  public async exists(key: string, options?: StorageOptions): Promise<boolean> {
    if (!key) return false;
    const cleanKey = key.trim().replace(/^[\/\\]+/, '');
    try {
      const cmd = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
      });
      await this.client.send(cmd, options?.abortSignal ? { abortSignal: options.abortSignal } : undefined);
      return true;
    } catch (err: any) {
      // Distinguish object genuinely missing (404 / NotFound / NoSuchKey) from provider failure
      const isNotFound =
        err?.name === 'NotFound' ||
        err?.name === 'NoSuchKey' ||
        err?.code === 'NotFound' ||
        err?.code === 'NoSuchKey' ||
        err?.$metadata?.httpStatusCode === 404;

      if (isNotFound) {
        return false;
      }

      // Provider failure (AccessDenied, network failure, configuration error, 500, etc.)
      // Do not falsely report provider failure as a missing file!
      console.error(`[S3StorageProvider] HeadObject failed for key "${cleanKey}":`, err?.message || err);
      throw new Error(`Storage provider error: ${err?.message || 'Failed to communicate with S3 storage'}`);
    }
  }

  public async getStream(key: string, options?: StorageOptions): Promise<{ stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
    const cleanKey = key.trim().replace(/^[\/\\]+/, '');
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });
    const res = await this.client.send(cmd, options?.abortSignal ? { abortSignal: options.abortSignal } : undefined);
    return {
      stream: res.Body as any,
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    };
  }
}
