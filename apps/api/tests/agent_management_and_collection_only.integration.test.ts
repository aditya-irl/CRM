import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, CollectionSource, InterestMethod, RepaymentFrequency } from '@crm/shared';

describe('Agent Management, Navigation & Collection-Only Dashboard Integration Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;
  let adminId: string;

  let dealerToken: string;
  let dealerId: string;

  // Agent 1 (will be assigned and later tested for deletion)
  let agent1Id: string;
  let agent1Phone: string;
  let agent1Token: string;

  // Agent 2 (reassignment target)
  let agent2Id: string;
  let agent2Phone: string;
  let agent2Token: string;

  // Customer & Loan
  let customerId: string;
  let loanId: string;
  let emi1Id: string;
  let emi2Id: string;

  // Second customer & loan (unassigned to Agent 1)
  let customer2Id: string;
  let loan2Id: string;
  let emiUnassignedId: string;

  beforeAll(async () => {
    // 1. Authenticate as Super Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;
    adminId = adminLogin.body.data.user.id;

    // 2. Create a test dealer store
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Collection Test Store ${runId}`,
        ownerName: 'Store Partner',
        phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `partner_${runId}@store.test`,
        address: 'Sector 62, Noida',
        areaCity: 'Noida',
      });
    expect(dealerRes.status).toBe(201);
    dealerId = dealerRes.body.data.id;

    // Login as dealer
    const dealerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: dealerRes.body.data.user?.email || `partner_${runId}@store.test`,
        password: dealerRes.body.data.temporaryPassword || 'TempPass@123',
      });
    if (dealerLogin.status === 200) {
      dealerToken = dealerLogin.body.data.tokens.accessToken;
    }

    // 3. Provision Agent 1
    agent1Phone = `92${Math.floor(10000000 + Math.random() * 90000000)}`;
    const ag1Res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Field Agent One ${runId}`,
        phone: agent1Phone,
        loginId: `ag1_${runId}`,
        areaRoute: `Route-Sector62-${runId}`,
      });
    expect(ag1Res.status).toBe(201);
    agent1Id = ag1Res.body.data.agentId;
    const ag1Pass = ag1Res.body.data.temporaryPassword;

    // Login as Agent 1
    const ag1Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `ag1_${runId}`, password: ag1Pass });
    expect(ag1Login.status).toBe(200);
    agent1Token = ag1Login.body.data.tokens.accessToken;

    // 4. Provision Agent 2 (Target for reassignment)
    agent2Phone = `93${Math.floor(10000000 + Math.random() * 90000000)}`;
    const ag2Res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Field Agent Two ${runId}`,
        phone: agent2Phone,
        loginId: `ag2_${runId}`,
        areaRoute: `Route-Sector62-${runId}`,
      });
    expect(ag2Res.status).toBe(201);
    agent2Id = ag2Res.body.data.agentId;
    const ag2Pass = ag2Res.body.data.temporaryPassword;

    const ag2Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `ag2_${runId}`, password: ag2Pass });
    expect(ag2Login.status).toBe(200);
    agent2Token = ag2Login.body.data.tokens.accessToken;

    // 5. Create Customer 1 & Disbursed Loan 1 (Assigned to Agent 1)
    const cust1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Assigned Customer ${runId}`,
        primaryPhone: `94${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: 'Flat 101, Block B',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201301',
        areaRoute: `Route-Sector62-${runId}`,
      });
    expect(cust1Res.status).toBe(201);
    customerId = cust1Res.body.data.id;

    const loan1Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        dealerId,
        principalAmount: 24000,
        downPayment: 4000,
        annualInterestRate: 4,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });
    expect(loan1Res.status).toBe(201);
    loanId = loan1Res.body.data.id;

    // Disburse loan 1
    await request(app)
      .post(`/api/v1/loans/${loanId}/disburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ disbursementDate: '2026-10-01' });

    // Explicitly assign Loan 1 to Agent 1
    const assignRes = await request(app)
      .post(`/api/v1/loans/${loanId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agent1Id, notes: 'Field collection assignment' });
    expect(assignRes.status).toBe(200);

    const emisRes = await queryPostgres(
      'SELECT id FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
      [loanId]
    );
    emi1Id = emisRes.rows[0].id;
    emi2Id = emisRes.rows[1].id;

    // 6. Create Customer 2 & Disbursed Loan 2 (NOT assigned to Agent 1)
    const cust2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Unassigned Customer ${runId}`,
        primaryPhone: `95${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: 'House 50, Sector 12',
        city: 'Faridabad',
        state: 'Haryana',
        pincode: '121001',
        areaRoute: `Route-Faridabad-${runId}`,
      });
    expect(cust2Res.status).toBe(201);
    customer2Id = cust2Res.body.data.id;

    const loan2Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        dealerId,
        principalAmount: 18000,
        downPayment: 3000,
        annualInterestRate: 4,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });
    expect(loan2Res.status).toBe(201);
    loan2Id = loan2Res.body.data.id;

    await request(app)
      .post(`/api/v1/loans/${loan2Id}/disburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ disbursementDate: '2026-10-01' });

    const emis2Res = await queryPostgres(
      'SELECT id FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
      [loan2Id]
    );
    emiUnassignedId = emis2Res.rows[0].id;
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // -------------------------------------------------------------
  // REQUIREMENT 2: Remove Customer Onboarding from Agent Login
  // -------------------------------------------------------------
  describe('Requirement 2: Restrict Customer Creation & Loan Origination for Agents', () => {
    test('Agent cannot create customer via POST /api/v1/customers (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          fullName: 'Unauthorized Agent Borrower',
          primaryPhone: '9876543299',
          addressLine1: 'Test Address',
          city: 'Noida',
          state: 'UP',
          pincode: '201301',
          areaRoute: 'Test-Route',
        });

      expect(res.status).toBe(403);
    });

    test('Agent cannot onboard customer + loan via POST /api/v1/customers/onboard (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          fullName: 'Unauthorized Borrower Onboard',
          primaryPhone: '9876543298',
          addressLine1: 'Test Address',
          city: 'Noida',
          state: 'UP',
          pincode: '201301',
          areaRoute: 'Test-Route',
          principalAmount: 20000,
          downPayment: 2000,
          annualInterestRate: 4,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
          firstEmiDate: '2026-11-01',
        });

      expect(res.status).toBe(403);
    });

    test('Agent cannot originate loans via POST /api/v1/loans (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          customerId,
          dealerId,
          principalAmount: 20000,
          downPayment: 2000,
          annualInterestRate: 4,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
          firstEmiDate: '2026-11-01',
        });

      expect(res.status).toBe(403);
    });

    test('Agent cannot run loan calculator via POST /api/v1/loans/calculate-preview (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          principalAmount: 30000,
          downPayment: 5000,
          annualInterestRate: 4,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
        });

      expect(res.status).toBe(403);
    });

    test('Authorized roles (Admin) retain customer creation and onboarding access', async () => {
      const checkRes = await request(app)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: `Admin Created Borrower ${runId}`,
          primaryPhone: `96${Math.floor(10000000 + Math.random() * 90000000)}`,
          addressLine1: 'Admin Address',
          city: 'Noida',
          state: 'UP',
          pincode: '201301',
          areaRoute: `Route-Admin-${runId}`,
        });

      expect(checkRes.status).toBe(201);
    });
  });

  // -------------------------------------------------------------
  // REQUIREMENT 4: Collection-Only Workflow & RLAC Scoping
  // -------------------------------------------------------------
  describe('Requirement 4: Collection-Only Operations & Strict Assignment Verification', () => {
    test('Agent dashboard summary returns authoritative assigned metrics', async () => {
      const res = await request(app)
        .get('/api/v1/emi/agent-dashboard')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.assignedCustomers).toBeGreaterThanOrEqual(1);
      expect(res.body.data.activeLoans).toBeGreaterThanOrEqual(1);
      expect(typeof res.body.data.todayCollected).toBe('number');
      expect(typeof res.body.data.todayDue).toBe('number');
      expect(typeof res.body.data.overdueAmount).toBe('number');
    });

    test('Agent sees only assigned customer obligations in recovery queue', async () => {
      const res = await request(app)
        .get('/api/v1/emi/agent-queue')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const items = res.body.items || res.body.data?.items || res.body.data;
      expect(Array.isArray(items)).toBe(true);
      // All items returned must belong to Agent 1's assigned loan/customer
      items.forEach((item: any) => {
        expect(item.customerId).toBe(customerId);
        expect(item.loanId).toBe(loanId);
        expect(item.loanId).not.toBe(loan2Id);
      });
    });

    test('Agent CANNOT record payment for an unassigned customer or loan (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan2Id, // Unassigned loan
          emiId: emiUnassignedId,
          customerId: customer2Id,
          amount: 2000,
          paymentMode: 'CASH',
          collectionSource: CollectionSource.RECOVERY_AGENT,
          agentId: agent1Id,
          idempotencyKey: `IDEM_UNASSIGNED_${Date.now()}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('not authorized to collect payments');
    });

    test('Agent CAN record payment for an assigned customer with receipt generation and idempotency', async () => {
      const idemKey = `IDEM_ASSIGNED_${Date.now()}`;
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId,
          emiId: emi1Id,
          customerId,
          amount: 2500,
          paymentMode: 'CASH',
          collectionSource: CollectionSource.RECOVERY_AGENT,
          agentId: agent1Id,
          idempotencyKey: idemKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.receiptNumber).toBeDefined();
      expect(res.body.data.agentId || res.body.data.collectedByAgentId).toBe(agent1Id);
      const firstReceiptNo = res.body.data.receiptNumber;

      // Duplicate payment protection: sending same idempotency key must return existing payment
      const dupRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId,
          emiId: emi1Id,
          customerId,
          amount: 2500,
          paymentMode: 'CASH',
          collectionSource: CollectionSource.RECOVERY_AGENT,
          agentId: agent1Id,
          idempotencyKey: idemKey,
        });

      expect(dupRes.status).toBe(200);
      expect(dupRes.body.data.receiptNumber).toBe(firstReceiptNo);
    });

    test('Agent can retrieve EMI schedule and details for assigned loan', async () => {
      const res = await request(app)
        .get(`/api/v1/loans/${loanId}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.installments).toBeDefined();
      expect(res.body.data.installments.length).toBe(6);
    });

    test('Agent CANNOT retrieve loan details for unassigned loan (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/v1/loans/${loan2Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------
  // REQUIREMENT 1: Safe Agent Deletion by Authorized Admin
  // -------------------------------------------------------------
  describe('Requirement 1: Admin Delete Agent Accounts & Session Invalidation', () => {
    test('Unauthorized role (Agent) CANNOT delete another agent (403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/agents/${agent2Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
    });

    test('Agent CANNOT delete their own account (403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/agents/${agent1Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
    });

    test('Admin CANNOT delete their own account (403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('cannot delete your own account');
    });

    test('Admin safely deletes Agent 1 with assignment reassignment to Agent 2', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/agents/${agent1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reassignToAgentId: agent2Id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reassignedCount).toBeGreaterThanOrEqual(1);

      // Verify in DB that Agent 1 is soft-deleted and INACTIVE
      const ag1Check = await queryPostgres(
        'SELECT status, deleted_at FROM users WHERE id = $1',
        [agent1Id]
      );
      expect(ag1Check.rows[0].status).toBe('INACTIVE');
      expect(ag1Check.rows[0].deleted_at).not.toBeNull();

      // Verify Loan 1 has been atomically reassigned to Agent 2
      const loanCheck = await queryPostgres(
        'SELECT assigned_agent_id FROM loans WHERE id = $1',
        [loanId]
      );
      expect(loanCheck.rows[0].assigned_agent_id).toBe(agent2Id);

      // Verify financial audit trail: historical payment collected by Agent 1 remains intact
      const paymentCheck = await queryPostgres(
        'SELECT id, amount, collected_by_agent_id FROM payments WHERE collected_by_agent_id = $1',
        [agent1Id]
      );
      expect(paymentCheck.rows.length).toBeGreaterThanOrEqual(1);
      expect(Number(paymentCheck.rows[0].amount)).toBe(2500);

      // Verify audit log exists
      const auditCheck = await queryPostgres(
        "SELECT action, entity_id FROM audit_logs WHERE action = 'AGENT_DELETED' AND entity_id = $1",
        [agent1Id]
      );
      expect(auditCheck.rows.length).toBeGreaterThanOrEqual(1);
    });

    test('Deactivated/Deleted Agent token is rejected immediately on subsequent requests (401 Unauthorized)', async () => {
      const res = await request(app)
        .get('/api/v1/emi/agent-dashboard')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('inactive');
    });

    test('Reassigned Agent 2 can now access the reassigned loan and customer', async () => {
      const res = await request(app)
        .get('/api/v1/emi/agent-queue')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(res.status).toBe(200);
      const items = res.body.items || res.body.data?.items || res.body.data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.some((it: any) => it.loanId === loanId)).toBe(true);
    });

    test('Admin can safely delete an agent without reassignment (safe unassign)', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/agents/${agent2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({}); // No reassign target

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify Loan 1 is unassigned (assigned_agent_id = NULL) rather than orphaned
      const loanCheck = await queryPostgres(
        'SELECT assigned_agent_id FROM loans WHERE id = $1',
        [loanId]
      );
      expect(loanCheck.rows[0].assigned_agent_id).toBeNull();
    });
  });
});
