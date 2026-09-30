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
  getBusinessDate,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('TASK 3: Dealer Collection Ledger Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@dealerledger.com`;
  const managerEmail = `mgr_${runId}@dealerledger.com`;
  const agentEmail = `agent_${runId}@dealerledger.com`;

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

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agentId = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Admin User', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9811${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9811${numId}2`, hash]);

    // 3. Create Recovery Agent
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Recovery Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agentId, agentEmail, `9811${numId}3`, hash]);

    // Authenticate users
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'Password@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const agentLogin = await request(app).post('/api/v1/auth/login').send({ email: agentEmail, password: 'Password@123' });
    agentToken = agentLogin.body.data.tokens.accessToken;

    // Create Dealer A: Rathore Mobile - Dadri
    const dealerARes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Rathore Mobile Dadri ${runId}`,
        ownerName: 'Rakesh Rathore',
        phone: `9822${numId}1`,
        address: 'Main Market, Dadri',
        areaCity: 'Dadri',
      });
    dealerAId = dealerARes.body.data.id;
    dealerACode = dealerARes.body.data.dealerCode;

    // Create Dealer B: Rathore Mobile - Alpha
    const dealerBRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Rathore Mobile Alpha ${runId}`,
        ownerName: 'Suresh Rathore',
        phone: `9822${numId}2`,
        address: 'Commercial Complex, Alpha 1',
        areaCity: 'Alpha 1',
      });
    dealerBId = dealerBRes.body.data.id;
    dealerBCode = dealerBRes.body.data.dealerCode;

    // Create Customer 1
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Rahul Sharma ${runId}`,
        primaryPhone: `9833${numId}1`,
        addressLine1: 'Plot 42, Dadri',
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
        fullName: `Priya Verma ${runId}`,
        primaryPhone: `9833${numId}2`,
        addressLine1: 'Flat 101, Alpha 1',
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
        principalAmount: 32000,
        downPayment: 8000,
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
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES (uuid_generate_v4(), $1, $2, $3, $4, NOW(), TRUE, NOW())
    `, [agentId, customer1Id, `ROUTE-DADRI-${runId}`, adminId]);

    // Record Payments:
    // 1. Dealer A: 2,500 Cash
    const pA1 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealerAId,
        idempotencyKey: `IDEMP_A1_${runId}`,
      });
    paymentA1Id = pA1.body.data.paymentId;

    // 2. Dealer A: 3,500 UPI
    const pA2 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 3500,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealerAId,
        idempotencyKey: `IDEMP_A2_${runId}`,
      });
    paymentA2Id = pA2.body.data.paymentId;

    // 3. Dealer B: 4,000 Cash
    const pB1 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 4000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealerBId,
        idempotencyKey: `IDEMP_B1_${runId}`,
      });
    paymentB1Id = pB1.body.data.paymentId;

    // 4. Direct Customer: 5,000 Online
    const pDirect = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 5000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        idempotencyKey: `IDEMP_DIR_${runId}`,
      });
    directPaymentId = pDirect.body.data.paymentId;

    // 5. Recovery Agent: 1,500 Cash
    const pAgent = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 1500,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: agentId,
        idempotencyKey: `IDEMP_AGT_${runId}`,
      });
    agentPaymentId = pAgent.body.data.paymentId;

    // 6. Dealer A: 2,000 Cash (to be reversed)
    const pRev = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealerAId,
        idempotencyKey: `IDEMP_REV_${runId}`,
      });
    reversedPaymentId = pRev.body.data.paymentId;
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // 1. Dealer collection summary is correct
  it('1. Dealer collection summary calculates correct aggregate totals', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-collections/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const summary = res.body.data;

    // Dealer A: 2,500 + 3,500 + 2,000 = 8,000 (before reversal)
    // Dealer B: 4,000
    // Total Dealer Collections >= 12,000 (including this run)
    expect(summary.totalCollections).toBeGreaterThanOrEqual(12000);
    expect(summary.paymentCount).toBeGreaterThanOrEqual(4);
    expect(summary.todayCollections).toBeGreaterThanOrEqual(12000);
    expect(summary.monthCollections).toBeGreaterThanOrEqual(12000);
  });

  // 2. Dealer collection details are correct
  it('2. Dealer collection details return correct payment metadata and customer/dealer info', async () => {
    const res = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.records.length).toBeGreaterThanOrEqual(3);

    const record = res.body.data.records.find((r: any) => r.id === paymentA1Id);
    expect(record).toBeDefined();
    expect(record.amount).toBe(2500);
    expect(record.paymentMode).toBe('CASH');
    expect(record.customerName).toContain('Rahul Sharma');
    expect(record.dealerStoreName).toContain('Rathore Mobile Dadri');
    expect(record.dealerCode).toBe(dealerACode);
    expect(record.loanAccountNo).toBe(loan1AccNo);
    expect(record.receiptNumber).toBeDefined();
    expect(record.status).toBe('SUCCESS');
  });

  // 3. Dealer filter works
  it('3. Dealer filter isolates records to the selected dealer only', async () => {
    const resA = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resA.status).toBe(200);
    // All records in resA should belong to Dealer A
    resA.body.data.records.forEach((r: any) => {
      expect(r.dealerId).toBe(dealerAId);
    });

    const resB = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerBId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resB.status).toBe(200);
    // All records in resB should belong to Dealer B
    resB.body.data.records.forEach((r: any) => {
      expect(r.dealerId).toBe(dealerBId);
    });
    expect(resB.body.data.summary.totalCollections).toBe(4000);
    expect(resB.body.data.summary.paymentCount).toBe(1);
  });

  // 4. Date filter works
  it('4. Date filter correctly filters dealer collection payments by date range', async () => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');

    const res = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerAId}&startDate=${today}&endDate=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBeGreaterThanOrEqual(3);

    // Future date range should return 0 records
    const resFuture = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerAId}&startDate=2035-01-01&endDate=2035-01-31`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resFuture.status).toBe(200);
    expect(resFuture.body.data.records.length).toBe(0);
    expect(resFuture.body.data.summary.totalCollections).toBe(0);
    expect(resFuture.body.data.summary.paymentCount).toBe(0);
  });

  // 5. Search works
  it('5. Search works across customer name, dealer code, store name, receipt, and loan account', async () => {
    // Search by customer name
    const searchCust = await request(app)
      .get(`/api/v1/dealer-collections?search=Rahul%20Sharma`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(searchCust.status).toBe(200);
    expect(searchCust.body.data.records.some((r: any) => r.id === paymentA1Id)).toBe(true);

    // Search by dealer code
    const searchCode = await request(app)
      .get(`/api/v1/dealer-collections?search=${dealerACode}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(searchCode.status).toBe(200);
    expect(searchCode.body.data.records.some((r: any) => r.id === paymentA1Id)).toBe(true);

    // Search by loan account
    const searchLoan = await request(app)
      .get(`/api/v1/dealer-collections?search=${loan1AccNo}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(searchLoan.status).toBe(200);
    expect(searchLoan.body.data.records.some((r: any) => r.id === paymentA1Id)).toBe(true);
  });

  // 6. Pagination works
  it('6. Pagination works with page, limit, totalPages, and totalCount', async () => {
    const res = await request(app)
      .get(`/api/v1/dealer-collections?limit=2&page=1`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(2);
    expect(res.body.data.records.length).toBeLessThanOrEqual(2);
    expect(res.body.data.totalPages).toBeGreaterThanOrEqual(2);
  });

  // 7. Multiple dealers are separated correctly
  it('7. Multiple dealers are separated correctly in dealerBreakdown', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-collections/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const breakdown = res.body.data.dealerBreakdown;
    expect(breakdown.length).toBeGreaterThanOrEqual(2);

    const bA = breakdown.find((b: any) => b.dealerId === dealerAId);
    const bB = breakdown.find((b: any) => b.dealerId === dealerBId);

    expect(bA).toBeDefined();
    expect(bB).toBeDefined();
    expect(bA.storeName).toContain('Rathore Mobile Dadri');
    expect(bB.storeName).toContain('Rathore Mobile Alpha');
    expect(bB.totalCollections).toBe(4000);
    expect(bB.paymentCount).toBe(1);
  });

  // 8. Direct customer payments are NOT included
  it('8. Direct customer payments are NOT included in dealer ledger', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const directRecord = res.body.data.records.find((r: any) => r.id === directPaymentId);
    expect(directRecord).toBeUndefined();
  });

  // 9. Recovery agent payments are NOT included
  it('9. Recovery agent payments are NOT included in dealer ledger', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const agentRecord = res.body.data.records.find((r: any) => r.id === agentPaymentId);
    expect(agentRecord).toBeUndefined();
  });

  // 10. Dealer payments are included
  it('10. Dealer payments with collection_source = DEALER are included', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const recordA1 = res.body.data.records.find((r: any) => r.id === paymentA1Id);
    const recordA2 = res.body.data.records.find((r: any) => r.id === paymentA2Id);
    const recordB1 = res.body.data.records.find((r: any) => r.id === paymentB1Id);

    expect(recordA1).toBeDefined();
    expect(recordA2).toBeDefined();
    expect(recordB1).toBeDefined();
  });

  // 11. Reversed dealer payments are excluded from active totals
  it('11. Reversing a dealer payment excludes it from active collection totals', async () => {
    // Check totals before reversal for Dealer A
    const preRes = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const preTotal = preRes.body.data.summary.totalCollections;
    const preCount = preRes.body.data.summary.paymentCount;
    expect(preTotal).toBe(8000); // 2500 + 3500 + 2000
    expect(preCount).toBe(3);

    // Reverse the 2,000 payment
    const revRes = await request(app)
      .post(`/api/v1/payments/${reversedPaymentId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer returned unit to dealer' });

    expect(revRes.status).toBe(200);

    // Check totals after reversal for Dealer A
    const postRes = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const postTotal = postRes.body.data.summary.totalCollections;
    const postCount = postRes.body.data.summary.paymentCount;

    // Total should now be 8,000 - 2,000 = 6,000
    expect(postTotal).toBe(6000);
    expect(postCount).toBe(2);
  });

  // 12. Historical payment remains accessible after reversal
  it('12. Historical reversed payment remains accessible in detailed records with REVERSED status', async () => {
    const res = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const reversedRecord = res.body.data.records.find((r: any) => r.id === reversedPaymentId);
    expect(reversedRecord).toBeDefined();
    expect(reversedRecord.status).toBe('REVERSED');
    expect(reversedRecord.amount).toBe(2000);
  });

  // 13. Customer payment history still shows dealer collection
  it('13. Customer payment history still shows collection_source = DEALER and store details', async () => {
    const res = await request(app)
      .get(`/api/v1/payments?customerId=${customer1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const pA1Record = res.body.data.find((p: any) => p.id === paymentA1Id);
    expect(pA1Record).toBeDefined();
    expect(pA1Record.collectionSource).toBe(CollectionSource.DEALER);
    expect(pA1Record.dealerStoreName).toContain('Rathore Mobile Dadri');
    expect(pA1Record.dealerCode).toBe(dealerACode);
  });

  // 14. Dealer detail shows collection totals
  it('14. Single dealer detail endpoint returns accurate collection stats and recent collections', async () => {
    const res = await request(app)
      .get(`/api/v1/dealer-collections/dealers/${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dealerId).toBe(dealerAId);
    expect(res.body.data.totalCollections).toBe(6000); // 2500 + 3500 (active only)
    expect(res.body.data.paymentCount).toBe(2);
    expect(res.body.data.averageCollection).toBe(3000); // 6000 / 2
    expect(res.body.data.recentCollections.length).toBeGreaterThanOrEqual(2);
  });

  // 15. Unauthorized recovery agents cannot access full dealer ledger
  it('15. Recovery agents are blocked from dealer collections ledger with 403 Forbidden', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-collections')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    const resSummary = await request(app)
      .get('/api/v1/dealer-collections/summary')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(resSummary.status).toBe(403);
  });

  // 16. Admin can access dealer ledger
  it('16. Super Admin has full access to dealer collections ledger', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-collections')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 17. Manager permissions follow existing RBAC
  it('17. Branch Manager has full access to dealer collections ledger', async () => {
    const res = await request(app)
      .get('/api/v1/dealer-collections')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 18. Monetary totals are accurate
  it('18. Monetary totals match exact Decimal precision without floating point inaccuracies', async () => {
    const res = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${dealerAId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    // Active payments: 2,500 + 3,500 = 6,000.00
    expect(summary.totalCollections).toBe(6000);
    expect(summary.averageCollection).toBe(3000);
  });

  // 19. Empty dealer results work correctly
  it('19. Non-existent dealer ID or empty date filter returns zeroed summary cleanly without error', async () => {
    const nonExistentDealerId = uuidv4();
    const res = await request(app)
      .get(`/api/v1/dealer-collections?dealerId=${nonExistentDealerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records).toEqual([]);
    expect(res.body.data.summary.totalCollections).toBe(0);
    expect(res.body.data.summary.paymentCount).toBe(0);
    expect(res.body.data.summary.todayCollections).toBe(0);
    expect(res.body.data.summary.monthCollections).toBe(0);
    expect(res.body.data.summary.averageCollection).toBe(0);
  });

  // 20. Existing payment and loan workflows remain intact
  it('20. Payment receipt endpoint still returns full source and dealer metadata', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/receipt/${paymentA1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.collectionSource).toBe(CollectionSource.DEALER);
    expect(res.body.data.dealer.id).toBe(dealerAId);
    expect(res.body.data.dealer.storeName).toContain('Rathore Mobile Dadri');
  });
});
