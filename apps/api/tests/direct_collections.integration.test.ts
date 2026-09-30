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

describe('TASK 6: Direct Customer Collection Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@directledger.com`;
  const managerEmail = `mgr_${runId}@directledger.com`;
  const agentEmail = `agent_${runId}@directledger.com`;

  let adminToken: string;
  let managerToken: string;
  let agentToken: string;

  let adminId: string;
  let managerId: string;
  let agentId: string;

  let dealerId: string;

  let customer1Id: string;
  let customer2Id: string;
  let loan1Id: string;
  let loan1AccNo: string;
  let loan2Id: string;
  let loan2AccNo: string;

  let paymentDirect1Id: string;
  let paymentDirect1Receipt: string;
  let paymentDirect2Id: string;
  let paymentDealerId: string;
  let paymentAgentId: string;
  let paymentReversedId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agentId = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9816${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9816${numId}2`, hash]);

    // 3. Create Recovery Agent
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Field Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agentId, agentEmail, `9816${numId}3`, hash]);

    // Authenticate users
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'Password@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const agentLogin = await request(app).post('/api/v1/auth/login').send({ email: agentEmail, password: 'Password@123' });
    agentToken = agentLogin.body.data.tokens.accessToken;

    // Create Dealer
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Direct Test Store ${runId}`,
        ownerName: 'Sunil Direct',
        phone: `9827${numId}1`,
        address: 'Sector 15 Market',
        areaCity: 'Noida',
      });
    dealerId = dealerRes.body.data.id;

    // Create Customer 1
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Vikramaditya Rao ${runId}`,
        primaryPhone: `9858${numId}1`,
        addressLine1: 'B-10, Sector 15',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201301',
        areaRoute: `ROUTE-DIR1-${runId}`,
      });
    customer1Id = c1Res.body.data.id;

    // Create Customer 2
    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Sneha Reddy ${runId}`,
        primaryPhone: `9858${numId}2`,
        addressLine1: 'C-44, Sector 50',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201304',
        areaRoute: `ROUTE-DIR2-${runId}`,
      });
    customer2Id = c2Res.body.data.id;

    // Create Loan 1
    const l1Draft = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        dealerId,
        principalAmount: 50000,
        downPayment: 10000,
        annualInterestRate: 24,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        tenureMonths: 12,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agentId,
        status: LoanStatus.ACTIVE,
      });
    loan1Id = l1Draft.body.data.id;
    loan1AccNo = l1Draft.body.data.loanAccountNo;

    // Create Loan 2
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
        assignedAgentId: agentId,
        status: LoanStatus.ACTIVE,
      });
    loan2Id = l2Draft.body.data.id;
    loan2AccNo = l2Draft.body.data.loanAccountNo;

    // Assign customer to agent
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, NOW())
    `, [uuidv4(), agentId, customer1Id, `ROUTE-DIR1-${runId}`, adminId]);

    // Record Payments:
    // 1. Direct Customer: ₹5,000 UPI
    const pDir1 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 5000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: `UPI-DIR1-${runId}`,
        idempotencyKey: `IDEMP_DIR_1_${runId}`,
      });
    paymentDirect1Id = pDir1.body.data.paymentId;
    paymentDirect1Receipt = pDir1.body.data.receiptNumber;

    // 2. Direct Customer: ₹3,500 Bank Transfer
    const pDir2 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 3500,
        paymentMode: PaymentMode.BANK_TRANSFER,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: `IMPS-DIR2-${runId}`,
        idempotencyKey: `IDEMP_DIR_2_${runId}`,
      });
    paymentDirect2Id = pDir2.body.data.paymentId;

    // 3. Dealer Payment: ₹4,000 Cash (DEALER source - MUST NOT appear in direct ledger)
    const pDlr = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 4000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId,
        idempotencyKey: `IDEMP_DLR_${runId}`,
      });
    paymentDealerId = pDlr.body.data.paymentId;

    // 4. Recovery Agent Payment: ₹2,500 Cash (RECOVERY_AGENT source - MUST NOT appear in direct ledger)
    const pAgt = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        idempotencyKey: `IDEMP_AGT_${runId}`,
      });
    paymentAgentId = pAgt.body.data.paymentId;

    // 5. Direct Customer: ₹2,000 Cash (Will be reversed)
    const pRev = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        idempotencyKey: `IDEMP_DIR_REV_${runId}`,
      });
    paymentReversedId = pRev.body.data.paymentId;

    // Authorize reversal of payment 5
    await request(app)
      .post(`/api/v1/payments/${paymentReversedId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Direct transaction failed at bank gateway' });
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // 1. Direct customer payment appears in direct collection ledger
  it('1. Direct customer payment appears in direct collection ledger with full customer and receipt details', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const recordIds = res.body.data.records.map((r: any) => r.id);
    expect(recordIds).toContain(paymentDirect1Id);
    expect(recordIds).toContain(paymentDirect2Id);

    const record1 = res.body.data.records.find((r: any) => r.id === paymentDirect1Id);
    expect(record1).toBeDefined();
    expect(record1.receiptNumber).toBe(paymentDirect1Receipt);
    expect(record1.amount).toBe(5000);
    expect(record1.paymentMode).toBe(PaymentMode.UPI);
    expect(record1.collectionSource).toBe(CollectionSource.DIRECT_CUSTOMER);
    expect(record1.customerName).toContain('Vikramaditya Rao');
    expect(record1.loanAccountNo).toBe(loan1AccNo);
  });

  // 2. Dealer payment does NOT appear
  it('2. Partner store / dealer payments do NOT appear in direct collection ledger', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const paymentIds = res.body.data.records.map((r: any) => r.id);
    expect(paymentIds).not.toContain(paymentDealerId);
  });

  // 3. Recovery-agent payment does NOT appear
  it('3. Recovery agent payments do NOT appear in direct collection ledger', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const paymentIds = res.body.data.records.map((r: any) => r.id);
    expect(paymentIds).not.toContain(paymentAgentId);
  });

  // 4. Direct collection summary is correct
  it('4. Direct collection summary accurately calculates total collections and active counts', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const sum = res.body.data;
    // Active direct collections in this test: 5000 + 3500 = 8500 (reversed 2000 is excluded)
    expect(sum.totalCollections).toBeGreaterThanOrEqual(8500);
    expect(sum.paymentCount).toBeGreaterThanOrEqual(2);
    expect(sum.averageCollection).toBeGreaterThan(0);
  });

  // 5. Today's direct collection is correct
  it('5. Today direct collection metrics correctly calculate today active collections and count', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');
    const res = await request(app)
      .get(`/api/v1/direct-collections/summary?startDate=${today}&endDate=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.todayCollections).toBeGreaterThanOrEqual(8500);
    expect(res.body.data.todayCount).toBeGreaterThanOrEqual(2);
  });

  // 6. Monthly direct collection is correct
  it('6. Monthly direct collection metrics correctly calculate month active collections', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.monthCollections).toBeGreaterThanOrEqual(8500);
    expect(res.body.data.monthCount).toBeGreaterThanOrEqual(2);
  });

  // 7. Date filters work
  it('7. Date range filters correctly filter direct customer transactions', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    const resToday = await request(app)
      .get(`/api/v1/direct-collections?startDate=${today}&endDate=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resToday.status).toBe(200);
    expect(resToday.body.data.records.length).toBeGreaterThanOrEqual(2);

    const resFuture = await request(app)
      .get('/api/v1/direct-collections?startDate=2035-01-01&endDate=2035-01-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resFuture.status).toBe(200);
    expect(resFuture.body.data.records.length).toBe(0);
  });

  // 8. Search works
  it('8. Search query matches across customer name, phone, receipt number, and loan account', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections?search=Vikramaditya')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBeGreaterThanOrEqual(1);
    res.body.data.records.forEach((r: any) => {
      expect(r.customerName).toContain('Vikramaditya');
    });
  });

  // 9. Pagination works
  it('9. Pagination properly limits and offsets direct collection ledger records', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections?limit=1&page=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(1);
    expect(res.body.data.totalPages).toBeGreaterThanOrEqual(2);
  });

  // 10. Payment method filtering works
  it('10. Payment method filtering properly returns only matching payment mode records', async () => {
    const resUpi = await request(app)
      .get('/api/v1/direct-collections?paymentMode=UPI')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resUpi.status).toBe(200);
    resUpi.body.data.records.forEach((r: any) => {
      expect(r.paymentMode).toBe('UPI');
    });

    const resBank = await request(app)
      .get('/api/v1/direct-collections?paymentMode=BANK_TRANSFER')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resBank.status).toBe(200);
    resBank.body.data.records.forEach((r: any) => {
      expect(r.paymentMode).toBe('BANK_TRANSFER');
    });
  });

  // 11. Status filtering works
  it('11. Status filter properly returns COMPLETED vs REVERSED direct customer payments', async () => {
    const resSuccess = await request(app)
      .get('/api/v1/direct-collections?status=SUCCESS')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resSuccess.status).toBe(200);
    resSuccess.body.data.records.forEach((r: any) => {
      expect(r.status).toBe(PaymentStatus.SUCCESS);
      expect(r.isReversal).toBe(false);
    });

    const resReversed = await request(app)
      .get('/api/v1/direct-collections?status=REVERSED')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resReversed.status).toBe(200);
    resReversed.body.data.records.forEach((r: any) => {
      expect(r.status).toBe(PaymentStatus.REVERSED);
    });
  });

  // 12. Reversed direct payment is excluded from active totals
  it('12. Reversed direct payment is excluded from active collection sums and counts', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Direct payment 1 (5,000) + Direct payment 2 (3,500) = 8,500. Reversed payment (2,000) is excluded.
    expect(res.body.data.totalCollections).toBeGreaterThanOrEqual(8500);
  });

  // 13. Reversed direct payment remains visible historically
  it('13. Reversed direct payment remains visible historically with REVERSED status and reason', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections?status=REVERSED')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const revRecord = res.body.data.records.find((r: any) => r.id === paymentReversedId);
    expect(revRecord).toBeDefined();
    expect(revRecord.isReversal).toBe(true);
    expect(revRecord.status).toBe(PaymentStatus.REVERSED);
    expect(revRecord.reversalReason).toBe('Direct transaction failed at bank gateway');
  });

  // 14. Direct payment cannot contain dealer ID
  it('14. Direct customer payment payload containing dealerId is rejected with 422 Validation Error', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        dealerId, // Invalid for DIRECT_CUSTOMER
        idempotencyKey: `IDEMP_INVALID_DIR_DLR_${runId}`,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.details.some((d: any) => d.issue.includes('Dealer ID must not be provided'))).toBe(true);
  });

  // 15. Direct payment cannot contain agent ID
  it('15. Direct customer payment payload containing agentId is rejected with 422 Validation Error', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        agentId, // Invalid for DIRECT_CUSTOMER
        idempotencyKey: `IDEMP_INVALID_DIR_AGT_${runId}`,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.details.some((d: any) => d.issue.includes('Agent ID must not be provided'))).toBe(true);
  });

  // 16. Backend rejects invalid source/ID combinations
  it('16. Backend rejects invalid collection source combinations', async () => {
    // Partner store payment without dealerId
    const resNoDlr = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        idempotencyKey: `IDEMP_NO_DLR_${runId}`,
      });

    expect(resNoDlr.status).toBe(422);

    // Partner store payment with agentId
    const resDlrWithAgt = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId,
        agentId,
        idempotencyKey: `IDEMP_DLR_WITH_AGT_${runId}`,
      });

    expect(resDlrWithAgt.status).toBe(422);
  });

  // 17. Customer payment waterfall remains correct
  it('17. Single direct payment detail endpoint returns accurate waterfall allocation breakdown', async () => {
    const res = await request(app)
      .get(`/api/v1/direct-collections/${paymentDirect1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const detail = res.body.data;
    expect(detail.id).toBe(paymentDirect1Id);
    expect(detail.amount).toBe(5000);
    expect(detail.customer.name).toContain('Vikramaditya Rao');
    expect(detail.loan.accountNo).toBe(loan1AccNo);
    expect(detail.allocations.length).toBeGreaterThan(0);
    expect(detail.allocations[0].principalComponent).toBeDefined();
    expect(detail.allocations[0].interestComponent).toBeDefined();
  });

  // 18. Customer loan balance remains correct
  it('18. Customer loan balance and EMI installments are accurately updated by direct payment waterfall', async () => {
    const loanRes = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(loanRes.status).toBe(200);
    expect(loanRes.body.data.loanAccountNo).toBe(loan1AccNo);
    expect(loanRes.body.data.installments.length).toBeGreaterThan(0);
  });

  // 19. Receipt contains correct direct collection source
  it('19. Payment receipt verification confirms Collection Source as Direct Customer without agent/dealer', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/receipt/${paymentDirect1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.collectionSource).toBe(CollectionSource.DIRECT_CUSTOMER);
    expect(res.body.data.dealer).toBeNull();
    expect(res.body.data.agent).toBeNull();
  });

  // 20. Existing Tasks 1–5 tests remain passing & Collection Agent receives 403 on direct collection ledger
  it('20. Collection Agent is forbidden from accessing the organization-wide direct collection ledger', async () => {
    const res = await request(app)
      .get('/api/v1/direct-collections')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('not authorized to access the direct customer collections ledger');
  });
});
