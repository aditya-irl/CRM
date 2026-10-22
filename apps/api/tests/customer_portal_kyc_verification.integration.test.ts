import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { getStorageProvider } from '../src/core/storage';
import { runPostgresMigrations } from '../src/database/migrate';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { CustomerVerificationStatus, VerificationSection, KYCType, KYCStatus } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Customer Portal KYC Self-Verification & Issue Reporting Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const adminEmail = `admin_kycverif_${runId}@crmtest.com`;

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
  let photoDocAId: string;

  beforeAll(async () => {
    // 0. Ensure database migrations are applied on test database
    await runPostgresMigrations();

    // 1. Create and login Admin
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'KYC Admin', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
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
        id, customer_code, full_name, primary_phone, alternate_phone, address_line1, address_line2, landmark,
        city, state, pincode, area_route, is_active, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, 'Aarav Sharma', '+919876543210', '+919876543211', 'Flat 402, Sunshine Towers', 'MG Road', 'Near City Mall',
        'Jaipur', 'Rajasthan', '302001', 'Route North', TRUE, $3, NOW(), NOW()
      )`,
      [customerAId, `CUST-A-${runId}`, adminId]
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
      [loanAId, `LN-A-${runId}`, customerAId, adminId]
    );

    const linkARes = await request(app)
      .post(`/api/v1/portal/loans/${loanAId}/link`)
      .set('Authorization', `Bearer ${adminToken}`);
    portalTokenA = linkARes.body.data.token;

    // 3. Create Customer B & Loan B
    customerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1,
        city, state, pincode, area_route, is_active, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, 'Bhavna Patel', '+919876549999', 'Plot 15, Green Valley',
        'Jaipur', 'Rajasthan', '302002', 'Route South', TRUE, $3, NOW(), NOW()
      )`,
      [customerBId, `CUST-B-${runId}`, adminId]
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
      [loanBId, `LN-B-${runId}`, customerBId, adminId]
    );

    const linkBRes = await request(app)
      .post(`/api/v1/portal/loans/${loanBId}/link`)
      .set('Authorization', `Bearer ${adminToken}`);
    portalTokenB = linkBRes.body.data.token;

    // 4. Seed documents for Customer A
    const storage = getStorageProvider();
    const fakePhotoKey = `test_photo_${runId}.jpg`;
    const fakeDocAKey = `test_aadhaar_${runId}.pdf`;
    const fakeDocBKey = `test_pan_${runId}.pdf`;

    await storage.upload({
      key: fakePhotoKey,
      body: Buffer.from('\xff\xd8\xff\xe0 fake-photo-image-content'),
      mimeType: 'image/jpeg',
    });
    await storage.upload({
      key: fakeDocAKey,
      body: Buffer.from('%PDF-1.4 fake-aadhaar-pdf-content'),
      mimeType: 'application/pdf',
    });
    await storage.upload({
      key: fakeDocBKey,
      body: Buffer.from('%PDF-1.4 fake-pan-pdf-content'),
      mimeType: 'application/pdf',
    });

    photoDocAId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (
        id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, created_at
      ) VALUES ($1, $2, 'PHOTO', NULL, $3, 'image/jpeg', 24, 'VERIFIED', NOW())`,
      [photoDocAId, customerAId, fakePhotoKey]
    );

    docAId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (
        id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, created_at
      ) VALUES ($1, $2, 'AADHAAR', 'XXXXXXXX3456', $3, 'application/pdf', 26, 'VERIFIED', NOW())`,
      [docAId, customerAId, fakeDocAKey]
    );

    // Seed document for Customer B
    docBId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (
        id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, created_at
      ) VALUES ($1, $2, 'PAN', 'XXXXX9876X', $3, 'application/pdf', 22, 'PENDING', NOW())`,
      [docBId, customerBId, fakeDocBKey]
    );
  });

  describe('1. Profile Retrieval & Anti-IDOR Security', () => {
    it('allows a customer to view their own profile and masked details', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/profile?token=${portalTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const profile = res.body.data;
      expect(profile.customerId).toBe(customerAId);
      expect(profile.fullName).toBe('Aarav Sharma');
      // Phones must be masked
      expect(profile.primaryPhone).toMatch(/^XXXXXX\d{4}$/);
      expect(profile.alternatePhone).toMatch(/^XXXXXX\d{4}$/);
      // Missing fields returned as null per requirements
      expect(profile.dob).toBeNull();
      expect(profile.gender).toBeNull();
      expect(profile.email).toBeNull();
      // Address fields
      expect(profile.addressLine1).toBe('Flat 402, Sunshine Towers');
      expect(profile.city).toBe('Jaipur');
      expect(profile.pincode).toBe('302001');
      // Photograph
      expect(profile.hasPhoto).toBe(true);
      expect(profile.photoUrl).toContain('/api/v1/portal/photo');
      // KYC Documents (only Customer A's own docs)
      expect(profile.kycDocuments.length).toBeGreaterThanOrEqual(1);
      const docIds = profile.kycDocuments.map((d: any) => d.id);
      expect(docIds).toContain(docAId);
      expect(docIds).not.toContain(docBId);
      // Default verification status
      expect(profile.verificationStatus).toBe(CustomerVerificationStatus.NOT_REVIEWED);
    });

    it('rejects unauthenticated requests without a token', async () => {
      const res = await request(app).get('/api/v1/portal/profile');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PORTAL_TOKEN_REQUIRED');
    });

    it('rejects invalid or tampered tokens', async () => {
      const res = await request(app).get('/api/v1/portal/profile?token=cpt_invalidfaketoken123456');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('prevents IDOR: Customer B cannot access Customer A profile via Customer B token', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/profile?token=${portalTokenB}`);

      expect(res.status).toBe(200);
      const profile = res.body.data;
      expect(profile.customerId).toBe(customerBId);
      expect(profile.fullName).toBe('Bhavna Patel');
      expect(profile.customerId).not.toBe(customerAId);

      const docIds = profile.kycDocuments.map((d: any) => d.id);
      expect(docIds).toContain(docBId);
      expect(docIds).not.toContain(docAId);
    });
  });

  describe('2. Photograph Streaming & Privacy Safeguards', () => {
    it('safely streams customer photograph with security headers', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/photo?token=${portalTokenA}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toContain('inline');
    });

    it('returns 404 for customer photograph when none exists', async () => {
      // Customer B has no photo
      const res = await request(app)
        .get(`/api/v1/portal/photo?token=${portalTokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Customer Self-Verification Confirmation', () => {
    it('records customer confirmation without altering official KYC document records', async () => {
      // 1. Confirm profile details
      const confirmRes = await request(app)
        .post(`/api/v1/portal/verify/confirm?token=${portalTokenA}`)
        .send({ section: VerificationSection.ALL, customerId: customerBId }); // Attempting IDOR spoof

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.data.status).toBe(CustomerVerificationStatus.CONFIRMED);
      expect(confirmRes.body.data.confirmedAt).toBeDefined();

      // 2. Verify Customer A profile reflects CONFIRMED status
      const profileRes = await request(app)
        .get(`/api/v1/portal/profile?token=${portalTokenA}`);
      expect(profileRes.body.data.verificationStatus).toBe(CustomerVerificationStatus.CONFIRMED);

      // 3. Verify Customer B was untouched by the spoofed customerId in payload
      const profileBRes = await request(app)
        .get(`/api/v1/portal/profile?token=${portalTokenB}`);
      expect(profileBRes.body.data.verificationStatus).toBe(CustomerVerificationStatus.NOT_REVIEWED);

      // 4. Verify official KYC records were NOT altered or auto-approved
      const docBInDb = await queryPostgres('SELECT status FROM kyc_documents WHERE id = $1', [docBId]);
      expect(docBInDb.rows[0].status).toBe(KYCStatus.PENDING);
    });

    it('handles idempotent repeated confirmations gracefully', async () => {
      const res = await request(app)
        .post(`/api/v1/portal/verify/confirm?token=${portalTokenA}`)
        .send({ section: VerificationSection.ALL });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(CustomerVerificationStatus.CONFIRMED);
    });
  });

  describe('4. Issue Reporting & Correction Requests', () => {
    it('validates explanation length and required fields', async () => {
      // Too short
      const shortRes = await request(app)
        .post(`/api/v1/portal/verify/report-issue?token=${portalTokenA}`)
        .send({ section: VerificationSection.ADDRESS, explanation: 'Hi' });

      expect(shortRes.status).toBe(422);
      expect(shortRes.body.success).toBe(false);

      // Invalid section
      const invSectionRes = await request(app)
        .post(`/api/v1/portal/verify/report-issue?token=${portalTokenA}`)
        .send({ section: 'INVALID_SECTION', explanation: 'My address has changed to Flat 501' });

      expect(invSectionRes.status).toBe(422);
      expect(invSectionRes.body.success).toBe(false);
    });

    it('successfully persists a correction request and updates customer verification status', async () => {
      const reportRes = await request(app)
        .post(`/api/v1/portal/verify/report-issue?token=${portalTokenA}`)
        .send({
          section: VerificationSection.ADDRESS,
          explanation: 'My apartment number is 403, not 402. Please correct.',
        });

      expect(reportRes.status).toBe(201);
      expect(reportRes.body.success).toBe(true);
      expect(reportRes.body.data.status).toBe(CustomerVerificationStatus.CORRECTION_REQUESTED);

      // Verify in Customer A profile
      const profileRes = await request(app)
        .get(`/api/v1/portal/profile?token=${portalTokenA}`);
      expect(profileRes.body.data.verificationStatus).toBe(CustomerVerificationStatus.CORRECTION_REQUESTED);
      expect(profileRes.body.data.correctionRequests.length).toBeGreaterThanOrEqual(1);

      const recentReport = profileRes.body.data.correctionRequests.find(
        (r: any) => r.section === VerificationSection.ADDRESS
      );
      expect(recentReport).toBeDefined();
      expect(recentReport.explanation).toBe('My apartment number is 403, not 402. Please correct.');
      expect(recentReport.status).toBe('PENDING');
    });

    it('prevents rapid duplicate correction requests for the same section', async () => {
      const dupRes = await request(app)
        .post(`/api/v1/portal/verify/report-issue?token=${portalTokenA}`)
        .send({
          section: VerificationSection.ADDRESS,
          explanation: 'Another duplicate report for the same address section.',
        });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.success).toBe(false);
      expect(dupRes.body.error.code).toBe('DUPLICATE_CORRECTION_REQUEST');
    });
  });

  describe('5. Staff Workflow and RBAC Enforcement', () => {
    let requestId: string;

    beforeAll(async () => {
      const list = await queryPostgres(
        `SELECT id FROM customer_kyc_correction_requests WHERE customer_id = $1 AND request_type = 'CORRECTION_REQUEST' LIMIT 1`,
        [customerAId]
      );
      requestId = list.rows[0]?.id;
    });

    it('allows authorized staff to list and view correction requests', async () => {
      const res = await request(app)
        .get('/api/v1/portal/verification-requests')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requests.length).toBeGreaterThanOrEqual(1);

      const target = res.body.data.requests.find((r: any) => r.id === requestId);
      expect(target).toBeDefined();
      expect(target.customerName).toBe('Aarav Sharma');
      expect(target.section).toBe(VerificationSection.ADDRESS);
      // Raw unmasked phone must not be exposed in staff list
      expect(target.customerPhone).toMatch(/^XXXXXX\d{4}$/);
    });

    it('allows staff to view customer verifications by customerId', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/customers/${customerAId}/verifications`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verification.status).toBe(CustomerVerificationStatus.CORRECTION_REQUESTED);
      expect(res.body.data.requests.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects unauthenticated staff access', async () => {
      const res = await request(app).get('/api/v1/portal/verification-requests');
      expect(res.status).toBe(401);
    });

    it('allows staff to mark request UNDER_REVIEW', async () => {
      const res = await request(app)
        .patch(`/api/v1/portal/verification-requests/${requestId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'UNDER_REVIEW', resolutionNotes: 'Checking physical rental agreement' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('UNDER_REVIEW');
      expect(res.body.data.customerVerificationStatus).toBe(CustomerVerificationStatus.UNDER_REVIEW);
    });

    it('allows staff to mark request RESOLVED with resolution notes', async () => {
      const res = await request(app)
        .patch(`/api/v1/portal/verification-requests/${requestId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'RESOLVED', resolutionNotes: 'Address verified and updated in primary records' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('RESOLVED');
      expect(res.body.data.customerVerificationStatus).toBe(CustomerVerificationStatus.RESOLVED);

      // Verify customer portal reflects resolution
      const profileRes = await request(app)
        .get(`/api/v1/portal/profile?token=${portalTokenA}`);
      expect(profileRes.body.data.verificationStatus).toBe(CustomerVerificationStatus.RESOLVED);

      const resolvedReport = profileRes.body.data.correctionRequests.find((r: any) => r.id === requestId);
      expect(resolvedReport.status).toBe('RESOLVED');
      expect(resolvedReport.resolutionNotes).toBe('Address verified and updated in primary records');
      expect(resolvedReport.reviewedByName).toBe('KYC Admin');
    });
  });
});
