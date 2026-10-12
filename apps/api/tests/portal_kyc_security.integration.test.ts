import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { getStorageProvider } from '../src/core/storage';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Customer Portal KYC Security and IDOR Protection Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const adminEmail = `admin_portal_${runId}@crmtest.com`;
  let adminId: string;
  let adminToken: string;
  let customerAId: string;
  let customerBId: string;
  let loanAId: string;
  let loanBId: string;
  let portalTokenA: string;
  let portalTokenB: string;
  let docAId: string;
  let docBId: string;
  let storageKeyA: string;
  let storageKeyB: string;

  beforeAll(async () => {
    // 1. Seed & login Super Admin
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Portal Admin User', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [adminId, adminEmail, `+9198${Date.now().toString().slice(-8)}`, hash]
    );

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'Password@123' });
    adminToken = loginRes.body.data.tokens.accessToken;

    // 2. Create Customer A & Loan A
    customerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by, created_at, updated_at
      ) VALUES ($1, $2, 'Portal Borrower Alice', '+919876541101', '10 A Street', 'Jaipur', 'Rajasthan', '302001', 'Route A', TRUE, $3, NOW(), NOW())`,
      [customerAId, `CUST-PA-${runId}`, adminId]
    );

    loanAId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 30000.00, 5000.00, 25000.00,
        14.00, 'FLAT_RATE', 6, 'MONTHLY',
        6, 4339.00, 1034.00, 26034.00, 0.00,
        26034.00, '2026-01-10', '2026-02-10', '2026-07-10',
        'ACTIVE', $4, NOW(), NOW()
      )`,
      [loanAId, `LN-PA-${runId}`, customerAId, adminId]
    );

    // Generate Portal Link for Customer A
    const linkARes = await request(app)
      .post(`/api/v1/portal/loans/${loanAId}/link`)
      .set('Authorization', `Bearer ${adminToken}`);
    portalTokenA = linkARes.body.data.token;

    // 3. Create Customer B & Loan B
    customerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by, created_at, updated_at
      ) VALUES ($1, $2, 'Portal Borrower Bob', '+919876541102', '20 B Street', 'Jaipur', 'Rajasthan', '302002', 'Route B', TRUE, $3, NOW(), NOW())`,
      [customerBId, `CUST-PB-${runId}`, adminId]
    );

    loanBId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 40000.00, 5000.00, 35000.00,
        14.00, 'FLAT_RATE', 6, 'MONTHLY',
        6, 6075.00, 1450.00, 36450.00, 0.00,
        36450.00, '2026-01-10', '2026-02-10', '2026-07-10',
        'ACTIVE', $4, NOW(), NOW()
      )`,
      [loanBId, `LN-PB-${runId}`, customerBId, adminId]
    );

    // Generate Portal Link for Customer B
    const linkBRes = await request(app)
      .post(`/api/v1/portal/loans/${loanBId}/link`)
      .set('Authorization', `Bearer ${adminToken}`);
    portalTokenB = linkBRes.body.data.token;

    // 4. Upload & create KYC doc for Customer A
    storageKeyA = `kyc/${customerAId}/${uuidv4()}.pdf`;
    const storage = getStorageProvider();
    await storage.upload({
      key: storageKeyA,
      body: Buffer.from('%PDF-1.4 Customer A Confidential Document'),
      mimeType: 'application/pdf',
    });
    const docAInsert = await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_at)
       VALUES ($1, $2, 'AADHAAR', 'XXXX-XXXX-1111', $3, 'application/pdf', 1024, 'VERIFIED', NOW())
       RETURNING id`,
      [uuidv4(), customerAId, storageKeyA]
    );
    docAId = docAInsert.rows[0].id;

    // 5. Upload & create KYC doc for Customer B
    storageKeyB = `kyc/${customerBId}/${uuidv4()}.pdf`;
    await storage.upload({
      key: storageKeyB,
      body: Buffer.from('%PDF-1.4 Customer B Confidential Document'),
      mimeType: 'application/pdf',
    });
    const docBInsert = await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_at)
       VALUES ($1, $2, 'PAN', 'XXXXX2222B', $3, 'application/pdf', 2048, 'VERIFIED', NOW())
       RETURNING id`,
      [uuidv4(), customerBId, storageKeyB]
    );
    docBId = docBInsert.rows[0].id;
  });

  afterAll(async () => {
    if (customerAId) {
      await queryPostgres('DELETE FROM kyc_documents WHERE customer_id = $1', [customerAId]);
      await queryPostgres('DELETE FROM customer_portal_tokens WHERE customer_id = $1', [customerAId]);
      await queryPostgres('DELETE FROM loans WHERE id = $1', [loanAId]);
      await queryPostgres('DELETE FROM customers WHERE id = $1', [customerAId]);
    }
    if (customerBId) {
      await queryPostgres('DELETE FROM kyc_documents WHERE customer_id = $1', [customerBId]);
      await queryPostgres('DELETE FROM customer_portal_tokens WHERE customer_id = $1', [customerBId]);
      await queryPostgres('DELETE FROM loans WHERE id = $1', [loanBId]);
      await queryPostgres('DELETE FROM customers WHERE id = $1', [customerBId]);
    }
  });

  describe('1. Customer Portal KYC Document Listing', () => {
    it('returns only borrower A own documents with sanitized metadata (no raw storage keys)', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/kyc?token=${portalTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);

      const doc = res.body.data[0];
      expect(doc.id).toBe(docAId);
      expect(doc.docType).toBe('AADHAAR');
      expect(doc.docNumberMasked).toBe('XXXX-XXXX-1111');
      expect(doc.status).toBe('VERIFIED');
      expect(doc.fileMimeType).toBe('application/pdf');

      // Crucial security invariant: raw storage keys and internal identifiers must NEVER be exposed
      expect(doc.storage_key).toBeUndefined();
      expect(doc.storageKey).toBeUndefined();
      expect(doc.bucket).toBeUndefined();
    });

    it('supports token via x-portal-token header as well', async () => {
      const res = await request(app)
        .get('/api/v1/portal/kyc')
        .set('x-portal-token', portalTokenA);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(docAId);
    });

    it('rejects listing request if portal token is missing', async () => {
      const res = await request(app).get('/api/v1/portal/kyc');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PORTAL_TOKEN_REQUIRED');
    });

    it('rejects listing request if portal token is invalid or forged', async () => {
      const res = await request(app).get('/api/v1/portal/kyc?token=cpt_invalid_token_123');
      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Invalid or expired portal link');
    });
  });

  describe('2. Customer Portal Document Download and Streaming', () => {
    it('allows Borrower A to obtain presigned download URL for own KYC document', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/kyc/${docAId}/presigned-download?token=${portalTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.documentId).toBe(docAId);
    });

    it('allows Borrower A to directly stream own KYC document with nosniff header', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/kyc/${docAId}/view?token=${portalTokenA}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toContain('inline');
    });
  });

  describe('3. Strict Anti-Tampering & IDOR Protection', () => {
    it('STRICTLY PREVENTS Borrower A from obtaining presigned download URL for Borrower B document', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/kyc/${docBId}/presigned-download?token=${portalTokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('KYC document not found or unauthorized');
    });

    it('STRICTLY PREVENTS Borrower A from streaming Borrower B document', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/kyc/${docBId}/view?token=${portalTokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('KYC document not found or unauthorized');
    });

    it('STRICTLY PREVENTS Borrower B from accessing Borrower A document', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/kyc/${docAId}/presigned-download?token=${portalTokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('KYC document not found or unauthorized');
    });
  });

  describe('4. Token Revocation and Lifecycle Enforcement', () => {
    it('blocks portal KYC access immediately when portal link is revoked', async () => {
      // Admin revokes link for Borrower A
      const revokeRes = await request(app)
        .post(`/api/v1/portal/loans/${loanAId}/revoke`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(revokeRes.status).toBe(200);

      // Now Borrower A's old token must be rejected
      const listRes = await request(app)
        .get(`/api/v1/portal/kyc?token=${portalTokenA}`);
      expect(listRes.status).toBe(401);
      expect(listRes.body.error.message).toContain('revoked');

      const downloadRes = await request(app)
        .get(`/api/v1/portal/kyc/${docAId}/presigned-download?token=${portalTokenA}`);
      expect(downloadRes.status).toBe(401);
    });
  });
});
