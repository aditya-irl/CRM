import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { getStorageProvider } from '../src/core/storage';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Storage Vault and KYC Document Lifecycle Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const adminEmail = `admin_vault_${runId}@crmtest.com`;
  let adminId: string;
  let adminToken: string;
  let testCustomerId: string;
  let testDocId: string;
  let validStorageKey: string;

  beforeAll(async () => {
    // 1. Seed and authenticate Super Admin
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Storage Admin User', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [adminId, adminEmail, `+9198${Date.now().toString().slice(-8)}`, hash]
    );

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'Password@123' });
    adminToken = loginRes.body.data.tokens.accessToken;

    // 2. Create a clean test customer
    testCustomerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by, created_at, updated_at
      ) VALUES ($1, $2, 'Storage Vault Test Customer', '+919876543299', '123 Test Street', 'Noida', 'Uttar Pradesh', '201301', 'Dadri', TRUE, $3, NOW(), NOW())`,
      [testCustomerId, `CUST-V-${runId}`, adminId]
    );
  });

  afterAll(async () => {
    if (testCustomerId) {
      await queryPostgres('DELETE FROM kyc_documents WHERE customer_id = $1', [testCustomerId]);
      await queryPostgres('DELETE FROM customers WHERE id = $1', [testCustomerId]);
    }
  });

  describe('1. Standard KYC Upload, Persistence, and Vault Retrieval', () => {
    it('successfully initiates presigned upload and confirms document with actual vault file', async () => {
      // Step A: Request presigned upload
      const initRes = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: testCustomerId,
          docType: 'AADHAAR',
          fileName: 'aadhaar_card.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
        });

      expect(initRes.status).toBe(200);
      expect(initRes.body.success).toBe(true);
      validStorageKey = initRes.body.data.storageKey;
      expect(validStorageKey).toContain(`kyc/${testCustomerId}/`);

      // Step B: Write actual mock file to active storage provider
      const storage = getStorageProvider();
      await storage.upload({
        key: validStorageKey,
        body: Buffer.from('%PDF-1.4 Mock Aadhaar Document Content for Testing'),
        mimeType: 'application/pdf',
      });

      // Step C: Confirm KYC document record
      const confirmRes = await request(app)
        .post('/api/v1/kyc/confirm')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: testCustomerId,
          docType: 'AADHAAR',
          docNumber: '123456789012',
          storageKey: validStorageKey,
          fileMimeType: 'application/pdf',
          fileSizeBytes: 2048,
        });

      expect(confirmRes.status).toBe(201);
      expect(confirmRes.body.success).toBe(true);
      testDocId = confirmRes.body.data.id;
      expect(confirmRes.body.data.docNumberMasked).toBe('XXXX-XXXX-9012');
    });

    it('retrieves presigned download URL when vault object exists', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${testDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.docType).toBe('AADHAAR');
      expect(res.body.data.docNumberMasked).toBe('XXXX-XXXX-9012');
    });

    it('streams document directly with nosniff and safe inline headers', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${testDocId}/view`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toContain('inline');
    });
  });

  describe('2. Handling Genuinely Missing Vault Objects', () => {
    let missingDocId: string;
    const ghostKey = `kyc/${uuidv4()}/ghost_doc.pdf`;

    beforeAll(async () => {
      // Insert a KYC database record whose storage object intentionally does NOT exist in storage vault
      const insertRes = await queryPostgres(
        `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_at)
         VALUES ($1, $2, 'PAN', 'XXXXX1234F', $3, 'application/pdf', 1024, 'VERIFIED', NOW())
         RETURNING id`,
        [uuidv4(), testCustomerId, ghostKey]
      );
      missingDocId = insertRes.rows[0].id;
    });

    it('returns clean, actionable 404 with DOCUMENT_FILE_MISSING and diagnostic correlation reference', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${missingDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_FILE_MISSING');
      expect(res.body.error.message).toContain('Document file not found in storage vault');
      expect(res.body.error.message).toContain('Ref:');
    });

    it('preserves database record and verification status even when object is missing in storage', async () => {
      const dbCheck = await queryPostgres('SELECT id, status FROM kyc_documents WHERE id = $1', [missingDocId]);
      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].status).toBe('VERIFIED');
    });

    it('logs safe diagnostic audit event for the missing object without leaking secrets', async () => {
      const auditRes = await queryPostgres(
        `SELECT action, new_state FROM audit_logs WHERE entity = 'KYCDocument' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [missingDocId]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].action).toBe('KYC_STORAGE_OBJECT_MISSING');
      expect(auditRes.rows[0].new_state.correlationId).toBeDefined();
    });
  });

  describe('3. Differentiating Storage Provider Failure from Missing Object', () => {
    it('returns 503 STORAGE_PROVIDER_ERROR when storage provider throws an unexpected failure', async () => {
      const storage = getStorageProvider();
      const originalExists = storage.exists;

      // Mock storage provider throwing an unexpected failure (e.g. S3 network unreachable / 500)
      storage.exists = jest.fn().mockRejectedValue(new Error('S3 Endpoint Unreachable: ETIMEDOUT'));

      try {
        const res = await request(app)
          .get(`/api/v1/kyc/${testDocId}/presigned-download`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('STORAGE_PROVIDER_ERROR');
        expect(res.body.error.message).toContain('Storage service temporarily unavailable');
      } finally {
        storage.exists = originalExists;
      }
    });
  });

  describe('4. Safe Document Re-upload / Replacement Lifecycle', () => {
    it('allows authorized Admin to safely re-upload and replace a missing or updated document', async () => {
      // Step A: Init re-upload
      const initRes = await request(app)
        .post(`/api/v1/kyc/${testDocId}/reupload`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fileName: 'aadhaar_updated.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 4096,
        });

      expect(initRes.status).toBe(200);
      expect(initRes.body.success).toBe(true);
      const newStorageKey = initRes.body.data.storageKey;
      expect(newStorageKey).toBeDefined();

      // Step B: Upload replacement file to vault
      const storage = getStorageProvider();
      await storage.upload({
        key: newStorageKey,
        body: Buffer.from('%PDF-1.4 Updated Aadhaar File in Vault'),
        mimeType: 'application/pdf',
      });

      // Step C: Confirm replacement
      const confirmRes = await request(app)
        .post(`/api/v1/kyc/${testDocId}/confirm-replacement`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storageKey: newStorageKey,
          fileMimeType: 'application/pdf',
          fileSizeBytes: 4096,
          docNumber: '987654321098',
        });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.data.docNumberMasked).toBe('XXXX-XXXX-1098');

      // Step D: Verify presigned download now points to new valid object
      const downloadRes = await request(app)
        .get(`/api/v1/kyc/${testDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.body.data.docNumberMasked).toBe('XXXX-XXXX-1098');
    });

    it('rejects replacement confirmation if the replacement file was not actually uploaded', async () => {
      const fakeNewKey = `kyc/${testCustomerId}/${uuidv4()}.pdf`;

      const res = await request(app)
        .post(`/api/v1/kyc/${testDocId}/confirm-replacement`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storageKey: fakeNewKey,
          fileMimeType: 'application/pdf',
          fileSizeBytes: 2048,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('Uploaded replacement file was not found in storage');
    });
  });

  describe('5. Safe Deletion Lifecycle and Consistency', () => {
    it('deletes document and vault object cleanly', async () => {
      const delRes = await request(app)
        .delete(`/api/v1/kyc/${testDocId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Verify DB record is gone
      const checkRes = await request(app)
        .get(`/api/v1/kyc/${testDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(checkRes.status).toBe(404);
      expect(checkRes.body.error.message).toContain('KYC document not found');
    });
  });
});
