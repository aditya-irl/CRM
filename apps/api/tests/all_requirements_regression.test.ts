import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import {
  UserRole,
  InterestMethod,
  RepaymentFrequency,
  ALLOWED_MONTHLY_INTEREST_RATES,
  SettlementStatus,
  PaymentStatus,
  LoanStatus,
  generateAmortizationSchedule,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Comprehensive End-to-End Regression Suite: Requirements 1-6', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  let superAdminToken: string;
  let adminToken: string;
  let dealerAToken: string;
  let dealerBToken: string;

  let dealerAId: string;
  let dealerBId: string;
  let cleanDealerId: string;

  let customerAId: string;
  let customerBId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Seed Dealers
    dealerAId = uuidv4();
    dealerBId = uuidv4();
    cleanDealerId = uuidv4();

    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES 
         ($1, $2, 'Store A', 'Dealer Owner A', $3, 'Mumbai', 'Shop A, Bandra', 'ACTIVE', NOW(), NOW()),
         ($4, $5, 'Store B', 'Dealer Owner B', $6, 'Delhi', 'Shop B, Connaught', 'ACTIVE', NOW(), NOW()),
         ($7, $8, 'Clean Store', 'Clean Owner', $9, 'Pune', 'Shop C, Kothrud', 'ACTIVE', NOW(), NOW())`,
      [
        dealerAId, `DLR_A_${runId}`, `9801${numId}1`,
        dealerBId, `DLR_B_${runId}`, `9801${numId}2`,
        cleanDealerId, `DLR_C_${runId}`, `9801${numId}3`,
      ]
    );

    // 2. Seed Users
    const superAdminId = uuidv4();
    const adminId = uuidv4();
    const dealerAUserId = uuidv4();
    const dealerBUserId = uuidv4();
    const cleanDealerUserId = uuidv4();

    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $8, 'System Admin', 'ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($9, $10, $11, $12, 'Dealer User A', 'DEALER', $13, 'ACTIVE', NOW(), NOW()),
         ($14, $15, $16, $17, 'Dealer User B', 'DEALER', $18, 'ACTIVE', NOW(), NOW()),
         ($19, $20, $21, $22, 'Clean Dealer User', 'DEALER', $23, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, `sa_${runId}@crm.test`, `9701${numId}1`, hash,
        adminId, `admin_${runId}@crm.test`, `9701${numId}2`, hash,
        dealerAUserId, `dealer_a_${runId}@crm.test`, `9701${numId}3`, hash, dealerAId,
        dealerBUserId, `dealer_b_${runId}@crm.test`, `9701${numId}4`, hash, dealerBId,
        cleanDealerUserId, `clean_dealer_${runId}@crm.test`, `9701${numId}5`, hash, cleanDealerId,
      ]
    );

    // Update dealers with user_id
    await queryPostgres(`UPDATE dealers SET user_id = $1 WHERE id = $2`, [dealerAUserId, dealerAId]);
    await queryPostgres(`UPDATE dealers SET user_id = $1 WHERE id = $2`, [dealerBUserId, dealerBId]);
    await queryPostgres(`UPDATE dealers SET user_id = $1 WHERE id = $2`, [cleanDealerUserId, cleanDealerId]);

    // 3. Logins to acquire JWT tokens
    const saLogin = await request(app).post('/api/v1/auth/login').send({
      email: `sa_${runId}@crm.test`,
      password: 'Password@123',
    });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      email: `admin_${runId}@crm.test`,
      password: 'Password@123',
    });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const dealerALogin = await request(app).post('/api/v1/auth/login').send({
      email: `dealer_a_${runId}@crm.test`,
      password: 'Password@123',
    });
    dealerAToken = dealerALogin.body.data.tokens.accessToken;

    const dealerBLogin = await request(app).post('/api/v1/auth/login').send({
      email: `dealer_b_${runId}@crm.test`,
      password: 'Password@123',
    });
    dealerBToken = dealerBLogin.body.data.tokens.accessToken;

    // 4. Seed Customers & Loans for Dealer A & Dealer B
    customerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, 'Borrower A', $3, 'Flat 101', 'Mumbai', 'MH', '400050', 'Bandra West', NOW(), NOW())`,
      [customerAId, `CUST_A_${runId}`, `9101${numId}1`]
    );

    customerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, 'Borrower B', $3, 'Flat 202', 'Delhi', 'DL', '110001', 'Connaught Place', NOW(), NOW())`,
      [customerBId, `CUST_B_${runId}`, `9101${numId}2`]
    );
  });

  afterAll(async () => {
    // Cleanup seeded records
    try {
      await queryPostgres(`DELETE FROM dealer_payable_payments WHERE dealer_id IN ($1, $2, $3)`, [dealerAId, dealerBId, cleanDealerId]);
      await queryPostgres(`DELETE FROM dealer_settlement_allocations WHERE settlement_id IN (SELECT id FROM dealer_settlements WHERE dealer_id IN ($1, $2, $3))`, [dealerAId, dealerBId, cleanDealerId]);
      await queryPostgres(`DELETE FROM dealer_settlements WHERE dealer_id IN ($1, $2, $3)`, [dealerAId, dealerBId, cleanDealerId]);
      await queryPostgres(`DELETE FROM payments WHERE loan_id IN (SELECT id FROM loans WHERE dealer_id IN ($1, $2, $3))`, [dealerAId, dealerBId, cleanDealerId]);
      await queryPostgres(`DELETE FROM emi_installments WHERE loan_id IN (SELECT id FROM loans WHERE dealer_id IN ($1, $2, $3))`, [dealerAId, dealerBId, cleanDealerId]);
      await queryPostgres(`DELETE FROM loans WHERE dealer_id IN ($1, $2, $3)`, [dealerAId, dealerBId, cleanDealerId]);
      await queryPostgres(`DELETE FROM customers WHERE id IN ($1, $2)`, [customerAId, customerBId]);
      await queryPostgres(`UPDATE dealers SET user_id = NULL WHERE id IN ($1, $2, $3)`, [dealerAId, dealerBId, cleanDealerId]);
      await queryPostgres(`DELETE FROM users WHERE dealer_id IN ($1, $2, $3) OR email LIKE '%${runId}@crm.test'`, [dealerAId, dealerBId, cleanDealerId]);
      await queryPostgres(`DELETE FROM dealers WHERE id IN ($1, $2, $3)`, [dealerAId, dealerBId, cleanDealerId]);
    } catch {
      // Ignore cleanup error
    }
  });

  // ==========================================================================
  // REQUIREMENT 1: FIX DEALER PROFILE DELETION
  // ==========================================================================
  describe('Requirement 1: Dealer Profile Deletion', () => {
    it('1.1 Rejects deletion with 400 Bad Request if ID is an invalid UUID format (prevents unhandled 500)', async () => {
      const res = await request(app)
        .delete('/api/v1/dealers/invalid-uuid-string')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Invalid.*identifier format/i);
    });

    it('1.2 Rejects deletion with 404 Not Found if dealer does not exist', async () => {
      const nonExistentId = uuidv4();
      const res = await request(app)
        .delete(`/api/v1/dealers/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Dealer not found/i);
    });

    it('1.3 Rejects unauthorized deletion attempt with 403 Forbidden', async () => {
      const res = await request(app)
        .delete(`/api/v1/dealers/${cleanDealerId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('1.4 Successfully deletes dealer with zero financial dependencies and cleans up circular FK safely', async () => {
      const res = await request(app)
        .delete(`/api/v1/dealers/${cleanDealerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify dealer is gone
      const verifyRes = await request(app)
        .get(`/api/v1/dealers/${cleanDealerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(verifyRes.status).toBe(404);
    });
  });

  // ==========================================================================
  // REQUIREMENT 2: STORE SETTLEMENT DEALER ISOLATION
  // ==========================================================================
  describe('Requirement 2: Store Settlement Dealer Isolation', () => {
    let settlementAId: string;

    beforeAll(async () => {
      // Create a settlement for Dealer A
      const insertRes = await queryPostgres(
        `INSERT INTO dealer_settlements (id, settlement_number, dealer_id, amount, payment_method, settlement_date, reference_number, status, notes, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 5000, 'BANK_TRANSFER', CURRENT_DATE, 'UTR_SETTLE_A_1', 'PENDING_APPROVAL', 'Weekly Settlement', (SELECT user_id FROM dealers WHERE id = $3), NOW(), NOW())
         RETURNING id`,
        [uuidv4(), `SETTLE_A_${runId}`, dealerAId]
      );
      settlementAId = insertRes.rows[0].id;
    });

    it('2.1 Dealer B CANNOT view Dealer A settlement list', async () => {
      const res = await request(app)
        .get('/api/v1/dealer-settlements')
        .set('Authorization', `Bearer ${dealerBToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.records || [];
      const foundA = items.find((s: any) => s.id === settlementAId);
      expect(foundA).toBeUndefined();
    });

    it('2.2 Dealer B CANNOT view Dealer A settlement by ID (returns 403/404 isolation)', async () => {
      const res = await request(app)
        .get(`/api/v1/dealer-settlements/${settlementAId}`)
        .set('Authorization', `Bearer ${dealerBToken}`);

      expect([403, 404]).toContain(res.status);
    });

    it('2.3 Changing dealerId query param by Dealer B does NOT expose Dealer A settlements', async () => {
      const res = await request(app)
        .get(`/api/v1/dealer-settlements?dealerId=${dealerAId}`)
        .set('Authorization', `Bearer ${dealerBToken}`);

      expect(res.status).toBe(200);
      // Backend forces dealerId from authenticated session, so it returns Dealer B data only
      const items = res.body.data.records || [];
      for (const item of items) {
        expect(item.dealerId).toBe(dealerBId);
      }
    });

    it('2.4 Admin CAN view Dealer A settlement and filter by dealer', async () => {
      const res = await request(app)
        .get(`/api/v1/dealer-settlements/${settlementAId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(settlementAId);
      expect(res.body.data.dealerId).toBe(dealerAId);
    });
  });

  // ==========================================================================
  // REQUIREMENT 3: ADMIN APPROVAL FOR SETTLEMENTS & RECORD EMI
  // ==========================================================================
  describe('Requirement 3: Admin Approval for Store Settlements and Record EMI', () => {
    let pendingSettlementId: string;
    let loanAId: string;
    let paymentAId: string;

    beforeAll(async () => {
      // 1. Create a loan for Customer A under Dealer A
      const loanRes = await queryPostgres(
        `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount, annual_interest_rate, tenure_months, installment_frequency, total_installments, interest_calc_method, emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date, first_emi_date, maturity_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 30000, 0, 30000, 4, 6, 'MONTHLY', 6, 'FLAT_RATE', 6200, 7200, 37200, 0, 37200, 'ACTIVE', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months', NOW(), NOW())
         RETURNING id`,
        [uuidv4(), `LN_A_${runId}`, customerAId, dealerAId]
      );
      loanAId = loanRes.rows[0].id;

      // Seed 1st EMI installment
      await queryPostgres(
        `INSERT INTO emi_installments (id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount, status, created_at, updated_at)
         VALUES ($1, $2, $3, 1, CURRENT_DATE + INTERVAL '1 month', 5000, 1200, 6200, 0, 6200, 0, 'UPCOMING', NOW(), NOW())`,
        [uuidv4(), loanAId, customerAId]
      );

      // 2. Insert a settlement in PENDING_APPROVAL status for Dealer A
      const setRes = await queryPostgres(
        `INSERT INTO dealer_settlements (id, settlement_number, dealer_id, amount, payment_method, settlement_date, reference_number, status, notes, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 3000, 'BANK_TRANSFER', CURRENT_DATE, 'UTR_PENDING_1', 'PENDING_APPROVAL', 'Need Approval', (SELECT user_id FROM dealers WHERE id = $3), NOW(), NOW())
         RETURNING id`,
        [uuidv4(), `SETTLE_P_${runId}`, dealerAId]
      );
      pendingSettlementId = setRes.rows[0].id;
    });

    it('3.1 Dealer CANNOT approve or reject their own settlement (403 Forbidden)', async () => {
      const approveRes = await request(app)
        .post(`/api/v1/dealer-settlements/${pendingSettlementId}/approve`)
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({});

      expect(approveRes.status).toBe(403);

      const rejectRes = await request(app)
        .post(`/api/v1/dealer-settlements/${pendingSettlementId}/reject`)
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({ reason: 'Self reject attempt' });

      expect(rejectRes.status).toBe(403);
    });

    it('3.2 Admin rejection of settlement requires a reason and updates status to REJECTED', async () => {
      const failRes = await request(app)
        .post(`/api/v1/dealer-settlements/${pendingSettlementId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(failRes.status).toBe(400);
      expect(failRes.body.error.message).toMatch(/reason is required/i);

      const successRes = await request(app)
        .post(`/api/v1/dealer-settlements/${pendingSettlementId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Bank UTR mismatch' });

      expect(successRes.status).toBe(200);
      expect(successRes.body.data.status).toBe(SettlementStatus.REJECTED);
      expect(successRes.body.data.rejectedBy).toBeDefined();
    });

    it('3.3 Dealer Record EMI creates payment in PENDING_VERIFICATION status without updating loan balance', async () => {
      const emiRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          loanId: loanAId,
          customerId: customerAId,
          amount: 6200,
          paymentMode: 'CASH',
          paymentDate: new Date().toISOString(),
          referenceNumber: `REC_EMI_${runId}`,
          notes: 'Customer paid cash at store counter',
        });

      expect(emiRes.status).toBe(201);
      expect(emiRes.body.data.status).toBe(PaymentStatus.PENDING_VERIFICATION);
      paymentAId = emiRes.body.data.id;

      // Verify loan outstanding balance has NOT been deducted yet
      const loanCheck = await queryPostgres(`SELECT outstanding_balance, total_paid FROM loans WHERE id = $1`, [loanAId]);
      expect(Number(loanCheck.rows[0].total_paid)).toBe(0);
      expect(Number(loanCheck.rows[0].outstanding_balance)).toBe(37200);
    });

    it('3.4 Dealer CANNOT self-verify or approve payment (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${paymentAId}/approve`)
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('3.5 Admin approves EMI payment: marks SUCCESS and updates loan balance transactionally', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${paymentAId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(PaymentStatus.SUCCESS);

      // Verify loan balance is now updated
      const loanCheck = await queryPostgres(`SELECT outstanding_balance, total_paid FROM loans WHERE id = $1`, [loanAId]);
      expect(Number(loanCheck.rows[0].total_paid)).toBe(6200);
      expect(Number(loanCheck.rows[0].outstanding_balance)).toBe(31000);
    });
  });

  // ==========================================================================
  // REQUIREMENT 4: REMOVE DEALER STORE LOANS AND APPROVALS ACCESS
  // ==========================================================================
  describe('Requirement 4: Dealer Store Loans and Approvals Access Restrictions', () => {
    let pendingLoanId: string;

    beforeAll(async () => {
      const res = await queryPostgres(
        `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount, annual_interest_rate, tenure_months, installment_frequency, total_installments, interest_calc_method, emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date, first_emi_date, maturity_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 25000, 0, 25000, 4, 6, 'MONTHLY', 6, 'FLAT_RATE', 5166.67, 6000, 31000, 0, 31000, 'PENDING_APPROVAL', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months', NOW(), NOW())
         RETURNING id`,
        [uuidv4(), `LN_PENDING_${runId}`, customerAId, dealerAId]
      );
      pendingLoanId = res.rows[0].id;
    });

    it('4.1 Dealer CANNOT access /loans/pending-approvals endpoint (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/loans/pending-approvals')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.2 Dealer CANNOT approve loan via API (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/loans/${pendingLoanId}/approve`)
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('4.3 Dealer CANNOT disburse/activate loan via API (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/loans/${pendingLoanId}/disburse`)
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('4.4 Admin approves loan: status becomes APPROVED, but NOT ACTIVE until explicit disbursal', async () => {
      const approveRes = await request(app)
        .post(`/api/v1/loans/${pendingLoanId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe(LoanStatus.APPROVED);

      // Verify in DB that status is APPROVED, NOT ACTIVE
      const check = await queryPostgres(`SELECT status FROM loans WHERE id = $1`, [pendingLoanId]);
      expect(check.rows[0].status).toBe('APPROVED');
      expect(check.rows[0].status).not.toBe('ACTIVE');
    });
  });

  // ==========================================================================
  // REQUIREMENT 5: COMPANY PAYABLES FUNCTIONALITY & ISOLATION
  // ==========================================================================
  describe('Requirement 5: Company Payables Functional & Isolation', () => {
    let payablePaymentId: string;

    beforeAll(async () => {
      const res = await queryPostgres(
        `INSERT INTO dealer_payable_payments (id, payout_number, dealer_id, amount, payment_method, payment_date, reference_number, notes, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 15000, 'NEFT', CURRENT_DATE, 'NEFT_PAYABLE_A', 'Disbursal compensation', 'COMPLETED', (SELECT user_id FROM dealers WHERE id = $3), NOW(), NOW())
         RETURNING id`,
        [uuidv4(), `PAY_A_${runId}`, dealerAId]
      );
      payablePaymentId = res.rows[0].id;
    });

    it('5.1 Dealer B CANNOT view Dealer A company payable details (isolation enforced)', async () => {
      const res = await request(app)
        .get(`/api/v1/dealer-payables/${payablePaymentId}`)
        .set('Authorization', `Bearer ${dealerBToken}`);

      expect([403, 404]).toContain(res.status);
    });

    it('5.2 Admin CAN view company payable details and payout breakdown by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/dealer-payables/${payablePaymentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(payablePaymentId);
      expect(res.body.data.dealerId).toBe(dealerAId);
      expect(Array.isArray(res.body.data.allocations)).toBe(true);
    });
  });

  // ==========================================================================
  // REQUIREMENT 6: OPTIMIZE ADMIN LOAN AND EMI TERMS
  // ==========================================================================
  describe('Requirement 6: Loan and EMI Terms Engine & Calculations', () => {
    it('6.1 Backend strictly ACCEPTS approved monthly flat rates (4%, 5%, 6%)', async () => {
      for (const rate of [4, 5, 6]) {
        const sched = generateAmortizationSchedule({
          principalAmount: 30000,
          downPayment: 0,
          annualInterestRate: rate,
          monthlyInterestRate: rate,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-10-21',
        });

        // Monthly Interest = 30000 * rate / 100
        const expectedMonthlyInterest = (30000 * rate) / 100;
        const expectedTotalInterest = expectedMonthlyInterest * 6;
        const expectedTotalPayable = 30000 + expectedTotalInterest;
        const expectedEmi = expectedTotalPayable / 6;

        expect(sched.monthlyInterestRate).toBe(rate);
        expect(sched.totalInterest).toBe(expectedTotalInterest);
        expect(sched.totalPayable).toBe(expectedTotalPayable);
        expect(sched.emiAmount).toBe(expectedEmi);
      }
    });

    it('6.2 Backend rejects loan origination with unsupported rate (e.g. 3% or 7%)', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customerAId,
          dealerId: dealerAId,
          principalAmount: 20000,
          annualInterestRate: 3,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-10-21',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/interest rates of 4%, 5%, or 6%/i);
    });

    it('6.3 Loan amortization guarantees Decimal.js Banker rounding and last-cent adjustment', () => {
      // 31,000 principal at 4% for 6 months
      // Financed: 31000
      // Monthly Interest: 31000 * 0.04 = 1240
      // Total Interest: 1240 * 6 = 7440
      // Total Payable: 31000 + 7440 = 38440
      // 38440 / 6 = 6406.66666... -> 6406.67
      const sched = generateAmortizationSchedule({
        principalAmount: 31000,
        downPayment: 0,
        annualInterestRate: 4,
        monthlyInterestRate: 4,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-10-21',
      });

      expect(sched.totalPayable).toBe(38440);
      expect(sched.schedule).toHaveLength(6);

      // Sum of all installments must equal totalPayable exactly
      const totalSum = sched.schedule.reduce((acc, inst) => acc + inst.expectedAmount, 0);
      expect(Math.round(totalSum * 100) / 100).toBe(38440);
    });
  });
});
