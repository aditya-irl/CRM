import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, getBusinessDate, addDays, LoanStatus } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Global CRM Role Authorization & Loan Disbursement Regression Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const superAdminEmail = `sa_${runId}@globalrbac.com`;
  const adminEmail = `admin_${runId}@globalrbac.com`;
  const branchManagerEmail = `bm_${runId}@globalrbac.com`;
  const agentAEmail = `agent_a_${runId}@globalrbac.com`;
  const agentBEmail = `agent_b_${runId}@globalrbac.com`;
  const dealerAEmail = `dealer_a_${runId}@globalrbac.com`;
  const dealerBEmail = `dealer_b_${runId}@globalrbac.com`;

  let superAdminToken: string;
  let adminToken: string;
  let branchManagerToken: string;
  let agentAToken: string;
  let agentBToken: string;
  let dealerAToken: string;
  let dealerBToken: string;

  let superAdminId: string;
  let adminId: string;
  let branchManagerId: string;
  let agentAId: string;
  let agentBId: string;
  let dealerAUserId: string;
  let dealerBUserId: string;
  let dealerAId: string;
  let dealerBId: string;

  let customerAId: string;
  let customerBId: string;

  const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
  const pastDueDate = addDays(businessToday, -15);
  const futureDueDate = addDays(businessToday, 15);

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    superAdminId = uuidv4();
    adminId = uuidv4();
    branchManagerId = uuidv4();
    agentAId = uuidv4();
    agentBId = uuidv4();
    dealerAUserId = uuidv4();
    dealerBUserId = uuidv4();
    dealerAId = uuidv4();
    dealerBId = uuidv4();
    customerAId = uuidv4();
    customerBId = uuidv4();

    // 1. Seed Dealers
    await queryPostgres(
      `INSERT INTO dealers (
        id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at
      ) VALUES
        ($1, $2, 'Store A', 'Owner A', '9800000001', 'City A', 'Street A', 'ACTIVE', NOW(), NOW()),
        ($3, $4, 'Store B', 'Owner B', '9800000002', 'City B', 'Street B', 'ACTIVE', NOW(), NOW())`,
      [
        dealerAId, `DLR-A-${runId}`,
        dealerBId, `DLR-B-${runId}`,
      ]
    );

    const phonePrefix = Math.floor(Math.random() * 8000000 + 1000000).toString();

    // 2. Seed Users
    await queryPostgres(
      `INSERT INTO users (
        id, email, password_hash, full_name, phone, role, dealer_id, status, created_at, updated_at
      ) VALUES
        ($1, $2, $3, 'Super Admin Sparsh', $4, 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
        ($5, $6, $3, 'Admin Officer', $7, 'ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
        ($8, $9, $3, 'Branch Manager North', $10, 'BRANCH_MANAGER', NULL, 'ACTIVE', NOW(), NOW()),
        ($11, $12, $3, 'Recovery Agent A', $13, 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
        ($14, $15, $3, 'Recovery Agent B', $16, 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
        ($17, $18, $3, 'Dealer User A', $19, 'DEALER', $20, 'ACTIVE', NOW(), NOW()),
        ($21, $22, $3, 'Dealer User B', $23, 'DEALER', $24, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, superAdminEmail, hash, `91${phonePrefix}1`,
        adminId, adminEmail, `91${phonePrefix}2`,
        branchManagerId, branchManagerEmail, `91${phonePrefix}3`,
        agentAId, agentAEmail, `91${phonePrefix}4`,
        agentBId, agentBEmail, `91${phonePrefix}5`,
        dealerAUserId, dealerAEmail, `91${phonePrefix}6`, dealerAId,
        dealerBUserId, dealerBEmail, `91${phonePrefix}7`, dealerBId,
      ]
    );

    // 3. Seed Customers
    await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at
      ) VALUES
        ($1, $2, 'Borrower Customer A', $3, 'Add A', 'City A', 'Delhi', '110001', 'Route North', NOW(), NOW()),
        ($4, $5, 'Borrower Customer B', $6, 'Add B', 'City B', 'Delhi', '110002', 'Route South', NOW(), NOW())`,
      [
        customerAId, `CUST-A-${runId}`, `92${phonePrefix}1`,
        customerBId, `CUST-B-${runId}`, `92${phonePrefix}2`,
      ]
    );

    // 4. Authenticate All Roles
    const [resSA, resAdmin, resBM, resAgA, resAgB, resDlrA, resDlrB] = await Promise.all([
      request(app).post('/api/v1/auth/login').send({ email: superAdminEmail, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: branchManagerEmail, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: agentAEmail, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: agentBEmail, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: dealerAEmail, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: dealerBEmail, password: 'Password@123' }),
    ]);

    superAdminToken = resSA.body.data.tokens.accessToken;
    adminToken = resAdmin.body.data.tokens.accessToken;
    branchManagerToken = resBM.body.data.tokens.accessToken;
    agentAToken = resAgA.body.data.tokens.accessToken;
    agentBToken = resAgB.body.data.tokens.accessToken;
    dealerAToken = resDlrA.body.data.tokens.accessToken;
    dealerBToken = resDlrB.body.data.tokens.accessToken;
  });

  // Helper to create test loan
  async function createLoanDirect(status: string, dealerId: string | null = null, agentId: string | null = null) {
    const loanId = uuidv4();
    const loanAcc = `LN-${runId}-${Math.floor(Math.random() * 90000 + 10000)}`;
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, assigned_agent_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 30000, 5000, 25000, 18.0, 'FLAT_RATE', 6,
        'MONTHLY', 6, 5000, 5000, 30000, 0, 30000,
        $5, $6, $7, $8, $9, NOW(), NOW()
      )`,
      [loanId, loanAcc, customerAId, dealerId, pastDueDate, pastDueDate, futureDueDate, status, agentId]
    );
    return loanId;
  }

  // Helper to seed overdue EMI
  async function createOverdueEmi(loanId: string) {
    const emiId = uuidv4();
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component,
        interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
        status, days_overdue, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 1, $4, 4000, 1000, 5000, 0, 5000, 0,
        'OVERDUE', 15, NOW(), NOW()
      )`,
      [emiId, loanId, customerAId, pastDueDate]
    );
    return emiId;
  }

  describe('Part 1 & 2: Loan Disbursement & Lifecycle Permissions', () => {
    test('1. SUPER_ADMIN can disburse an eligible APPROVED loan', async () => {
      const loanId = await createLoanDirect(LoanStatus.APPROVED, dealerAId);

      const res = await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(LoanStatus.ACTIVE);

      // Verify DB status
      const check = await queryPostgres('SELECT status FROM loans WHERE id = $1', [loanId]);
      expect(check.rows[0].status).toBe(LoanStatus.ACTIVE);
    });

    test('2. ADMIN can disburse an eligible APPROVED loan without Super Admin restriction', async () => {
      const loanId = await createLoanDirect(LoanStatus.APPROVED, dealerAId);

      const res = await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(LoanStatus.ACTIVE);

      // Verify DB status
      const check = await queryPostgres('SELECT status FROM loans WHERE id = $1', [loanId]);
      expect(check.rows[0].status).toBe(LoanStatus.ACTIVE);
    });

    test('3. BRANCH_MANAGER can disburse an eligible APPROVED loan per configured RBAC', async () => {
      const loanId = await createLoanDirect(LoanStatus.APPROVED, dealerAId);

      const res = await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(LoanStatus.ACTIVE);
    });

    test('4. DEALER cannot disburse loans (HTTP 403 Forbidden)', async () => {
      const loanId = await createLoanDirect(LoanStatus.APPROVED, dealerAId);

      const res = await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('5. COLLECTION_AGENT cannot disburse loans (HTTP 403 Forbidden)', async () => {
      const loanId = await createLoanDirect(LoanStatus.APPROVED, dealerAId);

      const res = await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${agentAToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('6. Unapproved PENDING_APPROVAL loan cannot be disbursed (HTTP 400 clean message)', async () => {
      const loanId = await createLoanDirect(LoanStatus.PENDING_APPROVAL, dealerAId);

      const res = await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      const errMsg = res.body.error?.message || res.body.message;
      expect(errMsg).toContain('pending approval');
      // Must not show confusing "pending Super Admin approval"
      expect(errMsg).not.toContain('pending Super Admin approval');
    });

    test('7. Repeated disbursement is idempotent and does NOT duplicate EMI installments', async () => {
      const loanId = await createLoanDirect(LoanStatus.APPROVED, dealerAId);

      // First disbursement
      const res1 = await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res1.status).toBe(200);

      const count1 = await queryPostgres('SELECT COUNT(*) as cnt FROM emi_installments WHERE loan_id = $1', [loanId]);
      const initialEmiCount = parseInt(count1.rows[0].cnt, 10);
      expect(initialEmiCount).toBe(6);

      // Repeated disbursement
      const res2 = await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res2.status).toBe(200);

      const count2 = await queryPostgres('SELECT COUNT(*) as cnt FROM emi_installments WHERE loan_id = $1', [loanId]);
      expect(parseInt(count2.rows[0].cnt, 10)).toBe(initialEmiCount);
    });

    test('8. Loan becomes ACTIVE only after successful disbursement', async () => {
      const loanId = await createLoanDirect(LoanStatus.APPROVED, dealerAId);

      // Verify before
      const before = await queryPostgres('SELECT status FROM loans WHERE id = $1', [loanId]);
      expect(before.rows[0].status).toBe(LoanStatus.APPROVED);

      // Disburse
      await request(app)
        .post(`/api/v1/loans/${loanId}/disburse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // Verify after
      const after = await queryPostgres('SELECT status FROM loans WHERE id = $1', [loanId]);
      expect(after.rows[0].status).toBe(LoanStatus.ACTIVE);
    });
  });

  describe('Part 3 & 4: Global Role Permissions & RLAC Consistency', () => {
    test('9. ADMIN can approve dealer-originated loans', async () => {
      const loanId = await createLoanDirect(LoanStatus.PENDING_APPROVAL, dealerAId);

      const res = await request(app)
        .post(`/api/v1/loans/${loanId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved by authorized Admin' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const check = await queryPostgres('SELECT status FROM loans WHERE id = $1', [loanId]);
      expect(check.rows[0].status).toBe(LoanStatus.APPROVED);
    });

    test('10. SUPER_ADMIN retains full administrative privilege', async () => {
      const res = await request(app)
        .get('/api/v1/reports/finance-dashboard')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('11. BRANCH_MANAGER can view audit logs without "Requires SUPER_ADMIN, ADMIN" error', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${branchManagerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('12. BRANCH_MANAGER can add manual penalty to overdue EMI', async () => {
      const loanId = await createLoanDirect(LoanStatus.ACTIVE, dealerAId);
      const emiId = await createOverdueEmi(loanId);

      const res = await request(app)
        .post(`/api/v1/emi/${emiId}/penalties`)
        .set('Authorization', `Bearer ${branchManagerToken}`)
        .send({ amount: 150, reason: 'Branch Manager overdue assessment' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('13. DEALER cannot view or access another dealer loans (RLAC)', async () => {
      // Create loan for Dealer B
      const loanBId = await createLoanDirect(LoanStatus.ACTIVE, dealerBId);

      // Dealer A attempts to fetch loan detail of Dealer B
      const res = await request(app)
        .get(`/api/v1/loans/${loanBId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('14. COLLECTION_AGENT cannot access loans assigned to another agent (RLAC)', async () => {
      // Loan assigned to Agent B
      const loanAssignedB = await createLoanDirect(LoanStatus.ACTIVE, dealerAId, agentBId);

      // Agent A attempts to access Agent B's loan
      const res = await request(app)
        .get(`/api/v1/loans/${loanAssignedB}`)
        .set('Authorization', `Bearer ${agentAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('15. DEALER and COLLECTION_AGENT cannot access administrative user endpoints (403)', async () => {
      const resDealer = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${dealerAToken}`);
      expect(resDealer.status).toBe(403);

      const resAgent = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${agentAToken}`);
      expect(resAgent.status).toBe(403);
    });

    test('16. Unauthenticated requests return HTTP 401', async () => {
      const res = await request(app)
        .get('/api/v1/loans');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('17. Collection agents cannot waive or reverse penalties (403)', async () => {
      const penaltyId = uuidv4();
      const res = await request(app)
        .post(`/api/v1/emi/penalties/${penaltyId}/reverse`)
        .set('Authorization', `Bearer ${agentAToken}`)
        .send({ reason: 'Unauthorized reversal attempt' });

      expect(res.status).toBe(403);
    });

    test('18. Collection agents cannot add late penalties via emi endpoint (403)', async () => {
      const loanId = await createLoanDirect(LoanStatus.ACTIVE, dealerAId);
      const emiId = await createOverdueEmi(loanId);

      const res = await request(app)
        .post(`/api/v1/emi/${emiId}/penalties`)
        .set('Authorization', `Bearer ${agentAToken}`)
        .send({ amount: 100, reason: 'Field agent manual penalty attempt' });

      expect(res.status).toBe(403);
    });

    test('19. Non-Super Admin cannot toggle dealer penalty system setting (403)', async () => {
      const res = await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ allowDealerPenalty: true });

      expect(res.status).toBe(403);
    });

    test('20. Super Admin CAN toggle dealer penalty setting (200)', async () => {
      const res = await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ allowDealerPenalty: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
