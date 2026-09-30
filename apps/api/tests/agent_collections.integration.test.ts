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

describe('TASK 5: Recovery Agent Collection Ledger Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@agentledger.com`;
  const managerEmail = `mgr_${runId}@agentledger.com`;
  const agent1Email = `agent1_${runId}@agentledger.com`;
  const agent2Email = `agent2_${runId}@agentledger.com`;

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

  let paymentAgent1_1Id: string;
  let paymentAgent1_1Receipt: string;
  let paymentAgent1_2Id: string;
  let paymentAgent2_1Id: string;
  let paymentDealerId: string;
  let paymentDirectId: string;
  let paymentReversedId: string;

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
    `, [adminId, adminEmail, `9815${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9815${numId}2`, hash]);

    // 3. Create Recovery Agent 1 (Rahul Field)
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Rahul Field Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent1Id, agent1Email, `9815${numId}3`, hash]);

    // 4. Create Recovery Agent 2 (Amit Field)
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Amit Field Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent2Id, agent2Email, `9815${numId}4`, hash]);

    // Authenticate users
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'Password@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const a1Login = await request(app).post('/api/v1/auth/login').send({ email: agent1Email, password: 'Password@123' });
    agent1Token = a1Login.body.data.tokens.accessToken;

    const a2Login = await request(app).post('/api/v1/auth/login').send({ email: agent2Email, password: 'Password@123' });
    agent2Token = a2Login.body.data.tokens.accessToken;

    // Create Partner Store / Dealer
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Mobile Hub ${runId}`,
        ownerName: 'Vikas Hub',
        phone: `9826${numId}1`,
        address: 'Sector 18 Market',
        areaCity: 'Noida',
      });
    dealerId = dealerRes.body.data.id;

    // Create Customer 1 (Assigned to Agent 1)
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Manoj Tiwari ${runId}`,
        primaryPhone: `9847${numId}1`,
        addressLine1: 'H-101, Atta Market',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201301',
        areaRoute: `ROUTE-ATTA-${runId}`,
      });
    customer1Id = c1Res.body.data.id;

    // Create Customer 2 (Assigned to Agent 2)
    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Pooja Sharma ${runId}`,
        primaryPhone: `9847${numId}2`,
        addressLine1: 'B-22, Sector 62',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201309',
        areaRoute: `ROUTE-SEC62-${runId}`,
      });
    customer2Id = c2Res.body.data.id;

    // Create Loan 1 (Agent 1 assigned)
    const l1Draft = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        dealerId,
        principalAmount: 40000,
        downPayment: 5000,
        annualInterestRate: 24,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        tenureMonths: 12,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agent1Id,
        status: LoanStatus.ACTIVE,
      });
    loan1Id = l1Draft.body.data.id;
    loan1AccNo = l1Draft.body.data.loanAccountNo;

    // Create Loan 2 (Agent 2 assigned)
    const l2Draft = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        dealerId,
        principalAmount: 30000,
        downPayment: 5000,
        annualInterestRate: 24,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        tenureMonths: 12,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agent2Id,
        status: LoanStatus.ACTIVE,
      });
    loan2Id = l2Draft.body.data.id;
    loan2AccNo = l2Draft.body.data.loanAccountNo;

    // Assign Customers to Agents in collection_assignments
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, NOW())
    `, [uuidv4(), agent1Id, customer1Id, `ROUTE-ATTA-${runId}`, adminId]);

    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, NOW())
    `, [uuidv4(), agent2Id, customer2Id, `ROUTE-SEC62-${runId}`, adminId]);

    // Record Payments:
    // 1. Agent 1: ₹3,000 Cash (RECOVERY_AGENT)
    const pA1_1 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 3000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        idempotencyKey: `IDEMP_AGT1_P1_${runId}`,
      });
    paymentAgent1_1Id = pA1_1.body.data.paymentId;
    paymentAgent1_1Receipt = pA1_1.body.data.receiptNumber;

    // 2. Agent 1: ₹2,000 UPI (RECOVERY_AGENT recorded by Admin on behalf of Agent 1)
    const pA1_2 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agent1Id,
        idempotencyKey: `IDEMP_AGT1_P2_${runId}`,
      });
    paymentAgent1_2Id = pA1_2.body.data.paymentId;

    // 3. Agent 2: ₹4,500 Cash (RECOVERY_AGENT)
    const pA2_1 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent2Token}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 4500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        idempotencyKey: `IDEMP_AGT2_P1_${runId}`,
      });
    paymentAgent2_1Id = pA2_1.body.data.paymentId;

    // 4. Dealer Payment: ₹5,000 (DEALER source - MUST NOT appear in agent ledger)
    const pDlr = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 5000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId,
        idempotencyKey: `IDEMP_DLR_${runId}`,
      });
    paymentDealerId = pDlr.body.data.paymentId;

    // 5. Direct Customer Payment: ₹4,000 (DIRECT_CUSTOMER - MUST NOT appear in agent ledger)
    const pDir = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 4000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        idempotencyKey: `IDEMP_DIR_${runId}`,
      });
    paymentDirectId = pDir.body.data.paymentId;

    // 6. Agent 1: ₹1,500 Cash (Will be reversed)
    const pRev = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        idempotencyKey: `IDEMP_AGT1_REV_${runId}`,
      });
    paymentReversedId = pRev.body.data.paymentId;

    // Authorize reversal of payment 6
    await request(app)
      .post(`/api/v1/payments/${paymentReversedId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Receipt cancelled due to customer cash return' });
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // 1. Recovery-agent payment appears in agent collection ledger
  it('1. Recovery-agent payment appears in agent collection ledger with full details', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections?agentId=${agent1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const receiptIds = res.body.data.records.map((r: any) => r.id);
    expect(receiptIds).toContain(paymentAgent1_1Id);
    expect(receiptIds).toContain(paymentAgent1_2Id);

    const record1 = res.body.data.records.find((r: any) => r.id === paymentAgent1_1Id);
    expect(record1).toBeDefined();
    expect(record1.receiptNumber).toBe(paymentAgent1_1Receipt);
    expect(record1.amount).toBe(3000);
    expect(record1.paymentMode).toBe(PaymentMode.CASH);
    expect(record1.collectionSource).toBe(CollectionSource.RECOVERY_AGENT);
    expect(record1.agentId).toBe(agent1Id);
    expect(record1.customerName).toContain('Manoj Tiwari');
    expect(record1.loanAccountNo).toBe(loan1AccNo);
  });

  // 2. Dealer payment does NOT appear
  it('2. Partner store / dealer payments do NOT appear in recovery agent collection ledger', async () => {
    const res = await request(app)
      .get('/api/v1/agent-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const paymentIds = res.body.data.records.map((r: any) => r.id);
    expect(paymentIds).not.toContain(paymentDealerId);
  });

  // 3. Direct customer payment does NOT appear
  it('3. Direct customer payments do NOT appear in recovery agent collection ledger', async () => {
    const res = await request(app)
      .get('/api/v1/agent-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const paymentIds = res.body.data.records.map((r: any) => r.id);
    expect(paymentIds).not.toContain(paymentDirectId);
  });

  // 4. Agent-wise summary is correct
  it('4. Agent-wise breakdown summary accurately computes metrics per recovery agent', async () => {
    const res = await request(app)
      .get('/api/v1/agent-collections/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const breakdown = res.body.data.agentBreakdown;
    const a1Metrics = breakdown.find((b: any) => b.agentId === agent1Id);
    const a2Metrics = breakdown.find((b: any) => b.agentId === agent2Id);

    expect(a1Metrics).toBeDefined();
    expect(a2Metrics).toBeDefined();

    // Agent 1: 3000 + 2000 = 5000 active total across 2 payments (1500 reversed is excluded)
    expect(a1Metrics.totalCollections).toBe(5000);
    expect(a1Metrics.paymentCount).toBe(2);
    expect(a1Metrics.averageCollection).toBe(2500);

    // Agent 2: 4500 active total across 1 payment
    expect(a2Metrics.totalCollections).toBe(4500);
    expect(a2Metrics.paymentCount).toBe(1);
    expect(a2Metrics.averageCollection).toBe(4500);
  });

  // 5. Today's collection is correct
  it('5. Today collection metrics accurately calculate total collections and count for today', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections/summary?agentId=${agent1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const summary = res.body.data;
    expect(summary.todayCollections).toBe(5000);
    expect(summary.todayCount).toBe(2);
  });

  // 6. Monthly collection is correct
  it('6. Monthly collection metrics accurately calculate active monthly collections and count', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections/summary?agentId=${agent2Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const summary = res.body.data;
    expect(summary.monthCollections).toBe(4500);
    expect(summary.monthCount).toBe(1);
  });

  // 7. Date filters work
  it('7. Date range filters correctly filter recovery agent payments', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    const resToday = await request(app)
      .get(`/api/v1/agent-collections?startDate=${today}&endDate=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resToday.status).toBe(200);
    expect(resToday.body.data.records.length).toBeGreaterThanOrEqual(3);

    const resFuture = await request(app)
      .get('/api/v1/agent-collections?startDate=2035-01-01&endDate=2035-01-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resFuture.status).toBe(200);
    expect(resFuture.body.data.records.length).toBe(0);
  });

  // 8. Agent filter works
  it('8. Filtering by agentId returns only collections belonging to that recovery agent', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections?agentId=${agent2Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBe(1);
    expect(res.body.data.records[0].agentId).toBe(agent2Id);
    expect(res.body.data.records[0].amount).toBe(4500);
  });

  // 9. Search works
  it('9. Search query matches across customer name, phone, receipt number, and loan account', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections?search=Manoj`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBeGreaterThanOrEqual(2);
    res.body.data.records.forEach((r: any) => {
      expect(r.customerName).toContain('Manoj');
    });
  });

  // 10. Pagination works
  it('10. Pagination properly limits and offsets collection ledger records', async () => {
    const res = await request(app)
      .get('/api/v1/agent-collections?limit=1&page=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(1);
    expect(res.body.data.totalPages).toBeGreaterThanOrEqual(3);
  });

  // 11. Reversed recovery-agent payment is excluded from active totals
  it('11. Reversed recovery-agent payment is excluded from active collection sums and counts', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections/summary?agentId=${agent1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // 3,000 + 2,000 = 5,000 (1,500 reversed is excluded)
    expect(res.body.data.totalCollections).toBe(5000);
    expect(res.body.data.paymentCount).toBe(2);
  });

  // 12. Reversed payment remains visible historically
  it('12. Reversed recovery-agent payment remains visible historically with REVERSED status', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections?agentId=${agent1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const revRecord = res.body.data.records.find((r: any) => r.id === paymentReversedId);
    expect(revRecord).toBeDefined();
    expect(revRecord.isReversal).toBe(true);
    expect(revRecord.status).toBe(PaymentStatus.REVERSED);
    expect(revRecord.reversalReason).toBe('Receipt cancelled due to customer cash return');
  });

  // 13. Admin can view all agent collections
  it('13. Super Admin has unrestricted access to full organization-wide agent collections', async () => {
    const res = await request(app)
      .get('/api/v1/agent-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBeGreaterThanOrEqual(3);
    expect(res.body.data.summary.totalCollections).toBeGreaterThanOrEqual(9500);
    const a1Breakdown = res.body.data.summary.agentBreakdown.find((a: any) => a.agentId === agent1Id);
    const a2Breakdown = res.body.data.summary.agentBreakdown.find((a: any) => a.agentId === agent2Id);
    expect(a1Breakdown.totalCollections).toBe(5000);
    expect(a2Breakdown.totalCollections).toBe(4500);
  });

  // 14. Branch manager follows existing permission rules
  it('14. Branch Manager can access agent collections and summary metrics', async () => {
    const res = await request(app)
      .get('/api/v1/agent-collections')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBeGreaterThanOrEqual(3);
  });

  // 15. Recovery agent can view own collections
  it('15. Recovery Agent 1 can view their own collection ledger', async () => {
    const res = await request(app)
      .get('/api/v1/agent-collections')
      .set('Authorization', `Bearer ${agent1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBeGreaterThan(0);
    res.body.data.records.forEach((r: any) => {
      expect(r.agentId).toBe(agent1Id);
    });
  });

  // 16. Recovery agent cannot view another agent’s collections
  it('16. Recovery Agent 1 is forbidden from viewing Agent 2 collection ledger', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections?agentId=${agent2Id}`)
      .set('Authorization', `Bearer ${agent1Token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('can only access their own collection records');
  });

  // 17. Recovery agent cannot access another agent single summary
  it('17. Recovery Agent 1 is forbidden from accessing Agent 2 single metrics endpoint', async () => {
    const res = await request(app)
      .get(`/api/v1/agent-collections/agents/${agent2Id}`)
      .set('Authorization', `Bearer ${agent1Token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('can only access their own collection records');
  });

  // 18. Authenticated agent identity is enforced server-side
  it('18. Collection Agent cannot record a payment under another agent ID', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agent2Id, // Attempting to forge Agent 2
        idempotencyKey: `IDEMP_FORGE_${runId}`,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('cannot record payments on behalf of another agent');
  });

  // 19. Existing Quick Collect creates the correct agent_id
  it('19. Recording payment as authenticated collection agent automatically associates their agent_id', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        idempotencyKey: `IDEMP_AUTO_AGENT_${runId}`,
      });

    expect(res.status).toBe(201);
    const newPaymentId = res.body.data.paymentId;

    const checkRes = await queryPostgres(`SELECT agent_id, collection_source FROM payments WHERE id = $1`, [newPaymentId]);
    expect(checkRes.rows[0].agent_id).toBe(agent1Id);
    expect(checkRes.rows[0].collection_source).toBe('RECOVERY_AGENT');
  });

  // 20. Existing payment/loan tests remain unchanged and pass
  it('20. Customer loan balance and EMI installment records remain consistent with payments engine', async () => {
    const loanRes = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(loanRes.status).toBe(200);
    expect(loanRes.body.data.loanAccountNo).toBe(loan1AccNo);
    expect(loanRes.body.data.installments.length).toBeGreaterThan(0);
  });
});
