import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider, UploadParams, PresignedUrlParams, MAX_KYC_URL_EXPIRY_SECONDS } from './storage.provider';
import { env } from '../../config/env';

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = env.AWS_S3_BUCKET;

    const config: any = {
      region: env.AWS_REGION,
    };

    if (env.AWS_S3_ENDPOINT) {
      config.endpoint = env.AWS_S3_ENDPOINT;
    }

    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      };
    }

    this.client = new S3Client(config);
  }

  public async upload(params: UploadParams): Promise<{ key: string; location?: string }> {
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

    await this.client.send(cmd);
    return { key: cleanKey };
  }

  public async delete(key: string): Promise<void> {
    const cleanKey = key.trim().replace(/^[\/\\]+/, '');
    const cmd = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });
    await this.client.send(cmd);
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

  public async exists(key: string): Promise<boolean> {
    if (!key) return false;
    const cleanKey = key.trim().replace(/^[\/\\]+/, '');
    try {
      const cmd = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
      });
      await this.client.send(cmd);
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

  public async getStream(key: string): Promise<{ stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
    const cleanKey = key.trim().replace(/^[\/\\]+/, '');
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });
    const res = await this.client.send(cmd);
    return {
      stream: res.Body as any,
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    };
  }
}
