import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import {
  UserRole,
  DealerStatus,
  LoanStatus,
  InterestMethod,
  RepaymentFrequency,
  PaymentMode,
  CollectionSource,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('TASK 2: Payment Collection Source Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@collsource.com`;
  const managerEmail = `mgr_${runId}@collsource.com`;
  const agent1Email = `agent1_${runId}@collsource.com`;
  const agent2Email = `agent2_${runId}@collsource.com`;
  const accountantEmail = `acct_${runId}@collsource.com`;

  let adminToken: string;
  let managerToken: string;
  let agent1Token: string;
  let agent2Token: string;
  let accountantToken: string;

  let adminId: string;
  let managerId: string;
  let agent1Id: string;
  let agent2Id: string;
  let accountantId: string;

  let activeDealerId: string;
  let activeDealerCode: string;
  let inactiveDealerId: string;

  let customer1Id: string;
  let customer2Id: string;
  let loan1Id: string;
  let loan1AccNo: string;
  let loan2Id: string;
  let loan2AccNo: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agent1Id = uuidv4();
    agent2Id = uuidv4();
    accountantId = uuidv4();

    // 1. Create Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9810${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9810${numId}2`, hash]);

    // 3. Create Agent 1
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Rahul Singh', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent1Id, agent1Email, `9810${numId}3`, hash]);

    // 4. Create Agent 2
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Amit Verma', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent2Id, agent2Email, `9810${numId}4`, hash]);

    // 5. Create Inactive Manager (non-agent user)
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Finance Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [accountantId, accountantEmail, `9810${numId}5`, hash]);

    // Login users to get tokens
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'Password@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const agent1Login = await request(app).post('/api/v1/auth/login').send({ email: agent1Email, password: 'Password@123' });
    agent1Token = agent1Login.body.data.tokens.accessToken;

    const agent2Login = await request(app).post('/api/v1/auth/login').send({ email: agent2Email, password: 'Password@123' });
    agent2Token = agent2Login.body.data.tokens.accessToken;

    const acctLogin = await request(app).post('/api/v1/auth/login').send({ email: accountantEmail, password: 'Password@123' });
    accountantToken = acctLogin.body.data.tokens.accessToken;

    // Create Active Dealer
    const activeDealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Rathore Mobile Dadri ${runId}`,
        ownerName: 'Rakesh Rathore',
        phone: `9820${numId}1`,
        address: 'Main Bazaar',
        areaCity: 'Dadri',
      });
    activeDealerId = activeDealerRes.body.data.id;
    activeDealerCode = activeDealerRes.body.data.dealerCode;

    // Create Inactive Dealer
    const inactiveDealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Closed Store ${runId}`,
        ownerName: 'Old Owner',
        phone: `9820${numId}2`,
        address: 'Old Market',
        areaCity: 'Noida',
      });
    inactiveDealerId = inactiveDealerRes.body.data.id;
    // Deactivate dealer
    await request(app)
      .patch(`/api/v1/dealers/${inactiveDealerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: DealerStatus.INACTIVE, reason: 'Business shut down' });

    // Create Customer 1 (Route A)
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Vikram Malhotra ${runId}`,
        primaryPhone: `9830${numId}1`,
        addressLine1: 'House 12, Dadri',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '203207',
        areaRoute: `ROUTE-A-${runId}`,
      });
    customer1Id = c1Res.body.data.id;

    // Create Customer 2 (Route B)
    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Suresh Raina ${runId}`,
        primaryPhone: `9830${numId}2`,
        addressLine1: 'House 44, Surajpur',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '201306',
        areaRoute: `ROUTE-B-${runId}`,
      });
    customer2Id = c2Res.body.data.id;

    // Create Loan 1 for Customer 1 (with Active Dealer and Assigned Agent 1)
    const l1Draft = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        dealerId: activeDealerId,
        principalAmount: 10000,
        downPayment: 0,
        annualInterestRate: 24,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 4,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agent1Id,
        status: LoanStatus.ACTIVE,
      });
    loan1Id = l1Draft.body.data.id;
    loan1AccNo = l1Draft.body.data.loanAccountNo;

    // Create Loan 2 for Customer 2 (Assigned to Agent 2)
    const l2Draft = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        principalAmount: 12000,
        downPayment: 0,
        annualInterestRate: 20,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agent2Id,
        status: LoanStatus.ACTIVE,
      });
    loan2Id = l2Draft.body.data.id;
    loan2AccNo = l2Draft.body.data.loanAccountNo;

    // Assign Customer 1 to Agent 1 in collection_assignments for RLAC
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES (uuid_generate_v4(), $1, $2, $3, $4, NOW(), TRUE, NOW())
    `, [agent1Id, customer1Id, `ROUTE-A-${runId}`, adminId]);

    // Assign Customer 2 to Agent 2 in collection_assignments for RLAC
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES (uuid_generate_v4(), $1, $2, $3, $4, NOW(), TRUE, NOW())
    `, [agent2Id, customer2Id, `ROUTE-B-${runId}`, adminId]);
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  let directPaymentId: string;
  let dealerPaymentId: string;
  let agentPaymentId: string;

  // 1. Direct customer payment works
  it('1. Direct customer payment works without dealer or agent', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2700,
        paymentMode: PaymentMode.UPI,
        referenceNumber: `UPI-DIR-${runId}-1`,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        idempotencyKey: `IDEMP_DIR_${runId}_1`,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.collectionSource).toBe(CollectionSource.DIRECT_CUSTOMER);
    expect(res.body.data.dealerId).toBeNull();
    expect(res.body.data.agentId).toBeNull();

    directPaymentId = res.body.data.paymentId;

    // Verify database record
    const dbRes = await queryPostgres('SELECT collection_source, dealer_id, agent_id FROM payments WHERE id = $1', [directPaymentId]);
    expect(dbRes.rows[0].collection_source).toBe('DIRECT_CUSTOMER');
    expect(dbRes.rows[0].dealer_id).toBeNull();
    expect(dbRes.rows[0].agent_id).toBeNull();
  });

  // 2. Dealer payment works with active dealer
  it('2. Dealer payment works with active partner store', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2700,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: activeDealerId,
        idempotencyKey: `IDEMP_DLR_${runId}_2`,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.collectionSource).toBe(CollectionSource.DEALER);
    expect(res.body.data.dealerId).toBe(activeDealerId);
    expect(res.body.data.agentId).toBeNull();

    dealerPaymentId = res.body.data.paymentId;

    // Verify audit log
    const auditRes = await queryPostgres(
      `SELECT * FROM audit_logs WHERE entity = 'Payment' AND entity_id = $1 AND action = 'PAYMENT_COLLECTED'`,
      [dealerPaymentId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].new_state.collectionSource).toBe(CollectionSource.DEALER);
    expect(auditRes.rows[0].new_state.dealerId).toBe(activeDealerId);
  });

  // 3. Recovery agent payment works with assigned agent
  it('3. Recovery agent payment works when recorded by assigned agent', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2700,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agent1Id,
        idempotencyKey: `IDEMP_AGT_${runId}_3`,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.collectionSource).toBe(CollectionSource.RECOVERY_AGENT);
    expect(res.body.data.agentId).toBe(agent1Id);
    expect(res.body.data.dealerId).toBeNull();

    agentPaymentId = res.body.data.paymentId;
  });

  // 4. Dealer payment requires dealerId
  it('4. Dealer payment requires dealerId in validation', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        idempotencyKey: `IDEMP_ERR_${runId}_4`,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // 5. Agent payment requires agentId
  it('5. Agent payment requires agentId in validation', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        idempotencyKey: `IDEMP_ERR_${runId}_5`,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/agent id is required/i);
  });

  // 6. Direct payment cannot have dealerId
  it('6. Direct payment cannot have dealerId', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        dealerId: activeDealerId,
        idempotencyKey: `IDEMP_ERR_${runId}_6`,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // 7. Direct payment cannot have agentId
  it('7. Direct payment cannot have agentId', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        agentId: agent1Id,
        idempotencyKey: `IDEMP_ERR_${runId}_7`,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // 8. Dealer payment cannot have agentId
  it('8. Dealer payment cannot have agentId', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: activeDealerId,
        agentId: agent1Id,
        idempotencyKey: `IDEMP_ERR_${runId}_8`,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // 9. Agent payment cannot have dealerId
  it('9. Agent payment cannot have dealerId', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agent1Id,
        dealerId: activeDealerId,
        idempotencyKey: `IDEMP_ERR_${runId}_9`,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // 10. Inactive dealer cannot receive a new payment
  it('10. Inactive dealer cannot receive a new payment', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: inactiveDealerId,
        idempotencyKey: `IDEMP_ERR_${runId}_10`,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/inactive/i);
  });

  // 11. Invalid/non-agent user cannot be selected as recovery agent
  it('11. Non-agent user cannot be selected as recovery agent', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: accountantId,
        idempotencyKey: `IDEMP_ERR_${runId}_11`,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/collection agent/i);
  });

  // 12. Recovery agent cannot create payment under another agent
  it('12. Recovery agent cannot create payment under another agent', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agent2Id,
        idempotencyKey: `IDEMP_ERR_${runId}_12`,
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/another agent/i);
  });

  // 13. Existing payment waterfall remains unchanged
  it('13. Payment waterfall applies identically regardless of collection source', async () => {
    // Check loan remaining balance reduced accurately after the 3 payments (2700 * 3 = 8100)
    const loanRes = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(loanRes.status).toBe(200);
    // Loan total was 10000 + (10000 * 0.24 * 4 / 12) = 10800.
    // 8100 was paid. Remaining total should be 2700.
    const remaining = Number(loanRes.body.data.outstandingBalance || loanRes.body.data.outstanding_balance);
    expect(remaining).toBe(2700);
  });

  // 14. Payment reversal preserves collection-source information
  it('14. Payment reversal preserves collection-source metadata on payment and audit log', async () => {
    const revRes = await request(app)
      .post(`/api/v1/payments/${dealerPaymentId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer disputed store receipt' });

    expect(revRes.status).toBe(200);
    expect(revRes.body.success).toBe(true);
    expect(revRes.body.data.reversedPaymentId).toBe(dealerPaymentId);

    // Verify DB original payment
    const dbRes = await queryPostgres('SELECT status, collection_source, dealer_id FROM payments WHERE id = $1', [dealerPaymentId]);
    expect(dbRes.rows[0].status).toBe('REVERSED');
    expect(dbRes.rows[0].collection_source).toBe('DEALER');
    expect(dbRes.rows[0].dealer_id).toBe(activeDealerId);

    // Verify reversal audit payment record in DB
    const revPayRes = await queryPostgres('SELECT collection_source, dealer_id, is_reversal FROM payments WHERE reversed_payment_id = $1', [dealerPaymentId]);
    expect(revPayRes.rows.length).toBe(1);
    expect(revPayRes.rows[0].is_reversal).toBe(true);
    expect(revPayRes.rows[0].collection_source).toBe('DEALER');
    expect(revPayRes.rows[0].dealer_id).toBe(activeDealerId);

    // Verify Reversal Audit Log
    const auditRes = await queryPostgres(
      `SELECT * FROM audit_logs WHERE entity = 'Payment' AND entity_id = $1 AND action = 'PAYMENT_REVERSED'`,
      [dealerPaymentId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].new_state.collectionSource).toBe(CollectionSource.DEALER);
    expect(auditRes.rows[0].new_state.dealerId).toBe(activeDealerId);
  });

  // 15. Existing historical payments remain valid
  it('15. Historical payments with default DIRECT_CUSTOMER remain valid and retrievable', async () => {
    // Create an un-sourced historical payment directly in the DB
    const histPaymentId = uuidv4();
    await queryPostgres(`
      INSERT INTO payments (
        id, loan_id, customer_id, receipt_number, amount, payment_mode,
        collected_by_agent_id, status, is_reversal, collection_source, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 2000, 'CASH',
        $5, 'SUCCESS', false, 'DIRECT_CUSTOMER', NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'
      )
    `, [histPaymentId, loan2Id, customer2Id, `REC-HIST-${numId}`, adminId]);

    const receiptRes = await request(app)
      .get(`/api/v1/payments/receipt/${histPaymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.data.collectionSource).toBe(CollectionSource.DIRECT_CUSTOMER);
    expect(receiptRes.body.data.dealer).toBeNull();
    expect(receiptRes.body.data.agent).toBeNull();
  });

  // 16. RBAC remains enforced
  it('16. Collection Agent cannot create DEALER or DIRECT_CUSTOMER payments', async () => {
    // Agent trying DEALER
    const resDealer = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: activeDealerId,
        idempotencyKey: `IDEMP_RBAC_1_${runId}`,
      });
    expect(resDealer.status).toBe(403);

    // Agent trying DIRECT_CUSTOMER
    const resDirect = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 500,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        idempotencyKey: `IDEMP_RBAC_2_${runId}`,
      });
    expect(resDirect.status).toBe(403);
  });

  // 17. RLAC remains enforced
  it('17. Recovery Agent on Route A cannot record payment for Customer on Route B', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id, // Route B
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agent1Id,
        idempotencyKey: `IDEMP_RLAC_${runId}`,
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // 18. Receipt contains collection source and partner store / agent details
  it('18. Receipt endpoint returns collection source, partner store info, or agent info', async () => {
    // Check Agent Payment Receipt
    const agentReceiptRes = await request(app)
      .get(`/api/v1/payments/receipt/${agentPaymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(agentReceiptRes.status).toBe(200);
    expect(agentReceiptRes.body.data.collectionSource).toBe(CollectionSource.RECOVERY_AGENT);
    expect(agentReceiptRes.body.data.agent?.name).toBe('Rahul Singh');

    // Check Dealer Payment Receipt
    const dealerReceiptRes = await request(app)
      .get(`/api/v1/payments/receipt/${dealerPaymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(dealerReceiptRes.status).toBe(200);
    expect(dealerReceiptRes.body.data.collectionSource).toBe(CollectionSource.DEALER);
    expect(dealerReceiptRes.body.data.dealer?.storeName).toContain('Rathore Mobile');
  });

  // 19. Payment list displays collection source and filtered columns
  it('19. Payment list returns collectionSource, dealerStoreName, dealerCode, and agentName', async () => {
    const listRes = await request(app)
      .get(`/api/v1/payments?loanId=${loan1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(3);

    const payments = listRes.body.data;
    const directP = payments.find((p: any) => p.id === directPaymentId);
    const agentP = payments.find((p: any) => p.id === agentPaymentId);

    expect(directP.collectionSource).toBe(CollectionSource.DIRECT_CUSTOMER);
    expect(agentP.collectionSource).toBe(CollectionSource.RECOVERY_AGENT);
    expect(agentP.agentName).toBe('Rahul Singh');
  });
});
