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
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Regression Tests: Financed Principal Metric Calculation Rules', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const adminEmail = `admin_fp_${runId}@financedash.test`;
  let adminToken: string;
  let adminId: string;
  let dealerId: string;
  let customerId: string;

  let loanNoPaymentId: string;
  let loanPartialPaidId: string;
  let loanFullyPaidId: string;
  let loanDefaultedId: string;
  let loanRejectedId: string;
  let loanPendingId: string;
  let loanDraftId: string;
  let loanCancelledId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Super Admin FP Test', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [adminId, adminEmail, `9819${Date.now().toString().slice(-6)}`, hash]
    );

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'Password@123' });
    adminToken = loginRes.body.data.tokens.accessToken;

    // 2. Create Test Dealer
    dealerId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, $3, 'Rajesh Dealer', $4, $5, 'ACTIVE', 'South Delhi', 'Shop 101 Mall Road', NOW(), NOW())`,
      [dealerId, `DLR_FP_${runId}`, `Store Financed Hub ${runId}`, `9871${Date.now().toString().slice(-6)}`, `dlr_${runId}@store.test`]
    );

    // 3. Create Test Customer
    customerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, 'Aarav Sharma', $3, '14 Heritage Apt', 'South Delhi', 'Delhi', '110017', 'Saket', NOW(), NOW())`,
      [customerId, `CUST_FP_${runId}`, `9812${Date.now().toString().slice(-6)}`]
    );
  });

  afterAll(async () => {
    try {
      await queryPostgres('DELETE FROM payments WHERE loan_id IN (SELECT id FROM loans WHERE dealer_id = $1)', [dealerId]);
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id IN (SELECT id FROM loans WHERE dealer_id = $1)', [dealerId]);
      await queryPostgres('DELETE FROM loans WHERE dealer_id = $1', [dealerId]);
      await queryPostgres('DELETE FROM dealers WHERE id = $1', [dealerId]);
      await queryPostgres('DELETE FROM customers WHERE id = $1', [customerId]);
      await queryPostgres('DELETE FROM users WHERE id = $1', [adminId]);
    } catch {}

    await closePostgresPool();
    await closeRedisConnection();
    await closeAllQueues();
  });

  // Rule 1: A financed loan with no payments
  test('1. Financed loan with 0 payments: Financed Principal equals original net disbursed amount', async () => {
    // Retail: 25,000, Down Payment: 5,000 => Net Disbursed (Financed Principal): 20,000
    const res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        dealerId,
        principalAmount: 25000,
        downPayment: 5000,
        annualInterestRate: 5.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });

    expect(res.status).toBe(201);
    loanNoPaymentId = res.body.data.id;
    expect(res.body.data.netDisbursedAmount).toBe(20000);
    expect(res.body.data.status).toBe(LoanStatus.ACTIVE);

    // Verify dealer analytics
    const analyticsRes = await request(app)
      .get(`/api/v1/reports/dealer-financing-analytics?dealerId=${dealerId}&preset=all`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(analyticsRes.status).toBe(200);
    const target = analyticsRes.body.data.dealers[0];
    expect(target).toBeDefined();
    expect(target.totalFinancedPrincipal).toBe(20000);
    expect(target.totalDownPayment).toBe(5000);
    expect(target.totalCollected).toBe(0);
    expect(target.totalLoans).toBe(1);
    expect(target.totalPhonesFinanced).toBe(1);
  });

  // Rule 2: A partially paid loan: financed principal remains unchanged
  test('2. Partially paid loan: Collections do NOT reduce Financed Principal figure', async () => {
    // Retail: 30,000, Down Payment: 6,000 => Net Disbursed: 24,000
    const l2Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        dealerId,
        principalAmount: 30000,
        downPayment: 6000,
        annualInterestRate: 4.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });

    expect(l2Res.status).toBe(201);
    loanPartialPaidId = l2Res.body.data.id;
    expect(l2Res.body.data.netDisbursedAmount).toBe(24000);

    // Record partial payment of ₹8,000 against Loan 2
    const payRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loanPartialPaidId,
        customerId,
        amount: 8000,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: `PAY_PART_${runId}`,
        idempotencyKey: `IDEMP_FP_PART_${runId}`,
      });
    expect(payRes.status).toBe(201);

    // Verify analytics: Financed Principal = 20,000 + 24,000 = 44,000 (NOT reduced by 8,000)
    const analyticsRes = await request(app)
      .get(`/api/v1/reports/dealer-financing-analytics?dealerId=${dealerId}&preset=all`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(analyticsRes.status).toBe(200);
    const target = analyticsRes.body.data.dealers[0];
    expect(target.totalFinancedPrincipal).toBe(44000); // 20000 + 24000
    expect(target.totalDownPayment).toBe(11000); // 5000 + 6000
    expect(target.totalCollected).toBe(8000);
    expect(target.totalLoans).toBe(2);
    expect(target.totalPhonesFinanced).toBe(2);
  });

  // Rule 3: A fully paid loan: financed principal remains unchanged
  test('3. Fully paid loan (status CLOSED): Financed Principal remains unchanged even when balance is 0', async () => {
    // Retail: 18,000, Down Payment: 3,000 => Net Disbursed: 15,000
    const l3Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        dealerId,
        principalAmount: 18000,
        downPayment: 3000,
        annualInterestRate: 4.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-10-01',
        firstEmiDate: '2026-11-01',
      });

    expect(l3Res.status).toBe(201);
    loanFullyPaidId = l3Res.body.data.id;
    const totalPayable = l3Res.body.data.totalPayable;

    // Simulate full repayment: status = CLOSED, outstanding_balance = 0, total_paid = totalPayable
    await queryPostgres(
      `UPDATE loans
       SET status = 'CLOSED', outstanding_balance = 0.00, total_paid = $1, updated_at = NOW()
       WHERE id = $2`,
      [totalPayable, loanFullyPaidId]
    );
    await queryPostgres(
      `UPDATE emi_installments
       SET status = 'PAID', remaining_amount = 0.00, paid_amount = expected_amount, updated_at = NOW()
       WHERE loan_id = $1`,
      [loanFullyPaidId]
    );

    // Verify analytics: Financed Principal = 20,000 + 24,000 + 15,000 = 59,000
    const analyticsRes = await request(app)
      .get(`/api/v1/reports/dealer-financing-analytics?dealerId=${dealerId}&preset=all`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(analyticsRes.status).toBe(200);
    const target = analyticsRes.body.data.dealers[0];
    expect(target.totalFinancedPrincipal).toBe(59000); // 44000 + 15000
    expect(target.completedLoans).toBe(1);
    expect(target.activeLoans).toBe(2);
    expect(target.totalLoans).toBe(3);
    expect(target.totalPhonesFinanced).toBe(3);
  });

  // Rule 4: Interest and additional charges are excluded
  test('4. Interest and charges are excluded from Financed Principal figure', async () => {
    // Add loan with status DEFAULTED (Retail: 20,000, DP: 4,000 => Net Disbursed: 16,000)
    loanDefaultedId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, status, disbursement_date, first_emi_date, maturity_date,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 20000, 4000,
        16000, 5.0, 'FLAT_RATE', 6,
        'MONTHLY', 6, 3466.67, 4800, 20800,
        0, 20800, 'DEFAULTED', '2026-08-01', '2026-09-01', '2027-02-01',
        NOW(), NOW()
      )`,
      [loanDefaultedId, `LN_DEF_${runId}`, customerId, dealerId]
    );

    // Add overdue installments with heavy penalties (₹2,500 penalties)
    for (let i = 1; i <= 6; i++) {
      await queryPostgres(
        `INSERT INTO emi_installments (
          id, loan_id, customer_id, installment_number, due_date, principal_component,
          interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
          status, days_overdue, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, '2026-09-01', 2666.67,
          800, 3466.67, 0, 3466.67, 500.00,
          'OVERDUE', 45, NOW(), NOW()
        )`,
        [uuidv4(), loanDefaultedId, customerId, i]
      );
    }

    const analyticsRes = await request(app)
      .get(`/api/v1/reports/dealer-financing-analytics?dealerId=${dealerId}&preset=all`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(analyticsRes.status).toBe(200);
    const target = analyticsRes.body.data.dealers[0];
    // Financed Principal = 20,000 + 24,000 + 15,000 + 16,000 = 75,000
    // Total interest and penalties are NOT added to financed principal
    expect(target.totalFinancedPrincipal).toBe(75000);
    expect(target.totalPenalty).toBeGreaterThanOrEqual(3000); // penalties tracked separately
  });

  // Rule 5: Multiple EMI/payment records do not inflate the total (avoid double counting)
  test('5. Multiple EMI installments and payment records do not duplicate or inflate Financed Principal', async () => {
    // Insert additional payment rows for loanPartialPaidId
    await queryPostgres(
      `INSERT INTO payments (
        id, loan_id, customer_id, dealer_id, amount, payment_mode, collection_source, status,
        receipt_number, payment_timestamp, is_reversal, collected_by_agent_id, created_at, updated_at
      ) VALUES
      ($1, $2, $3, $4, 1000, 'CASH', 'DIRECT_CUSTOMER', 'SUCCESS', $5, NOW(), FALSE, $6, NOW(), NOW()),
      ($7, $2, $3, $4, 1500, 'UPI', 'DIRECT_CUSTOMER', 'SUCCESS', $8, NOW(), FALSE, $6, NOW(), NOW())`,
      [uuidv4(), loanPartialPaidId, customerId, dealerId, `REC1_${runId}`, adminId, uuidv4(), `REC2_${runId}`]
    );

    const analyticsRes = await request(app)
      .get(`/api/v1/reports/dealer-financing-analytics?dealerId=${dealerId}&preset=all`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(analyticsRes.status).toBe(200);
    const target = analyticsRes.body.data.dealers[0];
    // Financed Principal MUST remain exactly 75,000 regardless of payments/installments count
    expect(target.totalFinancedPrincipal).toBe(75000);
  });

  // Rule 6: Loan statuses follow existing reporting rules (REJECTED, PENDING_APPROVAL, DRAFT, CANCELLED excluded)
  test('6. Non-eligible loan statuses (REJECTED, PENDING_APPROVAL, DRAFT, CANCELLED) are strictly excluded from Financed Principal', async () => {
    // Loan 7: REJECTED (Retail: 40,000, DP: 10,000, Net: 30,000)
    loanRejectedId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, status, disbursement_date, first_emi_date, maturity_date,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 40000, 10000, 30000, 5.0, 'FLAT_RATE', 6, 'MONTHLY', 6, 5000, 6000, 36000,
        0, 36000, 'REJECTED', '2026-10-01', '2026-11-01', '2027-04-01', NOW(), NOW()
      )`,
      [loanRejectedId, `LN_REJ_${runId}`, customerId, dealerId]
    );

    // Loan 8: PENDING_APPROVAL (Retail: 35,000, DP: 5,000, Net: 30,000)
    loanPendingId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, status, disbursement_date, first_emi_date, maturity_date,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 35000, 5000, 30000, 4.0, 'FLAT_RATE', 6, 'MONTHLY', 6, 5000, 4800, 34800,
        0, 34800, 'PENDING_APPROVAL', '2026-10-01', '2026-11-01', '2027-04-01', NOW(), NOW()
      )`,
      [loanPendingId, `LN_PND_${runId}`, customerId, dealerId]
    );

    // Loan 9: DRAFT (Retail: 15,000, DP: 2,000, Net: 13,000)
    loanDraftId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, status, disbursement_date, first_emi_date, maturity_date,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 15000, 2000, 13000, 4.0, 'FLAT_RATE', 6, 'MONTHLY', 6, 2500, 2000, 15000,
        0, 15000, 'DRAFT', '2026-10-01', '2026-11-01', '2027-04-01', NOW(), NOW()
      )`,
      [loanDraftId, `LN_DFT_${runId}`, customerId, dealerId]
    );

    // Loan 10: CANCELLED (Retail: 22,000, DP: 4,000, Net: 18,000)
    loanCancelledId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, status, disbursement_date, first_emi_date, maturity_date,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 22000, 4000, 18000, 4.0, 'FLAT_RATE', 6, 'MONTHLY', 6, 3500, 3000, 21000,
        0, 21000, 'CANCELLED', '2026-10-01', '2026-11-01', '2027-04-01', NOW(), NOW()
      )`,
      [loanCancelledId, `LN_CAN_${runId}`, customerId, dealerId]
    );

    const analyticsRes = await request(app)
      .get(`/api/v1/reports/dealer-financing-analytics?dealerId=${dealerId}&preset=all`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(analyticsRes.status).toBe(200);
    const target = analyticsRes.body.data.dealers[0];
    const summary = analyticsRes.body.data.summary;

    // Total Financed Principal must strictly remain 75,000 (excluding 30,000 + 30,000 + 13,000 + 18,000 = 91,000 non-eligible amounts)
    expect(target.totalFinancedPrincipal).toBe(75000);
    expect(summary.totalFinancedPrincipal).toBe(75000);

    // Total Phones Financed strictly equals 4 (Loans 1, 2, 3, 4)
    expect(target.totalPhonesFinanced).toBe(4);

    // Non-eligible applications are tracked in their respective status breakdown counts
    expect(target.totalLoans).toBe(8);
    expect(target.rejectedLoans).toBe(1);
    expect(target.pendingLoans).toBe(1);
    expect(target.activeLoans).toBe(2);
    expect(target.completedLoans).toBe(1);
  });
});
