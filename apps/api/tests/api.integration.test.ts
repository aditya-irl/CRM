import request from 'supertest';
import app from '../src/app';
import { initDatabase } from '../src/database/db';
import { seedDatabase, seedPostgres } from '../src/database/seed';
import { closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';

beforeAll(async () => {
  initDatabase();
  seedDatabase();
  await seedPostgres();
});

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('API Integration & End-to-End Tests', () => {
  let adminToken: string;
  let agentToken: string;
  let testCustomerId: string;
  let testLoanId: string;
  let testEmiId: string;

  test('POST /api/v1/auth/login - Admin Login', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    adminToken = res.body.data.tokens.accessToken;
  });

  let agentUserId: string;

  test('POST /api/v1/auth/login - Agent Login', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'agent.rahul@financecrm.com', password: 'Agent@123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    agentToken = res.body.data.tokens.accessToken;
    agentUserId = res.body.data.user.id;
  });

  test('POST /api/v1/customers - Admin creates a new customer', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Test Borrower Integration',
        primaryPhone: '+919988776655',
        addressLine1: 'Shop 101, Test Road',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
        areaRoute: 'Sector-12 Market',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    testCustomerId = res.body.data.id;
  });

  test('POST /api/v1/loans - Admin books and amortizes a new loan', async () => {
    const res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: testCustomerId,
        principalAmount: 50000,
        downPayment: 5000,
        annualInterestRate: 12.0,
        interestCalcMethod: 'FLAT_RATE',
        tenureMonths: 6,
        installmentFrequency: 'MONTHLY',
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agentUserId,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loanAccountNo).toBeDefined();
    expect(res.body.data.totalPayable).toBe(47700); // (50000 - 5000) = 45000 * 12% * 0.5 = 2700 int => 47700 total
    testLoanId = res.body.data.id;
  });

  test('GET /api/v1/loans/:id - Fetch loan and verify amortization schedule', async () => {
    const res = await request(app)
      .get(`/api/v1/loans/${testLoanId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.installments.length).toBe(6);
    testEmiId = res.body.data.installments[0].id;
  });

  test('GET /api/v1/agent/queue - Agent fetches assigned queue', async () => {
    const res = await request(app)
      .get('/api/v1/agent/queue')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /api/v1/payments - Agent records payment with idempotency protection', async () => {
    const idempotencyKey = `TEST_IDEMPOTENCY_${Date.now()}`;

    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        loanId: testLoanId,
        customerId: testCustomerId,
        amount: 7950,
        paymentMode: 'CASH',
        notes: 'Integration test cash collection',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.receiptNumber).toMatch(/^RCP-/);
    expect(res.body.data.remainingLoanOutstanding).toBe(47700 - 7950);

    const paymentId = res.body.data.paymentId;

    // Test duplicate post with same idempotency key returns same receipt
    const duplicateRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agentToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        loanId: testLoanId,
        customerId: testCustomerId,
        amount: 7950,
        paymentMode: 'CASH',
      });

    expect(duplicateRes.status).toBe(200);
    expect(duplicateRes.body.data.paymentId).toBe(paymentId);
  });

  test('POST /api/v1/call-logs - Agent logs customer recovery call', async () => {
    const res = await request(app)
      .post('/api/v1/call-logs')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        customerId: testCustomerId,
        loanId: testLoanId,
        outcome: 'PROMISED_TO_PAY',
        promisedPaymentDate: '2026-09-25',
        notes: 'Borrower promised to clear balance on 25th',
        contactPhoneUsed: '+919988776655',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.outcome).toBe('PROMISED_TO_PAY');
  });

  test('GET /api/v1/reports/dashboard-stats - Admin fetches executive analytics', async () => {
    const res = await request(app)
      .get('/api/v1/reports/dashboard-stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalActiveLoans).toBeGreaterThan(0);
    expect(res.body.data.agingBuckets).toBeDefined();
  });

  test('GET /api/v1/audit-logs - Admin verifies immutable audit trail', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
