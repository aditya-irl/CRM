import request from 'supertest';
import app from '../src/app';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';
import { UserRole } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import { getStorageProvider, resetStorageProvider } from '../src/core/storage';
import { queryPostgres } from '../src/database/postgres';
import { env } from '../src/config/env';

describe('Storage Diagnostic Endpoint Security & Verification Suite', () => {
  const superAdminId = uuidv4();
  const adminId = uuidv4();
  const dealerId = uuidv4();
  const agentId = uuidv4();

  const superAdminToken = jwt.sign(
    { id: superAdminId, email: 'superadmin_diag@crmtest.com', role: UserRole.SUPER_ADMIN },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const adminToken = jwt.sign(
    { id: adminId, email: 'admin_diag@crmtest.com', role: UserRole.ADMIN },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const dealerToken = jwt.sign(
    { id: dealerId, email: 'dealer_diag@crmtest.com', role: UserRole.DEALER },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const agentToken = jwt.sign(
    { id: agentId, email: 'agent_diag@crmtest.com', role: UserRole.COLLECTION_AGENT },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  let initialFlag: string | undefined;

  beforeAll(async () => {
    initialFlag = process.env.ENABLE_STORAGE_DIAGNOSTIC;

    // Seed test users to satisfy authenticate middleware DB check
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status)
       VALUES ($1, 'superadmin_diag@crmtest.com', '9999990001', 'hash', 'Super Admin', 'SUPER_ADMIN', 'ACTIVE'),
              ($2, 'admin_diag@crmtest.com', '9999990002', 'hash', 'Admin', 'ADMIN', 'ACTIVE'),
              ($3, 'dealer_diag@crmtest.com', '9999990003', 'hash', 'Dealer', 'DEALER', 'ACTIVE'),
              ($4, 'agent_diag@crmtest.com', '9999990004', 'hash', 'Agent', 'COLLECTION_AGENT', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [superAdminId, adminId, dealerId, agentId]
    );
  });

  afterAll(async () => {
    await queryPostgres(
      'DELETE FROM users WHERE id IN ($1, $2, $3, $4)',
      [superAdminId, adminId, dealerId, agentId]
    );

    if (initialFlag !== undefined) {
      process.env.ENABLE_STORAGE_DIAGNOSTIC = initialFlag;
      (env as any).ENABLE_STORAGE_DIAGNOSTIC = initialFlag;
    } else {
      delete process.env.ENABLE_STORAGE_DIAGNOSTIC;
      (env as any).ENABLE_STORAGE_DIAGNOSTIC = 'false';
    }
  });

  describe('1. Disabled Mode (Default State)', () => {
    beforeEach(() => {
      delete process.env.ENABLE_STORAGE_DIAGNOSTIC;
      (env as any).ENABLE_STORAGE_DIAGNOSTIC = 'false';
    });

    test('Returns 404 Not Found when feature flag is disabled, completely hiding endpoint', async () => {
      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    test('Returns 404 even for unauthenticated probes when feature flag is disabled', async () => {
      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe('2. Authorization & RBAC Enforcement (Enabled Mode)', () => {
    beforeEach(() => {
      process.env.ENABLE_STORAGE_DIAGNOSTIC = 'true';
      (env as any).ENABLE_STORAGE_DIAGNOSTIC = 'true';
    });

    test('Rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .send({});

      expect(res.status).toBe(401);
    });

    test('Strictly rejects non-SUPER_ADMIN roles (ADMIN, DEALER, COLLECTION_AGENT) with 403', async () => {
      for (const token of [adminToken, dealerToken, agentToken]) {
        const res = await request(app)
          .post('/api/v1/system/diagnostic-storage-ping')
          .set('Authorization', `Bearer ${token}`)
          .send({});

        expect(res.status).toBe(403);
      }
    });

    test('Allows SUPER_ADMIN and executes diagnostic without database mutation', async () => {
      // Record counts prior to run
      const preAudit = await queryPostgres('SELECT COUNT(*) as c FROM audit_logs');
      const preKyc = await queryPostgres('SELECT COUNT(*) as c FROM kyc_documents');
      const preCust = await queryPostgres('SELECT COUNT(*) as c FROM customers');

      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.diagnostic).toBe('STORAGE_PIPELINE_VERIFIED');
      expect(res.body.details.keyPrefix).toBe('_diagnostics/');
      expect(res.body.details.bytesUploaded).toBeGreaterThan(0);
      expect(res.body.details.bytesDownloaded).toBe(res.body.details.bytesUploaded);
      expect(res.body.details.checksumVerified).toBe(true);
      expect(res.body.details.objectDeleted).toBe(true);

      // Verify zero credentials or URLs leaked
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('http://');
      expect(bodyStr).not.toContain('https://');
      expect(bodyStr).not.toContain('secret');
      expect(bodyStr).not.toContain('accessKey');

      // Verify ZERO database mutations
      const postAudit = await queryPostgres('SELECT COUNT(*) as c FROM audit_logs');
      const postKyc = await queryPostgres('SELECT COUNT(*) as c FROM kyc_documents');
      const postCust = await queryPostgres('SELECT COUNT(*) as c FROM customers');

      expect(postAudit.rows[0].c).toBe(preAudit.rows[0].c);
      expect(postKyc.rows[0].c).toBe(preKyc.rows[0].c);
      expect(postCust.rows[0].c).toBe(preCust.rows[0].c);
    });
  });

  describe('3. Failure & Cleanup Handling', () => {
    beforeEach(() => {
      process.env.ENABLE_STORAGE_DIAGNOSTIC = 'true';
      (env as any).ENABLE_STORAGE_DIAGNOSTIC = 'true';
    });

    test('Preserves cleanup on read failure and reports diagnostic failure safely', async () => {
      const storage = getStorageProvider() as any;

      // Simulate a read-back stream failure
      jest.spyOn(storage, 'getStream').mockImplementationOnce(async () => {
        throw new Error('Simulated B2 stream read network failure');
      });

      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.diagnostic).toBe('STORAGE_PIPELINE_FAILED');
      expect(res.body.error.message).toContain('Simulated B2 stream read network failure');
      // Cleanup was still attempted and succeeded
      expect(res.body.cleanup.attempted).toBe(true);
      expect(res.body.cleanup.cleanedUp).toBe(true);
      expect(res.body.cleanup.residualObject).toBeNull();

      jest.restoreAllMocks();
    });

    test('Reports residual object if cleanup delete fails', async () => {
      const storage = getStorageProvider();

      // Simulate delete failure
      jest.spyOn(storage, 'delete').mockImplementationOnce(async () => {
        throw new Error('Simulated B2 delete API timeout');
      });

      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.diagnostic).toBe('STORAGE_VERIFIED_BUT_CLEANUP_FAILED');
      expect(res.body.cleanup.cleanedUp).toBe(false);
      expect(res.body.cleanup.residualObject).toMatch(/^_diagnostics\/live_ping_/);
      expect(res.body.cleanup.cleanupError).toContain('Simulated B2 delete API timeout');

      // Manual cleanup of the residual object created during test
      if (res.body.cleanup.residualObject) {
        jest.restoreAllMocks();
        await storage.delete(res.body.cleanup.residualObject);
      }
    });

    test('Reports failure when delete succeeds but post-delete existence check fails', async () => {
      const storage = getStorageProvider();

      // Simulate delete succeeding, but exists() still returning true (failed deletion confirmation)
      let deleteCount = 0;
      jest.spyOn(storage, 'delete').mockImplementationOnce(async () => {
        deleteCount++;
      });
      // exists: first call during verification returns true; second call during cleanup returns true!
      jest.spyOn(storage, 'exists').mockImplementation(async (key: string) => {
        return true;
      });

      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.diagnostic).toBe('STORAGE_VERIFIED_BUT_CLEANUP_FAILED');
      expect(res.body.cleanup.cleanedUp).toBe(false);
      expect(res.body.cleanup.residualObject).toMatch(/^_diagnostics\/live_ping_/);
      expect(res.body.cleanup.cleanupError).toBe('Object still present after delete');

      jest.restoreAllMocks();
    });

    test('Handles operation timeout via AbortController and returns 504 with cleanup report', async () => {
      const storage = getStorageProvider();

      // Simulate upload being aborted by timeout
      jest.spyOn(storage, 'upload').mockImplementationOnce(async (_params, options) => {
        return new Promise((_, reject) => {
          if (options?.abortSignal?.aborted) {
            const err = new Error('Storage diagnostic timed out after 15 seconds');
            err.name = 'AbortError';
            return reject(err);
          }
          options?.abortSignal?.addEventListener('abort', () => {
            const err = new Error('Storage diagnostic timed out after 15 seconds');
            err.name = 'AbortError';
            reject(err);
          });
          // Trigger abort promptly
          setTimeout(() => {
            const err = new Error('Storage diagnostic timed out after 15 seconds');
            err.name = 'AbortError';
            reject(err);
          }, 50);
        });
      });

      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(504);
      expect(res.body.success).toBe(false);
      expect(res.body.diagnostic).toBe('DIAGNOSTIC_TIMEOUT');
      expect(res.body.error.code).toBe('DIAGNOSTIC_TIMEOUT');
      expect(res.body.cleanup.attempted).toBe(true);

      jest.restoreAllMocks();
    });

    test('Redacts URLs, keys, and credentials from error responses', async () => {
      const storage = getStorageProvider();

      jest.spyOn(storage, 'upload').mockImplementationOnce(async () => {
        throw new Error(
          'Failed contacting https://s3.us-east-005.backblazeb2.com with key AKIAIOSFODNN7EXAMPLE and secret 1234567890123456789012345678901234567890'
        );
      });

      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(502);
      expect(res.body.error.message).not.toContain('https://s3.us-east-005.backblazeb2.com');
      expect(res.body.error.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(res.body.error.message).not.toContain('1234567890123456789012345678901234567890');
      expect(res.body.error.message).toContain('[REDACTED_URL]');
      expect(res.body.error.message).toContain('[REDACTED_KEY]');
      expect(res.body.error.message).toContain('[REDACTED_SECRET]');

      jest.restoreAllMocks();
    });

    test('Completely ignores caller-supplied bucket, key, and payload in body', async () => {
      const res = await request(app)
        .post('/api/v1/system/diagnostic-storage-ping')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          bucket: 'evil-external-bucket',
          key: 'kyc/target-customer/document.pdf',
          payload: 'malicious-overwrite',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.details.keyPrefix).toBe('_diagnostics/');
      // Confirm that the diagnostic only touched _diagnostics/ and never the caller's key
      const existsMalicious = await getStorageProvider().exists('kyc/target-customer/document.pdf');
      expect(existsMalicious).toBe(false);
    });
  });
});
