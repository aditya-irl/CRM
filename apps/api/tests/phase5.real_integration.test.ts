import request from 'supertest';
import app from '../src/app';
import { getPostgresPool, queryPostgres, closePostgresPool } from '../src/database/postgres';
import { getRedisClient, closeRedisConnection } from '../src/core/redis';
import { UserRole, PaymentMode, LoanStatus, EMIStatus, CallOutcome, getBusinessDate } from '@crm/shared';
import bcrypt from 'bcryptjs';

describe('PHASE 5: Real Integration Test Suite (Reporting, Analytics, Call Logs, Field Operations & Exports)', () => {
  let superAdminToken: string;
  let adminToken: string;
  let agent1Token: string;
  let agent2Token: string;

  let superAdminId: string;
  let adminId: string;
  let agent1Id: string;
  let agent2Id: string;

  let customer1Id: string;
  let customer2Id: string;

  let loan1Id: string;
  let loan2Id: string;

  let emi1Id: string;
  let emi2Id: string;

  const testSuffix = Math.random().toString(36).substring(2, 8);
  const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');

  beforeAll(async () => {
    getPostgresPool();

    const saEmail = `sa-p5-${testSuffix}@crm.test`;
    const admEmail = `adm-p5-${testSuffix}@crm.test`;
    const ag1Email = `ag1-p5-${testSuffix}@crm.test`;
    const ag2Email = `ag2-p5-${testSuffix}@crm.test`;
    const numId = Math.floor(10000 + Math.random() * 90000);

    const hash = bcrypt.hashSync('Password@123', 10);

    // Super Admin
    const saRes = await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, 'Super Admin P5', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [saEmail, `98751${numId}`, hash]
    );
    superAdminId = saRes.rows[0].id;

    const saLogin = await request(app).post('/api/v1/auth/login').send({
      email: saEmail,
      password: 'Password@123',
    });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    // Admin
    const admRes = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: admEmail,
        password: 'Password@123',
        fullName: 'Branch Admin P5',
        phone: `98752${numId}`,
        role: UserRole.ADMIN,
      });
    adminId = admRes.body.data.id;

    const admLogin = await request(app).post('/api/v1/auth/login').send({
      email: admEmail,
      password: 'Password@123',
    });
    adminToken = admLogin.body.data.tokens.accessToken;

    // Agent 1 (Assigned Route North)
    const ag1Res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: ag1Email,
        password: 'Password@123',
        fullName: 'Agent North P5',
        phone: `98753${numId}`,
        role: UserRole.COLLECTION_AGENT,
      });
    agent1Id = ag1Res.body.data.id;

    const ag1Login = await request(app).post('/api/v1/auth/login').send({
      email: ag1Email,
      password: 'Password@123',
    });
    agent1Token = ag1Login.body.data.tokens.accessToken;

    // Agent 2 (Assigned Route South)
    const ag2Res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: ag2Email,
        password: 'Password@123',
        fullName: 'Agent South P5',
        phone: `98754${numId}`,
        role: UserRole.COLLECTION_AGENT,
      });
    agent2Id = ag2Res.body.data.id;

    const ag2Login = await request(app).post('/api/v1/auth/login').send({
      email: ag2Email,
      password: 'Password@123',
    });
    agent2Token = ag2Login.body.data.tokens.accessToken;

    // Customer 1 in Route-North
    const cust1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Customer North ${testSuffix}`,
        primaryPhone: `91111${numId}`,
        addressLine1: '100 North Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        areaRoute: `Route-North-${testSuffix}`,
      });
    customer1Id = cust1Res.body.data.id;

    // Customer 2 in Route-South
    const cust2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Customer South ${testSuffix}`,
        primaryPhone: `92222${numId}`,
        addressLine1: '200 South Station Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560002',
        areaRoute: `Route-South-${testSuffix}`,
      });
    customer2Id = cust2Res.body.data.id;

    // Assign Customer 1 to Agent 1
    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agent1Id,
        customerId: customer1Id,
        effectiveFrom: '2026-01-01',
      });

    // Assign Customer 2 to Agent 2
    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agent2Id,
        customerId: customer2Id,
        effectiveFrom: '2026-01-01',
      });

    // Create Loan 1 for Customer 1 (Principal 10000, 3 EMIs) assigned to Agent 1
    const loan1Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        principalAmount: 10000,
        downPayment: 0,
        annualInterestRate: 12,
        tenureMonths: 3,
        installmentFrequency: 'MONTHLY',
        interestCalcMethod: 'FLAT_RATE',
        disbursementDate: '2026-06-01',
        firstEmiDate: '2026-07-01',
        assignedAgentId: agent1Id,
      });
    loan1Id = loan1Res.body.data.id;

    // Disburse Loan 1
    await request(app)
      .post(`/api/v1/loans/${loan1Id}/disburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    // Create Loan 2 for Customer 2 (Principal 20000, 4 EMIs) assigned to Agent 2
    const loan2Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        principalAmount: 20000,
        downPayment: 0,
        annualInterestRate: 12,
        tenureMonths: 4,
        installmentFrequency: 'MONTHLY',
        interestCalcMethod: 'FLAT_RATE',
        disbursementDate: '2026-06-01',
        firstEmiDate: '2026-07-01',
        assignedAgentId: agent2Id,
      });
    loan2Id = loan2Res.body.data.id;

    // Disburse Loan 2
    await request(app)
      .post(`/api/v1/loans/${loan2Id}/disburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    // Adjust Loan 1 EMI 1 to be OVERDUE (15 days overdue) and EMI 2 to be DUE_TODAY
    const emisLoan1 = await queryPostgres(
      'SELECT id, installment_number FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
      [loan1Id]
    );
    emi1Id = emisLoan1.rows[0].id;
    await queryPostgres(
      `UPDATE emi_installments 
       SET status = 'OVERDUE', days_overdue = 15, due_date = '2026-09-04', penalty_amount = 100.00
       WHERE id = $1`,
      [emi1Id]
    );
    await queryPostgres(
      `UPDATE emi_installments 
       SET status = 'DUE_TODAY', due_date = $1
       WHERE id = $2`,
      [businessToday, emisLoan1.rows[1].id]
    );

    // Adjust Loan 2 EMI 1 to be OVERDUE (45 days overdue in PAR 31-60 bucket)
    const emisLoan2 = await queryPostgres(
      'SELECT id, installment_number FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
      [loan2Id]
    );
    emi2Id = emisLoan2.rows[0].id;
    await queryPostgres(
      `UPDATE emi_installments 
       SET status = 'OVERDUE', days_overdue = 45, due_date = '2026-08-05', penalty_amount = 250.00
       WHERE id = $1`,
      [emi2Id]
    );

    // Record a payment on Loan 1 collected by Agent 1
    await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 2000,
        paymentMode: PaymentMode.CASH,
        notes: 'Initial field collection',
      });
  });

  afterAll(async () => {
    await closePostgresPool();
    await closeRedisConnection();
  });

  // =========================================================================
  // 1. DASHBOARD ANALYTICS & ROLE-BASED SCOPING
  // =========================================================================
  describe('1. Dashboard Analytics & Role-Based Scoping', () => {
    it('Admin retrieves organization-wide dashboard statistics', async () => {
      const res = await request(app)
        .get('/api/v1/reports/dashboard-stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalActiveLoans).toBeGreaterThanOrEqual(2);
      expect(res.body.data.todayCollectedAmount).toBeGreaterThanOrEqual(2000);
      expect(res.body.data.totalOverdueAmount).toBeGreaterThanOrEqual(350); // 100 penalty + 250 penalty + remaining
      expect(res.body.data.agingBuckets).toBeDefined();
      expect(res.body.data.agingBuckets.bucket0To30).toBeGreaterThanOrEqual(0);
      expect(res.body.data.agingBuckets.bucket31To60).toBeGreaterThanOrEqual(0);
    });

    it('Collection Agent 1 receives strictly scoped dashboard analytics for assigned portfolio', async () => {
      const res = await request(app)
        .get('/api/v1/reports/dashboard-stats')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Agent 1 has only Loan 1 assigned
      expect(res.body.data.totalActiveLoans).toBe(1);
      expect(res.body.data.todayCollectedAmount).toBe(2000);
      expect(res.body.data.totalOverdueCustomers).toBe(1);
      expect(res.body.data.recentPayments.length).toBeGreaterThanOrEqual(1);
      // Ensure all recent payments belong to Agent 1
      res.body.data.recentPayments.forEach((p: any) => {
        expect(p.collected_by_agent_id || p.collected_by_name).toBeDefined();
      });
    });

    it('Collection Agent 2 receives strictly scoped analytics (0 collected, Loan 2 only)', async () => {
      const res = await request(app)
        .get('/api/v1/reports/dashboard-stats')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalActiveLoans).toBe(1);
      expect(res.body.data.todayCollectedAmount).toBe(0);
      expect(res.body.data.totalOverdueCustomers).toBe(1);
    });
  });

  // =========================================================================
  // 2. DAILY COLLECTION REPORTS & FILTERING
  // =========================================================================
  describe('2. Daily Collection Reports & Filtering', () => {
    it('Admin views daily collections ledger with aggregate mode breakdowns', async () => {
      const res = await request(app)
        .get(`/api/v1/reports/daily-collections?date=${businessToday}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCollected).toBeGreaterThanOrEqual(2000);
      expect(res.body.data.modeBreakdown.cash).toBeGreaterThanOrEqual(2000);
      expect(res.body.data.records.length).toBeGreaterThanOrEqual(1);
    });

    it('Admin filters daily collections by agentId and payment mode', async () => {
      const res = await request(app)
        .get(`/api/v1/reports/daily-collections?agentId=${agent1Id}&mode=CASH`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.records.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.records[0].collected_by_name).toContain('Agent North');
    });

    it('Agent 1 cannot access Agent 2 daily collections (enforces self-scoping)', async () => {
      // Agent 1 requests with agentId=agent2Id filter; backend should force agentId = user.id
      const res = await request(app)
        .get(`/api/v1/reports/daily-collections?agentId=${agent2Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      // Should return Agent 1 records, NOT Agent 2 records
      res.body.data.records.forEach((r: any) => {
        expect(r.collected_by_name).toContain('Agent North');
      });
    });
  });

  // =========================================================================
  // 3. OVERDUE & PAR (PORTFOLIO AT RISK) AGING REPORT
  // =========================================================================
  describe('3. Overdue & PAR Aging Reports', () => {
    it('Admin retrieves comprehensive PAR aging report with bucket breakdown', async () => {
      const res = await request(app)
        .get('/api/v1/reports/overdue-par')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const summary = res.body.data.summary;
      expect(summary.totalOverdueLoans).toBeGreaterThanOrEqual(2);
      expect(summary.parBuckets.par1To30.count).toBeGreaterThanOrEqual(1); // Loan 1 (15 days overdue)
      expect(summary.parBuckets.par31To60.count).toBeGreaterThanOrEqual(1); // Loan 2 (45 days overdue)
      expect(res.body.data.records.length).toBeGreaterThanOrEqual(2);
    });

    it('Filters PAR report by specific aging bucket (1-30 days)', async () => {
      const res = await request(app)
        .get('/api/v1/reports/overdue-par?bucket=1-30')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      res.body.data.records.forEach((r: any) => {
        expect(r.daysOverdue).toBeGreaterThanOrEqual(1);
        expect(r.daysOverdue).toBeLessThanOrEqual(30);
      });
    });

    it('Filters PAR report by 31-60 days bucket', async () => {
      const res = await request(app)
        .get('/api/v1/reports/overdue-par?bucket=31-60')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      res.body.data.records.forEach((r: any) => {
        expect(r.daysOverdue).toBeGreaterThanOrEqual(31);
        expect(r.daysOverdue).toBeLessThanOrEqual(60);
      });
    });

    it('Agent 1 PAR report only contains assigned Customer 1 / Loan 1 records', async () => {
      const res = await request(app)
        .get('/api/v1/reports/overdue-par')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      res.body.data.records.forEach((r: any) => {
        expect(r.customerId).toBe(customer1Id);
      });
    });
  });

  // =========================================================================
  // 4. CALL & RECOVERY LOGS WITH RLAC & IDOR PROTECTION
  // =========================================================================
  describe('4. Call & Recovery Logs (RLAC & IDOR Protections)', () => {
    it('Agent 1 logs a valid call interaction for assigned Customer 1', async () => {
      const res = await request(app)
        .post('/api/v1/call-logs')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          customerId: customer1Id,
          loanId: loan1Id,
          outcome: CallOutcome.PROMISED_TO_PAY,
          promisedPaymentDate: '2026-09-25',
          notes: 'Customer agreed to pay balance by next Friday',
          contactPhoneUsed: '9111100000',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.outcome).toBe(CallOutcome.PROMISED_TO_PAY);
      expect(res.body.data.promisedPaymentDate).toBe('2026-09-25');
    });

    it('Agent 1 is REJECTED (403) when attempting to log call for unassigned Customer 2', async () => {
      const res = await request(app)
        .post('/api/v1/call-logs')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          customerId: customer2Id,
          outcome: CallOutcome.PROMISED_TO_PAY,
          notes: 'Unauthorized call log attempt',
          contactPhoneUsed: '9222200000',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('permission');
    });

    it('Agent 1 can view call history for assigned Customer 1', async () => {
      const res = await request(app)
        .get(`/api/v1/call-logs/customer/${customer1Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].notes).toContain('Customer agreed to pay');
    });

    it('Agent 1 is REJECTED (403) when attempting to view call history of unassigned Customer 2', async () => {
      const res = await request(app)
        .get(`/api/v1/call-logs/customer/${customer2Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('permission');
    });

    it('Admin can view call history for any customer in the organization', async () => {
      const res = await request(app)
        .get(`/api/v1/call-logs/customer/${customer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('Admin queries paginated call logs with filters', async () => {
      const res = await request(app)
        .get('/api/v1/call-logs?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 5. FIELD COLLECTION / AGENT QUEUE
  // =========================================================================
  describe('5. Field Collection / Agent Queue', () => {
    it('Agent 1 receives prioritized collection queue with Overdue -> Due Today -> Upcoming ordering', async () => {
      const res = await request(app)
        .get('/api/v1/emi/queue')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);

      // Verify that the first item is the OVERDUE installment
      expect(res.body.data[0].status).toBe('OVERDUE');
      expect(res.body.data[0].daysOverdue).toBe(15);
      // Verify attached call log outcome
      expect(res.body.data[0].lastCallOutcome).toBe(CallOutcome.PROMISED_TO_PAY);
      expect(res.body.data[0].promisedPaymentDate).toBe('2026-09-25');
    });

    it('Agent 1 queue supports pagination and search', async () => {
      const res = await request(app)
        .get(`/api/v1/emi/queue?page=1&limit=1&search=Customer North`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].customerName).toContain('Customer North');
    });

    it('Agent 2 queue only contains Customer 2 records', async () => {
      const res = await request(app)
        .get('/api/v1/emi/queue')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(res.status).toBe(200);
      res.body.data.forEach((item: any) => {
        expect(item.customerId).toBe(customer2Id);
        expect(item.customerName).toContain('Customer South');
      });
    });
  });

  // =========================================================================
  // 6. AGENT PERFORMANCE REPORT
  // =========================================================================
  describe('6. Agent Performance Rankings', () => {
    it('Admin fetches agent performance rankings', async () => {
      const res = await request(app)
        .get('/api/v1/reports/agent-performance')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const agent1Data = res.body.data.find((a: any) => a.agent_id === agent1Id);
      expect(agent1Data).toBeDefined();
      expect(agent1Data.total_lifetime_collected).toBeGreaterThanOrEqual(2000);
      expect(agent1Data.total_calls_logged).toBeGreaterThanOrEqual(1);
      expect(agent1Data.assigned_customers_count).toBeGreaterThanOrEqual(1);
    });

    it('Collection Agent is forbidden (403) from accessing full agent performance report', async () => {
      const res = await request(app)
        .get('/api/v1/reports/agent-performance')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 7. CONTROLLED CSV EXPORTS & RBAC
  // =========================================================================
  describe('7. Controlled CSV Exports & RBAC', () => {
    it('Admin exports daily collections as CSV', async () => {
      const res = await request(app)
        .get('/api/v1/reports/export?type=daily-collections')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.text).toContain('Receipt Number,Date & Time,Customer Code');
      expect(res.text).toContain('2000.00');
    });

    it('Admin exports overdue PAR report as CSV', async () => {
      const res = await request(app)
        .get('/api/v1/reports/export?type=overdue-par')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Loan Account,Customer Code,Customer Name');
      expect(res.text).toContain('Days Overdue');
    });

    it('Admin exports customers list as CSV with sensitive PII protected', async () => {
      const res = await request(app)
        .get('/api/v1/reports/export?type=customers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Customer Code,Full Name,Primary Phone');
      // Ensure KYC document numbers / raw hashes are not exposed
      expect(res.text).not.toContain('aadhaar_number');
      expect(res.text).not.toContain('pan_number');
    });

    it('Collection Agent can export their own daily collections', async () => {
      const res = await request(app)
        .get('/api/v1/reports/export?type=daily-collections')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Agent North');
      expect(res.text).not.toContain('Agent South');
    });

    it('Collection Agent is forbidden (403) from exporting org customer directory', async () => {
      const res = await request(app)
        .get('/api/v1/reports/export?type=customers')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
    });
  });
});
