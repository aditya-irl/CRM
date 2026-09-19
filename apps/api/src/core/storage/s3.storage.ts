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
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      Body: Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body),
      ContentType: params.mimeType,
      ServerSideEncryption: 'AES256',
    });

    await this.client.send(cmd);
    return { key: params.key };
  }

  public async delete(key: string): Promise<void> {
    const cmd = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(cmd);
  }

  public async getSignedUrl(params: PresignedUrlParams): Promise<string> {
    // Strict compliance rule: maximum URL expiry is 300 seconds (5 mins)
    const effectiveExpiry = Math.min(params.expiresInSeconds, MAX_KYC_URL_EXPIRY_SECONDS);

    if (params.operation === 'getObject') {
      const cmd = new GetObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
      });
      return getSignedUrl(this.client, cmd, { expiresIn: effectiveExpiry });
    } else {
      const cmd = new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        ContentType: params.mimeType,
        ServerSideEncryption: 'AES256',
      });
      return getSignedUrl(this.client, cmd, { expiresIn: effectiveExpiry });
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const cmd = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(cmd);
      return true;
    } catch {
      return false;
    }
  }
}
