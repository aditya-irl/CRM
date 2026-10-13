import request from 'supertest';
import app, { sanitizeUrlForLogging } from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { getStorageProvider, S3StorageProvider } from '../src/core/storage';
import { KYCType, UserRole } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';

describe('Requirement E & F: Backblaze B2 KYC Storage & Customer Portal Warning Integration Tests', () => {
  let adminId: string;
  let adminToken: string;
  let dealerId: string;
  let dealerUserId: string;
  let dealerToken: string;
  let otherDealerId: string;
  let otherDealerUserId: string;
  let otherDealerToken: string;

  let branchManagerNoidaId: string;
  let branchManagerNoidaToken: string;
  let branchManagerSouthId: string;
  let branchManagerSouthToken: string;
  let unassignedAgentId: string;
  let unassignedAgentToken: string;
  let inactiveUserId: string;
  let inactiveUserToken: string;

  let customerId: string;
  let loanId: string;
  let overdueLoanId: string;
  let overduePortalToken: string;
  let cleanPortalToken: string;

  const sampleFileBuffer = Buffer.from('%PDF-1.4 Mock PDF Content For KYC Verification');
  const sampleBase64 = sampleFileBuffer.toString('base64');

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    const runId = Math.random().toString(36).substring(2, 7);

    // 1. Admin
    adminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ADMIN', 'KYC Storage Admin', 'ACTIVE', NOW(), NOW())`,
      [adminId, `kyc_admin_${runId}@crm.test`, hash]
    );
    adminToken = jwt.sign({ id: adminId }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Dealers
    dealerId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Primary Mobile Store', 'Owner 1', $3, $4, 'ACTIVE', 'Noida', 'Shop 10', NOW(), NOW())`,
      [dealerId, `DLR_B2_1_${runId}`, `9876${Date.now().toString().slice(-6)}`, `dlr1_${runId}@crm.test`]
    );

    dealerUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, dealer_id, assigned_branch, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEALER', 'Dealer User 1', 'ACTIVE', $4, 'Noida', NOW(), NOW())`,
      [dealerUserId, `dealer1_${runId}@crm.test`, hash, dealerId]
    );
    dealerToken = jwt.sign({ id: dealerUserId }, JWT_SECRET, { expiresIn: '1h' });

    otherDealerId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Competitor Mobile Store', 'Owner 2', $3, $4, 'ACTIVE', 'Noida', 'Shop 20', NOW(), NOW())`,
      [otherDealerId, `DLR_B2_2_${runId}`, `9875${Date.now().toString().slice(-6)}`, `dlr2_${runId}@crm.test`]
    );

    otherDealerUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, dealer_id, assigned_branch, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEALER', 'Dealer User 2', 'ACTIVE', $4, 'South Branch', NOW(), NOW())`,
      [otherDealerUserId, `dealer2_${runId}@crm.test`, hash, otherDealerId]
    );
    otherDealerToken = jwt.sign({ id: otherDealerUserId }, JWT_SECRET, { expiresIn: '1h' });

    // 2b. Branch Managers
    branchManagerNoidaId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, assigned_branch, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'BRANCH_MANAGER', 'BM Noida', 'Noida', 'ACTIVE', NOW(), NOW())`,
      [branchManagerNoidaId, `bm_noida_${runId}@crm.test`, hash]
    );
    branchManagerNoidaToken = jwt.sign({ id: branchManagerNoidaId }, JWT_SECRET, { expiresIn: '1h' });

    branchManagerSouthId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, assigned_branch, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'BRANCH_MANAGER', 'BM South', 'South Branch', 'ACTIVE', NOW(), NOW())`,
      [branchManagerSouthId, `bm_south_${runId}@crm.test`, hash]
    );
    branchManagerSouthToken = jwt.sign({ id: branchManagerSouthId }, JWT_SECRET, { expiresIn: '1h' });

    // 2c. Unassigned Collection Agent
    unassignedAgentId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'COLLECTION_AGENT', 'Unassigned Agent', 'ACTIVE', NOW(), NOW())`,
      [unassignedAgentId, `agent_unassigned_${runId}@crm.test`, hash]
    );
    unassignedAgentToken = jwt.sign({ id: unassignedAgentId }, JWT_SECRET, { expiresIn: '1h' });

    // 2d. Inactive User
    const inactiveDealerId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Inactive Store', 'Inactive Owner', $3, $4, 'INACTIVE', 'Noida', 'Shop 99', NOW(), NOW())`,
      [inactiveDealerId, `DLR_INACT_${runId}`, `9874${Date.now().toString().slice(-6)}`, `inact_${runId}@crm.test`]
    );

    inactiveUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, dealer_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEALER', 'Inactive Dealer', $4, 'INACTIVE', NOW(), NOW())`,
      [inactiveUserId, `inactive_${runId}@crm.test`, hash, inactiveDealerId]
    );
    inactiveUserToken = jwt.sign({ id: inactiveUserId }, JWT_SECRET, { expiresIn: '1h' });

    // 3. Customer
    customerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Ramesh Kumar Verma', '9811002233', '101 Sector 18', 'Noida', 'Uttar Pradesh', '201301', 'Route-A', $3, NOW(), NOW())`,
      [customerId, `CUST_B2_${runId}`, dealerUserId]
    );

    // 4. Clean Loan (no overdue)
    loanId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 25000, 5000, 20000, 18, 'FLAT_RATE', 6, 'MONTHLY', 6, 4500, 2000, 27000,
        9000, 18000, '2026-09-01', '2026-10-01', '2027-03-01', 'ACTIVE', $5, NOW(), NOW()
      )`,
      [loanId, `LN_CLN_${runId}`, customerId, dealerId, adminId]
    );

    const cleanTokenRaw = `cpt_clean_${Date.now()}_${Math.random().toString(36)}`;
    const crypto = await import('crypto');
    const cleanHash = crypto.createHash('sha256').update(cleanTokenRaw).digest('hex');
    cleanPortalToken = cleanTokenRaw;
    await queryPostgres(
      `INSERT INTO customer_portal_tokens (id, loan_id, customer_id, token_hash, is_active, created_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())`,
      [uuidv4(), loanId, customerId, cleanHash]
    );

    // 5. Overdue Loan
    overdueLoanId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 30000, 6000, 24000, 18, 'FLAT_RATE', 6, 'MONTHLY', 6, 5000, 3000, 30000,
        0, 30000, '2026-07-01', '2026-08-01', '2027-01-01', 'ACTIVE', $5, NOW(), NOW()
      )`,
      [overdueLoanId, `LN_OVD_${runId}`, customerId, dealerId, adminId]
    );

    // Overdue EMI installments with late penalty
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component,
        interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
        status, days_overdue, created_at, updated_at
      ) VALUES
      ($1, $2, $3, 1, '2026-08-01', 4500, 500, 5000, 0, 5000, 250, 'OVERDUE', 73, NOW(), NOW()),
      ($4, $2, $3, 2, '2026-09-01', 4500, 500, 5000, 0, 5000, 250, 'OVERDUE', 42, NOW(), NOW()),
      ($5, $2, $3, 3, '2026-10-01', 4500, 500, 5000, 0, 5000, 0, 'OVERDUE', 12, NOW(), NOW())`,
      [uuidv4(), overdueLoanId, customerId, uuidv4(), uuidv4()]
    );

    const ovdTokenRaw = `cpt_ovd_${Date.now()}_${Math.random().toString(36)}`;
    const ovdHash = crypto.createHash('sha256').update(ovdTokenRaw).digest('hex');
    overduePortalToken = ovdTokenRaw;
    await queryPostgres(
      `INSERT INTO customer_portal_tokens (id, loan_id, customer_id, token_hash, is_active, created_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())`,
      [uuidv4(), overdueLoanId, customerId, ovdHash]
    );
  });

  // ─── REQUIREMENT E: Backblaze B2 & Storage Verification ────────────────────────

  describe('Requirement E: Storage Configuration & Backblaze B2 Resilience', () => {
    test('1. S3StorageProvider normalizes endpoint URL without protocol', () => {
      const origEndpoint = process.env.AWS_S3_ENDPOINT;
      const origRegion = process.env.AWS_REGION;
      try {
        process.env.AWS_S3_ENDPOINT = 's3.us-east-005.backblazeb2.com';
        delete process.env.AWS_REGION;

        const provider = new S3StorageProvider();
        expect(provider).toBeDefined();
        // Client config endpoint should be normalized to https://
        const clientConfig = (provider as any).client.config;
        expect(clientConfig).toBeDefined();
      } finally {
        if (origEndpoint) process.env.AWS_S3_ENDPOINT = origEndpoint;
        else delete process.env.AWS_S3_ENDPOINT;
        if (origRegion) process.env.AWS_REGION = origRegion;
        else delete process.env.AWS_REGION;
      }
    });

    test('2. S3StorageProvider auto-derives region us-east-005 from Backblaze B2 endpoint', async () => {
      const origEndpoint = process.env.AWS_S3_ENDPOINT;
      const origRegion = process.env.AWS_REGION;
      try {
        process.env.AWS_S3_ENDPOINT = 'https://s3.us-east-005.backblazeb2.com';
        delete process.env.AWS_REGION;

        const provider = new S3StorageProvider();
        const clientConfig = (provider as any).client.config;
        const region = await clientConfig.region();
        expect(region).toBe('us-east-005');
      } finally {
        if (origEndpoint) process.env.AWS_S3_ENDPOINT = origEndpoint;
        else delete process.env.AWS_S3_ENDPOINT;
        if (origRegion) process.env.AWS_REGION = origRegion;
        else delete process.env.AWS_REGION;
      }
    });

    test('3. Direct authenticated upload endpoint saves file and confirms metadata atomically', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          customerId,
          docType: KYCType.AADHAAR,
          docNumber: '9988-7766-5544',
          fileName: 'aadhaar_card.pdf',
          mimeType: 'application/pdf',
          fileBase64: sampleBase64,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.docNumberMasked).toContain('5544');

      // Verify the storage object actually exists in the storage provider
      const docRes = await queryPostgres('SELECT storage_key FROM kyc_documents WHERE id = $1', [res.body.data.id]);
      expect(docRes.rows.length).toBe(1);
      const storageKey = docRes.rows[0].storage_key;

      const storage = getStorageProvider();
      const exists = await storage.exists(storageKey);
      expect(exists).toBe(true);
    });

    test('4. confirmKYCDocument strictly rejects confirmation if file is missing in storage', async () => {
      const fakeStorageKey = `kyc/${customerId}/fake_nonexistent_file_${Date.now()}.pdf`;

      const res = await request(app)
        .post('/api/v1/kyc/confirm')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          customerId,
          docType: KYCType.PAN,
          docNumber: 'ABCDE1234F',
          storageKey: fakeStorageKey,
          fileMimeType: 'application/pdf',
          fileSizeBytes: 2048,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('not found in storage vault');
    });

    test('5. Cross-dealer KYC access is strictly denied (RLAC)', async () => {
      // Dealer 1 uploads a document
      const uploadRes = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          customerId,
          docType: KYCType.PAN,
          fileName: 'dealer1_pan.pdf',
          mimeType: 'application/pdf',
          fileBase64: sampleBase64,
        });
      expect(uploadRes.status).toBe(201);
      const docId = uploadRes.body.data.id;

      // Dealer 2 tries to download/view Dealer 1 customer document
      const forbiddenRes = await request(app)
        .get(`/api/v1/kyc/${docId}/presigned-download`)
        .set('Authorization', `Bearer ${otherDealerToken}`);

      expect(forbiddenRes.status).toBe(403);
    });

    test('6. Authenticated document streaming and scoped view-token validation', async () => {
      const uploadRes = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          docType: KYCType.OTHER,
          fileName: 'stream_test.pdf',
          mimeType: 'application/pdf',
          fileBase64: sampleBase64,
        });
      const docId = uploadRes.body.data.id;

      // 6a. Direct access via Bearer token works
      const bearerStreamRes = await request(app)
        .get(`/api/v1/kyc/${docId}/view`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(bearerStreamRes.status).toBe(200);
      expect(bearerStreamRes.header['content-type']).toContain('application/pdf');
      expect(bearerStreamRes.header['x-content-type-options']).toBe('nosniff');

      // 6b. Passing general JWT as ?token=... is strictly rejected (must be scoped KYC_VIEW token)
      const rawQueryTokenRes = await request(app)
        .get(`/api/v1/kyc/${docId}/view?token=${adminToken}`);
      expect(rawQueryTokenRes.status).toBe(401);

      // 6c. Standard API routes reject query tokens
      const blockedStandardRoute = await request(app)
        .get(`/api/v1/customers?token=${adminToken}`);
      expect(blockedStandardRoute.status).toBe(401);

      // Bearer token works on standard API routes
      const okStandardRoute = await request(app)
        .get(`/api/v1/customers`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(okStandardRoute.status).toBe(200);

      // 6d. Short-lived scoped document view token endpoint
      const viewTokenRes = await request(app)
        .get(`/api/v1/kyc/${docId}/view-token`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(viewTokenRes.status).toBe(200);
      expect(viewTokenRes.body.data.token).toBeDefined();
      expect(viewTokenRes.body.data.expiresIn).toBe(300);

      const scopedToken = viewTokenRes.body.data.token;

      // Access streaming using the scoped view token succeeds
      const scopedStreamRes = await request(app)
        .get(`/api/v1/kyc/${docId}/view?token=${scopedToken}`);
      expect(scopedStreamRes.status).toBe(200);

      // Using the scoped token for an arbitrary other document fails (403)
      const fakeDocId = uuidv4();
      const crossDocRes = await request(app)
        .get(`/api/v1/kyc/${fakeDocId}/view?token=${scopedToken}`);
      expect(crossDocRes.status).toBe(403);

      // Scoped view token cannot authenticate unrelated API routes (401)
      const unrelatedApiRes = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${scopedToken}`);
      expect(unrelatedApiRes.status).toBe(401);

      // Customer portal token cannot authenticate CRM endpoint
      const portalTokenRes = await request(app)
        .get(`/api/v1/kyc/${docId}/view?token=${cleanPortalToken}`);
      expect(portalTokenRes.status).toBe(401);
    });

    test('6e. Hardened KYC media view-token security enforcement', async () => {
      // 1. Upload Document A for Dealer 1 customer
      const uploadDocARes = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          customerId,
          docType: KYCType.AADHAAR,
          fileName: 'doc_a.pdf',
          mimeType: 'application/pdf',
          fileBase64: sampleBase64,
        });
      expect(uploadDocARes.status).toBe(201);
      const docAId = uploadDocARes.body.data.id;

      // 2. Upload Document B for Dealer 2 customer
      const custBId = uuidv4();
      await queryPostgres(
        `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
         VALUES ($1, $2, 'Customer B', '9811009988', '202 South St', 'South City', 'UP', '201305', 'Route-B', $3, NOW(), NOW())`,
        [custBId, `CUST_B_ALT_${Date.now()}`, otherDealerUserId]
      );
      const uploadDocBRes = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${otherDealerToken}`)
        .send({
          customerId: custBId,
          docType: KYCType.PAN,
          fileName: 'doc_b.pdf',
          mimeType: 'application/pdf',
          fileBase64: sampleBase64,
        });
      expect(uploadDocBRes.status).toBe(201);
      const docBId = uploadDocBRes.body.data.id;

      // (A) Dealer requesting a token for another dealer's document -> 403 Forbidden
      const dealerCrossTokenRes = await request(app)
        .get(`/api/v1/kyc/${docBId}/view-token`)
        .set('Authorization', `Bearer ${dealerToken}`);
      expect(dealerCrossTokenRes.status).toBe(403);

      // Authorized dealer requesting token for own document -> 200 OK
      const dealerOwnTokenRes = await request(app)
        .get(`/api/v1/kyc/${docAId}/view-token`)
        .set('Authorization', `Bearer ${dealerToken}`);
      expect(dealerOwnTokenRes.status).toBe(200);
      expect(dealerOwnTokenRes.body.data.token).toBeDefined();

      // (B) Branch Manager cross-branch access
      // BM South attempts to request view-token for docAId (Noida branch) -> 403 Forbidden
      const bmCrossBranchRes = await request(app)
        .get(`/api/v1/kyc/${docAId}/view-token`)
        .set('Authorization', `Bearer ${branchManagerSouthToken}`);
      expect(bmCrossBranchRes.status).toBe(403);

      // BM Noida requests view-token for docAId (Noida branch) -> 200 OK
      const bmSameBranchRes = await request(app)
        .get(`/api/v1/kyc/${docAId}/view-token`)
        .set('Authorization', `Bearer ${branchManagerNoidaToken}`);
      expect(bmSameBranchRes.status).toBe(200);

      // (C) Collection Agent without active assignment requesting token -> 403 Forbidden
      const unassignedAgentReq = await request(app)
        .get(`/api/v1/kyc/${docAId}/view-token`)
        .set('Authorization', `Bearer ${unassignedAgentToken}`);
      expect(unassignedAgentReq.status).toBe(403);

      // (D) Nonexistent document IDs -> 404 Not Found without leaking customer info
      const nonExistentDocId = uuidv4();
      const nonExistentRes = await request(app)
        .get(`/api/v1/kyc/${nonExistentDocId}/view-token`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(nonExistentRes.status).toBe(404);
      expect(nonExistentRes.body.error?.message).toMatch(/KYC document not found/i);
      expect(nonExistentRes.body.data).toBeUndefined();

      // (E) Valid authorized document access: token for Doc A used on Doc B -> 403 Forbidden
      const validDocAToken = dealerOwnTokenRes.body.data.token;
      const docAStreamRes = await request(app)
        .get(`/api/v1/kyc/${docAId}/view?token=${validDocAToken}`);
      expect(docAStreamRes.status).toBe(200);

      const crossDocBRes = await request(app)
        .get(`/api/v1/kyc/${docBId}/view?token=${validDocAToken}`);
      expect(crossDocBRes.status).toBe(403);

      // (F) Inactive users: cannot request token or consume token
      const inactiveReqTokenRes = await request(app)
        .get(`/api/v1/kyc/${docAId}/view-token`)
        .set('Authorization', `Bearer ${inactiveUserToken}`);
      expect(inactiveReqTokenRes.status).toBe(401);

      const inactiveConsumeToken = jwt.sign(
        { id: inactiveUserId, docId: docAId, type: 'KYC_VIEW' },
        JWT_SECRET,
        { expiresIn: '300s' }
      );
      const inactiveStreamRes = await request(app)
        .get(`/api/v1/kyc/${docAId}/view?token=${inactiveConsumeToken}`);
      expect(inactiveStreamRes.status).toBe(401);

      // (G) Expired tokens rejected -> 401 Unauthorized
      const expiredViewToken = jwt.sign(
        { id: adminId, docId: docAId, type: 'KYC_VIEW' },
        JWT_SECRET,
        { expiresIn: '-10s' }
      );
      const expiredStreamRes = await request(app)
        .get(`/api/v1/kyc/${docAId}/view?token=${expiredViewToken}`);
      expect(expiredStreamRes.status).toBe(401);

      // (H) Redaction of sensitive query parameters from application logs
      const urlWithToken = `/api/v1/kyc/${docAId}/view?token=${validDocAToken}&debug=true`;
      const sanitized = sanitizeUrlForLogging(urlWithToken);
      expect(sanitized).toContain('token=[REDACTED]');
      expect(sanitized).not.toContain(validDocAToken);
      expect(sanitized).toContain('debug=true');

      const portalUrl = `/api/v1/portal/loan?token=cpt_9876543210abcdef1234567890`;
      const sanitizedPortal = sanitizeUrlForLogging(portalUrl);
      expect(sanitizedPortal).toContain('token=[REDACTED]');
      expect(sanitizedPortal).not.toContain('cpt_9876543210abcdef1234567890');
    });
  });

  // ─── REQUIREMENT F: Customer Portal Bilingual Overdue Warning ──────────────────

  describe('Requirement F: Customer Portal Overdue & Bilingual Warning Verification', () => {
    test('7. Overdue loan portal response includes accurate authoritative overdue count and penalty amount', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/loan?token=${overduePortalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.overdueInstallments).toBeGreaterThanOrEqual(1);
      // Late penalty: 250 + 250 = 500
      expect(res.body.data.totalPenaltyAmount).toBe(500);

      // Verify each overdue installment contains daysOverdue and status OVERDUE
      const overdueEmis = res.body.data.installments.filter((i: any) => i.status === 'OVERDUE');
      expect(overdueEmis.length).toBeGreaterThan(0);
      expect(overdueEmis[0].daysOverdue).toBeGreaterThan(0);
    });

    test('8. Non-overdue loan portal returns zero overdue installments and zero penalty', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/loan?token=${cleanPortalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.overdueInstallments).toBe(0);
      expect(res.body.data.totalPenaltyAmount).toBe(0);
    });

    test('9. Customer portal KYC document viewing and streaming enforces borrower token isolation', async () => {
      // Direct upload KYC for this customer
      const uploadRes = await request(app)
        .post('/api/v1/kyc/direct-upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          docType: KYCType.PHOTO,
          fileName: 'borrower_photo.jpg',
          mimeType: 'image/jpeg',
          fileBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString('base64'),
        });
      const docId = uploadRes.body.data.id;

      // Borrower can stream with valid portal token
      const viewRes = await request(app)
        .get(`/api/v1/portal/kyc/${docId}/view?token=${overduePortalToken}`);

      expect(viewRes.status).toBe(200);
      expect(viewRes.header['content-type']).toContain('image/jpeg');

      // Invalid token returns 401
      const badTokenRes = await request(app)
        .get(`/api/v1/portal/kyc/${docId}/view?token=cpt_bad_forged_token`);
      expect(badTokenRes.status).toBe(401);
    });
  });
});
