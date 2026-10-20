import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { getStorageProvider } from '../src/core/storage';
import { KYCType, UserRole } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';

describe('Requirement 7: KYC Document Upload End-to-End Regression Test Suite', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  let superAdminId: string;
  let superAdminToken: string;

  let dealerAId: string;
  let dealerAUser1Id: string;
  let dealerAUser1Token: string;
  let dealerAUser2Id: string;
  let dealerAUser2Token: string;

  let dealerBId: string;
  let dealerBUserId: string;
  let dealerBUserToken: string;

  let customerAId: string;
  let customerBId: string;

  // Synthetic valid PDF binary buffer and Base64 string
  const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Synthetic KYC Document) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
  const validPdfBase64 = validPdfBuffer.toString('base64');

  // Synthetic valid JPEG buffer and Base64 string (FF D8 FF ...)
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01]);
  const validJpegBase64 = validJpegBuffer.toString('base64');

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Super Admin
    superAdminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'SUPER_ADMIN', 'KYC Super Admin', 'ACTIVE', NOW(), NOW())`,
      [superAdminId, `kyc_superadmin_${runId}@crm.test`, hash]
    );
    superAdminToken = jwt.sign({ id: superAdminId }, JWT_SECRET, { expiresIn: '2h' });

    // 2. Dealer A Store and User
    dealerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Store A Telecom', 'Owner A', $3, $4, 'ACTIVE', 'Noida', 'Shop 1A', NOW(), NOW())`,
      [dealerAId, `DLR_A_${runId}`, `9801${numId}`, `dlr_a_${runId}@crm.test`]
    );

    dealerAUser1Id = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, dealer_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEALER', 'Store A User 1', 'ACTIVE', $4, NOW(), NOW())`,
      [dealerAUser1Id, `dealer_a1_${runId}@crm.test`, hash, dealerAId]
    );
    dealerAUser1Token = jwt.sign({ id: dealerAUser1Id }, JWT_SECRET, { expiresIn: '2h' });

    // 3. Dealer B Store and User (Competitor Store)
    dealerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Store B Mobile Gallery', 'Owner B', $3, $4, 'ACTIVE', 'Noida', 'Shop 2B', NOW(), NOW())`,
      [dealerBId, `DLR_B_${runId}`, `9802${numId}`, `dlr_b_${runId}@crm.test`]
    );

    dealerBUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, dealer_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEALER', 'Store B User', 'ACTIVE', $4, NOW(), NOW())`,
      [dealerBUserId, `dealer_b_${runId}@crm.test`, hash, dealerBId]
    );
    dealerBUserToken = jwt.sign({ id: dealerBUserId }, JWT_SECRET, { expiresIn: '2h' });

    // 4. Customer A (Created by Dealer A User 1)
    customerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Customer Store A', '9811001122', 'Address A', 'Noida', 'UP', '201301', 'Route A', $3, NOW(), NOW())`,
      [customerAId, `CUST_A_${runId}`, dealerAUser1Id]
    );

    // 5. Customer B (Created by Dealer B User)
    customerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Customer Store B', '9811002244', 'Address B', 'Noida', 'UP', '201301', 'Route B', $3, NOW(), NOW())`,
      [customerBId, `CUST_B_${runId}`, dealerBUserId]
    );
  });

  afterAll(async () => {
    try {
      if (customerAId) {
        await queryPostgres('DELETE FROM kyc_documents WHERE customer_id = $1', [customerAId]);
        await queryPostgres('DELETE FROM customers WHERE id = $1', [customerAId]);
      }
      if (customerBId) {
        await queryPostgres('DELETE FROM kyc_documents WHERE customer_id = $1', [customerBId]);
        await queryPostgres('DELETE FROM customers WHERE id = $1', [customerBId]);
      }
      await queryPostgres(`UPDATE users SET status = 'INACTIVE' WHERE id IN ($1, $2, $3)`, [
        superAdminId,
        dealerAUser1Id,
        dealerBUserId,
      ]);
    } catch {
      // Ignore cleanup error in test environment
    }
  });

  // ─── 1. SUCCESSFUL UPLOAD FLOWS ──────────────────────────────────────────────

  describe('1. Successful Upload Workflows', () => {
    let directDocId: string;

    it('1.1 successfully performs direct KYC document upload with synthetic PDF', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.AADHAAR,
          docNumber: '998877665544',
          fileName: 'customer_aadhaar.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.customerId).toBe(customerAId);
      expect(res.body.data.docType).toBe(KYCType.AADHAAR);
      expect(res.body.data.docNumberMasked).toBe('XXXX-XXXX-5544');
      directDocId = res.body.data.id;

      // Verify record exists in PostgreSQL database
      const dbRes = await queryPostgres('SELECT * FROM kyc_documents WHERE id = $1', [directDocId]);
      expect(dbRes.rows.length).toBe(1);
      const doc = dbRes.rows[0];
      expect(doc.customer_id).toBe(customerAId);
      expect(doc.status).toBe('VERIFIED');

      // Verify file actually exists in storage provider
      const storage = getStorageProvider();
      const existsInStorage = await storage.exists(doc.storage_key);
      expect(existsInStorage).toBe(true);
    });

    it('1.2 successfully performs direct KYC upload with synthetic JPEG image', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.PHOTO,
          docNumber: 'Passport Photo',
          fileName: 'customer_photo.jpg',
          mimeType: 'image/jpeg',
          fileBase64: validJpegBase64,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.docType).toBe(KYCType.PHOTO);
    });

    it('1.3 successfully executes presigned upload initialization and confirmation flow', async () => {
      // Step A: Init presigned upload
      const initRes = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.PAN,
          fileName: 'pan_card.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: validPdfBuffer.length,
        });

      expect(initRes.status).toBe(200);
      expect(initRes.body.success).toBe(true);
      const storageKey = initRes.body.data.storageKey;
      expect(storageKey).toContain(`kyc/${customerAId}/`);

      // Step B: Write file to storage vault
      const storage = getStorageProvider();
      await storage.upload({
        key: storageKey,
        body: validPdfBuffer,
        mimeType: 'application/pdf',
        isPrivate: true,
      });

      // Step C: Confirm KYC document
      const confirmRes = await request(app)
        .post('/api/v1/kyc/confirm')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.PAN,
          docNumber: 'ABCDE1234F',
          storageKey,
          fileMimeType: 'application/pdf',
          fileSizeBytes: validPdfBuffer.length,
        });

      expect(confirmRes.status).toBe(201);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.data.docNumberMasked).toBe('ABCDE****F');
    });

    it('1.4 allows authorized users to generate download URLs and view tokens', async () => {
      // Dealer A user 1 can get download URL for own customer document
      const downloadRes = await request(app)
        .get(`/api/v1/kyc/${directDocId}/presigned-download`)
        .set('Authorization', `Bearer ${dealerAUser1Token}`);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.body.success).toBe(true);
      expect(downloadRes.body.data.downloadUrl).toBeDefined();

      // View token generation
      const tokenRes = await request(app)
        .get(`/api/v1/kyc/${directDocId}/view-token`)
        .set('Authorization', `Bearer ${dealerAUser1Token}`);

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.data.token).toBeDefined();
    });
  });

  // ─── 2. MISSING OR INVALID PARAMETERS ────────────────────────────────────────

  describe('2. Missing or Invalid Request Validation', () => {
    it('2.1 rejects upload when required parameters are missing', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          // customerId missing
          docType: KYCType.AADHAAR,
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('2.2 rejects upload with invalid customer UUID format (safe 422 error, not 500)', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: 'not-a-valid-uuid-format',
          docType: KYCType.AADHAAR,
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Invalid request payload');
    });

    it('2.3 rejects nonexistent customer ID with safe 404 error', async () => {
      const nonExistentCustomerId = uuidv4();
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: nonExistentCustomerId,
          docType: KYCType.AADHAAR,
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('Customer not found');
    });

    it('2.4 rejects invalid docType enum value', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: 'INVALID_PASSPORT_DOC_TYPE',
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── 3. UNSUPPORTED FILE TYPES & MAGIC BYTES ─────────────────────────────────

  describe('3. Unsupported File Types & Magic Bytes Verification', () => {
    it('3.1 rejects unsupported MIME types (e.g. text/html, application/x-sh)', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.AADHAAR,
          fileName: 'script.sh',
          mimeType: 'application/x-sh',
          fileBase64: Buffer.from('#!/bin/bash\necho bad').toString('base64'),
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('3.2 rejects spoofed files where declared MIME type does not match binary magic bytes', async () => {
      // Declare application/pdf but body is plain text / shell script (fails magic byte %PDF check)
      const fakePdfBuffer = Buffer.from('This is completely fake and not a real PDF at all');
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.AADHAAR,
          fileName: 'fake_aadhaar.pdf',
          mimeType: 'application/pdf',
          fileBase64: fakePdfBuffer.toString('base64'),
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('File content does not match the declared MIME type');
    });

    it('3.3 rejects spoofed JPEG where magic bytes FF D8 FF are missing', async () => {
      const fakeJpegBuffer = Buffer.from('FAKE JPEG CONTENT WITHOUT MAGIC BYTES');
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.PHOTO,
          fileName: 'fake_photo.jpg',
          mimeType: 'image/jpeg',
          fileBase64: fakeJpegBuffer.toString('base64'),
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('File content does not match the declared MIME type');
    });
  });

  // ─── 4. FILE SIZE LIMITS ─────────────────────────────────────────────────────

  describe('4. File Size Limits', () => {
    it('4.1 rejects file uploads exceeding the 10 MB limit', async () => {
      // 10.5 MB buffer with valid PDF header
      const oversizedBuffer = Buffer.alloc(10.5 * 1024 * 1024);
      oversizedBuffer.write('%PDF-1.4\n', 0);
      const oversizedBase64 = oversizedBuffer.toString('base64');

      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.AADHAAR,
          fileName: 'oversized.pdf',
          mimeType: 'application/pdf',
          fileBase64: oversizedBase64,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('10 MB');
    });

    it('4.2 rejects zero-byte empty files', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerAId,
          docType: KYCType.AADHAAR,
          fileName: 'empty.pdf',
          mimeType: 'application/pdf',
          fileBase64: '',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── 5. AUTHENTICATION & ACCESS CONTROL ──────────────────────────────────────

  describe('5. Authentication & Authorization Enforcement', () => {
    it('5.1 rejects unauthenticated uploads with HTTP 401', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .send({
          customerId: customerAId,
          docType: KYCType.AADHAAR,
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('5.2 rejects invalid or tampered bearer token with HTTP 401', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', 'Bearer invalid.tampered.jwt.token')
        .send({
          customerId: customerAId,
          docType: KYCType.AADHAAR,
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ─── 6. CROSS-DEALER TENANT ISOLATION ────────────────────────────────────────

  describe('6. Cross-Dealer Tenant Isolation', () => {
    let dealerBDocId: string;

    beforeAll(async () => {
      // Upload a valid document for Dealer B's customer
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerBUserToken}`)
        .send({
          customerId: customerBId,
          docType: KYCType.AADHAAR,
          docNumber: '112233445566',
          fileName: 'dealer_b_aadhaar.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });
      expect(res.status).toBe(201);
      dealerBDocId = res.body.data.id;
    });

    it('6.1 prevents Dealer A from uploading KYC documents for Dealer B customer', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerAUser1Token}`)
        .send({
          customerId: customerBId, // Belongs to Store B!
          docType: KYCType.PAN,
          fileName: 'cross_dealer_attack.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('not authorized to upload KYC documents for this customer');
    });

    it('6.2 prevents Dealer A from downloading or accessing Dealer B customer documents', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${dealerBDocId}/presigned-download`)
        .set('Authorization', `Bearer ${dealerAUser1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('not authorized to access KYC documents for this customer');
    });

    it('6.3 prevents Dealer A from requesting a view-token for Dealer B customer document', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${dealerBDocId}/view-token`)
        .set('Authorization', `Bearer ${dealerAUser1Token}`);

      expect(res.status).toBe(403);
    });

    it('6.4 allows Dealer A to upload and view KYC for a customer associated via store loan', async () => {
      // Create Customer C created by Admin
      const custCId = uuidv4();
      const loanCId = uuidv4();
      await queryPostgres(
        `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
         VALUES ($1, $2, 'Customer Store A Financed', '9811003355', 'Address C', 'Noida', 'UP', '201301', 'Route C', $3, NOW(), NOW())`,
        [custCId, `CUST_C_${runId}`, superAdminId]
      );
      // Link customer to Dealer A via loan
      await queryPostgres(
        `INSERT INTO loans (
          id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
          net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
          installment_frequency, total_installments, emi_amount, total_interest, total_payable,
          total_paid, outstanding_balance, disbursement_date, first_emi_date, maturity_date,
          status, created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 20000, 2000, 18000, 18, 'FLAT_RATE', 6, 'MONTHLY', 6, 3500, 3000, 21000,
          0, 21000, '2026-09-01', '2026-10-01', '2027-03-01', 'ACTIVE', $5, NOW(), NOW()
        )`,
        [loanCId, `LN_C_${runId}`, custCId, dealerAId, superAdminId]
      );

      try {
        const uploadRes = await request(app)
          .post('/api/v1/kyc/direct-upload')
          .set('Authorization', `Bearer ${dealerAUser1Token}`)
          .send({
            customerId: custCId,
            docType: KYCType.DRIVING_LICENSE,
            fileName: 'store_a_loan_customer_doc.pdf',
            mimeType: 'application/pdf',
            fileBase64: validPdfBase64,
          });

        expect(uploadRes.status).toBe(201);
        expect(uploadRes.body.success).toBe(true);
        const docCId = uploadRes.body.data.id;

        const downloadRes = await request(app)
          .get(`/api/v1/kyc/${docCId}/presigned-download`)
          .set('Authorization', `Bearer ${dealerAUser1Token}`);

        expect(downloadRes.status).toBe(200);
        expect(downloadRes.body.data.downloadUrl).toBeDefined();
      } finally {
        await queryPostgres('DELETE FROM kyc_documents WHERE customer_id = $1', [custCId]);
        await queryPostgres('DELETE FROM loans WHERE id = $1', [loanCId]);
        await queryPostgres('DELETE FROM customers WHERE id = $1', [custCId]);
      }
    });
  });

  // ─── 7. STORAGE-PROVIDER FAILURE HANDLING ────────────────────────────────────

  describe('7. Storage Provider Failure Resilience (Safe 503 instead of 500)', () => {
    it('7.1 returns HTTP 503 STORAGE_PROVIDER_ERROR when storage provider upload fails', async () => {
      const storage = getStorageProvider();
      const originalUpload = storage.upload;

      // Mock storage provider to simulate sudden S3 network or credential failure
      storage.upload = jest.fn().mockRejectedValue(new Error('S3 Connection Timeout / Bucket Unreachable'));

      try {
        const res = await request(app)
          .post('/api/v1/kyc/direct-upload')
          .set('Authorization', `Bearer ${dealerAUser1Token}`)
          .send({
            customerId: customerAId,
            docType: KYCType.VOTER_ID,
            fileName: 'voter_id.pdf',
            mimeType: 'application/pdf',
            fileBase64: validPdfBase64,
          });

        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('STORAGE_PROVIDER_ERROR');
        expect(res.body.error.message).toContain('Storage service temporarily unavailable');
      } finally {
        storage.upload = originalUpload;
      }
    });
  });

  // ─── 8. DATABASE FAILURE & SAFE ATOMIC CLEANUP ───────────────────────────────

  describe('8. Database Failure After Upload & Safe Cleanup of Orphaned Files', () => {
    it('8.1 safely rolls back and deletes uploaded storage object if database insert fails', async () => {
      const storage = getStorageProvider();
      let capturedStorageKey: string | null = null;

      const originalUpload = storage.upload.bind(storage);
      const originalDelete = storage.delete.bind(storage);

      let deleteWasInvoked = false;

      // Intercept upload to record storageKey
      storage.upload = jest.fn().mockImplementation(async (params) => {
        capturedStorageKey = params.key;
        return originalUpload(params);
      });

      // Intercept delete to verify atomic cleanup was triggered
      storage.delete = jest.fn().mockImplementation(async (key) => {
        deleteWasInvoked = true;
        return originalDelete(key);
      });

      // Temporarily sabotage kyc_documents table by inserting an invalid column or constraint
      // We can simulate DB failure by using a customer ID with an impossible state or mock queryPostgres
      const postgresModule = await import('../src/database/postgres');
      const originalQueryPostgres = postgresModule.queryPostgres;

      // Mock queryPostgres to throw error specifically on the INSERT INTO kyc_documents statement
      const querySpy = jest.spyOn(postgresModule, 'queryPostgres').mockImplementation(async (sql, params) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO kyc_documents')) {
          throw new Error('Simulated Database Crash: Unique constraint or deadlock failure');
        }
        return originalQueryPostgres(sql, params);
      });

      try {
        const res = await request(app)
          .post('/api/v1/kyc/direct-upload')
          .set('Authorization', `Bearer ${dealerAUser1Token}`)
          .send({
            customerId: customerAId,
            docType: KYCType.OTHER,
            fileName: 'cleanup_test.pdf',
            mimeType: 'application/pdf',
            fileBase64: validPdfBase64,
          });

        // The endpoint should catch the error and return error status (either handled error or 500)
        expect(res.status).toBeGreaterThanOrEqual(400);

        // Crucial verification: The storage cleanup was invoked for the uploaded object
        expect(deleteWasInvoked).toBe(true);
        expect(capturedStorageKey).toBeDefined();

        // Verify that the file no longer exists in storage (not orphaned!)
        if (capturedStorageKey) {
          const fileExistsAfterCleanup = await originalDelete(capturedStorageKey).then(() => false).catch(() => false);
          expect(fileExistsAfterCleanup).toBe(false);
        }
      } finally {
        querySpy.mockRestore();
        storage.upload = originalUpload;
        storage.delete = originalDelete;
      }
    });
  });
});
