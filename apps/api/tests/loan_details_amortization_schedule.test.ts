import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { v4 as uuidv4 } from 'uuid';

describe('Loan Details & Amortization Schedule Integrity Regression Tests', () => {
  let adminToken: string;
  let customerId: string;
  let dealerId: string;
  const runId = Date.now().toString(36);

  beforeAll(async () => {
    // 1. Authenticate as Admin
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.data.tokens.accessToken;

    // 2. Create dealer
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Amort Store ${runId}`,
        ownerName: 'Test Owner',
        phone: `92${Math.floor(10000000 + Math.random() * 90000000)}`,
        address: '101 Amort Rd',
        areaCity: 'Dadri',
      });
    expect(dealerRes.status).toBe(201);
    dealerId = dealerRes.body.data.id;

    // 3. Obtain customer
    const existingCust = await queryPostgres('SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1');
    if (existingCust.rows.length > 0) {
      customerId = existingCust.rows[0].id;
    } else {
      const newCustId = uuidv4();
      await queryPostgres(
        `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, '202 Finance Ave', 'Dadri', 'Uttar Pradesh', '203207', 'Dadri Market', TRUE, NOW(), NOW())`,
        [newCustId, `CUST-${runId}`, `Amort Customer ${runId}`, `93${Math.floor(10000000 + Math.random() * 90000000)}`]
      );
      customerId = newCustId;
    }
  });

  afterAll(async () => {
    await closePostgresPool();
    await closeRedisConnection();
    await closeAllQueues();
  });

  test('1. Monthly Flat Simple Interest: Retail 10k, DP 4k, Financed 6k, Rate 1%, Tenure 6m', async () => {
    // Preview calculation
    const previewRes = await request(app)
      .post('/api/v1/loans/calculate-preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        principalAmount: 10000,
        downPayment: 4000,
        monthlyInterestRate: 1,
        annualInterestRate: 1,
        tenureMonths: 6,
        disbursementDate: '2026-10-06',
        firstEmiDate: '2026-11-06',
      });

    expect(previewRes.status).toBe(200);
    const data = previewRes.body.data;
    expect(data.netDisbursedAmount).toBe(6000);
    expect(data.totalInterest).toBe(360);
    expect(data.totalPayable).toBe(6360);
    expect(data.emiAmount).toBe(1060);
    expect(data.totalInstallments).toBe(6);
    expect(data.schedule.length).toBe(6);

    // Verify installments in schedule
    data.schedule.forEach((inst: any, idx: number) => {
      expect(inst.installmentNumber).toBe(idx + 1);
      expect(inst.expectedAmount).toBe(1060);
      expect(inst.principalComponent).toBe(1000);
      expect(inst.interestComponent).toBe(60);
      expect(inst.paidAmount).toBe(0);
      expect(inst.penaltyAmount).toBe(0);
      expect(inst.remainingAmount).toBe(1060);
    });
  });

  test('2. Book loan and verify GET /api/v1/loans/:id returns complete schedule data with dual camelCase and snake_case mapping', async () => {
    const bookRes = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        dealerId,
        principalAmount: 10000,
        downPayment: 4000,
        monthlyInterestRate: 1,
        annualInterestRate: 1,
        tenureMonths: 6,
        disbursementDate: '2026-10-06',
        firstEmiDate: '2026-11-06',
      });

    expect(bookRes.status).toBe(201);
    const loanId = bookRes.body.data.id;
    expect(loanId).toBeDefined();

    // Fetch loan details
    const detailRes = await request(app)
      .get(`/api/v1/loans/${loanId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(detailRes.status).toBe(200);
    const loanDetail = detailRes.body.data;

    // Check loan object dual compatibility
    expect(loanDetail.loanAccountNo).toBeDefined();
    expect(loanDetail.loan_account_no).toBe(loanDetail.loanAccountNo);
    expect(loanDetail.customerName).toBeDefined();
    expect(loanDetail.customer_name).toBe(loanDetail.customerName);
    expect(loanDetail.areaRoute).toBeDefined();
    expect(loanDetail.area_route).toBe(loanDetail.areaRoute);
    expect(loanDetail.dealerId).toBe(dealerId);
    expect(loanDetail.dealer_id).toBe(dealerId);
    expect(loanDetail.netDisbursedAmount).toBe(6000);
    expect(loanDetail.net_disbursed_amount).toBe(6000);
    expect(loanDetail.totalPayable).toBe(6360);
    expect(loanDetail.total_payable).toBe(6360);

    // Verify exactly 6 installments returned
    expect(loanDetail.installments).toBeDefined();
    expect(loanDetail.installments.length).toBe(6);

    // Check each installment for non-blank, non-zero values and dual field compatibility
    loanDetail.installments.forEach((inst: any, idx: number) => {
      // Installment number must not be blank
      expect(inst.installmentNumber).toBe(idx + 1);
      expect(inst.installment_number).toBe(idx + 1);

      // Due date must not be blank
      expect(typeof inst.dueDate).toBe('string');
      expect(inst.dueDate.length).toBeGreaterThan(0);
      expect(inst.due_date).toBe(inst.dueDate);

      // Expected amount must be > 0 (exactly 1060)
      expect(inst.expectedAmount).toBe(1060);
      expect(inst.expected_amount).toBe(1060);

      // Principal component must be 1000
      expect(inst.principalComponent).toBe(1000);
      expect(inst.principal_component).toBe(1000);

      // Interest component must be 60
      expect(inst.interestComponent).toBe(60);
      expect(inst.interest_component).toBe(60);

      // Paid initially 0
      expect(inst.paidAmount).toBe(0);
      expect(inst.paid_amount).toBe(0);

      // Penalty initially 0
      expect(inst.penaltyAmount).toBe(0);
      expect(inst.penalty_amount).toBe(0);

      // Total due initially equals expected amount
      expect(inst.remainingAmount).toBe(1060);
      expect(inst.remaining_amount).toBe(1060);

      // Status must not be undefined
      expect(inst.status).toBeDefined();
    });
  });

  test('3. Verify LN-2026-1005 loan details in database contains valid, complete schedule data', async () => {
    const loanCheck = await queryPostgres(
      'SELECT id, loan_account_no FROM loans WHERE loan_account_no = $1',
      ['LN-2026-1005']
    );

    if (loanCheck.rows.length > 0) {
      const targetLoanId = loanCheck.rows[0].id;
      const res = await request(app)
        .get(`/api/v1/loans/${targetLoanId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.loanAccountNo).toBe('LN-2026-1005');
      expect(data.installments.length).toBeGreaterThanOrEqual(1);

      // Verify no blank or zero values in LN-2026-1005
      data.installments.forEach((inst: any, idx: number) => {
        expect(inst.installmentNumber).toBe(idx + 1);
        expect(inst.installment_number).toBe(idx + 1);
        expect(inst.dueDate).toBeDefined();
        expect(typeof inst.dueDate).toBe('string');
        expect(inst.dueDate.length).toBeGreaterThan(0);
        expect(inst.due_date).toBeDefined();
        expect(inst.expectedAmount).toBeGreaterThan(0);
        expect(inst.expected_amount).toBeGreaterThan(0);
        expect(inst.paidAmount + inst.remainingAmount).toBeCloseTo(inst.expectedAmount, 1);
        expect(inst.paid_amount + inst.remaining_amount).toBeCloseTo(inst.expected_amount, 1);
      });
    }
  });
});
