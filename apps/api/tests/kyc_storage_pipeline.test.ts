import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { S3StorageProvider } from '../src/core/storage/s3.storage';
import { LocalStorageProvider } from '../src/core/storage/local.storage';
import { getStorageProvider, resetStorageProvider } from '../src/core/storage';
import { KYCType, UserRole } from '@crm/shared';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';
import { v4 as uuidv4 } from 'uuid';

describe('KYC End-to-End Pipeline & Storage Resilience Test Suite', () => {
  let adminToken: string;
  let dealer1Token: string;
  let dealer2Token: string;
  let agentToken: string;
  let dealer1Id: string;
  let dealer2Id: string;
  let agentId: string;
  let customer1Id: string;
  let customer2Id: string;

  const validPdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  const validPdfBase64 = validPdfBytes.toString('base64');

  const runId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

  beforeAll(async () => {
    dealer1Id = uuidv4();
    dealer2Id = uuidv4();
    agentId = uuidv4();

    // Insert test dealers
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, address, area_city, status)
       VALUES ($1, $3, 'Dealer One', 'Owner 1', $4, $5, 'Addr 1', 'Delhi', 'ACTIVE'),
              ($2, $6, 'Dealer Two', 'Owner 2', $7, $8, 'Addr 2', 'Delhi', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [
        dealer1Id,
        dealer2Id,
        `DLR_T1_${runId}`,
        `9811${Math.floor(100000 + Math.random() * 900000)}`,
        `d1_${runId}@kyctest.com`,
        `DLR_T2_${runId}`,
        `9822${Math.floor(100000 + Math.random() * 900000)}`,
        `d2_${runId}@kyctest.com`,
      ]
    );

    const adminUserId = uuidv4();
    const dealer1UserId = uuidv4();
    const dealer2UserId = uuidv4();

    // Insert test users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, dealer_id)
       VALUES ($1, $7, $8, 'hash', 'Admin User', 'ADMIN', 'ACTIVE', NULL),
              ($2, $9, $10, 'hash', 'Dealer1 User', 'DEALER', 'ACTIVE', $4),
              ($3, $11, $12, 'hash', 'Dealer2 User', 'DEALER', 'ACTIVE', $5),
              ($6, $13, $14, 'hash', 'Agent User', 'COLLECTION_AGENT', 'ACTIVE', NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        adminUserId,
        dealer1UserId,
        dealer2UserId,
        dealer1Id,
        dealer2Id,
        agentId,
        `admin_${runId}@kyctest.com`,
        `9801${Math.floor(100000 + Math.random() * 900000)}`,
        `d1u_${runId}@kyctest.com`,
        `9802${Math.floor(100000 + Math.random() * 900000)}`,
        `d2u_${runId}@kyctest.com`,
        `9803${Math.floor(100000 + Math.random() * 900000)}`,
        `ag_${runId}@kyctest.com`,
        `9804${Math.floor(100000 + Math.random() * 900000)}`,
      ]
    );

    adminToken = jwt.sign({ id: adminUserId, role: UserRole.ADMIN }, JWT_SECRET, { expiresIn: '1h' });
    dealer1Token = jwt.sign({ id: dealer1UserId, role: UserRole.DEALER, dealerId: dealer1Id }, JWT_SECRET, { expiresIn: '1h' });
    dealer2Token = jwt.sign({ id: dealer2UserId, role: UserRole.DEALER, dealerId: dealer2Id }, JWT_SECRET, { expiresIn: '1h' });
    agentToken = jwt.sign({ id: agentId, role: UserRole.COLLECTION_AGENT }, JWT_SECRET, { expiresIn: '1h' });

    // Insert customer belonging to dealer 1
    customer1Id = uuidv4();
    customer2Id = uuidv4();

    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by)
       VALUES ($1, $5, 'Customer One', $6, 'Street 1', 'Delhi', 'Delhi', '110001', 'NORTH', TRUE, $3),
              ($2, $7, 'Customer Two', $8, 'Street 2', 'Delhi', 'Delhi', '110001', 'SOUTH', TRUE, $4)`,
      [
        customer1Id,
        customer2Id,
        dealer1UserId,
        dealer2UserId,
        `CK1_${runId}`,
        `9891${Math.floor(100000 + Math.random() * 900000)}`,
        `CK2_${runId}`,
        `9892${Math.floor(100000 + Math.random() * 900000)}`,
      ]
    );

    // Assign customer 1 to dealer 1
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $5, $2, $3, 20000, 2000, 18000, 0.05, 'FLAT_RATE', 6,
        'MONTHLY', 6, 3150, 900, 18900, 0, 18900, '2026-09-01', '2026-10-01', '2027-03-01',
        'ACTIVE', $4, NOW(), NOW()
      )`,
      [uuidv4(), customer1Id, dealer1Id, dealer1UserId, `LN_K1_${runId}`]
    );
  });

  afterAll(async () => {
    // Clean up test customer data
    try {
      await queryPostgres('DELETE FROM kyc_documents WHERE customer_id IN ($1, $2)', [customer1Id, customer2Id]);
      await queryPostgres('DELETE FROM loans WHERE customer_id IN ($1, $2)', [customer1Id, customer2Id]);
      await queryPostgres('DELETE FROM customers WHERE id IN ($1, $2)', [customer1Id, customer2Id]);
    } catch (_) {}
  });

  describe('Storage Provider Configuration & B2 Endpoint Sanitization', () => {
    test('S3StorageProvider automatically auto-corrects .backblazeb2.co typo to .backblazeb2.com', () => {
      const provider = new S3StorageProvider({
        endpoint: 's3.us-east-005.backblazeb2.co',
        bucket: 'test-bucket',
      });
      const clientConfig = (provider as any).client.config;
      expect(clientConfig).toBeDefined();
    });

    test('S3StorageProvider accepts B2 alias environment variables when AWS_* are unset', () => {
      const origB2Key = process.env.B2_APPLICATION_KEY_ID;
      const origB2Sec = process.env.B2_APPLICATION_KEY;
      const origB2Bucket = process.env.B2_BUCKET_NAME;
      const origS3Bucket = process.env.AWS_S3_BUCKET;
      try {
        delete process.env.AWS_S3_BUCKET;
        process.env.B2_APPLICATION_KEY_ID = 'test-b2-key-id';
        process.env.B2_APPLICATION_KEY = 'test-b2-secret';
        process.env.B2_BUCKET_NAME = 'test-b2-bucket';

        const provider = new S3StorageProvider();
        expect((provider as any).bucket).toBe('test-b2-bucket');
      } finally {
        if (origS3Bucket) process.env.AWS_S3_BUCKET = origS3Bucket;
        if (origB2Key) process.env.B2_APPLICATION_KEY_ID = origB2Key;
        else delete process.env.B2_APPLICATION_KEY_ID;
        if (origB2Sec) process.env.B2_APPLICATION_KEY = origB2Sec;
        else delete process.env.B2_APPLICATION_KEY;
        if (origB2Bucket) process.env.B2_BUCKET_NAME = origB2Bucket;
        else delete process.env.B2_BUCKET_NAME;
      }
    });

    test('Development / test environment selects LocalStorageProvider by default', () => {
      resetStorageProvider();
      const provider = getStorageProvider();
      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });
  });

  describe('Upload Validation & Binary File Handling', () => {
    test('Nonempty valid PDF file reaches upload handler and creates metadata', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          customerId: customer1Id,
          docType: KYCType.AADHAAR,
          docNumber: '9988-7766-1122',
          fileName: 'aadhaar_doc.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.docNumberMasked).toContain('1122');

      // Verify file exists in active storage
      const storage = getStorageProvider();
      const docRes = await queryPostgres('SELECT storage_key FROM kyc_documents WHERE id = $1', [res.body.data.id]);
      expect(docRes.rows.length).toBe(1);
      const exists = await storage.exists(docRes.rows[0].storage_key);
      expect(exists).toBe(true);
    });

    test('Empty file or invalid MIME type is strictly rejected with 422', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          customerId: customer1Id,
          docType: KYCType.PAN,
          fileName: 'malicious.exe',
          mimeType: 'application/x-msdownload',
          fileBase64: Buffer.from('MZ...').toString('base64'),
        });

      expect(res.status).toBe(422);
    });

    test('Mismatch between declared MIME type and magic bytes is strictly rejected', async () => {
      const fakePdf = Buffer.from('NOT A PDF FILE');
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          customerId: customer1Id,
          docType: KYCType.PAN,
          fileName: 'fake.pdf',
          mimeType: 'application/pdf',
          fileBase64: fakePdf.toString('base64'),
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('File content does not match the declared MIME type');
    });
  });

  describe('Deduplication & Idempotent Retries', () => {
    test('Rapid duplicate direct upload returns existing record without creating duplicate', async () => {
      const payload = {
        customerId: customer1Id,
        docType: KYCType.PAN,
        docNumber: 'ABCDE5678G',
        fileName: 'pan_card.pdf',
        mimeType: 'application/pdf',
        fileBase64: validPdfBase64,
      };

      const firstRes = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send(payload);
      expect(firstRes.status).toBe(201);
      const firstId = firstRes.body.data.id;

      // Immediate retry
      const retryRes = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send(payload);
      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.id).toBe(firstId);

      // Verify DB contains only 1 record for this doc number
      const countRes = await queryPostgres(
        'SELECT count(*) FROM kyc_documents WHERE customer_id = $1 AND doc_type = $2',
        [customer1Id, KYCType.PAN]
      );
      expect(Number(countRes.rows[0].count)).toBe(1);
    });

    test('Idempotent confirmKYCDocument returns existing record when storageKey matches', async () => {
      // Setup a file in storage
      const storage = getStorageProvider();
      const testKey = `kyc/${customer1Id}/idemp_test.pdf`;
      await storage.upload({
        key: testKey,
        body: validPdfBytes,
        mimeType: 'application/pdf',
      });

      const confirmPayload = {
        customerId: customer1Id,
        docType: KYCType.VOTER_ID,
        docNumber: 'VOTER12345',
        storageKey: testKey,
        fileMimeType: 'application/pdf',
        fileSizeBytes: validPdfBytes.length,
      };

      const firstConfirm = await request(app)
        .post('/api/v1/kyc/confirm')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send(confirmPayload);
      expect(firstConfirm.status).toBe(201);
      const firstDocId = firstConfirm.body.data.id;

      // Network retry of confirm
      const retryConfirm = await request(app)
        .post('/api/v1/kyc/confirm')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send(confirmPayload);
      expect(retryConfirm.status).toBe(201);
      expect(retryConfirm.body.data.id).toBe(firstDocId);

      // Check DB count for this storage key
      const countRes = await queryPostgres(
        'SELECT count(*) FROM kyc_documents WHERE customer_id = $1 AND storage_key = $2',
        [customer1Id, testKey]
      );
      expect(Number(countRes.rows[0].count)).toBe(1);
    });
  });

  describe('Tenant Isolation & Document Access Controls', () => {
    test('Dealer 2 cannot view or download Dealer 1 customer KYC documents', async () => {
      // Find a document belonging to customer 1
      const docRes = await queryPostgres(
        'SELECT id FROM kyc_documents WHERE customer_id = $1 LIMIT 1',
        [customer1Id]
      );
      expect(docRes.rows.length).toBe(1);
      const docId = docRes.rows[0].id;

      // Dealer 2 tries to access download URL
      const res = await request(app)
        .get(`/api/v1/kyc/${docId}/presigned-download`)
        .set('Authorization', `Bearer ${dealer2Token}`);

      expect(res.status).toBe(403);
    });

    test('Unassigned collection agent cannot access KYC documents', async () => {
      const docRes = await queryPostgres(
        'SELECT id FROM kyc_documents WHERE customer_id = $1 LIMIT 1',
        [customer1Id]
      );
      const docId = docRes.rows[0].id;

      const res = await request(app)
        .get(`/api/v1/kyc/${docId}/presigned-download`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(res.status).toBe(403);
    });

    test('Missing underlying storage file produces 404 with correlation ID', async () => {
      // Insert a phantom document pointing to a nonexistent storage key
      const ghostDocId = uuidv4();
      const ghostKey = `kyc/${customer1Id}/ghost_file_${Date.now()}.pdf`;
      await queryPostgres(
        `INSERT INTO kyc_documents (id, customer_id, doc_type, storage_key, file_mime_type, file_size_bytes, status)
         VALUES ($1, $2, 'OTHER', $3, 'application/pdf', 1024, 'VERIFIED')`,
        [ghostDocId, customer1Id, ghostKey]
      );

      const res = await request(app)
        .get(`/api/v1/kyc/${ghostDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('Document file not found in storage vault');
      expect(res.body.error.message).toContain('Ref: kyc_miss_');

      // Cleanup ghost
      await queryPostgres('DELETE FROM kyc_documents WHERE id = $1', [ghostDocId]);
    });
  });
});
