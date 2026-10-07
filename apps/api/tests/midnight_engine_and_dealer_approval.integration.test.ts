import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { getRedisClient, closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, LoanStatus, InterestMethod, RepaymentFrequency } from '@crm/shared';

describe('Midnight Engine & Dealer Customer Approval Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);

  const superAdminEmail = `sa_${runId}@midnighttest.com`;
  const adminEmail = `admin_${runId}@midnighttest.com`;
  const agentEmail = `agent_${runId}@midnighttest.com`;
  const dealer1UserEmail = `dealer1_${runId}@midnighttest.com`;
  const dealer2UserEmail = `dealer2_${runId}@midnighttest.com`;

  let superAdminToken: string;
  let adminToken: string;
  let agentToken: string;
  let dealer1Token: string;
  let dealer2Token: string;

  let superAdminId: string;
  let adminId: string;
  let agentId: string;
  let dealer1UserId: string;
  let dealer2UserId: string;

  let dealer1Id: string;
  let dealer2Id: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    superAdminId = uuidv4();
    adminId = uuidv4();
    agentId = uuidv4();
    dealer1UserId = uuidv4();
    dealer2UserId = uuidv4();

    dealer1Id = uuidv4();
    dealer2Id = uuidv4();

    // 1. Seed Dealers
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES 
         ($1, $2, 'Midnight Partner 1', 'Partner One', $3, 'Delhi', 'Shop 101, Connaught Place', 'ACTIVE', NOW(), NOW()),
         ($4, $5, 'Midnight Partner 2', 'Partner Two', $6, 'Noida', 'Shop 202, Sector 18', 'ACTIVE', NOW(), NOW())`,
      [
        dealer1Id, `DLR-${runId}-01`, `+9191${Date.now().toString().slice(-8)}`,
        dealer2Id, `DLR-${runId}-02`, `+9192${Date.now().toString().slice(-8)}`,
      ]
    );

    // 2. Seed Users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'Super Admin User', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $4, 'Admin Manager User', 'ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($8, $9, $10, $4, 'Field Agent User', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
         ($11, $12, $13, $4, 'Dealer User One', 'DEALER', $14, 'ACTIVE', NOW(), NOW()),
         ($15, $16, $17, $4, 'Dealer User Two', 'DEALER', $18, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, superAdminEmail, `+9190${Math.floor(10000000 + Math.random() * 90000000)}`, hash,
        adminId, adminEmail, `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
        agentId, agentEmail, `+9194${Math.floor(10000000 + Math.random() * 90000000)}`,
        dealer1UserId, dealer1UserEmail, `+9195${Math.floor(10000000 + Math.random() * 90000000)}`, dealer1Id,
        dealer2UserId, dealer2UserEmail, `+9196${Math.floor(10000000 + Math.random() * 90000000)}`, dealer2Id,
      ]
    );

    // 3. Login to get tokens
    const saLogin = await request(app).post('/api/v1/auth/login').send({ email: superAdminEmail, password: 'Password@123' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const admLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = admLogin.body.data.tokens.accessToken;

    const agtLogin = await request(app).post('/api/v1/auth/login').send({ email: agentEmail, password: 'Password@123' });
    agentToken = agtLogin.body.data.tokens.accessToken;

    const d1Login = await request(app).post('/api/v1/auth/login').send({ email: dealer1UserEmail, password: 'Password@123' });
    dealer1Token = d1Login.body.data.tokens.accessToken;

    const d2Login = await request(app).post('/api/v1/auth/login').send({ email: dealer2UserEmail, password: 'Password@123' });
    dealer2Token = d2Login.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    try {
      await queryPostgres('DELETE FROM notifications WHERE recipient_user_id IN ($1, $2)', [superAdminId, adminId]);
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id IN (SELECT id FROM loans WHERE dealer_id IN ($1, $2))', [dealer1Id, dealer2Id]);
      await queryPostgres('DELETE FROM loans WHERE dealer_id IN ($1, $2)', [dealer1Id, dealer2Id]);
      await queryPostgres('DELETE FROM customers WHERE created_by IN ($1, $2)', [dealer1UserId, dealer2UserId]);
      await queryPostgres('DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5)', [superAdminId, adminId, agentId, dealer1UserId, dealer2UserId]);
      await queryPostgres('DELETE FROM dealers WHERE id IN ($1, $2)', [dealer1Id, dealer2Id]);
    } catch {}

    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // =========================================================================
  // GROUP 1: MIDNIGHT ENGINE MANUAL TRIGGER & CONCURRENCY
  // =========================================================================
  describe('Issue 1: Midnight Engine Trigger & Authorization', () => {
    test('ADMIN role CAN trigger Midnight Engine successfully', async () => {
      const res = await request(app)
        .post('/api/v1/system/trigger-jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBeDefined();
      expect(res.body.skipped).toBeDefined();
      expect(res.body.failed).toBeDefined();
    });

    test('SUPER_ADMIN role CAN trigger Midnight Engine successfully', async () => {
      const res = await request(app)
        .post('/api/v1/system/trigger-jobs')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBeDefined();
    });

    test('DEALER role is forbidden from triggering Midnight Engine (403)', async () => {
      const res = await request(app)
        .post('/api/v1/system/trigger-jobs')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({});

      expect(res.status).toBe(403);
    });

    test('COLLECTION_AGENT role is forbidden from triggering Midnight Engine (403)', async () => {
      const res = await request(app)
        .post('/api/v1/system/trigger-jobs')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({});

      expect(res.status).toBe(403);
    });

    test('Unauthenticated request is rejected (401)', async () => {
      const res = await request(app)
        .post('/api/v1/system/trigger-jobs')
        .send({});

      expect(res.status).toBe(401);
    });

    test('Concurrent/racing execution is safely locked in Redis and returns skipped', async () => {
      const redis = getRedisClient();
      const lockKey = 'cron:daily-emi-maintenance';

      // Simulate lock held by background worker
      await redis.set(`lock:${lockKey}`, 'locked_by_worker', 'PX', 10000);

      const res = await request(app)
        .post('/api/v1/system/trigger-jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.skipped).toBe(1);
      expect(res.body.processed).toBe(0);

      // Clean up lock
      await redis.del(`lock:${lockKey}`);
    });
  });

  // =========================================================================
  // GROUP 2: DEALER CUSTOMER ONBOARDING, APPROVAL FLOW & RLAC
  // =========================================================================
  describe('Issue 2: Dealer Add Customer -> Approval Workflow & RLAC', () => {
    let createdLoan1Id: string;
    let createdCustomer1Id: string;

    test('Dealer successfully onboards Customer + Financed Device Loan atomically without 500 collision', async () => {
      const customerPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          customer: {
            fullName: `Ramesh Sharma ${runId}`,
            primaryPhone: customerPhone,
            addressLine1: 'Shop 12 Sector 10',
            city: 'Noida',
            state: 'Uttar Pradesh',
            pincode: '201301',
            areaRoute: 'CENTRAL_DELHI',
          },
          loan: {
            principalAmount: 25000,
            downPayment: 5000,
            annualInterestRate: 1.5,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-06',
            firstEmiDate: '2026-11-06',
            deviceBrand: 'Samsung',
            deviceModel: 'Galaxy S24',
            deviceName: 'Samsung Galaxy S24',
            imei1: `356789${Date.now().toString().slice(-9)}`,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customer).toBeDefined();
      expect(res.body.data.loan).toBeDefined();

      createdCustomer1Id = res.body.data.customer.id;
      createdLoan1Id = res.body.data.loan.id;

      // Status must be PENDING_APPROVAL for Dealer origination
      expect(res.body.data.loan.status).toBe(LoanStatus.PENDING_APPROVAL);
      expect(res.body.data.loan.dealerId).toBe(dealer1Id);
      expect(res.body.data.loan.principalAmount).toBe(25000);
      expect(res.body.data.loan.downPayment).toBe(5000);
      expect(res.body.data.loan.netDisbursedAmount).toBe(20000);

      // Verify in-app notification was dispatched to Admin / Super Admin
      const notifRes = await queryPostgres(
        `SELECT * FROM notifications 
         WHERE recipient_user_id = $1 AND type = 'LOAN_APPROVAL_REQUEST' 
         ORDER BY created_at DESC LIMIT 1`,
        [adminId]
      );
      expect(notifRes.rows.length).toBe(1);
      const notif = notifRes.rows[0];
      expect(notif.title).toContain('New Dealer Loan Approval Request');
      expect(notif.metadata).toBeDefined();
      const meta = typeof notif.metadata === 'string' ? JSON.parse(notif.metadata) : notif.metadata;
      expect(meta.loanId).toBe(createdLoan1Id);
      expect(meta.dealerId).toBe(dealer1Id);
      expect(meta.netDisbursedAmount).toBe(20000);
    });

    test('Duplicate active approval submission returns 409 Conflict', async () => {
      // Loan is already in PENDING_APPROVAL status from onboarding
      const res = await request(app)
        .post(`/api/v1/loans/${createdLoan1Id}/submit-approval`)
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({ notes: 'Duplicate submission attempt' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/already.*submitted/i);
    });

    test('Dealer B CANNOT submit approval for Dealer A loan -> 403 Forbidden', async () => {
      // Dealer 2 tries to submit Dealer 1's loan
      const res = await request(app)
        .post(`/api/v1/loans/${createdLoan1Id}/submit-approval`)
        .set('Authorization', `Bearer ${dealer2Token}`)
        .send({ notes: 'Cross dealer attempt' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    test('Forged dealerId in onboarding payload is overridden with authenticated dealer identity', async () => {
      const customerPhone = `97${Math.floor(10000000 + Math.random() * 90000000)}`;
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          customer: {
            fullName: `Forged Attempt ${runId}`,
            primaryPhone: customerPhone,
            addressLine1: 'Address 1',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
            areaRoute: 'CENTRAL_DELHI',
          },
          loan: {
            dealerId: dealer2Id, // Attacking dealer passes Dealer 2's ID
            principalAmount: 15000,
            downPayment: 3000,
            annualInterestRate: 1,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-06',
            firstEmiDate: '2026-11-06',
          },
        });

      expect(res.status).toBe(201);
      // Backend must strictly bind to Dealer 1, ignoring the forged dealer2Id
      expect(res.body.data.loan.dealerId).toBe(dealer1Id);
    });

    test('Failed onboarding rolls back transaction completely leaving no orphan records', async () => {
      const customerPhone = `96${Math.floor(10000000 + Math.random() * 90000000)}`;
      const randomFakeDealer = uuidv4();

      // Attempt to originate with invalid EMI Start Date earlier than disbursement date
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: `Rollback Borrower ${runId}`,
            primaryPhone: customerPhone,
            addressLine1: 'Rollback Rd',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
            areaRoute: 'CENTRAL_DELHI',
          },
          loan: {
            dealerId: randomFakeDealer, // Inexistent dealer
            principalAmount: 20000,
            downPayment: 4000,
            annualInterestRate: 1,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-06',
            firstEmiDate: '2026-11-06',
          },
        });

      expect(res.status).toBe(404);

      // Verify that customer was NOT persisted due to rollback
      const checkCust = await queryPostgres('SELECT id FROM customers WHERE primary_phone = $1', [customerPhone]);
      expect(checkCust.rows.length).toBe(0);
    });

    test('Super Admin approves pending dealer loan -> status APPROVED and installments generated', async () => {
      const res = await request(app)
        .post(`/api/v1/loans/${createdLoan1Id}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ notes: 'All customer KYC docs verified. Approved.' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(LoanStatus.APPROVED);

      // Verify emi installments exist
      const emiCheck = await queryPostgres('SELECT COUNT(*) as count FROM emi_installments WHERE loan_id = $1', [createdLoan1Id]);
      expect(parseInt(emiCheck.rows[0].count, 10)).toBe(6);
    });

    test('Super Admin rejects loan with mandatory reason', async () => {
      // Create a second loan by dealer
      const origRes = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          customer: {
            fullName: `Reject Borrower ${runId}`,
            primaryPhone: `95${Math.floor(10000000 + Math.random() * 90000000)}`,
            addressLine1: '44 Reject St',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
            areaRoute: 'CENTRAL_DELHI',
          },
          loan: {
            principalAmount: 18000,
            downPayment: 2000,
            annualInterestRate: 1.2,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-06',
            firstEmiDate: '2026-11-06',
          },
        });

      expect(origRes.status).toBe(201);
      const rejectLoanId = origRes.body.data.loan.id;

      // Dealer cannot reject
      const dealerReject = await request(app)
        .post(`/api/v1/loans/${rejectLoanId}/reject`)
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({ reason: 'Self rejection attempt' });
      expect(dealerReject.status).toBe(403);

      // Super Admin rejects with reason
      const reasonText = 'Incomplete address verification documents and bad credit score.';
      const adminReject = await request(app)
        .post(`/api/v1/loans/${rejectLoanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: reasonText });

      expect(adminReject.status).toBe(200);
      expect(adminReject.body.data.status).toBe(LoanStatus.REJECTED);
      expect(adminReject.body.data.reason).toBe(reasonText);
    });
  });
});
