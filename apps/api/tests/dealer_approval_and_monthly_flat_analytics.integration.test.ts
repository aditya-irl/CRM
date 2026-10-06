import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, LoanStatus, InterestMethod, RepaymentFrequency, generateAmortizationSchedule } from '@crm/shared';

describe('Dealer Loan Approval, Monthly Flat Simple Interest & Dealer Financing Analytics Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;

  let dealerId: string;
  let dealerToken: string;
  let customerId: string;

  beforeAll(async () => {
    // 1. Authenticate as Super Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 2. Create Test Dealer
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Financing Partner Store ${runId}`,
        ownerName: 'Partner Merchant',
        phone: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `partner_${runId}@store.test`,
        address: '88 Commercial Arcade',
        areaCity: 'Delhi',
      });
    expect(dealerRes.status).toBe(201);
    dealerId = dealerRes.body.data.id;

    // 3. Create Dealer Login Credentials
    const credRes = await request(app)
      .post(`/api/v1/dealers/${dealerId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(credRes.status).toBe(201);
    const { loginId, temporaryPassword } = credRes.body.data;

    // 4. Login as Dealer and complete mandatory password change
    const dealerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: loginId, password: temporaryPassword });
    expect(dealerLogin.status).toBe(200);
    expect(dealerLogin.body.data.user.mustChangePassword).toBe(true);

    const changePassRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${dealerLogin.body.data.tokens.accessToken}`)
      .send({
        currentPassword: temporaryPassword,
        newPassword: 'SecurePartnerPass@2026',
      });
    expect(changePassRes.status).toBe(200);

    const activeDealerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: loginId, password: 'SecurePartnerPass@2026' });
    expect(activeDealerLogin.status).toBe(200);
    dealerToken = activeDealerLogin.body.data.tokens.accessToken;

    // 5. Create a customer
    const custRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Borrower ${runId}`,
        primaryPhone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: '42 Ring Road',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
        areaRoute: 'CENTRAL_DELHI',
      });
    expect(custRes.status).toBe(201);
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    // Clean up created entities atomically
    try {
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id IN (SELECT id FROM loans WHERE dealer_id = $1)', [dealerId]);
      await queryPostgres('DELETE FROM loans WHERE dealer_id = $1', [dealerId]);
      await queryPostgres('DELETE FROM users WHERE dealer_id = $1', [dealerId]);
      await queryPostgres('DELETE FROM dealers WHERE id = $1', [dealerId]);
      await queryPostgres('DELETE FROM customers WHERE id = $1', [customerId]);
    } catch {}

    await closePostgresPool();
    await closeRedisConnection();
    await closeAllQueues();
  });

  // ============================================================
  // PART 5: MONTHLY FLAT SIMPLE INTEREST TESTS
  // ============================================================
  describe('Monthly Flat Simple Interest Engine Calculations', () => {
    test('Mandatory exact test case: Retail 10,000, DP 4,000, Principal 6,000, 1% rate, 6m', () => {
      // Financed Principal = 10000 - 4000 = 6000
      // Monthly Interest = 6000 * 1% = 60
      // Total Interest = 60 * 6 = 360
      // Total Payable = 6000 + 360 = 6360
      // Monthly EMI = 6360 / 6 = 1060
      const result = generateAmortizationSchedule({
        principalAmount: 10000,
        downPayment: 4000,
        annualInterestRate: 1, // 1% per month
        monthlyInterestRate: 1,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });

      expect(result.netDisbursedAmount).toBe(6000);
      expect(result.totalInterest).toBe(360);
      expect(result.totalPayable).toBe(6360);
      expect(result.emiAmount).toBe(1060);
      expect(result.totalInstallments).toBe(6);
      expect(result.schedule.length).toBe(6);

      // Verify every installment is 1060
      for (const inst of result.schedule) {
        expect(inst.expectedAmount).toBe(1060);
        expect(inst.interestComponent).toBe(60);
        expect(inst.principalComponent).toBe(1000);
      }
    });

    test('1.5% monthly flat rate with 12 months tenure: Retail 20,000, DP 5,000', () => {
      // Financed = 15,000
      // Monthly Interest = 15,000 * 1.5% = 225
      // Total Interest = 225 * 12 = 2700
      // Total Payable = 15000 + 2700 = 17700
      // Monthly EMI = 17700 / 12 = 1475
      const result = generateAmortizationSchedule({
        principalAmount: 20000,
        downPayment: 5000,
        annualInterestRate: 1.5,
        monthlyInterestRate: 1.5,
        tenureMonths: 12,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });

      expect(result.netDisbursedAmount).toBe(15000);
      expect(result.totalInterest).toBe(2700);
      expect(result.totalPayable).toBe(17700);
      expect(result.emiAmount).toBe(1475);
    });

    test('Zero down payment: Retail 12,000, DP 0, 1% rate, 6m', () => {
      // Financed = 12000
      // Monthly Interest = 12000 * 1% = 120
      // Total Interest = 120 * 6 = 720
      // Total Payable = 12720
      // Monthly EMI = 2120
      const result = generateAmortizationSchedule({
        principalAmount: 12000,
        downPayment: 0,
        annualInterestRate: 1,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });

      expect(result.netDisbursedAmount).toBe(12000);
      expect(result.totalInterest).toBe(720);
      expect(result.totalPayable).toBe(12720);
      expect(result.emiAmount).toBe(2120);
    });
  });

  // ============================================================
  // PART 4: DEALER LOAN ORIGINATION APPROVAL QUEUE
  // ============================================================
  describe('Dealer Loan Approval Workflow & State Machine Enforcement', () => {
    let pendingLoanId: string;
    let loanToRejectId: string;

    test('Dealer originates loan -> backend forces status PENDING_APPROVAL', async () => {
      const origRes = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          customerId,
          principalAmount: 10000,
          downPayment: 4000,
          annualInterestRate: 1,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-06',
        });

      expect(origRes.status).toBe(201);
      expect(origRes.body.data.status).toBe(LoanStatus.PENDING_APPROVAL);
      expect(origRes.body.data.dealerId).toBe(dealerId);
      expect(origRes.body.data.netDisbursedAmount).toBe(6000);
      expect(origRes.body.data.totalInterest).toBe(360);
      expect(origRes.body.data.totalPayable).toBe(6360);
      expect(origRes.body.data.emiAmount).toBe(1060);

      pendingLoanId = origRes.body.data.id;
    });

    test('Dealer CANNOT approve own loan -> 403 Forbidden', async () => {
      const approveRes = await request(app)
        .post(`/api/v1/loans/${pendingLoanId}/approve`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({ notes: 'Self approval attempt' });

      expect(approveRes.status).toBe(403);
    });

    test('Direct disbursement of PENDING_APPROVAL loan is strictly blocked', async () => {
      const disbRes = await request(app)
        .post(`/api/v1/loans/${pendingLoanId}/disburse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(disbRes.status).toBe(400);
      const errMsg = disbRes.body.error?.message || disbRes.body.message || JSON.stringify(disbRes.body);
      expect(errMsg).toMatch(/pending.*approval/i);
    });

    test('Super Admin sees dealer loan in pending approval queue', async () => {
      const queueRes = await request(app)
        .get('/api/v1/loans/pending-approvals')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(queueRes.status).toBe(200);
      expect(Array.isArray(queueRes.body.data)).toBe(true);

      const found = queueRes.body.data.find((l: any) => l.id === pendingLoanId);
      expect(found).toBeDefined();
      expect(found.dealerId).toBe(dealerId);
      expect(found.customerName).toContain('Borrower');
      expect(found.netDisbursedAmount).toBe(6000);
      expect(found.emiAmount).toBe(1060);
    });

    test('Super Admin approves loan -> status becomes APPROVED and installments generated', async () => {
      const approveRes = await request(app)
        .post(`/api/v1/loans/${pendingLoanId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Verified KYC and credit score. Approved.' });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe(LoanStatus.APPROVED);

      // Verify in DB that installments exist
      const instCheck = await queryPostgres('SELECT COUNT(*) as count FROM emi_installments WHERE loan_id = $1', [pendingLoanId]);
      expect(parseInt(instCheck.rows[0].count, 10)).toBe(6);

      // Verify that approved loan no longer appears in pending approvals queue
      const queueRes = await request(app)
        .get('/api/v1/loans/pending-approvals')
        .set('Authorization', `Bearer ${adminToken}`);
      const found = queueRes.body.data.find((l: any) => l.id === pendingLoanId);
      expect(found).toBeUndefined();
    });

    test('Dealer originates second loan, Super Admin rejects with mandatory reason', async () => {
      // 1. Dealer originates second loan
      const origRes = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          customerId,
          principalAmount: 15000,
          downPayment: 3000,
          annualInterestRate: 1.5,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-06',
        });
      expect(origRes.status).toBe(201);
      loanToRejectId = origRes.body.data.id;

      // 2. Dealer cannot reject loans
      const dealerRejectRes = await request(app)
        .post(`/api/v1/loans/${loanToRejectId}/reject`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({ reason: 'Dealer attempt' });
      expect(dealerRejectRes.status).toBe(403);

      // 3. Super Admin rejects with reason
      const reasonText = 'KYC address proof mismatch and insufficient customer documentation.';
      const rejectRes = await request(app)
        .post(`/api/v1/loans/${loanToRejectId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: reasonText });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe(LoanStatus.REJECTED);
      expect(rejectRes.body.data.reason).toBe(reasonText);

      // 4. Verify in DB
      const loanRow = await queryPostgres('SELECT status, rejection_reason FROM loans WHERE id = $1', [loanToRejectId]);
      expect(loanRow.rows[0].status).toBe(LoanStatus.REJECTED);
      expect(loanRow.rows[0].rejection_reason).toBe(reasonText);
    });
  });

  // ============================================================
  // PART 6: DEALER-WISE FINANCING ANALYTICS
  // ============================================================
  describe('Dealer-Wise Financing Analytics API & Aggregation', () => {
    test('Super Admin accesses dealer-financing-analytics endpoint and receives correct calculations', async () => {
      const res = await request(app)
        .get('/api/v1/reports/dealer-financing-analytics')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ preset: 'all', dealerId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const { summary, dealers } = res.body.data;
      expect(dealers.length).toBe(1);
      const target = dealers[0];

      expect(target.dealerId).toBe(dealerId);
      // Total Financed Principal = Retail Price - Down Payment
      // Loan 1: 10000 - 4000 = 6000; Loan 2: 15000 - 3000 = 12000 => Total = 18000
      expect(target.totalFinancedPrincipal).toBe(18000);
      expect(target.totalDownPayment).toBe(7000);
      expect(target.totalLoans).toBe(2);
      expect(target.totalPhonesFinanced).toBe(2);
      expect(target.rejectedLoans).toBe(1);

      expect(summary.totalFinancedPrincipal).toBe(18000);
      expect(summary.totalDownPayment).toBe(7000);
    });

    test('Dealer accesses dealer-financing-analytics and is automatically scoped to own store (RLAC)', async () => {
      const res = await request(app)
        .get('/api/v1/reports/dealer-financing-analytics')
        .set('Authorization', `Bearer ${dealerToken}`)
        .query({ preset: 'all' });

      expect(res.status).toBe(200);
      expect(res.body.data.dealers.length).toBe(1);
      expect(res.body.data.dealers[0].dealerId).toBe(dealerId);
    });

    test('Collection Agent cannot access dealer-financing-analytics -> 403 Forbidden', async () => {
      // 1. Provision an active agent
      const agentPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
      const agentLoginId = `AGT_ANL_${runId}`;
      const provRes = await request(app)
        .post('/api/v1/users/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Agent Analytics Check',
          phone: agentPhone,
          loginId: agentLoginId,
          status: 'ACTIVE',
        });
      expect(provRes.status).toBe(201);
      const { temporaryPassword } = provRes.body.data;

      // 2. Login as agent
      const agentLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: agentLoginId, password: temporaryPassword });
      expect(agentLoginRes.status).toBe(200);
      const agentToken = agentLoginRes.body.data.tokens.accessToken;

      // 3. Agent cannot access dealer-financing-analytics -> 403 Forbidden
      const forbiddenRes = await request(app)
        .get('/api/v1/reports/dealer-financing-analytics')
        .set('Authorization', `Bearer ${agentToken}`);

      expect(forbiddenRes.status).toBe(403);

      // 4. Dealer cannot query other dealer's UUID
      const dealerOtherRes = await request(app)
        .get('/api/v1/reports/dealer-financing-analytics')
        .set('Authorization', `Bearer ${dealerToken}`)
        .query({ dealerId: '00000000-0000-0000-0000-000000000000' });

      expect(dealerOtherRes.status).toBe(200);
      expect(dealerOtherRes.body.data.dealers.length).toBe(0);
    });
  });
});
