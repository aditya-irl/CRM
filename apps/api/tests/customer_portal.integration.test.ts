import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, LoanStatus, PaymentMode, CollectionSource } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Customer Payment Portal Backend Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);

  const superAdminEmail = `super_${runId}@portaltest.com`;
  const adminEmail = `admin_${runId}@portaltest.com`;
  const branchMgrEmail = `mgr_${runId}@portaltest.com`;
  const agentEmail = `agent_${runId}@portaltest.com`;

  let superAdminToken: string;
  let adminToken: string;
  let branchMgrToken: string;
  let agentToken: string;

  let superAdminId: string;
  let adminId: string;
  let branchMgrId: string;
  let agentId: string;

  let customer1Id: string;
  let customer2Id: string;
  let loan1Id: string;
  let loan1AccNo: string;
  let loan2Id: string;
  let loan2AccNo: string;

  let portalToken1: string;
  let portalUrl1: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    superAdminId = uuidv4();
    adminId = uuidv4();
    branchMgrId = uuidv4();
    agentId = uuidv4();

    // 1. Seed test users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'Super Admin User', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $8, 'Admin User', 'ADMIN', 'ACTIVE', NOW(), NOW()),
         ($9, $10, $11, $12, 'Branch Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW()),
         ($13, $14, $15, $16, 'Field Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, superAdminEmail, `+9198${Date.now().toString().slice(-8)}`, hash,
        adminId, adminEmail, `+9197${Date.now().toString().slice(-8)}`, hash,
        branchMgrId, branchMgrEmail, `+9196${Date.now().toString().slice(-8)}`, hash,
        agentId, agentEmail, `+9195${Date.now().toString().slice(-8)}`, hash,
      ]
    );

    // Login users to get JWTs
    const saLogin = await request(app).post('/api/v1/auth/login').send({ email: superAdminEmail, password: 'Password@123' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const admLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = admLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: branchMgrEmail, password: 'Password@123' });
    branchMgrToken = mgrLogin.body.data.tokens.accessToken;

    const agtLogin = await request(app).post('/api/v1/auth/login').send({ email: agentEmail, password: 'Password@123' });
    agentToken = agtLogin.body.data.tokens.accessToken;

    // 2. Seed Customer 1 & Customer 2
    customer1Id = uuidv4();
    customer2Id = uuidv4();

    await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by, created_at, updated_at
      ) VALUES 
        ($1, $2, 'Ramesh Kumar Verma', '+919876543210', '12 Civil Lines', 'Jaipur', 'Rajasthan', '302001', 'ROUTE-NORTH', TRUE, $3, NOW(), NOW()),
        ($4, $5, 'Suresh Chandra Sharma', '+919123456789', '45 M.I. Road', 'Jaipur', 'Rajasthan', '302002', 'ROUTE-SOUTH', TRUE, $3, NOW(), NOW())`,
      [
        customer1Id, `CUST-P1-${runId}`, superAdminId,
        customer2Id, `CUST-P2-${runId}`,
      ]
    );

    // 3. Seed Loan 1 for Customer 1
    loan1Id = uuidv4();
    loan1AccNo = `LN-PORTAL-${runId}-1`;

    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 50000.00, 5000.00, 45000.00,
        14.00, 'FLAT_RATE', 6, 'MONTHLY',
        6, 8917.00, 3502.00, 53502.00, 8917.00,
        44585.00, '2026-01-10', '2026-02-10', '2026-07-10',
        'ACTIVE', $4, NOW(), NOW()
      )`,
      [loan1Id, loan1AccNo, customer1Id, superAdminId]
    );

    // Seed installments for Loan 1
    const emi1Id = uuidv4();
    const emi2Id = uuidv4();
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component,
        interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
        status, days_overdue, created_at, updated_at
      ) VALUES 
        ($1, $2, $3, 1, '2026-02-10', 8333.33, 583.67, 8917.00, 8917.00, 0.00, 0.00, 'PAID', 0, NOW(), NOW()),
        ($4, $2, $3, 2, '2026-03-10', 8333.33, 583.67, 8917.00, 0.00, 8917.00, 0.00, 'UPCOMING', 0, NOW(), NOW())`,
      [emi1Id, loan1Id, customer1Id, emi2Id]
    );

    // Seed a verified payment for Loan 1
    await queryPostgres(
      `INSERT INTO payments (
        id, receipt_number, loan_id, emi_id, customer_id, amount, payment_mode,
        collection_source, collected_by_agent_id, payment_timestamp, status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, 8917.00, 'UPI',
        'DIRECT_CUSTOMER', $6, NOW(), 'SUCCESS', NOW(), NOW()
      )`,
      [uuidv4(), `RCP-TEST-${runId}-001`, loan1Id, emi1Id, customer1Id, superAdminId]
    );

    // 4. Seed Loan 2 for Customer 2
    loan2Id = uuidv4();
    loan2AccNo = `LN-PORTAL-${runId}-2`;
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 30000.00, 0.00, 30000.00,
        12.00, 'FLAT_RATE', 3, 'MONTHLY',
        3, 10300.00, 900.00, 30900.00, 0.00,
        30900.00, '2026-02-01', '2026-03-01', '2026-05-01',
        'ACTIVE', $4, NOW(), NOW()
      )`,
      [loan2Id, loan2AccNo, customer2Id, superAdminId]
    );
  });

  describe('1. Admin Portal Link Management & RBAC', () => {
    test('Super Admin can generate portal link', async () => {
      const res = await request(app)
        .post(`/api/v1/portal/loans/${loan1Id}/link`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.token.startsWith('cpt_')).toBe(true);
      expect(res.body.data.portalUrl).toContain(res.body.data.token);
      expect(res.body.data.loanId).toBe(loan1Id);
      expect(res.body.data.loanAccountNo).toBe(loan1AccNo);

      portalToken1 = res.body.data.token;
      portalUrl1 = res.body.data.portalUrl;
    });

    test('Admin role can generate/regenerate portal link', async () => {
      const res = await request(app)
        .post(`/api/v1/portal/loans/${loan2Id}/link`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token.startsWith('cpt_')).toBe(true);
    });

    test('Branch Manager role can generate portal link', async () => {
      const res = await request(app)
        .post(`/api/v1/portal/loans/${loan2Id}/link`)
        .set('Authorization', `Bearer ${branchMgrToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('Collection Agent CANNOT generate or revoke portal link (403 Forbidden)', async () => {
      const genRes = await request(app)
        .post(`/api/v1/portal/loans/${loan1Id}/link`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(genRes.status).toBe(403);

      const revokeRes = await request(app)
        .post(`/api/v1/portal/loans/${loan1Id}/revoke`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(revokeRes.status).toBe(403);
    });

    test('Unauthenticated user cannot generate portal link (401 Unauthorized)', async () => {
      const res = await request(app).post(`/api/v1/portal/loans/${loan1Id}/link`);
      expect(res.status).toBe(401);
    });

    test('Non-existent loan returns 404 NotFound', async () => {
      const fakeId = uuidv4();
      const res = await request(app)
        .post(`/api/v1/portal/loans/${fakeId}/link`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(404);
    });

    test('Admin can check active portal link status', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/loans/${loan1Id}/link`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasActiveLink).toBe(true);
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data.loanId).toBe(loan1Id);
    });
  });

  describe('2. Token Security & Cryptographic Storage', () => {
    test('Raw token is NEVER stored in database — only SHA-256 hash is persisted', async () => {
      const dbRows = await queryPostgres(
        'SELECT id, token_hash, is_active FROM customer_portal_tokens WHERE loan_id = $1 AND is_active = TRUE',
        [loan1Id]
      );

      expect(dbRows.rows.length).toBe(1);
      const row = dbRows.rows[0];

      // 1. The stored hash must match SHA-256(rawToken)
      const expectedHash = crypto.createHash('sha256').update(portalToken1).digest('hex');
      expect(row.token_hash).toBe(expectedHash);

      // 2. The raw token string must NEVER appear as the hash
      expect(row.token_hash).not.toBe(portalToken1);

      // 3. Raw token text does not exist anywhere in the entire tokens table
      const rawSearch = await queryPostgres(
        'SELECT id FROM customer_portal_tokens WHERE token_hash = $1',
        [portalToken1]
      );
      expect(rawSearch.rows.length).toBe(0);
    });
  });

  describe('3. Public Customer Portal API (/api/v1/portal/loan)', () => {
    test('Public endpoint resolves loan with valid token without admin JWT auth', async () => {
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: portalToken1 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      // Verify core data
      expect(data.customerName).toBe('Ramesh Kumar Verma');
      expect(data.maskedPhone).toBe('XXXXXX3210'); // Masked for privacy
      expect(data.loanAccountNo).toBe(loan1AccNo);
      expect(data.emiAmount).toBe(8917);
      expect(data.totalInstallments).toBe(6);
      expect(data.paidInstallments).toBe(1);
      expect(data.pendingInstallments).toBe(5);
      expect(data.nextDueDate).toBe('2026-03-10');
      expect(data.outstandingBalance).toBe(44585);
      expect(data.totalPaid).toBe(8917);
      expect(data.status).toBe('ACTIVE');

      // Verify payment history
      expect(Array.isArray(data.paymentHistory)).toBe(true);
      expect(data.paymentHistory.length).toBe(1);
      expect(data.paymentHistory[0].amount).toBe(8917);
      expect(data.paymentHistory[0].paymentMode).toBe('UPI');

      // Verify installment breakdown
      expect(Array.isArray(data.installments)).toBe(true);
      expect(data.installments.length).toBe(2);
      expect(data.installments[0].status).toBe('PAID');
      // Due date 2026-03-10 is in the past relative to current business today (2026-10-05), so dynamic derivation correctly returns OVERDUE
      expect(data.installments[1].status).toBe('OVERDUE');
    });

    test('Supports token via x-portal-token header', async () => {
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .set('x-portal-token', portalToken1);

      expect(res.status).toBe(200);
      expect(res.body.data.loanAccountNo).toBe(loan1AccNo);
    });

    test('Updates last_accessed_at in database on portal access', async () => {
      await request(app).get('/api/v1/portal/loan').query({ token: portalToken1 });

      const dbRes = await queryPostgres(
        'SELECT last_accessed_at FROM customer_portal_tokens WHERE loan_id = $1 AND is_active = TRUE',
        [loan1Id]
      );
      expect(dbRes.rows[0].last_accessed_at).toBeDefined();
    });

    test('Strictly sanitizes response: NO sensitive KYC, credentials, or internal data', async () => {
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: portalToken1 });

      const data = res.body.data;

      // Must NOT contain sensitive identifiers
      expect((data as any).aadhaar).toBeUndefined();
      expect((data as any).pan).toBeUndefined();
      expect((data as any).kyc).toBeUndefined();
      expect((data as any).tokenHash).toBeUndefined();
      expect((data as any).token_hash).toBeUndefined();
      expect((data as any).password).toBeUndefined();
      expect((data as any).notes).toBeUndefined();
      expect((data as any).internalNotes).toBeUndefined();
      expect((data as any).agentId).toBeUndefined();
      expect((data as any).dealerId).toBeUndefined();
      expect((data as any).primaryPhone).toBeUndefined(); // Raw unmasked phone must not be leaked
    });
  });

  describe('4. Token Rejection, Expiration & Parameter Tampering Prevention', () => {
    test('Missing token returns 400 Bad Request', async () => {
      const res = await request(app).get('/api/v1/portal/loan');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PORTAL_TOKEN_REQUIRED');
    });

    test('Invalid/forged token returns 401 Unauthorized', async () => {
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: 'cpt_fake_token_1234567890abcdef' });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Invalid or expired portal link');
    });

    test('Parameter tampering (IDOR) is impossible: extra loanId/customerId parameters are ignored', async () => {
      // Customer 1 tries to pass Customer 2's loanId in query parameter
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({
          token: portalToken1,
          loanId: loan2Id,
          customerId: customer2Id,
        });

      expect(res.status).toBe(200);
      // The endpoint MUST STILL return Customer 1's loan data, NOT Customer 2
      expect(res.body.data.loanAccountNo).toBe(loan1AccNo);
      expect(res.body.data.customerName).toBe('Ramesh Kumar Verma');
      expect(res.body.data.loanAccountNo).not.toBe(loan2AccNo);
    });
  });

  describe('5. Link Regeneration & Revocation', () => {
    let newToken: string;

    test('Regenerating link invalidates old token immediately', async () => {
      const regenRes = await request(app)
        .post(`/api/v1/portal/loans/${loan1Id}/regenerate`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(regenRes.status).toBe(200);
      newToken = regenRes.body.data.token;
      expect(newToken).not.toBe(portalToken1);

      // Old token must now be rejected (revoked)
      const oldRes = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: portalToken1 });
      expect(oldRes.status).toBe(401);
      expect(oldRes.body.error.message).toContain('revoked');

      // New token must work
      const newRes = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: newToken });
      expect(newRes.status).toBe(200);
      expect(newRes.body.data.loanAccountNo).toBe(loan1AccNo);
    });

    test('Revoking active link turns status inactive and blocks portal access', async () => {
      const revokeRes = await request(app)
        .post(`/api/v1/portal/loans/${loan1Id}/revoke`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.data.revokedCount).toBeGreaterThan(0);

      // Now even the new token is rejected
      const accessRes = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: newToken });
      expect(accessRes.status).toBe(401);
      expect(accessRes.body.error.message).toContain('revoked');

      // Admin status check shows no active link
      const statusRes = await request(app)
        .get(`/api/v1/portal/loans/${loan1Id}/link`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(statusRes.body.data.hasActiveLink).toBe(false);
      expect(statusRes.body.data.isActive).toBe(false);
    });
  });

  describe('6. End-to-End Payment Flow & Portal Dynamic Synchronization', () => {
    let activeToken: string;

    test('Re-generating portal link restores access for customer', async () => {
      const linkRes = await request(app)
        .post(`/api/v1/portal/loans/${loan1Id}/link`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(linkRes.status).toBe(201);
      expect(linkRes.body.success).toBe(true);
      activeToken = linkRes.body.data.token;
      expect(activeToken).toBeDefined();

      const portalBefore = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: activeToken });

      expect(portalBefore.status).toBe(200);
      expect(portalBefore.body.data.paidInstallments).toBe(1);
      expect(portalBefore.body.data.pendingInstallments).toBe(5);
      expect(portalBefore.body.data.totalPaid).toBe(8917);
      expect(portalBefore.body.data.outstandingBalance).toBe(44585);
      expect(portalBefore.body.data.paymentHistory.length).toBe(1);
    });

    test('Super Admin records payment and payment waterfall allocates to EMI #2 correctly', async () => {
      const pRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 8917,
          paymentMode: PaymentMode.UPI,
          collectionSource: CollectionSource.DIRECT_CUSTOMER,
          referenceNumber: `UPI-PORTAL-E2E-${runId}`,
          idempotencyKey: `IDEMP_PORTAL_E2E_${runId}`,
        });

      expect([200, 201]).toContain(pRes.status);
      expect(pRes.body.success).toBe(true);
      expect(pRes.body.data.receiptNumber).toBeDefined();
    });

    test('Customer portal immediately reflects updated payment, installments, and outstanding balance', async () => {
      const portalAfter = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: activeToken });

      expect(portalAfter.status).toBe(200);
      expect(portalAfter.body.success).toBe(true);
      const data = portalAfter.body.data;

      // Verification of updated financial figures
      expect(data.paidInstallments).toBe(2);
      expect(data.pendingInstallments).toBe(4);
      expect(data.totalPaid).toBe(17834);
      expect(data.outstandingBalance).toBe(35668);

      // Payment history verification
      expect(data.paymentHistory.length).toBe(2);
      expect(data.paymentHistory[0].amount).toBe(8917);

      // Installment breakdown verification
      const emi2 = data.installments.find((i: any) => i.installmentNumber === 2);
      expect(emi2).toBeDefined();
      expect(emi2.status).toBe('PAID');
      expect(emi2.remainingAmount).toBe(0);

      // Verify no sensitive admin data or raw tokens leaked
      expect(data.password_hash).toBeUndefined();
      expect(data.token_hash).toBeUndefined();
      expect(data.token).toBeUndefined();
      expect(data.notes).toBeUndefined();
    });
  });
});
