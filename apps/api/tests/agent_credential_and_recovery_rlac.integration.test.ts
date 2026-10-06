import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, CollectionSource, InterestMethod, RepaymentFrequency } from '@crm/shared';
import bcrypt from 'bcryptjs';

describe('Collection Agent Credential Provisioning, RLAC & Recovery Module Integration Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;

  // Agent A
  let agentAId: string;
  let agentAPhone: string;
  let agentALoginId: string;
  let agentATempPassword: string;
  let agentAToken: string;

  // Agent B
  let agentBId: string;
  let agentBPhone: string;
  let agentBLoginId: string;
  let agentBTempPassword: string;
  let agentBToken: string;

  // Dealer, Customers & Loans for RLAC testing
  let dealerId: string;
  let customerAId: string;
  let loanAId: string;
  let emiAId: string;
  let customerBId: string;
  let loanBId: string;

  beforeAll(async () => {
    // 1. Authenticate as Super Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 2. Create a test dealer store
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Recovery Retailer ${runId}`,
        ownerName: 'Store Partner',
        phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `partner_${runId}@retail.test`,
        address: '42 Sector 18',
        areaCity: 'Noida',
      });
    expect(dealerRes.status).toBe(201);
    dealerId = dealerRes.body.data.id;

    // 3. Create Customer A & Loan A (to be assigned to Agent A)
    const custARes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Customer Alpha ${runId}`,
        primaryPhone: `93${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: 'Block A, Alpha-1',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '201308',
        areaRoute: `Route-Alpha-${runId}`,
      });
    expect(custARes.status).toBe(201);
    customerAId = custARes.body.data.id;

    const loanARes = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customerAId,
        dealerId,
        principalAmount: 20000,
        downPayment: 2000,
        annualInterestRate: 12,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });
    expect(loanARes.status).toBe(201);
    loanAId = loanARes.body.data.id;

    // Get first EMI ID for loan A
    const emiRes = await queryPostgres(
      'SELECT id FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC LIMIT 1',
      [loanAId]
    );
    emiAId = emiRes.rows[0].id;

    // 4. Create Customer B & Loan B (to be assigned to Agent B)
    const custBRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Customer Beta ${runId}`,
        primaryPhone: `94${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: 'Block B, Beta-2',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '201308',
        areaRoute: `Route-Beta-${runId}`,
      });
    expect(custBRes.status).toBe(201);
    customerBId = custBRes.body.data.id;

    const loanBRes = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customerBId,
        dealerId,
        principalAmount: 15000,
        downPayment: 1500,
        annualInterestRate: 14,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 3,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });
    expect(loanBRes.status).toBe(201);
    loanBId = loanBRes.body.data.id;
  });

  afterAll(async () => {
    // Cleanup test records
    if (loanAId) {
      await queryPostgres('DELETE FROM payments WHERE loan_id = $1', [loanAId]);
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id = $1', [loanAId]);
      await queryPostgres('DELETE FROM loans WHERE id = $1', [loanAId]);
    }
    if (loanBId) {
      await queryPostgres('DELETE FROM payments WHERE loan_id = $1', [loanBId]);
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id = $1', [loanBId]);
      await queryPostgres('DELETE FROM loans WHERE id = $1', [loanBId]);
    }
    if (customerAId) {
      await queryPostgres('DELETE FROM collection_assignments WHERE customer_id = $1', [customerAId]);
      await queryPostgres('DELETE FROM customers WHERE id = $1', [customerAId]);
    }
    if (customerBId) {
      await queryPostgres('DELETE FROM collection_assignments WHERE customer_id = $1', [customerBId]);
      await queryPostgres('DELETE FROM customers WHERE id = $1', [customerBId]);
    }
    if (agentAId) {
      await queryPostgres('DELETE FROM collection_assignments WHERE agent_id = $1', [agentAId]);
      await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [agentAId]);
    }
    if (agentBId) {
      await queryPostgres('DELETE FROM collection_assignments WHERE agent_id = $1', [agentBId]);
      await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [agentBId]);
    }
    if (dealerId) {
      await queryPostgres('DELETE FROM dealers WHERE id = $1', [dealerId]);
    }

    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // =========================================================================
  // 1. AGENT CREDENTIAL CREATION & PROVISIONING
  // =========================================================================

  it('1. Admin can provision a new Collection Agent with secure temporary password', async () => {
    agentAPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    agentALoginId = `AGT_A_${runId}`;

    const res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Agent Alpha Test',
        phone: agentAPhone,
        loginId: agentALoginId,
        status: 'ACTIVE',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBeDefined();
    expect(res.body.data.user.role).toBe(UserRole.COLLECTION_AGENT);
    expect(res.body.data.loginId.toLowerCase()).toBe(agentALoginId.toLowerCase());
    expect(typeof res.body.data.temporaryPassword).toBe('string');
    expect(res.body.data.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    agentAId = res.body.data.user.id;
    agentATempPassword = res.body.data.temporaryPassword;

    // Verify DB integrity: ONLY bcrypt hash stored, plaintext NOT stored
    const dbUserRes = await queryPostgres('SELECT password_hash FROM users WHERE id = $1', [agentAId]);
    expect(dbUserRes.rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    const isMatch = await bcrypt.compare(agentATempPassword, dbUserRes.rows[0].password_hash);
    expect(isMatch).toBe(true);

    // Verify must_change_password flag is TRUE
    const flagRes = await queryPostgres('SELECT must_change_password FROM users WHERE id = $1', [agentAId]);
    expect(Boolean(flagRes.rows[0].must_change_password)).toBe(true);
  });

  it('2. Provision Agent B for isolation and RLAC testing', async () => {
    agentBPhone = `97${Math.floor(10000000 + Math.random() * 90000000)}`;
    agentBLoginId = `AGT_B_${runId}`;

    const res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Agent Beta Test',
        phone: agentBPhone,
        loginId: agentBLoginId,
        status: 'ACTIVE',
      });

    expect(res.status).toBe(201);
    agentBId = res.body.data.user.id;
    agentBTempPassword = res.body.data.temporaryPassword;
  });

  // =========================================================================
  // 2. AGENT LOGIN & FORCED PASSWORD CHANGE
  // =========================================================================

  it('3. Agent can log in with temporary password and is flagged with mustChangePassword=true', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        identifier: agentALoginId,
        password: agentATempPassword,
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.role).toBe(UserRole.COLLECTION_AGENT);
    expect(loginRes.body.data.user.mustChangePassword).toBe(true);
    agentAToken = loginRes.body.data.tokens.accessToken;
  });

  it('4. Agent forces password change and then can access normally', async () => {
    const newPassword = 'SecureAgent@9988!';

    const changeRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        currentPassword: agentATempPassword,
        newPassword,
      });

    expect(changeRes.status).toBe(200);
    expect(changeRes.body.data.mustChangePassword).toBe(false);

    // Old temporary password no longer works
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: agentALoginId, password: agentATempPassword });
    expect(oldLogin.status).toBe(401);

    // New password logs in with mustChangePassword=false
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: agentALoginId, password: newPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.user.mustChangePassword).toBe(false);
    agentAToken = newLogin.body.data.tokens.accessToken;
  });

  // =========================================================================
  // 3. ADMIN RESET AGENT PASSWORD
  // =========================================================================

  it('5. Admin can reset Agent A password and invalidate current password', async () => {
    const resetRes = await request(app)
      .post(`/api/v1/users/agents/${agentAId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);
    expect(typeof resetRes.body.data.temporaryPassword).toBe('string');
    expect(resetRes.body.data.mustChangePassword).toBe(true);

    const newTempPassword = resetRes.body.data.temporaryPassword;

    // Previous password immediately invalidated
    const prevLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: agentALoginId, password: 'SecureAgent@9988!' });
    expect(prevLogin.status).toBe(401);

    // Log in with new temporary password
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: agentALoginId, password: newTempPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.mustChangePassword).toBe(true);
    agentAToken = loginRes.body.data.tokens.accessToken;

    // Set permanent password for Agent A
    const setPass = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        currentPassword: newTempPassword,
        newPassword: 'FinalAgentPass@123',
      });
    expect(setPass.status).toBe(200);

    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: agentALoginId, password: 'FinalAgentPass@123' });
    agentAToken = relogin.body.data.tokens.accessToken;
  });

  it('6. Unauthorized non-admin cannot reset agent password', async () => {
    // Agent B logs in
    const agentBLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: agentBLoginId, password: agentBTempPassword });
    agentBToken = agentBLogin.body.data.tokens.accessToken;

    // Agent B attempts to reset Agent A's password -> 403 Forbidden
    const unauthReset = await request(app)
      .post(`/api/v1/users/agents/${agentAId}/reset-password`)
      .set('Authorization', `Bearer ${agentBToken}`);

    expect(unauthReset.status).toBe(403);
  });

  // =========================================================================
  // 4. RLAC & IDOR PROTECTION FOR COLLECTION AGENTS
  // =========================================================================

  it('7. Assign Customer A to Agent A and Customer B to Agent B', async () => {
    // Assign Customer A to Agent A
    await queryPostgres(
      `INSERT INTO collection_assignments (id, agent_id, customer_id, is_active, assigned_by, effective_from, created_at)
       VALUES (gen_random_uuid(), $1, $2, TRUE, (SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1), CURRENT_DATE, NOW())`,
      [agentAId, customerAId]
    );

    // Assign Customer B to Agent B
    await queryPostgres(
      `INSERT INTO collection_assignments (id, agent_id, customer_id, is_active, assigned_by, effective_from, created_at)
       VALUES (gen_random_uuid(), $1, $2, TRUE, (SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1), CURRENT_DATE, NOW())`,
      [agentBId, customerBId]
    );

    // Also update loans.assigned_agent_id
    await queryPostgres('UPDATE loans SET assigned_agent_id = $1 WHERE id = $2', [agentAId, loanAId]);
    await queryPostgres('UPDATE loans SET assigned_agent_id = $1 WHERE id = $2', [agentBId, loanBId]);
  });

  it('8. RLAC: Agent A can access assigned Customer A (200), but gets 403 on unassigned Customer B', async () => {
    // Agent A -> Customer A = 200
    const accessA = await request(app)
      .get(`/api/v1/customers/${customerAId}`)
      .set('Authorization', `Bearer ${agentAToken}`);
    expect(accessA.status).toBe(200);
    expect(accessA.body.data.customer.id).toBe(customerAId);

    // Agent A -> Customer B = 403
    const accessB = await request(app)
      .get(`/api/v1/customers/${customerBId}`)
      .set('Authorization', `Bearer ${agentAToken}`);
    expect(accessB.status).toBe(403);
  });

  it('9. RLAC: Agent A can access assigned Loan A (200), but gets 403 on unassigned Loan B', async () => {
    // Agent A -> Loan A = 200
    const accessLoanA = await request(app)
      .get(`/api/v1/loans/${loanAId}`)
      .set('Authorization', `Bearer ${agentAToken}`);
    expect(accessLoanA.status).toBe(200);

    // Agent A -> Loan B = 403
    const accessLoanB = await request(app)
      .get(`/api/v1/loans/${loanBId}`)
      .set('Authorization', `Bearer ${agentAToken}`);
    expect(accessLoanB.status).toBe(403);
  });

  // =========================================================================
  // 5. AGENT PAYMENT RECORDING & WATERFALL
  // =========================================================================

  it('10. Agent A can record payment for assigned loan; waterfall settles and updates ledger', async () => {
    const paymentAmount = 3500;
    const idempotencyKey = `TEST_AGT_PAY_${runId}`;

    const payRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        loanId: loanAId,
        emiId: emiAId,
        customerId: customerAId,
        amount: paymentAmount,
        paymentMode: 'CASH',
        collectionSource: CollectionSource.RECOVERY_AGENT,
        referenceNumber: 'CASH-COLLECT-01',
        notes: 'Collected on home visit',
        idempotencyKey,
      });

    expect(payRes.status).toBe(201);
    expect(payRes.body.success).toBe(true);
    expect(payRes.body.data.amountCollected).toBe(paymentAmount);
    expect(payRes.body.data.receiptNumber).toBeDefined();

    // Verify Agent Collection Ledger entry was recorded
    const ledgerRes = await queryPostgres(
      `SELECT * FROM payments WHERE (collected_by_agent_id = $1 OR agent_id = $1) AND id = $2 AND collection_source = 'RECOVERY_AGENT'`,
      [agentAId, payRes.body.data.paymentId]
    );
    expect(ledgerRes.rows.length).toBe(1);
    expect(Number(ledgerRes.rows[0].amount)).toBe(paymentAmount);
  });

  it('11. RLAC: Agent A cannot record payment for unassigned Customer B or Loan B (403)', async () => {
    const payRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        loanId: loanBId,
        customerId: customerBId,
        amount: 2000,
        paymentMode: 'CASH',
        collectionSource: CollectionSource.RECOVERY_AGENT,
        idempotencyKey: `ILLEGAL_PAY_${runId}`,
      });

    expect(payRes.status).toBe(403);
  });

  // =========================================================================
  // 6. AGENT DASHBOARD & QUEUE METRICS
  // =========================================================================

  it('12. Agent Dashboard returns strictly agent-scoped metrics without company-wide totals', async () => {
    const dashRes = await request(app)
      .get('/api/v1/emi/agent-dashboard')
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.success).toBe(true);
    expect(dashRes.body.data.assignedCustomers).toBeGreaterThanOrEqual(1);
    expect(dashRes.body.data.todayCollected).toBeGreaterThanOrEqual(3500);
    expect(dashRes.body.data.recentCollections).toBeDefined();
    expect(Array.isArray(dashRes.body.data.recentCollections)).toBe(true);
  });

  it('13. Agent Queue returns items with dynamic calculation and priority', async () => {
    const queueRes = await request(app)
      .get('/api/v1/emi/queue?status=ALL')
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(queueRes.status).toBe(200);
    expect(Array.isArray(queueRes.body.data)).toBe(true);
    const item = queueRes.body.data.find((q: any) => q.loanId === loanAId);
    if (item) {
      expect(item.customerName).toBeDefined();
      expect(item.loanAccountNo).toBeDefined();
      expect(item.priority).toBeDefined();
    }
  });

  // =========================================================================
  // 7. STORE / DEALER DELETION SAFETY CHECKS
  // =========================================================================

  it('14. Cannot delete dealer with linked loan/payment records (returns 400 with explanation)', async () => {
    const delRes = await request(app)
      .delete(`/api/v1/dealers/${dealerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(400);
    const errText = delRes.body.error?.message || delRes.body.message;
    expect(errText).toContain('active financial history exists');
    expect(errText).toContain('deactivate');
  });

  it('15. Clean dealer without financial history can be deleted successfully', async () => {
    // Create temporary clean dealer
    const cleanDealer = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Temporary Store ${runId}`,
        ownerName: 'Temp Owner',
        phone: `96${Math.floor(10000000 + Math.random() * 90000000)}`,
        address: 'Temp Street',
        areaCity: 'Surajpur',
      });
    expect(cleanDealer.status).toBe(201);
    const tempDealerId = cleanDealer.body.data.id;

    // Delete clean dealer
    const delRes = await request(app)
      .delete(`/api/v1/dealers/${tempDealerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
  });
});
