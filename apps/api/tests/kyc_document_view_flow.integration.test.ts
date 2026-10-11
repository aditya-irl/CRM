import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { getStorageProvider } from '../src/core/storage';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('KYC Document View Flow & Storage Access Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  // User identifiers & tokens
  let superAdminToken: string;
  let adminId: string, adminToken: string;
  let branchManagerToken: string;
  let dealerAUserId: string, dealerAToken: string;
  let dealerBUserId: string, dealerBToken: string;
  let assignedAgentId: string, assignedAgentToken: string;
  let unassignedAgentId: string, unassignedAgentToken: string;

  // Dealers
  let dealerAId: string, dealerBId: string;

  // Customers & Loans
  let customerAId: string, customerBId: string;
  let loanAId: string, loanBId: string;

  // KYC Documents
  let pdfDocId: string;
  let imageDocId: string;
  let dealerBDocId: string;
  let missingFileDocId: string;

  // Sample data buffers
  const samplePdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n'
  );
  const sampleJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Dealers
    dealerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Store A', 'Owner A', $3, $4, 'ACTIVE', 'Noida', 'Address A', NOW(), NOW())`,
      [dealerAId, `DLR_A_${runId}`, `9810${numId}1`, `dlr_a_${runId}@crm.test`]
    );

    dealerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Store B', 'Owner B', $3, $4, 'ACTIVE', 'Noida', 'Address B', NOW(), NOW())`,
      [dealerBId, `DLR_B_${runId}`, `9810${numId}2`, `dlr_b_${runId}@crm.test`]
    );

    // 2. Users
    const superAdminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [superAdminId, `sa_${runId}@crm.test`, `9820${numId}1`, hash]
    );

    adminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Admin', 'ADMIN', 'ACTIVE', NOW(), NOW())`,
      [adminId, `admin_${runId}@crm.test`, `9820${numId}2`, hash]
    );

    const branchManagerId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Branch Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())`,
      [branchManagerId, `bm_${runId}@crm.test`, `9820${numId}3`, hash]
    );

    dealerAUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User A', 'DEALER', $5, 'ACTIVE', NOW(), NOW())`,
      [dealerAUserId, `da_${runId}@crm.test`, `9820${numId}4`, hash, dealerAId]
    );

    dealerBUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User B', 'DEALER', $5, 'ACTIVE', NOW(), NOW())`,
      [dealerBUserId, `db_${runId}@crm.test`, `9820${numId}5`, hash, dealerBId]
    );

    assignedAgentId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Assigned Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())`,
      [assignedAgentId, `agent_assign_${runId}@crm.test`, `9820${numId}6`, hash]
    );

    unassignedAgentId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Unassigned Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())`,
      [unassignedAgentId, `agent_unassign_${runId}@crm.test`, `9820${numId}7`, hash]
    );

    // 3. Customers
    customerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Customer A', $3, '123 Market St', 'Noida', 'UP', '201301', 'Route A', $4, NOW(), NOW())`,
      [customerAId, `CUST_A_${runId}`, `9830${numId}1`, dealerAUserId]
    );

    customerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Customer B', $3, '456 Market St', 'Noida', 'UP', '201301', 'Route B', $4, NOW(), NOW())`,
      [customerBId, `CUST_B_${runId}`, `9830${numId}2`, dealerBUserId]
    );

    // 4. Loans (Loan A assigned to assignedAgentId; Loan B not assigned to assignedAgentId)
    loanAId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, assigned_agent_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 25000, 5000, 20000, 12.0, 'FLAT_RATE', 6,
        'MONTHLY', 6, 3500, 1000, 21000, 0, 21000,
        CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + INTERVAL '6 months', 'ACTIVE', $5, NOW(), NOW()
      )`,
      [loanAId, `LN_A_${runId}`, customerAId, dealerAId, assignedAgentId]
    );

    loanBId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, assigned_agent_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 35000, 5000, 30000, 12.0, 'FLAT_RATE', 6,
        'MONTHLY', 6, 5250, 1500, 31500, 0, 31500,
        CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + INTERVAL '6 months', 'ACTIVE', NULL, NOW(), NOW()
      )`,
      [loanBId, `LN_B_${runId}`, customerBId, dealerBId]
    );

    // 5. Store files into storage provider
    const storage = getStorageProvider();
    const pdfKey = `kyc/${customerAId}/${uuidv4()}.pdf`;
    const imageKey = `kyc/${customerAId}/${uuidv4()}.jpg`;
    const dealerBKey = `kyc/${customerBId}/${uuidv4()}.pdf`;
    const missingKey = `kyc/${customerAId}/nonexistent_file_${uuidv4()}.pdf`;

    await storage.upload({ key: pdfKey, body: samplePdfBuffer, mimeType: 'application/pdf' });
    await storage.upload({ key: imageKey, body: sampleJpegBuffer, mimeType: 'image/jpeg' });
    await storage.upload({ key: dealerBKey, body: samplePdfBuffer, mimeType: 'application/pdf' });

    // 6. Insert database records for KYC documents
    pdfDocId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, created_at)
       VALUES ($1, $2, 'AADHAAR', 'XXXX-XXXX-1111', $3, 'application/pdf', $4, 'VERIFIED', NOW())`,
      [pdfDocId, customerAId, pdfKey, samplePdfBuffer.length]
    );

    imageDocId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, created_at)
       VALUES ($1, $2, 'PAN', 'ABCDE1234F', $3, 'image/jpeg', $4, 'VERIFIED', NOW())`,
      [imageDocId, customerAId, imageKey, sampleJpegBuffer.length]
    );

    dealerBDocId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, created_at)
       VALUES ($1, $2, 'AADHAAR', 'XXXX-XXXX-2222', $3, 'application/pdf', $4, 'VERIFIED', NOW())`,
      [dealerBDocId, customerBId, dealerBKey, samplePdfBuffer.length]
    );

    missingFileDocId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, created_at)
       VALUES ($1, $2, 'VOTER_ID', 'VOT-9999', $3, 'application/pdf', 5000, 'PENDING', NOW())`,
      [missingFileDocId, customerAId, missingKey]
    );

    // 7. Obtain auth tokens
    const login = async (email: string) => {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password@123' });
      return res.body.data.tokens ? res.body.data.tokens.accessToken : res.body.data.accessToken;
    };

    superAdminToken = await login(`sa_${runId}@crm.test`);
    adminToken = await login(`admin_${runId}@crm.test`);
    branchManagerToken = await login(`bm_${runId}@crm.test`);
    dealerAToken = await login(`da_${runId}@crm.test`);
    dealerBToken = await login(`db_${runId}@crm.test`);
    assignedAgentToken = await login(`agent_assign_${runId}@crm.test`);
    unassignedAgentToken = await login(`agent_unassign_${runId}@crm.test`);
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  describe('Part 1: Authorized Document Viewing & Format Integrity', () => {
    it('1. Authorized admin can view an existing PDF document', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${pdfDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.fileMimeType).toBe('application/pdf');
      expect(res.body.data.docType).toBe('AADHAAR');
      expect(res.body.data.expiresInSeconds).toBeLessThanOrEqual(300);
    });

    it('2. Authorized admin can view an existing image document', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${imageDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.fileMimeType).toBe('image/jpeg');
      expect(res.body.data.docType).toBe('PAN');
    });

    it('3. Valid signed URL or authenticated streaming returns the correct file', async () => {
      // Test direct authenticated streaming endpoint
      const streamRes = await request(app)
        .get(`/api/v1/kyc/${pdfDocId}/view`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(streamRes.status).toBe(200);
      expect(streamRes.headers['content-type']).toContain('application/pdf');
      expect(streamRes.body).toBeDefined();
      expect(streamRes.body.length).toBeGreaterThan(0);
    });

    it('4. Authenticated streaming of an image returns the correct image content-type', async () => {
      const streamRes = await request(app)
        .get(`/api/v1/kyc/${imageDocId}/view`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(streamRes.status).toBe(200);
      expect(streamRes.headers['content-type']).toContain('image/jpeg');
      expect(streamRes.body).toBeDefined();
    });

    it('5. Signed URL requests can be refreshed to obtain fresh valid tokens', async () => {
      const res1 = await request(app)
        .get(`/api/v1/kyc/${pdfDocId}/presigned-download`)
        .set('Authorization', `Bearer ${branchManagerToken}`);

      expect(res1.status).toBe(200);
      expect(res1.body.data.downloadUrl).toBeDefined();

      // Second request (refreshing the token) succeeds immediately
      const res2 = await request(app)
        .get(`/api/v1/kyc/${pdfDocId}/presigned-download`)
        .set('Authorization', `Bearer ${branchManagerToken}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.downloadUrl).toBeDefined();
      expect(res2.body.data.expiresInSeconds).toBeLessThanOrEqual(300);
    });
  });

  describe('Part 2: Error Handling for Missing Documents & Objects', () => {
    it('6. Missing document record in DB returns a clear 404 response', async () => {
      const nonexistentDocId = uuidv4();
      const res = await request(app)
        .get(`/api/v1/kyc/${nonexistentDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      const errMsg = res.body.error?.message || res.body.message || '';
      expect(errMsg).toMatch(/KYC document not found/i);
    });

    it('7. Missing storage object returns clear 404 (does NOT fabricate broken URL)', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${missingFileDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      const errMsg = res.body.error?.message || res.body.message || '';
      expect(errMsg).toMatch(/Document file not found in storage vault/i);
    });

    it('8. Streaming a missing storage object safely returns 404', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${missingFileDocId}/view`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('Part 3: Multi-Tenant RBAC & RLAC Isolation', () => {
    it('9. Authorized Dealer can view documents for their own financed customer', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${pdfDocId}/presigned-download`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    it('10. Unauthorized Dealer CANNOT view another dealer customer document -> 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${dealerBDocId}/presigned-download`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
      const errMsg = res.body.error?.message || res.body.message || '';
      expect(errMsg).toMatch(/not authorized/i);
    });

    it('11. Collection Agent is blocked from raw KYC download -> 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${pdfDocId}/presigned-download`)
        .set('Authorization', `Bearer ${assignedAgentToken}`);

      expect(res.status).toBe(403);
      const errMsg = res.body.error?.message || res.body.message || '';
      expect(errMsg).toMatch(/requires one of the following roles/i);
    });

    it('12. Collection Agent is blocked from streaming KYC document -> 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${pdfDocId}/view`)
        .set('Authorization', `Bearer ${assignedAgentToken}`);

      expect(res.status).toBe(403);
    });

    it('13. Super Admin retains global document viewing access across all customers', async () => {
      const resA = await request(app)
        .get(`/api/v1/kyc/${pdfDocId}/presigned-download`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(resA.status).toBe(200);

      const resB = await request(app)
        .get(`/api/v1/kyc/${dealerBDocId}/presigned-download`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(resB.status).toBe(200);
    });
  });

  describe('Part 4: Security, Expiry, and Non-Exposure of Internal Keys', () => {
    it('14. Private KYC storage remains secure: Unauthenticated request returns 401', async () => {
      const res = await request(app).get(`/api/v1/kyc/${pdfDocId}/presigned-download`);
      expect(res.status).toBe(401);
    });

    it('15. Unauthenticated streaming endpoint returns 401', async () => {
      const res = await request(app).get(`/api/v1/kyc/${pdfDocId}/view`);
      expect(res.status).toBe(401);
    });

    it('16. Customer KYC document listing strips raw storage_key for dealers and agents', async () => {
      const agentListRes = await request(app)
        .get(`/api/v1/kyc/customer/${customerAId}`)
        .set('Authorization', `Bearer ${assignedAgentToken}`);

      expect(agentListRes.status).toBe(200);
      expect(agentListRes.body.data.length).toBeGreaterThan(0);
      for (const doc of agentListRes.body.data) {
        expect(doc.storageKey).toBeUndefined();
      }

      const dealerListRes = await request(app)
        .get(`/api/v1/kyc/customer/${customerAId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(dealerListRes.status).toBe(200);
      for (const doc of dealerListRes.body.data) {
        expect(doc.storageKey).toBeUndefined();
      }
    });
  });
});
