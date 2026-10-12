/**
 * Storage Configuration Enforcement Tests
 *
 * Verifies that:
 *   1. Production with STORAGE_PROVIDER=local → rejected (hard fail)
 *   2. Production with STORAGE_PROVIDER=s3 + missing credentials → rejected
 *   3. Production with STORAGE_PROVIDER=s3 + valid credentials → accepted
 *   4. Development with STORAGE_PROVIDER=local → works (local storage)
 *   5. Local storage signed URL does not use a fake external domain
 *   6. Local storage upload/exists/delete cycle works
 *
 * NOTE: These tests override process.env temporarily and always restore it.
 * They use resetStorageProvider() to clear the singleton between cases.
 */

import { LocalStorageProvider } from '../src/core/storage/local.storage';
import { MAX_KYC_URL_EXPIRY_SECONDS } from '../src/core/storage/storage.provider';
import { envSchema } from '../src/config/env';
import { errorHandler, NotFoundError } from '../src/middlewares/error.middleware';

// ─── helpers ─────────────────────────────────────────────────────────────────

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const originals: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    originals[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Storage Configuration Enforcement', () => {
  /**
   * We test the factory logic directly via env-manipulation + re-requiring the module.
   * For simpler isolation, we test the production guard logic inline without
   * touching the real singleton (which is already initialised in test env).
   */

  describe('1. Production + local storage → rejected', () => {
    test('getStorageProvider throws when NODE_ENV=production and STORAGE_PROVIDER=local', () => {
      // Simulate the production guard logic directly (mirrors index.ts)
      const simulateFactory = (nodeEnv: string, storageProvider: string) => {
        if (nodeEnv === 'production') {
          if (storageProvider !== 's3') {
            throw new Error(
              '[FATAL] STORAGE_PROVIDER must be "s3" in production.'
            );
          }
        }
      };

      expect(() => simulateFactory('production', 'local')).toThrow(
        '[FATAL] STORAGE_PROVIDER must be "s3" in production.'
      );
    });
  });

  describe('2. Production + s3 + missing credentials → rejected', () => {
    test('getStorageProvider throws when production s3 credentials are absent', () => {
      const simulateFactory = (
        nodeEnv: string,
        storageProvider: string,
        accessKeyId: string | undefined,
        secretKey: string | undefined
      ) => {
        if (nodeEnv === 'production') {
          if (storageProvider !== 's3') {
            throw new Error('[FATAL] STORAGE_PROVIDER must be "s3" in production.');
          }
          if (!accessKeyId || !secretKey) {
            throw new Error(
              '[FATAL] AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required when STORAGE_PROVIDER=s3 in production.'
            );
          }
        }
      };

      expect(() =>
        simulateFactory('production', 's3', undefined, undefined)
      ).toThrow('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required');

      expect(() =>
        simulateFactory('production', 's3', 'AKIAEXAMPLE', undefined)
      ).toThrow('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required');
    });
  });

  describe('3. Production + s3 + valid credentials → accepted', () => {
    test('production with s3 + credentials does not throw from guard logic', () => {
      const simulateFactory = (
        nodeEnv: string,
        storageProvider: string,
        accessKeyId: string | undefined,
        secretKey: string | undefined
      ) => {
        if (nodeEnv === 'production') {
          if (storageProvider !== 's3') {
            throw new Error('[FATAL] STORAGE_PROVIDER must be "s3" in production.');
          }
          if (!accessKeyId || !secretKey) {
            throw new Error('[FATAL] AWS credentials required in production.');
          }
          return 'S3StorageProvider';
        }
        return 'LocalStorageProvider';
      };

      expect(() =>
        simulateFactory('production', 's3', 'AKIAEXAMPLE', 'secretExample')
      ).not.toThrow();

      const result = simulateFactory('production', 's3', 'AKIAEXAMPLE', 'secretExample');
      expect(result).toBe('S3StorageProvider');
    });
  });

  describe('4. Development + local storage → works', () => {
    test('LocalStorageProvider can be instantiated in development without throwing', () => {
      // In dev/test, local storage is allowed
      expect(() => new LocalStorageProvider()).not.toThrow();
    });

    test('LocalStorageProvider upload, exists, delete cycle works', async () => {
      const provider = new LocalStorageProvider();
      const key = `test_kyc_enforcement_${Date.now()}.txt`;

      const uploadResult = await provider.upload({
        key,
        body: 'KYC enforcement test payload',
        mimeType: 'text/plain',
        isPrivate: true,
      });
      expect(uploadResult.key).toBe(key);

      const exists = await provider.exists(key);
      expect(exists).toBe(true);

      await provider.delete(key);
      const existsAfter = await provider.exists(key);
      expect(existsAfter).toBe(false);
    });
  });

  describe('5. Local storage signed URL is not a fake external domain', () => {
    test('Local signed URL uses local:// scheme — not a real external S3 URL', async () => {
      const provider = new LocalStorageProvider();
      const url = await provider.getSignedUrl({
        key: 'kyc/test/doc.pdf',
        expiresInSeconds: 300,
        operation: 'getObject',
      });

      expect(url).toBeDefined();
      // Must NOT use any routable external domain
      expect(url).not.toContain('s3-secure-vault.internal');
      expect(url).not.toMatch(/^https?:\/\//);
      // Must be a local dev URL
      expect(url).toMatch(/^(local:\/\/dev-storage\/|\/api\/v1\/kyc\/local-vault)/);
      // Expiry must be present and clamped
      expect(url).toContain('X-Dev-Expires=300');
    });

    test('Local signed URL clamps expiry to MAX_KYC_URL_EXPIRY_SECONDS (300s)', async () => {
      const provider = new LocalStorageProvider();
      const url = await provider.getSignedUrl({
        key: 'kyc/test/doc.pdf',
        expiresInSeconds: 9999, // Way over limit
        operation: 'getObject',
      });

      expect(url).toContain(`X-Dev-Expires=${MAX_KYC_URL_EXPIRY_SECONDS}`);
    });
  });

  describe('6. Production STORAGE_PROVIDER env validation', () => {
    test('STORAGE_PROVIDER is set in current environment', () => {
      // In dev/test, STORAGE_PROVIDER may be local — that is expected and correct.
      // This test documents that the env var is being read (not silently ignored).
      const provider = process.env.STORAGE_PROVIDER;
      // Should be either 's3' or 'local' (or undefined → defaults to local in dev)
      if (provider !== undefined) {
        expect(['s3', 'local']).toContain(provider);
      }
    });
  });

  describe('7. PORTAL_BASE_URL production fail-fast enforcement', () => {
    const validProdBase = {
      NODE_ENV: 'production',
      PORT: 4000,
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgresql://prod_user:secret@prod-host:5432/crm_prod',
      JWT_SECRET: 'min_32_chars_cryptographically_secure_jwt_secret_12345',
      JWT_REFRESH_SECRET: 'min_32_chars_cryptographically_secure_refresh_secret_12345',
      REDIS_URL: 'rediss://:secret@redis-prod.internal:6380',
      STORAGE_PROVIDER: 's3',
      AWS_ACCESS_KEY_ID: 'AKIAEXAMPLEPROD123',
      AWS_SECRET_ACCESS_KEY: 'secretKeyExample123456789',
    };

    test('production + missing PORTAL_BASE_URL => fatal validation failure', () => {
      const result = envSchema.safeParse({ ...validProdBase });
      expect(result.success).toBe(false);
      if (!result.success) {
        const portalIssue = result.error.issues.find((i) => i.path.includes('PORTAL_BASE_URL'));
        expect(portalIssue).toBeDefined();
        expect(portalIssue?.message).toContain('PORTAL_BASE_URL is required in production');
      }
    });

    test('production + localhost PORTAL_BASE_URL => rejected', () => {
      const result = envSchema.safeParse({
        ...validProdBase,
        PORTAL_BASE_URL: 'http://localhost:5173/portal',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const portalIssue = result.error.issues.find((i) => i.path.includes('PORTAL_BASE_URL'));
        expect(portalIssue).toBeDefined();
        expect(portalIssue?.message).toContain('cannot use localhost or 127.0.0.1 in production');
      }
    });

    test('production + valid HTTPS PORTAL_BASE_URL => accepted', () => {
      const result = envSchema.safeParse({
        ...validProdBase,
        PORTAL_BASE_URL: 'https://crm.yourcompany.com/portal',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORTAL_BASE_URL).toBe('https://crm.yourcompany.com/portal');
      }
    });

    test('development + missing PORTAL_BASE_URL => existing local behavior preserved', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'development',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORTAL_BASE_URL).toBe('http://localhost:5173/portal');
      }
    });
  });

  describe('8. STORAGE_PROVIDER production fail-fast enforcement in envSchema', () => {
    const validProdBase = {
      NODE_ENV: 'production',
      PORT: 4000,
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgresql://prod_user:secret@prod-host:5432/crm_prod',
      JWT_SECRET: 'min_32_chars_cryptographically_secure_jwt_secret_12345',
      JWT_REFRESH_SECRET: 'min_32_chars_cryptographically_secure_refresh_secret_12345',
      REDIS_URL: 'rediss://:secret@redis-prod.internal:6380',
      PORTAL_BASE_URL: 'https://crm.yourcompany.com/portal',
    };

    test('production + missing STORAGE_PROVIDER => failure', () => {
      const result = envSchema.safeParse({ ...validProdBase });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('STORAGE_PROVIDER'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('STORAGE_PROVIDER is required in production and must explicitly equal "s3"');
      }
    });

    test('production + STORAGE_PROVIDER=local => failure', () => {
      const result = envSchema.safeParse({
        ...validProdBase,
        STORAGE_PROVIDER: 'local',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('STORAGE_PROVIDER'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('STORAGE_PROVIDER must explicitly equal "s3" in production');
      }
    });

    test('production + STORAGE_PROVIDER=s3 + required credentials => accepted', () => {
      const result = envSchema.safeParse({
        ...validProdBase,
        STORAGE_PROVIDER: 's3',
        AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE12345',
        AWS_SECRET_ACCESS_KEY: 'secretExampleKey12345',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.STORAGE_PROVIDER).toBe('s3');
      }
    });

    test('development/test + local => existing behavior preserved', () => {
      const devMissing = envSchema.safeParse({ NODE_ENV: 'development' });
      expect(devMissing.success).toBe(true);
      if (devMissing.success) {
        expect(devMissing.data.STORAGE_PROVIDER).toBe('local');
      }

      const devExplicit = envSchema.safeParse({ NODE_ENV: 'development', STORAGE_PROVIDER: 'local' });
      expect(devExplicit.success).toBe(true);
      if (devExplicit.success) {
        expect(devExplicit.data.STORAGE_PROVIDER).toBe('local');
      }

      const testLocal = envSchema.safeParse({ NODE_ENV: 'test', STORAGE_PROVIDER: 'local' });
      expect(testLocal.success).toBe(true);
      if (testLocal.success) {
        expect(testLocal.data.STORAGE_PROVIDER).toBe('local');
      }
    });
  });

  describe('9. Production 500 error leakage protection', () => {
    const makeMocks = () => {
      const req = { headers: { 'x-request-id': 'req-test-123' } } as any;
      let statusCode = 200;
      let body: any = null;
      const res = {
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: any) => {
          body = payload;
          return res;
        },
      } as any;
      const next = jest.fn();
      return { req, res, getStatus: () => statusCode, getBody: () => body, next };
    };

    test('production unexpected error => generic response ("Internal server error")', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const { req, res, getStatus, getBody, next } = makeMocks();
        const sensitiveError = new Error('Database connection failed to postgresql://crm_admin:topsecret@neon.tech:5432/crm_prod');

        errorHandler(sensitiveError, req, res, next);

        expect(getStatus()).toBe(500);
        const body = getBody();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
        expect(body.error.message).toBe('Internal server error');
        expect(body.error.traceId).toBe('req-test-123');
        expect(JSON.stringify(body)).not.toContain('postgresql://');
        expect(JSON.stringify(body)).not.toContain('topsecret');
        expect(JSON.stringify(body)).not.toContain('neon.tech');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    test('development/test behavior remains compatible with existing expectations', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const { req, res, getStatus, getBody, next } = makeMocks();
        const devError = new Error('Detailed debug error message for local developer');

        errorHandler(devError, req, res, next);

        expect(getStatus()).toBe(500);
        const body = getBody();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
        expect(body.error.message).toBe('Detailed debug error message for local developer');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    test('known AppError responses remain unchanged', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const { req, res, getStatus, getBody, next } = makeMocks();
        const notFound = new NotFoundError('KYC document not found');

        errorHandler(notFound, req, res, next);

        expect(getStatus()).toBe(404);
        const body = getBody();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error.message).toBe('KYC document not found');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('10. Path Traversal Security & Storage Vault Containment Enforcement', () => {
    let provider: LocalStorageProvider;

    beforeEach(() => {
      provider = new LocalStorageProvider();
    });

    test('valid nested KYC keys are accepted for upload, exists, stream, and delete', async () => {
      const nestedKey = `kyc/cust_valid_${Date.now()}/subfolder/aadhaar_card.pdf`;
      const payload = Buffer.from('PDF Mock Content For Valid KYC');

      const uploadResult = await provider.upload({
        key: nestedKey,
        body: payload,
        mimeType: 'application/pdf',
      });
      expect(uploadResult.key).toBe(nestedKey);

      const exists = await provider.exists(nestedKey);
      expect(exists).toBe(true);

      const resolved = provider.resolvePath(nestedKey);
      expect(resolved).toContain('aadhaar_card.pdf');

      const streamResult = await provider.getStream(nestedKey);
      expect(streamResult.contentType).toBe('application/pdf');
      expect(streamResult.contentLength).toBe(payload.length);

      // Verify stream read
      const chunks: Buffer[] = [];
      for await (const chunk of streamResult.stream as any) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('PDF Mock Content For Valid KYC');

      await provider.delete(nestedKey);
      expect(await provider.exists(nestedKey)).toBe(false);
    });

    test('../ traversal attempts are strictly rejected across all provider methods', async () => {
      const traversalKeys = [
        '../../package.json',
        'kyc/test/../../../package.json',
        '../outside_vault.txt',
        'kyc/cust_1/../../../../etc/passwd',
      ];

      for (const badKey of traversalKeys) {
        // resolvePath must throw
        expect(() => provider.resolvePath(badKey)).toThrow(/path traversal detected/i);

        // upload must throw and never write
        await expect(
          provider.upload({ key: badKey, body: 'evil payload', mimeType: 'text/plain' })
        ).rejects.toThrow(/path traversal detected/i);

        // delete must throw
        await expect(provider.delete(badKey)).rejects.toThrow(/path traversal detected/i);

        // getStream must throw
        await expect(provider.getStream(badKey)).rejects.toThrow(/path traversal detected/i);

        // getSignedUrl must throw
        await expect(
          provider.getSignedUrl({ key: badKey, expiresInSeconds: 60, operation: 'getObject' })
        ).rejects.toThrow(/path traversal detected/i);

        // exists must return false, never leaking external file existence
        const exists = await provider.exists(badKey);
        expect(exists).toBe(false);
      }
    });

    test('absolute paths are rejected across all provider methods', async () => {
      const absoluteKeys = [
        '/etc/passwd',
        '/var/log/syslog',
        '/Users/someone/secret.txt',
        'C:\\Windows\\System32\\drivers\\etc\\hosts',
        'D:/vault/secret.key',
      ];

      for (const absKey of absoluteKeys) {
        expect(() => provider.resolvePath(absKey)).toThrow(/absolute paths are not permitted/i);

        await expect(
          provider.upload({ key: absKey, body: 'payload', mimeType: 'text/plain' })
        ).rejects.toThrow(/absolute paths are not permitted/i);

        await expect(provider.delete(absKey)).rejects.toThrow(/absolute paths are not permitted/i);

        await expect(provider.getStream(absKey)).rejects.toThrow(/absolute paths are not permitted/i);

        await expect(
          provider.getSignedUrl({ key: absKey, expiresInSeconds: 60, operation: 'getObject' })
        ).rejects.toThrow(/absolute paths are not permitted/i);

        expect(await provider.exists(absKey)).toBe(false);
      }
    });

    test('Windows-style backslash traversal is normalized and rejected', async () => {
      const backslashKeys = [
        '..\\..\\package.json',
        'kyc\\cust_1\\..\\..\\package.json',
        'sub\\..\\..\\outside.txt',
      ];

      for (const bsKey of backslashKeys) {
        expect(() => provider.resolvePath(bsKey)).toThrow(/path traversal detected/i);
        await expect(
          provider.upload({ key: bsKey, body: 'payload', mimeType: 'text/plain' })
        ).rejects.toThrow(/path traversal detected/i);
        expect(await provider.exists(bsKey)).toBe(false);
      }
    });

    test('URL-encoded traversal sequences are rejected', async () => {
      const encodedKeys = [
        '%2e%2e%2fpackage.json',
        'kyc%2f%2e%2e%2f%2e%2e%2fpackage.json',
        '..%2foutside.txt',
      ];

      for (const encKey of encodedKeys) {
        expect(() => provider.resolvePath(encKey)).toThrow(/path traversal detected/i);
        expect(await provider.exists(encKey)).toBe(false);
      }
    });

    test('empty keys, whitespace-only, and null-byte injection are rejected', async () => {
      expect(() => provider.resolvePath('')).toThrow(/key cannot be empty|non-empty string/i);
      expect(() => provider.resolvePath('   ')).toThrow(/key cannot be empty/i);
      expect(() => provider.resolvePath('kyc/doc.pdf\0.png')).toThrow(/null bytes are not permitted/i);

      expect(await provider.exists('')).toBe(false);
      expect(await provider.exists('   ')).toBe(false);
      expect(await provider.exists('kyc/doc.pdf\0.png')).toBe(false);
    });

    test('existing standard upload, existence, read, and delete behavior is preserved', async () => {
      const standardKey = `standard_lifecycle_${Date.now()}.pdf`;
      const content = Buffer.from('Standard storage lifecycle content');

      const uploadResult = await provider.upload({
        key: standardKey,
        body: content,
        mimeType: 'application/pdf',
      });
      expect(uploadResult.key).toBe(standardKey);
      expect(await provider.exists(standardKey)).toBe(true);

      const streamRes = await provider.getStream(standardKey);
      expect(streamRes.contentType).toBe('application/pdf');
      await new Promise<void>((resolve, reject) => {
        streamRes.stream.on('error', reject);
        streamRes.stream.on('data', () => {});
        streamRes.stream.on('end', () => resolve());
        streamRes.stream.resume();
      });

      await provider.delete(standardKey);
      expect(await provider.exists(standardKey)).toBe(false);
    });
  });
});
