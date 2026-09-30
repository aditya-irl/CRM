import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import {
  UserRole,
  LoanStatus,
  InterestMethod,
  RepaymentFrequency,
  PaymentMode,
  CollectionSource,
  PaymentStatus,
  getBusinessDate,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('TASK 7: Receipts & Payment History Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@payhistory.com`;
  const managerEmail = `mgr_${runId}@payhistory.com`;
  const agent1Email = `agent1_${runId}@payhistory.com`;
  const agent2Email = `agent2_${runId}@payhistory.com`;

  let adminToken: string;
  let managerToken: string;
  let agent1Token: string;
  let agent2Token: string;

  let adminId: string;
  let managerId: string;
  let agent1Id: string;
  let agent2Id: string;

  let dealerId: string;

  let customer1Id: string;
  let customer2Id: string;
  let loan1Id: string;
  let loan1AccNo: string;
  let loan2Id: string;
  let loan2AccNo: string;

  let paymentDirectId: string;
  let paymentDirectReceipt: string;
  let paymentDealerId: string;
  let paymentDealerReceipt: string;
  let paymentAgentId: string;
  let paymentAgentReceipt: string;
  let paymentReversedId: string;
  let paymentReversedReceipt: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agent1Id = uuidv4();
    agent2Id = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9817${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9817${numId}2`, hash]);

    // 3. Create Recovery Agent 1
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Ramesh Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent1Id, agent1Email, `9817${numId}3`, hash]);

    // 4. Create Recovery Agent 2
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Suresh Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent2Id, agent2Email, `9817${numId}4`, hash]);

    // Authenticate users
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'Password@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const agent1Login = await request(app).post('/api/v1/auth/login').send({ email: agent1Email, password: 'Password@123' });
    agent1Token = agent1Login.body.data.tokens.accessToken;

    const agent2Login = await request(app).post('/api/v1/auth/login').send({ email: agent2Email, password: 'Password@123' });
    agent2Token = agent2Login.body.data.tokens.accessToken;

    // Create Dealer
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Mobile World ${runId}`,
        ownerName: 'Manish World',
        phone: `9828${numId}1`,
        address: 'MG Road Plaza',
        areaCity: 'Bangalore',
      });
    dealerId = dealerRes.body.data.id;

    // Create Customer 1
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Devendra Sharma ${runId}`,
        primaryPhone: `9838${numId}1`,
        addressLine1: '45 Lake View Residency',
        city: 'Bangalore',
        state: 'Karnataka',
        pincode: '560038',
        areaRoute: 'Indiranagar',
      });
    customer1Id = c1Res.body.data.id;

    // Create Customer 2
    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Pooja Hegde ${runId}`,
        primaryPhone: `9838${numId}2`,
        addressLine1: '88 Cyber Park',
        city: 'Bangalore',
        state: 'Karnataka',
        pincode: '560100',
        areaRoute: 'Electronic City',
      });
    customer2Id = c2Res.body.data.id;

    // Originate Loan 1 for Customer 1
    const l1Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        dealerId,
        principalAmount: 30000,
        downPayment: 5000,
        annualInterestRate: 14.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-09-01',
      });
    loan1Id = l1Res.body.data.id;
    loan1AccNo = l1Res.body.data.loanAccountNo;

    // Originate Loan 2 for Customer 2
    const l2Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        principalAmount: 24000,
        downPayment: 4000,
        annualInterestRate: 12.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-09-01',
      });
    loan2Id = l2Res.body.data.id;
    loan2AccNo = l2Res.body.data.loanAccountNo;

    // Assign customer2 to agent1 for RLAC
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, NOW())
    `, [uuidv4(), agent1Id, customer2Id, `ROUTE-T7-${runId}`, adminId]);

    // Record Payment 1: DIRECT_CUSTOMER (₹5,000, UPI)
    const p1Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 5000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: `UPI_DIR_${runId}`,
        notes: 'Direct online payment by customer',
        idempotencyKey: `IDEMP_DIR_T7_${runId}`,
      });
    paymentDirectId = p1Res.body.data.paymentId;
    paymentDirectReceipt = p1Res.body.data.receiptNumber;

    // Record Payment 2: DEALER (₹4,000, CASH)
    const p2Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 4000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId,
        referenceNumber: `DLR_CASH_${runId}`,
        notes: 'Paid at partner store counter',
        idempotencyKey: `IDEMP_DLR_T7_${runId}`,
      });
    paymentDealerId = p2Res.body.data.paymentId;
    paymentDealerReceipt = p2Res.body.data.receiptNumber;

    // Record Payment 3: RECOVERY_AGENT (₹3,000, CASH)
    const p3Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 3000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        referenceNumber: `AGT_CASH_${runId}`,
        notes: 'Collected on route visit',
        idempotencyKey: `IDEMP_AGT_T7_${runId}`,
      });
    paymentAgentId = p3Res.body.data.paymentId;
    paymentAgentReceipt = p3Res.body.data.receiptNumber;

    // Record Payment 4: To be Reversed (₹2,500, BANK_TRANSFER)
    const p4Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 2500,
        paymentMode: PaymentMode.BANK_TRANSFER,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: `REV_PAY_${runId}`,
        notes: 'Erroneous duplicate transfer',
        idempotencyKey: `IDEMP_REV_T7_${runId}`,
      });
    paymentReversedId = p4Res.body.data.paymentId;
    paymentReversedReceipt = p4Res.body.data.receiptNumber;

    // Reverse Payment 4
    await request(app)
      .post(`/api/v1/payments/${paymentReversedId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer accidentally paid twice via NEFT; refund initiated.' });
  });

  afterAll(async () => {
    await closePostgresPool();
    await closeRedisConnection();
    await closeAllQueues();
  });

  // 1. Global payment history returns direct customer payments
  it('1. Global payment history returns direct customer payments', async () => {
    const res = await request(app)
      .get('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const directP = res.body.data.find((p: any) => p.id === paymentDirectId);
    expect(directP).toBeDefined();
    expect(directP.collectionSource).toBe(CollectionSource.DIRECT_CUSTOMER);
    expect(directP.amount).toBe(5000);
    expect(directP.receiptNumber).toBe(paymentDirectReceipt);
  });

  // 2. Global payment history returns dealer payments
  it('2. Global payment history returns dealer payments with dealer store details', async () => {
    const res = await request(app)
      .get('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const dealerP = res.body.data.find((p: any) => p.id === paymentDealerId);
    expect(dealerP).toBeDefined();
    expect(dealerP.collectionSource).toBe(CollectionSource.DEALER);
    expect(dealerP.dealerStoreName).toContain('Mobile World');
  });

  // 3. Global payment history returns recovery-agent payments
  it('3. Global payment history returns recovery-agent payments with agent name', async () => {
    const res = await request(app)
      .get('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const agentP = res.body.data.find((p: any) => p.id === paymentAgentId);
    expect(agentP).toBeDefined();
    expect(agentP.collectionSource).toBe(CollectionSource.RECOVERY_AGENT);
    expect(agentP.agentName).toContain('Ramesh Agent');
  });

  // 4. Collection source filter works
  it('4. Collection source filter isolates direct, dealer, and recovery agent records', async () => {
    const resDirect = await request(app)
      .get(`/api/v1/payments?collectionSource=${CollectionSource.DIRECT_CUSTOMER}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resDirect.status).toBe(200);
    expect(resDirect.body.data.every((p: any) => p.collectionSource === CollectionSource.DIRECT_CUSTOMER)).toBe(true);

    const resDealer = await request(app)
      .get(`/api/v1/payments?collectionSource=${CollectionSource.DEALER}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resDealer.status).toBe(200);
    expect(resDealer.body.data.every((p: any) => p.collectionSource === CollectionSource.DEALER)).toBe(true);

    const resAgent = await request(app)
      .get(`/api/v1/payments?collectionSource=${CollectionSource.RECOVERY_AGENT}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resAgent.status).toBe(200);
    expect(resAgent.body.data.every((p: any) => p.collectionSource === CollectionSource.RECOVERY_AGENT)).toBe(true);
  });

  // 5. Status filter works
  it('5. Status filter properly returns COMPLETED vs REVERSED payments', async () => {
    const resSuccess = await request(app)
      .get('/api/v1/payments?status=SUCCESS')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body.data.every((p: any) => p.status === 'SUCCESS' && !p.isReversal)).toBe(true);

    const resReversed = await request(app)
      .get('/api/v1/payments?status=REVERSED')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resReversed.status).toBe(200);
    const revP = resReversed.body.data.find((p: any) => p.id === paymentReversedId);
    expect(revP).toBeDefined();
    expect(revP.status).toBe('REVERSED');
  });

  // 6. Payment method filter works
  it('6. Payment method filter properly filters by UPI, CASH, and BANK_TRANSFER', async () => {
    const resUpi = await request(app)
      .get(`/api/v1/payments?paymentMode=${PaymentMode.UPI}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resUpi.status).toBe(200);
    expect(resUpi.body.data.every((p: any) => p.paymentMode === PaymentMode.UPI)).toBe(true);

    const resCash = await request(app)
      .get(`/api/v1/payments?paymentMode=${PaymentMode.CASH}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resCash.status).toBe(200);
    expect(resCash.body.data.every((p: any) => p.paymentMode === PaymentMode.CASH)).toBe(true);
  });

  // 7. Date filters work
  it('7. Date filters in Asia/Kolkata timezone properly filter transactions', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');
    const res = await request(app)
      .get(`/api/v1/payments?startDate=${today}&endDate=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);

    const resFuture = await request(app)
      .get('/api/v1/payments?startDate=2035-01-01&endDate=2035-01-31')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resFuture.status).toBe(200);
    expect(resFuture.body.data.length).toBe(0);
  });

  // 8. Search works
  it('8. Search query matches across customer name, phone, receipt number, and loan account', async () => {
    const resName = await request(app)
      .get(`/api/v1/payments?search=Devendra`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resName.status).toBe(200);
    expect(resName.body.data.some((p: any) => p.customerName.includes('Devendra'))).toBe(true);

    const resReceipt = await request(app)
      .get(`/api/v1/payments?search=${paymentDirectReceipt}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resReceipt.status).toBe(200);
    expect(resReceipt.body.data.some((p: any) => p.receiptNumber === paymentDirectReceipt)).toBe(true);

    const resLoan = await request(app)
      .get(`/api/v1/payments?search=${loan1AccNo}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resLoan.status).toBe(200);
    expect(resLoan.body.data.some((p: any) => p.loanAccountNo === loan1AccNo)).toBe(true);
  });

  // 9. Pagination works
  it('9. Server-side pagination properly limits and offsets payment records', async () => {
    const res = await request(app)
      .get('/api/v1/payments?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(2);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(4);
    expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(2);
  });

  // 10. Global payment summary KPI calculation
  it('10. Global payment summary endpoint accurately calculates active collections', async () => {
    const res = await request(app)
      .get('/api/v1/payments/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const summary = res.body.data;
    expect(summary.totalCollections).toBeGreaterThan(0);
    expect(summary.paymentCount).toBeGreaterThan(0);
    expect(summary.todayCollections).toBeGreaterThan(0);
    expect(summary.averageCollection).toBeGreaterThan(0);
  });

  // 11. Source breakdown in payment summary
  it('11. Source breakdown KPI accurately aggregates per-channel amounts and counts', async () => {
    const res = await request(app)
      .get('/api/v1/payments/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const bd = res.body.data.sourceBreakdown;
    expect(bd).toBeDefined();
    expect(bd.directCustomer.amount).toBeGreaterThanOrEqual(5000);
    expect(bd.dealer.amount).toBeGreaterThanOrEqual(4000);
    expect(bd.recoveryAgent.amount).toBeGreaterThanOrEqual(3000);
  });

  // 12. Single payment detail endpoint returns customer information
  it('12. Single payment detail endpoint returns customer profile and contact info', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${paymentDirectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const detail = res.body.data;
    expect(detail.id).toBe(paymentDirectId);
    expect(detail.customer.name).toContain('Devendra Sharma');
    expect(detail.customer.phone).toBeDefined();
    expect(detail.customer.code).toBeDefined();
  });

  // 13. Single payment detail endpoint returns loan information
  it('13. Single payment detail endpoint returns loan account and outstanding balance', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${paymentDirectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const detail = res.body.data;
    expect(detail.loan.accountNo).toBe(loan1AccNo);
    expect(detail.loan.outstandingBalance).toBeDefined();
    expect(detail.loan.status).toBeDefined();
  });

  // 14. Single payment detail returns waterfall allocation breakdown
  it('14. Single payment detail endpoint returns accurate waterfall allocation breakdown', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${paymentDirectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const detail = res.body.data;
    expect(detail.allocations).toBeDefined();
    expect(detail.allocations.length).toBeGreaterThan(0);
    expect(detail.allocations[0].principalComponent).toBeDefined();
    expect(detail.allocations[0].interestComponent).toBeDefined();
  });

  // 15. Payment lifecycle timeline events
  it('15. Payment lifecycle timeline properly includes payment creation and allocation events', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${paymentDirectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const detail = res.body.data;
    expect(detail.timeline).toBeDefined();
    expect(detail.timeline.some((t: any) => t.event === 'PAYMENT_RECORDED')).toBe(true);
    expect(detail.timeline.some((t: any) => t.event === 'WATERFALL_ALLOCATED')).toBe(true);
    expect(detail.timeline.some((t: any) => t.event === 'RECEIPT_GENERATED')).toBe(true);
  });

  // 16. Direct payment receipt shows Direct Customer source
  it('16. Direct payment receipt shows Collection Through: Direct Customer without dealer/agent', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/receipt/${paymentDirectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const receipt = res.body.data;
    expect(receipt.collectionSource).toBe(CollectionSource.DIRECT_CUSTOMER);
    expect(receipt.dealer).toBeNull();
    expect(receipt.agent).toBeNull();
    expect(receipt.financeCompany.name).toContain('Terracotta');
  });

  // 17. Dealer payment receipt contains dealer store info
  it('17. Dealer payment receipt contains partner store name and code', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/receipt/${paymentDealerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const receipt = res.body.data;
    expect(receipt.collectionSource).toBe(CollectionSource.DEALER);
    expect(receipt.dealer).toBeDefined();
    expect(receipt.dealer.storeName).toContain('Mobile World');
  });

  // 18. Recovery agent payment receipt contains recovery agent name
  it('18. Recovery agent payment receipt contains recovery agent name', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/receipt/${paymentAgentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const receipt = res.body.data;
    expect(receipt.collectionSource).toBe(CollectionSource.RECOVERY_AGENT);
    expect(receipt.agent).toBeDefined();
    expect(receipt.agent.name).toContain('Ramesh Agent');
  });

  // 19. Reversed payment remains in history and timeline
  it('19. Reversed payment remains visible in history with REVERSED status, reason, and timeline event', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${paymentReversedId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const detail = res.body.data;
    expect(detail.status).toBe('REVERSED');
    expect(detail.isReversal).toBe(true);
    expect(detail.reversalReason).toContain('paid twice');
    expect(detail.timeline.some((t: any) => t.event === 'PAYMENT_REVERSED')).toBe(true);
  });

  // 20. Reversed payment excluded from active totals
  it('20. Reversed payment is excluded from active summary KPIs', async () => {
    const sumRes = await request(app)
      .get(`/api/v1/payments/summary?search=${runId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(sumRes.status).toBe(200);
    // Reversed payment (₹2,500) must not be in active total
    const activeDirectTotal = sumRes.body.data.sourceBreakdown.directCustomer.amount;
    expect(activeDirectTotal).toBe(5000); // Only Payment 1 (₹5,000), not ₹7,500
  });

  // 21. Collection agent RLAC permissions
  it('21. Collection agent permissions remain restricted by RLAC', async () => {
    // Agent 1 collected Payment 3 (on Customer 2 / Loan 2). They should see Payment 3
    const resAgent1 = await request(app)
      .get(`/api/v1/payments/receipt/${paymentAgentId}`)
      .set('Authorization', `Bearer ${agent1Token}`);
    expect(resAgent1.status).toBe(200);

    // Agent 2 was not the collector and is not assigned to Customer 2 / Loan 2 -> 403 Forbidden
    const resAgent2 = await request(app)
      .get(`/api/v1/payments/receipt/${paymentAgentId}`)
      .set('Authorization', `Bearer ${agent2Token}`);
    expect(resAgent2.status).toBe(403);
  });
});
