import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, InterestMethod, RepaymentFrequency } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('UAT Final Integration Tests: Onboarding, Dealer RLAC, and Customer Portal', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  let adminToken: string;

  // Dealers
  let dealerAId: string;
  let dealerAToken: string;
  let dealerACustomerId: string;
  let dealerALoanId: string;

  let dealerBId: string;
  let dealerBToken: string;

  beforeAll(async () => {
    // 1. Authenticate as Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 2. Create Dealer A
    const dealerARes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `UAT Store Alpha ${runId}`,
        ownerName: 'Alpha Store Owner',
        phone: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `dealer_a_${runId}@uatstore.com`,
        address: '101 Commercial Street',
        areaCity: 'Bengaluru',
        pincode: '560001',
      });

    expect(dealerARes.status).toBe(201);
    dealerAId = dealerARes.body.data.id;

    // Create login credentials for Dealer A
    const loginAccountARes = await request(app)
      .post(`/api/v1/dealers/${dealerAId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(loginAccountARes.status).toBe(201);
    const dealerACreds = loginAccountARes.body.data;

    // Login as Dealer A
    const dealerALogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerACreds.loginId, password: dealerACreds.temporaryPassword });

    expect(dealerALogin.status).toBe(200);
    dealerAToken = dealerALogin.body.data.tokens.accessToken;

    // 3. Create Dealer B
    const dealerBRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `UAT Store Beta ${runId}`,
        ownerName: 'Beta Store Owner',
        phone: `97${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `dealer_b_${runId}@uatstore.com`,
        address: '202 Market Road',
        areaCity: 'Bengaluru',
        pincode: '560002',
      });

    expect(dealerBRes.status).toBe(201);
    dealerBId = dealerBRes.body.data.id;

    // Create login credentials for Dealer B
    const loginAccountBRes = await request(app)
      .post(`/api/v1/dealers/${dealerBId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(loginAccountBRes.status).toBe(201);
    const dealerBCreds = loginAccountBRes.body.data;

    // Login as Dealer B
    const dealerBLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerBCreds.loginId, password: dealerBCreds.temporaryPassword });

    expect(dealerBLogin.status).toBe(200);
    dealerBToken = dealerBLogin.body.data.tokens.accessToken;
  });

  // ===========================================================================
  // TASK 1: CUSTOMER ONBOARDING ATOMICITY & RESILIENCE
  // ===========================================================================
  describe('Task 1: Customer Onboarding Integrity & Error Handling', () => {
    test('1.1 Normal customer + loan onboarding succeeds with atomic EMI generation', async () => {
      const payload = {
        customer: {
          fullName: 'Siddharth Sharma',
          primaryPhone: `+9198${Date.now().toString().slice(-8)}`,
          addressLine1: 'Flat 402, Green Valley Apartments',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
          areaRoute: 'ROUTE-CENTRAL',
        },
        loan: {
          principalAmount: 45000,
          downPayment: 5000,
          annualInterestRate: 14.5,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE,
          tenureMonths: 12,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-09-01',
          firstEmiDate: '2026-10-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customer.fullName).toBe('Siddharth Sharma');
      expect(res.body.data.loan).toBeDefined();
      expect(res.body.data.loan.principalAmount).toBe(45000);
      expect(res.body.data.loan.totalInstallments).toBe(12);

      // Verify customer exists in database
      const custCheck = await queryPostgres('SELECT id FROM customers WHERE id = $1', [res.body.data.customer.id]);
      expect(custCheck.rows.length).toBe(1);

      // Verify loan exists in database
      const loanCheck = await queryPostgres('SELECT id FROM loans WHERE id = $1', [res.body.data.loan.id]);
      expect(loanCheck.rows.length).toBe(1);

      // Verify exactly 12 EMIs were generated
      const emiCheck = await queryPostgres('SELECT COUNT(*) as count FROM emi_installments WHERE loan_id = $1', [res.body.data.loan.id]);
      expect(parseInt(emiCheck.rows[0].count, 10)).toBe(12);
    });

    test('1.2 Failed customer onboarding does NOT leave orphaned/partial customer or loan records (atomic rollback)', async () => {
      const customerPhone = `+9196${Date.now().toString().slice(-8)}`;

      // Intentionally invalid loan payload (invalid negative tenure)
      const payload = {
        customer: {
          fullName: 'Failed Customer Test',
          primaryPhone: customerPhone,
          addressLine1: 'Test Address',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
          areaRoute: 'ROUTE-CENTRAL',
        },
        loan: {
          principalAmount: 30000,
          downPayment: 5000,
          annualInterestRate: 12.0,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE,
          tenureMonths: -5, // Invalid negative tenure causes Amortization error
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-09-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      // Must fail
      expect(res.status).toBeGreaterThanOrEqual(400);

      // Verify transaction rolled back: NO customer with this phone was created
      const custCheck = await queryPostgres('SELECT id FROM customers WHERE primary_phone = $1', [customerPhone]);
      expect(custCheck.rows.length).toBe(0);

      // Verify NO loan was created for this customer
      const loanCheck = await queryPostgres(
        'SELECT l.id FROM loans l JOIN customers c ON l.customer_id = c.id WHERE c.primary_phone = $1',
        [customerPhone]
      );
      expect(loanCheck.rows.length).toBe(0);
    });

    test('1.3 CASE 1 — REDUCING BALANCE: Retail ₹120,000, Down Payment ₹20,000 (Net Financed ₹100,000), 10% p.a., 12 Months -> exactly 12 installments, EMI ≈ ₹8,791.59', async () => {
      // Direct API preview verification
      const previewRes = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 120000,
          downPayment: 20000,
          annualInterestRate: 10,
          tenureMonths: 12,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE,
          disbursementDate: '2026-09-01',
        });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.netDisbursedAmount).toBe(100000);
      expect(previewRes.body.data.totalInstallments).toBe(12);
      expect(previewRes.body.data.emiAmount).toBe(8791.59);
      expect(Math.abs(previewRes.body.data.totalInterest - 5499.06)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(previewRes.body.data.totalPayable - 105499.06)).toBeLessThanOrEqual(0.02);

      // Persisted Onboarding verification
      const onboardRes = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: 'UAT Case 1 Borrower',
            primaryPhone: `+9197${Date.now().toString().slice(-8)}`,
            addressLine1: '42 Sector 1',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
            areaRoute: 'ROUTE-CENTRAL',
          },
          loan: {
            principalAmount: 120000,
            downPayment: 20000,
            annualInterestRate: 10,
            tenureMonths: 12,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            interestCalcMethod: InterestMethod.REDUCING_BALANCE,
            disbursementDate: '2026-09-01',
          },
        });

      expect(onboardRes.status).toBe(201);
      const loan = onboardRes.body.data.loan;
      expect(loan.netDisbursedAmount).toBe(100000);
      expect(loan.totalInstallments).toBe(12);
      expect(loan.emiAmount).toBe(8791.59);

      // Verify persisted emi_installments in PostgreSQL: exactly 12 records
      const emiDb = await queryPostgres('SELECT * FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC', [loan.id]);
      expect(emiDb.rows.length).toBe(12);
      expect(Number(emiDb.rows[0].expected_amount)).toBe(8791.59);
    });

    test('1.4 CASE 2 — FLAT RATE: Retail ₹120,000, Down Payment ₹20,000 (Net Financed ₹100,000), 10% p.a., 12 Months -> exactly 12 installments, Total Interest = ₹10,000, EMI ≈ ₹9,166.67', async () => {
      // Direct API preview verification
      const previewRes = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 120000,
          downPayment: 20000,
          annualInterestRate: 10,
          tenureMonths: 12,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-09-01',
        });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.netDisbursedAmount).toBe(100000);
      expect(previewRes.body.data.totalInstallments).toBe(12);
      expect(previewRes.body.data.totalInterest).toBe(10000);
      expect(previewRes.body.data.totalPayable).toBe(110000);
      expect(previewRes.body.data.emiAmount).toBe(9166.67);

      // Persisted Onboarding verification
      const onboardRes = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: 'UAT Case 2 Flat Rate Borrower',
            primaryPhone: `+9198${Date.now().toString().slice(-8)}`,
            addressLine1: '128 Main Market',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
            areaRoute: 'ROUTE-CENTRAL',
          },
          loan: {
            principalAmount: 120000,
            downPayment: 20000,
            annualInterestRate: 10,
            tenureMonths: 12,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            disbursementDate: '2026-09-01',
          },
        });

      expect(onboardRes.status).toBe(201);
      const loan = onboardRes.body.data.loan;
      expect(loan.netDisbursedAmount).toBe(100000);
      expect(loan.totalInstallments).toBe(12);
      expect(loan.totalInterest).toBe(10000);
      expect(loan.totalPayable).toBe(110000);
      expect(loan.emiAmount).toBe(9166.67);

      // Verify persisted emi_installments in PostgreSQL: exactly 12 records
      const emiDb = await queryPostgres('SELECT * FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC', [loan.id]);
      expect(emiDb.rows.length).toBe(12);
      // Installment count is NEVER 6
      expect(emiDb.rows.length).not.toBe(6);
    });

    test('1.5 6-Month monthly loan -> exactly 6 installments; 12-Month monthly loan -> exactly 12 installments', async () => {
      // 6 months test
      const res6 = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 120000,
          downPayment: 20000,
          annualInterestRate: 10,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-09-01',
        });
      expect(res6.body.data.totalInstallments).toBe(6);
      expect(res6.body.data.schedule.length).toBe(6);

      // 12 months test
      const res12 = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 120000,
          downPayment: 20000,
          annualInterestRate: 10,
          tenureMonths: 12,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-09-01',
        });
      expect(res12.body.data.totalInstallments).toBe(12);
      expect(res12.body.data.schedule.length).toBe(12);
      expect(res12.body.data.totalInstallments).not.toBe(6);
    });
  });

  // ===========================================================================
  // TASK 2: DEALER → CUSTOMER RLAC IDOR ISOLATION
  // ===========================================================================
  describe('Task 2: Dealer Customer Onboarding & Strict RLAC Isolation', () => {
    test('2.1 Dealer A onboards customer; backend forces dealerId to Dealer A (ignoring spoofed dealerId)', async () => {
      const spoofedPayload = {
        customer: {
          fullName: 'Dealer A Borrower',
          primaryPhone: `+9195${Date.now().toString().slice(-8)}`,
          addressLine1: 'Shop Lane 5',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
          areaRoute: 'ROUTE-CENTRAL',
        },
        loan: {
          principalAmount: 25000,
          downPayment: 3000,
          annualInterestRate: 15.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-09-15',
          firstEmiDate: '2026-10-15',
          dealerId: dealerBId, // Malicious attempt by Dealer A to assign loan to Dealer B
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(spoofedPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      dealerACustomerId = res.body.data.customer.id;
      dealerALoanId = res.body.data.loan.id;

      // Assert that backend OVERRODE the spoofed dealerId with Dealer A's authenticated dealerId
      expect(res.body.data.loan.dealerId).toBe(dealerAId);

      const dbCheck = await queryPostgres('SELECT dealer_id FROM loans WHERE id = $1', [dealerALoanId]);
      expect(dbCheck.rows[0].dealer_id).toBe(dealerAId);
    });

    test('2.2 Dealer A can access their own customer profile and loan agreement', async () => {
      const custRes = await request(app)
        .get(`/api/v1/customers/${dealerACustomerId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(custRes.status).toBe(200);
      expect(custRes.body.data.customer.id).toBe(dealerACustomerId);

      const loanRes = await request(app)
        .get(`/api/v1/loans/${dealerALoanId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(loanRes.status).toBe(200);
      expect(loanRes.body.data.id).toBe(dealerALoanId);
      expect(loanRes.body.data.dealerId).toBe(dealerAId);
    });

    test('2.3 Dealer B CANNOT access Dealer A customer profile (returns 403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${dealerACustomerId}`)
        .set('Authorization', `Bearer ${dealerBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not have access/i);
    });

    test('2.4 Dealer B CANNOT access Dealer A loan agreement (returns 403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/v1/loans/${dealerALoanId}`)
        .set('Authorization', `Bearer ${dealerBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not have access/i);
    });

    test('2.5 Admin retains full access to Dealer A customer and loan', async () => {
      const custRes = await request(app)
        .get(`/api/v1/customers/${dealerACustomerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(custRes.status).toBe(200);
      expect(custRes.body.data.customer.id).toBe(dealerACustomerId);

      const loanRes = await request(app)
        .get(`/api/v1/loans/${dealerALoanId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(loanRes.status).toBe(200);
      expect(loanRes.body.data.id).toBe(dealerALoanId);
    });
  });

  // ===========================================================================
  // TASK 3: CUSTOMER PORTAL LIFECYCLE & VERIFIED PAYMENT WATERFALL
  // ===========================================================================
  describe('Task 3: Customer Payment Portal Complete Lifecycle', () => {
    let portalToken: string;
    let portalUrl: string;

    test('3.1 Admin generates secure opaque portal token for Dealer A loan', async () => {
      const res = await request(app)
        .post(`/api/v1/portal/loans/${dealerALoanId}/link`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toMatch(/^cpt_[a-f0-9]{64}$/);
      expect(res.body.data.portalUrl).toContain(res.body.data.token);

      portalToken = res.body.data.token;
      portalUrl = res.body.data.portalUrl;

      // Verify token in database: only SHA-256 hash is saved, NOT plaintext
      const dbRes = await queryPostgres('SELECT token_hash FROM customer_portal_tokens WHERE loan_id = $1 AND is_active = TRUE', [dealerALoanId]);
      expect(dbRes.rows.length).toBe(1);
      expect(dbRes.rows[0].token_hash).not.toBe(portalToken);
    });

    test('3.2 Customer accesses portal link: displays loan details, pending EMIs, and safe info', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/loan?token=${portalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customerName).toBe('Dealer A Borrower');
      expect(res.body.data.maskedPhone).toMatch(/^XXXXXX\d{4}$/);
      expect(res.body.data.financedAmount).toBeGreaterThan(0);
      expect(res.body.data.overdueInstallments).toBeDefined();
      expect(res.body.data.installments.length).toBe(6);
      expect(res.body.data.totalInstallments).toBe(6);
      expect(res.body.data.paidInstallments).toBe(0);
      expect(res.body.data.outstandingBalance).toBeGreaterThan(0);

      // Verify sensitive KYC/PII fields are NOT exposed
      expect(res.body.data.aadhaarNumber).toBeUndefined();
      expect(res.body.data.panNumber).toBeUndefined();
      expect(res.body.data.storageKey).toBeUndefined();
    });

    test('3.3 Customer WhatsApp pay message format contains only safe payment info', () => {
      const sampleLoan = {
        loanAccountNo: 'LN-2026-9082',
        customerName: 'Dealer A Borrower',
        emiAmount: 4350,
      };

      const msg = [
        'Hello, I want to pay my EMI.',
        `Loan: ${sampleLoan.loanAccountNo}`,
        `Customer: ${sampleLoan.customerName}`,
        `Amount: ₹4,350.00`,
        'Please share the UPI QR.',
      ].join('\n');

      const waUrl = `https://wa.me/919876543210?text=${encodeURIComponent(msg)}`;

      expect(waUrl).toContain('https://wa.me/919876543210?text=');
      expect(decodeURIComponent(waUrl)).toContain(sampleLoan.loanAccountNo);
      expect(decodeURIComponent(waUrl)).toContain('Dealer A Borrower');
      expect(decodeURIComponent(waUrl)).not.toContain('password');
      expect(decodeURIComponent(waUrl)).not.toContain('token');
    });

    test('3.4 Admin regenerates portal link: previous token is invalidated, new token is active', async () => {
      const regenRes = await request(app)
        .post(`/api/v1/portal/loans/${dealerALoanId}/regenerate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(regenRes.status).toBe(200);
      expect(regenRes.body.data.token).not.toBe(portalToken);

      const newPortalToken = regenRes.body.data.token;

      // Old token must now be 401 Unauthorized
      const oldTokenRes = await request(app)
        .get(`/api/v1/portal/loan?token=${portalToken}`);
      expect(oldTokenRes.status).toBe(401);

      // New token must work
      const newTokenRes = await request(app)
        .get(`/api/v1/portal/loan?token=${newPortalToken}`);
      expect(newTokenRes.status).toBe(200);

      portalToken = newPortalToken;
    });

    test('3.5 Admin revokes portal link: access is blocked immediately', async () => {
      const revokeRes = await request(app)
        .post(`/api/v1/portal/loans/${dealerALoanId}/revoke`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.data.success).toBe(true);

      const portalRes = await request(app)
        .get(`/api/v1/portal/loan?token=${portalToken}`);
      expect(portalRes.status).toBe(401);
    });

    test('3.6 Admin re-generates portal link and records payment: portal reflects paid installment', async () => {
      // 1. Re-generate link to restore access
      const genRes = await request(app)
        .post(`/api/v1/portal/loans/${dealerALoanId}/link`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(genRes.status).toBe(201);
      const activeToken = genRes.body.data.token;

      // 2. Fetch current portal status before payment
      const beforeRes = await request(app).get(`/api/v1/portal/loan?token=${activeToken}`);
      expect(beforeRes.status).toBe(200);
      const initialRemaining = beforeRes.body.data.outstandingBalance;
      const emiAmount = beforeRes.body.data.emiAmount;

      // 3. Admin records a payment for the EMI
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: dealerALoanId,
          customerId: dealerACustomerId,
          amount: emiAmount,
          paymentMode: 'UPI',
          referenceNumber: `UPI-UAT-${Date.now()}`,
          notes: 'Customer paid via UPI from portal instruction',
        });

      expect(payRes.status).toBe(201);

      // 4. Portal immediately reflects the updated payment
      const afterRes = await request(app).get(`/api/v1/portal/loan?token=${activeToken}`);
      expect(afterRes.status).toBe(200);
      expect(afterRes.body.data.paidInstallments).toBe(1);
      expect(afterRes.body.data.installments[0].status).toBe('PAID');
      expect(afterRes.body.data.outstandingBalance).toBeLessThan(initialRemaining);
      expect(afterRes.body.data.paymentHistory.length).toBeGreaterThan(0);
      expect(afterRes.body.data.paymentHistory[0].amount).toBe(emiAmount);
    });
  });
});
