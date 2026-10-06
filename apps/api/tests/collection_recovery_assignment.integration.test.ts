import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { UserRole, UserStatus, InterestMethod, RepaymentFrequency, PaymentMode, CollectionSource } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Collection Recovery Assignment & Agent Creation Integration Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;
  let managerToken: string;
  let managerUserId: string;

  // Collection Agents
  let agentAUserId: string;
  let agentAPhone: string;
  let agentATempPassword: string;
  let agentAToken: string;

  let agentBUserId: string;
  let agentBPhone: string;
  let agentBTempPassword: string;
  let agentBToken: string;

  let inactiveAgentUserId: string;

  // Customers & Loans
  let customer1Id: string;
  let loan1Id: string;
  let loan1EmiId: string;

  let customer2Id: string;
  let loan2Id: string;

  beforeAll(async () => {
    // 1. Authenticate as Super Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 2. Create Branch Manager for RBAC testing
    managerUserId = uuidv4();
    const managerPhone = `95${Math.floor(10000000 + Math.random() * 90000000)}`;
    const managerEmail = `mgr_${runId}@crm.com`;
    const managerHash = bcrypt.hashSync('Manager@123', 10);
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, must_change_password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Branch Manager', $5, 'ACTIVE', FALSE, NOW(), NOW())`,
      [managerUserId, managerEmail, managerPhone, managerHash, UserRole.BRANCH_MANAGER]
    );

    const mgrLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: managerEmail, password: 'Manager@123' });
    expect(mgrLogin.status).toBe(200);
    managerToken = mgrLogin.body.data.tokens.accessToken;

    // 3. Create Customer 1 and Customer 2
    const cust1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Customer Alpha ${runId}`,
        primaryPhone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: 'MG Road',
        city: 'Varanasi',
        state: 'UP',
        pincode: '221001',
        areaRoute: 'Route Alpha',
      });
    expect(cust1Res.status).toBe(201);
    customer1Id = cust1Res.body.data.id;

    const cust2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Customer Beta ${runId}`,
        primaryPhone: `92${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: 'Civil Lines',
        city: 'Varanasi',
        state: 'UP',
        pincode: '221002',
        areaRoute: 'Route Beta',
      });
    expect(cust2Res.status).toBe(201);
    customer2Id = cust2Res.body.data.id;

    // 4. Originate and disburse Loan 1 for Customer 1
    const loan1Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        principalAmount: 24000,
        downPayment: 4000,
        annualInterestRate: 12.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
      });
    expect(loan1Res.status).toBe(201);
    loan1Id = loan1Res.body.data.id;

    // Fetch first installment ID
    const loan1Detail = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(loan1Detail.status).toBe(200);
    loan1EmiId = loan1Detail.body.data.installments[0].id;

    // 5. Originate and disburse Loan 2 for Customer 2
    const loan2Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        principalAmount: 30000,
        downPayment: 5000,
        annualInterestRate: 12.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
      });
    expect(loan2Res.status).toBe(201);
    loan2Id = loan2Res.body.data.id;
  });

  // ==========================================
  // AGENT CREATION TESTS (Scenarios 1-8)
  // ==========================================

  it('1. Valid agent creation succeeds', async () => {
    agentAPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    const res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Agent Rahul Kumar',
        phone: agentAPhone,
        loginId: `agent_rahul_${runId}`,
        assignedBranch: 'Varanasi Main',
        areaRoute: 'Route A',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.temporaryPassword).toBeDefined();
    expect(typeof res.body.data.temporaryPassword).toBe('string');
    expect(res.body.data.mustChangePassword).toBe(true);

    agentAUserId = res.body.data.agentId || res.body.data.user.id;
    agentATempPassword = res.body.data.temporaryPassword;
  });

  it('2. Invalid payload returns useful validation error describing which field is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'A', // too short (< 2 chars)
        phone: '123', // invalid phone length
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('Full name must be at least 2 characters');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(1);
  });

  it('3. Missing required field fails with clear error', async () => {
    const res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Agent Without Phone',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('Phone number is required');
  });

  it('4. Optional empty fields ("") are handled correctly and fallback to phone for loginId', async () => {
    agentBPhone = `97${Math.floor(10000000 + Math.random() * 90000000)}`;
    const res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Agent Suresh Verma',
        phone: agentBPhone,
        loginId: '', // empty string optional field
        assignedBranch: '', // empty string optional field
        areaRoute: '', // empty string optional field
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loginId).toBe(agentBPhone); // Fallback to phone
    agentBUserId = res.body.data.agentId || res.body.data.user.id;
    agentBTempPassword = res.body.data.temporaryPassword;
  });

  it('5. Duplicate login identifier is rejected safely', async () => {
    const res = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Agent Duplicate Phone',
        phone: agentAPhone, // Already used by Agent A
      });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('already exists');
  });

  it('6. Temporary password is generated securely (at least 8 chars, mixed complexity)', async () => {
    expect(agentATempPassword.length).toBeGreaterThanOrEqual(8);
    expect(/[A-Z]/.test(agentATempPassword)).toBe(true);
    expect(/[0-9]/.test(agentATempPassword)).toBe(true);
  });

  it('7. Password hash only is persisted; plaintext is never in database', async () => {
    const userRow = await queryPostgres('SELECT password_hash FROM users WHERE id = $1', [agentAUserId]);
    expect(userRow.rows.length).toBe(1);
    const hash = userRow.rows[0].password_hash;
    expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix
    expect(hash).not.toBe(agentATempPassword);
    expect(bcrypt.compareSync(agentATempPassword, hash)).toBe(true);
  });

  it('8. must_change_password is true and agent can authenticate', async () => {
    const userRow = await queryPostgres('SELECT must_change_password FROM users WHERE id = $1', [agentAUserId]);
    expect(userRow.rows[0].must_change_password).toBe(true);

    // Agent A logs in with temporary password
    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `agent_rahul_${runId}`, password: agentATempPassword });
    expect(loginA.status).toBe(200);
    agentAToken = loginA.body.data.tokens.accessToken;

    // Agent B logs in with temporary password (using phone as loginId)
    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: agentBPhone, password: agentBTempPassword });
    expect(loginB.status).toBe(200);
    agentBToken = loginB.body.data.tokens.accessToken;

    // Create an inactive agent for validation test 13
    inactiveAgentUserId = uuidv4();
    const inactPhone = `96${Math.floor(10000000 + Math.random() * 90000000)}`;
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, must_change_password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Inactive Agent', $5, 'INACTIVE', FALSE, NOW(), NOW())`,
      [inactiveAgentUserId, `inactive_${runId}@crm.com`, inactPhone, hashPlaceholder, UserRole.COLLECTION_AGENT]
    );
  });

  const hashPlaceholder = bcrypt.hashSync('Temp@123', 10);

  // ==========================================
  // ASSIGNMENT & REASSIGNMENT (Scenarios 9-15)
  // ==========================================

  it('9. Admin can assign loan to Agent A', async () => {
    const res = await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agentAUserId,
        notes: 'Priority overdue recovery',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.assignedAgentId).toBe(agentAUserId);
    expect(res.body.data.isReassignment).toBe(false);

    // Verify database loans record
    const loanDb = await queryPostgres('SELECT assigned_agent_id FROM loans WHERE id = $1', [loan1Id]);
    expect(loanDb.rows[0].assigned_agent_id).toBe(agentAUserId);
  });

  it('10. Branch Manager can assign loan if RBAC permits it', async () => {
    const res = await request(app)
      .post(`/api/v1/loans/${loan2Id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        agentId: agentBUserId,
        notes: 'Assigned by branch manager',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedAgentId).toBe(agentBUserId);
  });

  it('11. Admin can reassign Agent A -> Agent B', async () => {
    const res = await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agentBUserId,
        notes: 'Reassigned to Suresh',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedAgentId).toBe(agentBUserId);
    expect(res.body.data.isReassignment).toBe(true);

    const loanDb = await queryPostgres('SELECT assigned_agent_id FROM loans WHERE id = $1', [loan1Id]);
    expect(loanDb.rows[0].assigned_agent_id).toBe(agentBUserId);
  });

  it('12. Admin can unassign loan', async () => {
    const res = await request(app)
      .post(`/api/v1/loans/${loan1Id}/unassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reason: 'Customer promised to pay online',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.assignedAgentId).toBeNull();

    const loanDb = await queryPostgres('SELECT assigned_agent_id FROM loans WHERE id = $1', [loan1Id]);
    expect(loanDb.rows[0].assigned_agent_id).toBeNull();
  });

  it('13. Inactive agent cannot be selected/assigned', async () => {
    const res = await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: inactiveAgentUserId,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('inactive collection agent');
  });

  it('14. Assignment history/audit is recorded', async () => {
    // Reassign Loan 1 back to Agent A
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentAUserId });

    const histRes = await request(app)
      .get(`/api/v1/loans/${loan1Id}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(histRes.status).toBe(200);
    expect(Array.isArray(histRes.body.data)).toBe(true);
    // Should have records of previous assignments (Agent A -> Agent B -> Agent A)
    expect(histRes.body.data.length).toBeGreaterThanOrEqual(2);

    // Verify audit_logs table
    const audits = await queryPostgres(
      `SELECT action, entity, entity_id FROM audit_logs WHERE entity_id = $1 ORDER BY created_at DESC`,
      [loan1Id]
    );
    expect(audits.rows.some((a) => a.action === 'LOAN_RECOVERY_ASSIGNED')).toBe(true);
  });

  it('15. Two active assignments cannot exist for one loan', async () => {
    const activeAssignments = await queryPostgres(
      'SELECT id, agent_id FROM collection_assignments WHERE loan_id = $1 AND is_active = TRUE',
      [loan1Id]
    );
    expect(activeAssignments.rows.length).toBe(1);
    expect(activeAssignments.rows[0].agent_id).toBe(agentAUserId);
  });

  // ==========================================
  // ROW-LEVEL ACCESS CONTROL (RLAC) (Scenarios 16-22)
  // ==========================================

  it('16. Agent A can access assigned loan', async () => {
    const res = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(loan1Id);
    expect(res.body.data.assignedAgentId).toBe(agentAUserId);
  });

  it('17. Agent B receives 403 for Agent A\'s loan', async () => {
    const res = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${agentBToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('You do not have access');
  });

  it('18. Agent A receives 403 after reassignment to Agent B', async () => {
    // Reassign Loan 1 to Agent B
    const reassignRes = await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentBUserId });
    expect(reassignRes.status).toBe(200);

    // Agent A tries to access Loan 1 now -> 403
    const resA = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(resA.status).toBe(403);
  });

  it('19. Agent B can access immediately after reassignment', async () => {
    const resB = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${agentBToken}`);

    expect(resB.status).toBe(200);
    expect(resB.body.data.id).toBe(loan1Id);
  });

  it('20. Any unassigned loan returns 403 to Collection Agent', async () => {
    // Unassign Loan 1
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/unassign`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${agentBToken}`);

    expect(res.status).toBe(403);
  });

  it('21. Agent cannot access unrelated loan through ID manipulation', async () => {
    // Loan 2 is assigned to Agent B. Agent A attempts to access Loan 2 -> 403
    const res = await request(app)
      .get(`/api/v1/loans/${loan2Id}`)
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(res.status).toBe(403);
  });

  it('22. Agent cannot access another agent\'s payment ledger through ID manipulation', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections/agents/${agentBUserId}`)
      .set('Authorization', `Bearer ${agentAToken}`);

    // Should return 403 since agent A cannot access agent B ledger
    expect(res.status).toBe(403);
  });

  // ==========================================
  // PAYMENTS AUTHORIZATION (Scenarios 23-30)
  // ==========================================

  it('23. Agent can record payment for assigned loan', async () => {
    // Assign Loan 1 to Agent A
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentAUserId });

    const payRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        emiId: loan1EmiId,
        amount: 3000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agentAUserId,
        idempotencyKey: `TEST_PAY_${loan1Id}_${Date.now()}`,
      });

    expect(payRes.status).toBe(201);
    expect(payRes.body.success).toBe(true);
    expect(payRes.body.data.receiptNumber).toMatch(/^RCP-/);
  });

  it('24. Agent cannot record payment for unassigned loan', async () => {
    // Unassign Loan 1
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/unassign`)
      .set('Authorization', `Bearer ${adminToken}`);

    const payRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        emiId: loan1EmiId,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agentAUserId,
        idempotencyKey: `TEST_PAY_UNASSIGNED_${Date.now()}`,
      });

    expect(payRes.status).toBe(403);
  });

  it('25. Agent cannot record payment for another agent\'s loan', async () => {
    // Assign Loan 1 to Agent B
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentBUserId });

    // Agent A tries to record payment for Loan 1 -> 403
    const payRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        emiId: loan1EmiId,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agentAUserId,
        idempotencyKey: `TEST_PAY_ANOTHER_${Date.now()}`,
      });

    expect(payRes.status).toBe(403);
  });

  it('26. Existing waterfall remains correct for agent collected payment', async () => {
    // Agent B records payment of 2000 on Loan 1
    const payRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentBToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        emiId: loan1EmiId,
        amount: 2000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agentBUserId,
        idempotencyKey: `TEST_WATERFALL_${Date.now()}`,
      });

    expect(payRes.status).toBe(201);
    expect(payRes.body.data.allocatedInstallments).toBeDefined();
    expect(Array.isArray(payRes.body.data.allocatedInstallments)).toBe(true);
    expect(payRes.body.data.allocatedInstallments.length).toBeGreaterThanOrEqual(1);
    const alloc = payRes.body.data.allocatedInstallments[0];
    expect(alloc.allocatedToPrincipalInterest).toBeDefined();
    expect(alloc.allocatedAmount).toBe(2000);
  });

  it('27. Agent collection ledger entry is created with collected_by_agent_id', async () => {
    const payment = await queryPostgres(
      `SELECT collected_by_agent_id, collection_source FROM payments WHERE loan_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [loan1Id]
    );
    expect(payment.rows[0].collected_by_agent_id).toBe(agentBUserId);
    expect(payment.rows[0].collection_source).toBe(CollectionSource.RECOVERY_AGENT);
  });

  it('28. Receipt is generated for the recovery agent payment', async () => {
    const payment = await queryPostgres(
      `SELECT receipt_number FROM payments WHERE loan_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [loan1Id]
    );
    expect(payment.rows[0].receipt_number).toMatch(/^RCP-/);
  });

  it('29. Audit entry is generated for payment collection', async () => {
    const auditRes = await queryPostgres(
      `SELECT action FROM audit_logs WHERE user_id = $1 AND action = 'PAYMENT_COLLECTED'`,
      [agentBUserId]
    );
    expect(auditRes.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('30. Idempotency behavior remains intact', async () => {
    const key = `IDEMP_KEY_${Date.now()}`;
    const firstRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentBToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        emiId: loan1EmiId,
        amount: 500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agentBUserId,
        idempotencyKey: key,
      });
    expect(firstRes.status).toBe(201);

    const dupRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentBToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        emiId: loan1EmiId,
        amount: 500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agentBUserId,
        idempotencyKey: key,
      });

    // Idempotent duplicate returns 200 with matching payment ID
    expect([200, 201]).toContain(dupRes.status);
    expect(dupRes.body.data.id).toBe(firstRes.body.data.id);
  });

  // ==========================================
  // DASHBOARD & QUEUE (Scenarios 31-34)
  // ==========================================

  it('31. Agent queue and dashboard only return assigned recovery cases', async () => {
    // Currently Loan 1 is assigned to Agent B, Loan 2 is assigned to Agent B
    const queueB = await request(app)
      .get('/api/v1/emi/agent-queue')
      .set('Authorization', `Bearer ${agentBToken}`);

    expect(queueB.status).toBe(200);
    const loansInQueueB = queueB.body.data.items.map((i: any) => i.loanId);
    expect(loansInQueueB).toContain(loan1Id);

    // Agent A has 0 loans assigned
    const queueA = await request(app)
      .get('/api/v1/emi/agent-queue')
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(queueA.status).toBe(200);
    const loansInQueueA = queueA.body.data.items.map((i: any) => i.loanId);
    expect(loansInQueueA).not.toContain(loan1Id);
    expect(loansInQueueA).not.toContain(loan2Id);
  });

  it('32. Reassignment immediately changes the returned dataset', async () => {
    // Reassign Loan 1 to Agent A
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentAUserId });

    // Agent A queue now contains Loan 1
    const queueA = await request(app)
      .get('/api/v1/emi/agent-queue')
      .set('Authorization', `Bearer ${agentAToken}`);
    expect(queueA.body.data.items.some((i: any) => i.loanId === loan1Id)).toBe(true);

    // Agent B queue no longer contains Loan 1
    const queueB = await request(app)
      .get('/api/v1/emi/agent-queue')
      .set('Authorization', `Bearer ${agentBToken}`);
    expect(queueB.body.data.items.some((i: any) => i.loanId === loan1Id)).toBe(false);
  });

  it('33. Unassignment removes the case from the agent\'s recovery queue', async () => {
    // Unassign Loan 1
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/unassign`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Agent A queue no longer contains Loan 1
    const queueA = await request(app)
      .get('/api/v1/emi/agent-queue')
      .set('Authorization', `Bearer ${agentAToken}`);
    expect(queueA.body.data.items.some((i: any) => i.loanId === loan1Id)).toBe(false);
  });

  it('34. Summary dashboard totals only include assigned cases', async () => {
    const dashA = await request(app)
      .get('/api/v1/emi/agent-dashboard')
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(dashA.status).toBe(200);
    // Since Loan 1 was unassigned, activeLoans for Agent A should be 0
    expect(dashA.body.data.activeLoans).toBe(0);

    // Reassign Loan 1 to Agent A
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentAUserId });

    const dashAUpdated = await request(app)
      .get('/api/v1/emi/agent-dashboard')
      .set('Authorization', `Bearer ${agentAToken}`);
    expect(dashAUpdated.body.data.activeLoans).toBe(1);
  });
});
