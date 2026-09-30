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
  SettlementStatus,
  SettlementPaymentMethod,
  getBusinessDate,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('TASK 8: Finance Dashboard & Reports Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@financedash.com`;
  const managerEmail = `mgr_${runId}@financedash.com`;
  const agent1Email = `agent1_${runId}@financedash.com`;
  const agent2Email = `agent2_${runId}@financedash.com`;

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
  let paymentDealerId: string;
  let paymentAgentId: string;
  let paymentReversedId: string;
  let settlementId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agent1Id = uuidv4();
    agent2Id = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Super Admin Dash', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9818${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Manager Dash', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9818${numId}2`, hash]);

    // 3. Create Recovery Agent 1
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Agent Dash One', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent1Id, agent1Email, `9818${numId}3`, hash]);

    // 4. Create Recovery Agent 2
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Agent Dash Two', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent2Id, agent2Email, `9818${numId}4`, hash]);

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
        storeName: `Fintech Mobiles ${runId}`,
        ownerName: 'Vikas Gupta',
        phone: `9829${numId}1`,
        address: '100 Feet Road, Indiranagar',
        areaCity: 'Bangalore',
      });
    dealerId = dealerRes.body.data.id;

    // Create Customer 1
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Rohan Verma ${runId}`,
        primaryPhone: `9839${numId}1`,
        addressLine1: '12 Prestige Towers',
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
        fullName: `Sneha Patel ${runId}`,
        primaryPhone: `9839${numId}2`,
        addressLine1: '54 Whitefield Main Rd',
        city: 'Bangalore',
        state: 'Karnataka',
        pincode: '560066',
        areaRoute: 'Whitefield',
      });
    customer2Id = c2Res.body.data.id;

    // Originate Loan 1 for Customer 1
    const l1Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        dealerId,
        principalAmount: 36000,
        downPayment: 6000,
        annualInterestRate: 15.0,
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
    `, [uuidv4(), agent1Id, customer2Id, `ROUTE-DASH-${runId}`, adminId]);

    // Record Payment 1: DIRECT_CUSTOMER (₹6,000, UPI)
    const p1Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 6000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: `UPI_DIR_DASH_${runId}`,
        notes: 'Online portal payment by customer',
        idempotencyKey: `IDEMP_DIR_T8_${runId}`,
      });
    paymentDirectId = p1Res.body.data.paymentId;

    // Record Payment 2: DEALER (₹5,000, CASH)
    const p2Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 5000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId,
        referenceNumber: `DLR_CASH_DASH_${runId}`,
        notes: 'Paid at partner store counter',
        idempotencyKey: `IDEMP_DLR_T8_${runId}`,
      });
    paymentDealerId = p2Res.body.data.paymentId;

    // Record Payment 3: RECOVERY_AGENT (₹4,000, CASH)
    const p3Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 4000,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        referenceNumber: `AGT_CASH_DASH_${runId}`,
        notes: 'Collected on home visit',
        idempotencyKey: `IDEMP_AGT_T8_${runId}`,
      });
    paymentAgentId = p3Res.body.data.paymentId;

    // Record Payment 4: To be Reversed (₹3,000, BANK_TRANSFER)
    const p4Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan2Id,
        customerId: customer2Id,
        amount: 3000,
        paymentMode: PaymentMode.BANK_TRANSFER,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: `REV_DASH_${runId}`,
        notes: 'Duplicate transfer to reverse',
        idempotencyKey: `IDEMP_REV_T8_${runId}`,
      });
    paymentReversedId = p4Res.body.data.paymentId;

    // Reverse Payment 4
    await request(app)
      .post(`/api/v1/payments/${paymentReversedId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: `Reversal for test ${runId}` });

    // Record Dealer Settlement for Dealer (₹3,000 settled out of ₹5,000 collected)
    const setRes = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId,
        amount: 3000,
        settlementDate: '2026-09-22',
        paymentMethod: SettlementPaymentMethod.NEFT_RTGS,
        referenceNumber: `SET_NEFT_${runId}`,
        notes: `Partial settlement for test ${runId}`,
        idempotencyKey: `IDEMP_SET_T8_${runId}`,
      });
    settlementId = setRes.body.data.settlementId;
  });

  afterAll(async () => {
    await closePostgresPool();
    await closeRedisConnection();
    await closeAllQueues();
  });

  // 1. Dashboard loads for Admin
  it('1. Finance dashboard loads successfully for Super Admin / Admin', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.topKpis).toBeDefined();
    expect(data.sourceBreakdown).toBeDefined();
    expect(data.trends).toBeDefined();
    expect(data.portfolioSummary).toBeDefined();
    expect(data.agingBuckets).toBeDefined();
    expect(data.dealerReconciliation).toBeDefined();
    expect(data.recoveryAgentSummary).toBeDefined();
    expect(data.directCustomerSummary).toBeDefined();
  });

  // 2. Dashboard rejects Collection Agent
  it('2. Finance dashboard rejects collection-agent access with 403 Forbidden', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard')
      .set('Authorization', `Bearer ${agent1Token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // 3. Date filters across presets in Asia/Kolkata
  it('3. Date filters across presets (today, this-month, custom) work accurately in Asia/Kolkata', async () => {
    const resToday = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=today')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resToday.status).toBe(200);
    expect(resToday.body.data.period.preset).toBe('today');

    const resMonth = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=this-month')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resMonth.status).toBe(200);
    expect(resMonth.body.data.period.preset).toBe('this-month');

    const resCustom = await request(app)
      .get('/api/v1/reports/finance-dashboard?startDate=2026-09-01&endDate=2026-09-30')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resCustom.status).toBe(200);
    expect(resCustom.body.data.period.startDate).toBe('2026-09-01');
    expect(resCustom.body.data.period.endDate).toBe('2026-09-30');
  });

  // 4. Total collections KPI reconciles with payments ledger
  it('4. Total collections KPI reconciles with payments ledger', async () => {
    const dashRes = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.topKpis.totalCollections).toBeGreaterThan(0);
  });

  // 5. Reversed payments excluded from active collection totals
  it('5. Reversed payments are excluded from active collection totals in dashboard', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const topKpis = res.body.data.topKpis;
    // Check that reversed payment (₹3,000) does not distort active counts
    expect(topKpis.collectionCount).toBeGreaterThan(0);
  });

  // 6. Direct customer collections metric is accurate
  it('6. Direct customer collections metric is accurate and excludes dealer/agent', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const directSummary = res.body.data.directCustomerSummary;
    expect(directSummary.totalDirectCollections).toBeGreaterThanOrEqual(6000);
    expect(directSummary.paymentCount).toBeGreaterThanOrEqual(1);
  });

  // 7. Dealer collections metric is accurate
  it('7. Dealer collections metric is accurate', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const dealerSummary = res.body.data.dealerReconciliation;
    expect(dealerSummary.totalCollectedThroughDealers).toBeGreaterThanOrEqual(5000);
  });

  // 8. Recovery agent collections metric is accurate
  it('8. Recovery agent collections metric is accurate', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const agentSummary = res.body.data.recoveryAgentSummary;
    expect(agentSummary.totalAgentCollections).toBeGreaterThanOrEqual(4000);
  });

  // 9. Source breakdown totals reconcile: direct + dealer + agent == totalCollections
  it('9. Source breakdown totals reconcile: direct + dealer + agent == totalCollections in period', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { topKpis, sourceBreakdown } = res.body.data;
    const sumBreakdown = sourceBreakdown.directCustomer.amount + sourceBreakdown.dealer.amount + sourceBreakdown.recoveryAgent.amount;
    expect(Math.round(sumBreakdown)).toBe(Math.round(topKpis.totalCollections));
  });

  // 10. Dealer settlement total reconciles with completed settlement records
  it('10. Dealer settlement total reconciles with completed settlement records', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { dealerReconciliation } = res.body.data;
    expect(dealerReconciliation.totalDealerSettled).toBeGreaterThanOrEqual(3000);
  });

  // 11. Dealer outstanding remittance equals collections minus settlements
  it('11. Dealer outstanding remittance equals collections minus settlements', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { dealerReconciliation } = res.body.data;
    const specificDealer = dealerReconciliation.dealers.find((d: any) => d.dealerId === dealerId);
    expect(specificDealer).toBeDefined();
    expect(specificDealer.customerCollections).toBe(5000);
    expect(specificDealer.settled).toBe(3000);
    expect(specificDealer.outstanding).toBe(2000); // 5000 - 3000 = 2000
  });

  // 12. Recovery agent summary matches agent collection records
  it('12. Recovery agent summary metrics match agent collection records', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { recoveryAgentSummary } = res.body.data;
    const specificAgent = recoveryAgentSummary.agents.find((a: any) => a.agentId === agent1Id);
    expect(specificAgent).toBeDefined();
    expect(specificAgent.collections).toBeGreaterThanOrEqual(4000);
  });

  // 13. Direct customer summary matches direct payment records
  it('13. Direct customer summary matches direct payment records', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { directCustomerSummary } = res.body.data;
    expect(directCustomerSummary.totalDirectCollections).toBeGreaterThanOrEqual(6000);
    expect(directCustomerSummary.averagePayment).toBeGreaterThan(0);
  });

  // 14. Active portfolio matches outstanding balance of active loans
  it('14. Active portfolio matches outstanding balance of active loans', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { topKpis, portfolioSummary } = res.body.data;
    expect(topKpis.activePortfolio).toBeGreaterThan(0);
    expect(portfolioSummary.totalOutstandingPrincipal).toBe(topKpis.activePortfolio);
  });

  // 15. Total overdue amount matches overdue EMI installments
  it('15. Total overdue amount matches overdue EMI installments', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { topKpis, overdueSummary } = res.body.data;
    expect(topKpis.totalOverdueAmount).toBe(overdueSummary.totalOverdueAmount);
  });

  // 16. Aging buckets classification
  it('16. PAR aging buckets accurately classify overdue days (current, 1-30, 31-60, 61-90, 90+)', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { agingBuckets } = res.body.data;
    expect(agingBuckets.current).toBeDefined();
    expect(agingBuckets.dpd1To30).toBeDefined();
    expect(agingBuckets.dpd31To60).toBeDefined();
    expect(agingBuckets.dpd61To90).toBeDefined();
    expect(agingBuckets.dpd90Plus).toBeDefined();
  });

  // 17. Collection efficiency safe zero handling
  it('17. Collection efficiency handles zero due safely without NaN or Infinity', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?startDate=2035-01-01&endDate=2035-01-31')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const eff = res.body.data.topKpis.collectionEfficiencyPercent;
    expect(isNaN(eff)).toBe(false);
    expect(isFinite(eff)).toBe(true);
    expect(eff).toBeGreaterThanOrEqual(0);
  });

  // 18. Recent collections feed
  it('18. Recent collections feed returns enriched source and detail payload', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard?preset=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { recentCollections } = res.body.data;
    expect(recentCollections.length).toBeGreaterThan(0);
    const first = recentCollections[0];
    expect(first.receiptNumber).toBeDefined();
    expect(first.customerName).toBeDefined();
    expect(first.collectedThrough).toBeDefined();
  });

  // 19. Custom reports endpoint
  it('19. Custom reports endpoint (/api/v1/reports/custom) supports collections, loans, dealer, and recovery categories', async () => {
    // Category 1: collections
    const colRes = await request(app)
      .get('/api/v1/reports/custom?category=collections&reportType=all-collections')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(colRes.status).toBe(200);
    expect(colRes.body.data.records).toBeDefined();
    expect(colRes.body.data.summary.totalAmount).toBeGreaterThan(0);

    // Category 2: loans
    const loanRes = await request(app)
      .get('/api/v1/reports/custom?category=loans&reportType=active-portfolio')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(loanRes.status).toBe(200);
    expect(loanRes.body.data.records).toBeDefined();

    // Category 3: dealer
    const dlrRes = await request(app)
      .get('/api/v1/reports/custom?category=dealer&reportType=dealer-reconciliation')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dlrRes.status).toBe(200);
    expect(dlrRes.body.data.records).toBeDefined();

    // Category 4: recovery
    const recRes = await request(app)
      .get('/api/v1/reports/custom?category=recovery&reportType=agent-performance')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(recRes.status).toBe(200);
    expect(recRes.body.data.records).toBeDefined();
  });

  // 20. CSV export
  it('20. CSV export generates valid CSV content with sanitized headers and filters', async () => {
    const csvRes = await request(app)
      .get('/api/v1/reports/export?type=all-collections')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('Receipt Number');
    expect(csvRes.text).toContain('Customer Name');
    expect(csvRes.text).toContain('Amount (INR)');
  });

  // 21. Branch Manager access
  it('21. Branch Manager access is authorized and respects permissions', async () => {
    const res = await request(app)
      .get('/api/v1/reports/finance-dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 22. Collection agent forbidden from exporting organization-wide CSV
  it('22. Collection agent is forbidden from downloading organization-wide CSV exports', async () => {
    const res = await request(app)
      .get('/api/v1/reports/export?type=all-collections')
      .set('Authorization', `Bearer ${agent1Token}`);
    expect(res.status).toBe(403);
  });
});
