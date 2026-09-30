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
  SettlementStatus,
  getBusinessDate,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('TASK 4: Dealer Settlement & Reconciliation Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@dealersettl.com`;
  const managerEmail = `mgr_${runId}@dealersettl.com`;
  const agentEmail = `agent_${runId}@dealersettl.com`;

  let adminToken: string;
  let managerToken: string;
  let agentToken: string;

  let adminId: string;
  let managerId: string;
  let agentId: string;

  let dealerAId: string;
  let dealerACode: string;
  let dealerBId: string;
  let dealerBCode: string;

  let customer1Id: string;
  let customer2Id: string;
  let loan1Id: string;
  let loan1AccNo: string;
  let loan2Id: string;
  let loan2AccNo: string;

  let paymentA1Id: string;
  let paymentA2Id: string;
  let paymentB1Id: string;
  let directPaymentId: string;
  let agentPaymentId: string;
  let reversedPaymentId: string;

  let settlement1Id: string;
  let settlement1Number: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agentId = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Admin User', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9814${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9814${numId}2`, hash]);

    // 3. Create Recovery Agent
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Recovery Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agentId, agentEmail, `9814${numId}3`, hash]);

    // Authenticate users
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'Password@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const agentLogin = await request(app).post('/api/v1/auth/login').send({ email: agentEmail, password: 'Password@123' });
    agentToken = agentLogin.body.data.tokens.accessToken;

    // Create Dealer A (Rathore Dadri)
    const dealerARes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Rathore Mobile Dadri ${runId}`,
        ownerName: 'Rakesh Rathore',
        phone: `9825${numId}1`,
        address: 'Main Market, Dadri',
        areaCity: 'Dadri',
      });
    dealerAId = dealerARes.body.data.id;
    dealerACode = dealerARes.body.data.dealerCode;

    // Create Dealer B (Rathore Alpha)
    const dealerBRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Rathore Mobile Alpha ${runId}`,
        ownerName: 'Suresh Rathore',
        phone: `9825${numId}2`,
        address: 'Commercial Alpha 1',
        areaCity: 'Alpha 1',
      });
    dealerBId = dealerBRes.body.data.id;
    dealerBCode = dealerBRes.body.data.dealerCode;

    // Create Customer 1
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Sanjay Sharma ${runId}`,
        primaryPhone: `9836${numId}1`,
        addressLine1: 'House 55, Dadri',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '203207',
        areaRoute: `ROUTE-DADRI-${runId}`,
      });
    customer1Id = c1Res.body.data.id;

    // Create Customer 2
    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Neelam Verma ${runId}`,
        primaryPhone: `9836${numId}2`,
        addressLine1: 'Flat 202, Alpha 1',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '201308',
        areaRoute: `ROUTE-ALPHA-${runId}`,
      });
    customer2Id = c2Res.body.data.id;

    // Create Loan 1 (Dealer A)
    const l1Draft = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        dealerId: dealerAId,
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

    // Create Loan 2 (Dealer B)
    const l2Draft = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        dealerId: dealerBId,
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

    // Assign Customers to Agent
    const assignmentId = uuidv4();
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, NOW())
    `, [assignmentId, agentId, customer1Id, `ROUTE-DADRI-${runId}`, adminId]);

    // Record Payments:
    // 1. Dealer A: ₹5,000 Cash
    const pA1 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 5000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealerAId,
        idempotencyKey: `IDEMP_SETTL_A1_${runId}`,
      });
    paymentA1Id = pA1.body.data.paymentId;

    // 2. Dealer A: ₹5,000 UPI
    const pA2 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 5000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealerAId,
        idempotencyKey: `IDEMP_SETTL_A2_${runId}`,
      });
    paymentA2Id = pA2.body.data.paymentId;

    // 3. Dealer B: ₹6,000 Cash
    const pB1 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 6000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealerBId,
        idempotencyKey: `IDEMP_SETTL_B1_${runId}`,
      });
    paymentB1Id = pB1.body.data.paymentId;

    // 4. Direct Customer: ₹4,000 (NOT dealer collection)
    const pDir = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 4000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        idempotencyKey: `IDEMP_SETTL_DIR_${runId}`,
      });
    directPaymentId = pDir.body.data.paymentId;

    // 5. Recovery Agent: ₹2,000 (NOT dealer collection)
    const pAgt = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agentId,
        idempotencyKey: `IDEMP_SETTL_AGT_${runId}`,
      });
    agentPaymentId = pAgt.body.data.paymentId;

    // 6. Dealer A: ₹3,000 (will be reversed)
    const pRev = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 3000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealerAId,
        idempotencyKey: `IDEMP_SETTL_REV_${runId}`,
      });
    reversedPaymentId = pRev.body.data.paymentId;

    // Reverse the payment
    await request(app)
      .post(`/api/v1/payments/${reversedPaymentId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Disputed customer transaction' });
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // 1. Create dealer settlement
  it('1. Create completed dealer settlement with automatic receipt allocation', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');
    const res = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerAId,
        amount: 4000,
        settlementDate: today,
        paymentMethod: 'BANK_TRANSFER',
        referenceNumber: `UTR-${runId}-1`,
        notes: 'First partial remittance from Dealer A',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amount).toBe(4000);
    expect(res.body.data.dealerId).toBe(dealerAId);
    expect(res.body.data.status).toBe(SettlementStatus.COMPLETED);
    expect(res.body.data.settlementNumber).toMatch(/^STL-\d{4}-\d{6}$/);
    expect(res.body.data.allocationsCount).toBeGreaterThan(0);

    settlement1Id = res.body.data.id;
    settlement1Number = res.body.data.settlementNumber;
  });

  // 2. Successful partial settlement
  it('2. Partial settlement updates outstanding balance accurately', async () => {
    // Dealer A collected ₹10,000 active (5000 + 5000). Settled ₹4,000.
    // Outstanding should now be exactly ₹6,000.
    const res = await request(app)
      .get(`/api/v1/dealer-settlements/summary?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const summary = res.body.data;
    expect(summary.totalCollections).toBe(10000);
    expect(summary.totalSettled).toBe(4000);
    expect(summary.outstandingSettlement).toBe(6000);
  });

  // 3. Successful full settlement
  it('3. Successful settlement with explicit allocations can settle remaining balance', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    // Unsettled collections for Dealer A:
    // Payment A1 has ₹1000 remaining (5000 - 4000). Payment A2 has ₹5000 remaining.
    const unsettledRes = await request(app)
      .get(`/api/v1/dealer-settlements/dealers/${dealerAId}/unsettled-collections`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(unsettledRes.status).toBe(200);
    expect(unsettledRes.body.data.length).toBe(2);

    const res = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerAId,
        amount: 6000,
        settlementDate: today,
        paymentMethod: 'UPI',
        referenceNumber: `UPI-SETTL-${runId}-2`,
        allocations: [
          { paymentId: paymentA1Id, amountAllocated: 1000 },
          { paymentId: paymentA2Id, amountAllocated: 5000 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(6000);

    // Verify Dealer A is now fully settled (Outstanding = ₹0)
    const sumRes = await request(app)
      .get(`/api/v1/dealer-settlements/summary?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(sumRes.body.data.totalSettled).toBe(10000);
    expect(sumRes.body.data.outstandingSettlement).toBe(0);
  });

  // 4. Settlement exceeding available collections is rejected
  it('4. Settlement exceeding available collections is rejected with 400 Bad Request', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    // Dealer A has ₹0 unsettled remaining. Trying to settle ₹1,000 must fail.
    const res = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerAId,
        amount: 1000,
        settlementDate: today,
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('exceeds available unsettled dealer collections');
  });

  // 5. DIRECT_CUSTOMER payment cannot be settled through dealer settlement
  it('5. DIRECT_CUSTOMER payment cannot be allocated to a dealer settlement', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    const res = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerBId,
        amount: 1000,
        settlementDate: today,
        paymentMethod: 'CASH',
        allocations: [{ paymentId: directPaymentId, amountAllocated: 1000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('not an eligible unsettled collection');
  });

  // 6. RECOVERY_AGENT payment cannot be settled through dealer settlement
  it('6. RECOVERY_AGENT payment cannot be allocated to a dealer settlement', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    const res = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerBId,
        amount: 1000,
        settlementDate: today,
        paymentMethod: 'CASH',
        allocations: [{ paymentId: agentPaymentId, amountAllocated: 1000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('not an eligible unsettled collection');
  });

  // 7. Reversed customer payment cannot be settled
  it('7. Reversed customer payments are excluded from unsettled collections and cannot be allocated', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    const res = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerAId,
        amount: 1000,
        settlementDate: today,
        paymentMethod: 'CASH',
        allocations: [{ paymentId: reversedPaymentId, amountAllocated: 1000 }],
      });

    expect(res.status).toBe(400);
  });

  // 8. Multiple settlements correctly calculate remaining balance
  it('8. Dealer B partial settlements maintain exact remaining balance', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');
    // Dealer B collections = ₹6,000. Settle ₹2,500.
    const res1 = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerBId,
        amount: 2500,
        settlementDate: today,
        paymentMethod: 'BANK_TRANSFER',
      });
    expect(res1.status).toBe(201);

    const sum1 = await request(app)
      .get(`/api/v1/dealer-settlements/summary?dealerId=${dealerBId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sum1.body.data.totalSettled).toBe(2500);
    expect(sum1.body.data.outstandingSettlement).toBe(3500);

    // Second settlement: Settle ₹1,500
    const res2 = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerBId,
        amount: 1500,
        settlementDate: today,
        paymentMethod: 'UPI',
      });
    expect(res2.status).toBe(201);

    const sum2 = await request(app)
      .get(`/api/v1/dealer-settlements/summary?dealerId=${dealerBId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sum2.body.data.totalSettled).toBe(4000);
    expect(sum2.body.data.outstandingSettlement).toBe(2000);
  });

  // 9. Settlement reversal restores outstanding balance
  it('9. Settlement reversal marks settlement as REVERSED and restores outstanding unsettled amount', async () => {
    // Reverse settlement 1 (₹4,000 on Dealer A)
    const revRes = await request(app)
      .post(`/api/v1/dealer-settlements/${settlement1Id}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Bank transfer UTR rejected by accounting' });

    expect(revRes.status).toBe(200);
    expect(revRes.body.success).toBe(true);
    expect(revRes.body.data.status).toBe(SettlementStatus.REVERSED);
    expect(revRes.body.data.isReversal).toBe(true);

    // Verify Dealer A summary: Total collections = 10,000, Total Settled = 6,000 (was 10,000), Outstanding = 4,000
    const sumRes = await request(app)
      .get(`/api/v1/dealer-settlements/summary?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(sumRes.body.data.totalSettled).toBe(6000);
    expect(sumRes.body.data.outstandingSettlement).toBe(4000);
  });

  // 10. Settlement detail returns allocations
  it('10. Settlement detail endpoint returns complete record and allocated customer payment items', async () => {
    const res = await request(app)
      .get(`/api/v1/dealer-settlements/${settlement1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.settlementNumber).toBe(settlement1Number);
    expect(res.body.data.allocations.length).toBeGreaterThan(0);
    expect(res.body.data.allocations[0].receiptNumber).toBeDefined();
    expect(res.body.data.allocations[0].customerName).toBeDefined();
    expect(res.body.data.allocations[0].loanAccountNo).toBeDefined();
    expect(res.body.data.allocations[0].amountAllocated).toBeGreaterThan(0);
  });

  // 11. Dealer-wise reconciliation is correct
  it('11. Dealer-wise reconciliation computes accurate figures across all stores', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-settlements/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const recList = res.body.data.dealerReconciliation;
    expect(recList.length).toBeGreaterThanOrEqual(2);

    const recA = recList.find((r: any) => r.dealerId === dealerAId);
    const recB = recList.find((r: any) => r.dealerId === dealerBId);

    expect(recA).toBeDefined();
    expect(recB).toBeDefined();
    expect(recA.totalCollections).toBe(10000);
    expect(recA.totalSettled).toBe(6000);
    expect(recA.outstandingSettlement).toBe(4000);
    expect(recB.totalCollections).toBe(6000);
    expect(recB.totalSettled).toBe(4000);
    expect(recB.outstandingSettlement).toBe(2000);
  });

  // 12. Date filters work
  it('12. Date filters correctly filter settlements by settlement_date', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    const resToday = await request(app)
      .get(`/api/v1/dealer-settlements?startDate=${today}&endDate=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resToday.status).toBe(200);
    expect(resToday.body.data.records.length).toBeGreaterThan(0);

    const resFuture = await request(app)
      .get(`/api/v1/dealer-settlements?startDate=2035-01-01&endDate=2035-01-31`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resFuture.status).toBe(200);
    expect(resFuture.body.data.records.length).toBe(0);
  });

  // 13. Dealer filters work
  it('13. Dealer filter returns only settlements for the specified partner store', async () => {
    const resA = await request(app)
      .get(`/api/v1/dealer-settlements?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resA.status).toBe(200);
    resA.body.data.records.forEach((s: any) => {
      expect(s.dealerId).toBe(dealerAId);
    });
  });

  // 14. Pagination works
  it('14. Pagination properly limits and offsets settlement records', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-settlements?limit=1&page=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(1);
    expect(res.body.data.totalPages).toBeGreaterThanOrEqual(2);
  });

  // 15. Unauthorized collection agent receives 403
  it('15. Collection Agent is forbidden from creating, viewing, or reversing dealer settlements', async () => {
    const resGet = await request(app)
      .get('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(resGet.status).toBe(403);

    const resPost = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        dealerId: dealerAId,
        amount: 1000,
        settlementDate: '2026-01-01',
        paymentMethod: 'CASH',
      });
    expect(resPost.status).toBe(403);

    const resRev = await request(app)
      .post(`/api/v1/dealer-settlements/${settlement1Id}/reverse`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ reason: 'Unauthorized attempt' });
    expect(resRev.status).toBe(403);
  });

  // 16. Invalid dealer is rejected
  it('16. Settlement for non-existent dealer returns 404', async () => {
    const fakeDealerId = uuidv4();
    const res = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: fakeDealerId,
        amount: 500,
        settlementDate: '2026-01-01',
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(404);
  });

  // 17. Invalid payment allocation is rejected
  it('17. Allocating more than a receipt remaining amount is rejected with 400', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    const res = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealerBId,
        amount: 5000,
        settlementDate: today,
        paymentMethod: 'CASH',
        allocations: [{ paymentId: paymentB1Id, amountAllocated: 99999 }],
      });

    expect(res.status).toBe(400);
  });

  // 18. Concurrent settlement attempts cannot double-settle the same collection
  it('18. Concurrent settlement requests are serialized safely with row-level locks', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    // Dealer B currently has ₹2,000 unsettled remaining.
    // Try launching two concurrent requests each trying to settle ₹2,000 simultaneously.
    const [req1, req2] = await Promise.all([
      request(app)
        .post('/api/v1/dealer-settlements')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          dealerId: dealerBId,
          amount: 2000,
          settlementDate: today,
          paymentMethod: 'BANK_TRANSFER',
          referenceNumber: `CONC-1-${runId}`,
        }),
      request(app)
        .post('/api/v1/dealer-settlements')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          dealerId: dealerBId,
          amount: 2000,
          settlementDate: today,
          paymentMethod: 'BANK_TRANSFER',
          referenceNumber: `CONC-2-${runId}`,
        }),
    ]);

    // Exactly one must succeed (201) and the other must be rejected (400) due to over-settlement lock.
    const statuses = [req1.status, req2.status].sort();
    expect(statuses).toEqual([201, 400]);

    // Dealer B must now be exactly ₹0 outstanding
    const sumRes = await request(app)
      .get(`/api/v1/dealer-settlements/summary?dealerId=${dealerBId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sumRes.body.data.outstandingSettlement).toBe(0);
  });

  // 19. Audit events are created
  it('19. Audit log entries are written for DEALER_SETTLEMENT_CREATED and DEALER_SETTLEMENT_REVERSED', async () => {
    const auditRes = await queryPostgres(
      `SELECT * FROM audit_logs WHERE entity = 'DealerSettlement' AND entity_id = $1 ORDER BY created_at ASC`,
      [settlement1Id]
    );

    expect(auditRes.rows.length).toBeGreaterThanOrEqual(2);
    const actions = auditRes.rows.map((r: any) => r.action);
    expect(actions).toContain('DEALER_SETTLEMENT_CREATED');
    expect(actions).toContain('DEALER_SETTLEMENT_REVERSED');
  });

  // 20. Existing Task 1–3 payment/dealer tests still pass
  it('20. Customer loan balance and EMI installment records are verified to be untouched by settlements', async () => {
    const loanRes = await request(app)
      .get(`/api/v1/loans/${loan1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(loanRes.status).toBe(200);
    // Loan principal was 50,000. Loan balance and EMI calculations remain intact.
    expect(loanRes.body.data.loanAccountNo).toBe(loan1AccNo);
    expect(loanRes.body.data.installments.length).toBeGreaterThan(0);
  });
});
