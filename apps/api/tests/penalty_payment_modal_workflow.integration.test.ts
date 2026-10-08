import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, getBusinessDate, addDays } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Penalty Payment Modal Workflow Backend Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const superAdminEmail = `sa_${runId}@penaltymodal.com`;
  const dealerEmail = `dealer_${runId}@penaltymodal.com`;

  let superAdminToken: string;
  let dealerToken: string;
  let superAdminId: string;
  let dealerUserId: string;
  let dealerId: string;
  let customerId: string;
  let loanId: string;
  let overdueEmiId: string;
  let futureEmiId: string;

  const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
  const pastDueDate = addDays(businessToday, -12); // 12 days overdue
  const futureDueDate = addDays(businessToday, 18);

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    superAdminId = uuidv4();
    dealerUserId = uuidv4();
    dealerId = uuidv4();
    customerId = uuidv4();
    loanId = uuidv4();
    overdueEmiId = uuidv4();
    futureEmiId = uuidv4();

    // 1. Seed Dealer
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES ($1, $2, 'Galaxy Electronics', 'Vikram Singh', $3, 'Noida', 'Sec 18', 'ACTIVE', NOW(), NOW())`,
      [dealerId, `DLR-${runId}`, `+9198${Date.now().toString().slice(-8)}`]
    );

    // 2. Seed Users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $4, 'Dealer User', 'DEALER', $8, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, superAdminEmail, `+9190${Math.floor(10000000 + Math.random() * 90000000)}`, hash,
        dealerUserId, dealerEmail, `+9195${Math.floor(10000000 + Math.random() * 90000000)}`, dealerId,
      ]
    );

    // 3. Login
    const saLogin = await request(app).post('/api/v1/auth/login').send({
      email: superAdminEmail,
      password: 'Password@123',
    });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const dlrLogin = await request(app).post('/api/v1/auth/login').send({
      email: dealerEmail,
      password: 'Password@123',
    });
    dealerToken = dlrLogin.body.data.tokens.accessToken;

    // 4. Seed Customer
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, 'Ankit Sharma', $3, 'A-102, Noida', 'Noida', 'UP', '201301', 'Sec 18', NOW(), NOW())`,
      [customerId, `CUST-${runId}`, `+9197${Math.floor(10000000 + Math.random() * 90000000)}`]
    );

    // 5. Seed Loan
    await queryPostgres(
      `INSERT INTO loans (
        id, customer_id, dealer_id, loan_account_no,
        principal_amount, down_payment, net_disbursed_amount, total_interest, total_payable,
        total_paid, outstanding_balance, emi_amount, total_installments,
        tenure_months, annual_interest_rate, status, disbursement_date, first_emi_date, maturity_date,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 10000.00, 0.00, 10000.00, 0.00, 10000.00, 0.00, 10000.00, 5000.00, 2, 2, 0.00, 'ACTIVE', $5, $5, $6, NOW(), NOW())`,
      [loanId, customerId, dealerId, `LN-${runId}`, pastDueDate, futureDueDate]
    );

    // 6. Seed Installments: 1 overdue (12 days overdue), 1 future
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date,
        principal_component, interest_component, expected_amount,
        paid_amount, remaining_amount, penalty_amount, status, days_overdue,
        created_at, updated_at
      ) VALUES 
        ($1, $2, $3, 1, $4, 5000, 0, 5000, 0, 5000, 0, 'OVERDUE', 12, NOW(), NOW()),
        ($5, $2, $3, 2, $6, 5000, 0, 5000, 0, 5000, 0, 'UPCOMING', 0, NOW(), NOW())`,
      [overdueEmiId, loanId, customerId, pastDueDate, futureEmiId, futureDueDate]
    );
  });

  describe('1. Payment Preview Recalculation', () => {
    test('preview calculates calculatedPenalty for overdue installment (12 days * 10 = ₹120)', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/preview?loanId=${loanId}&installmentId=${overdueEmiId}&amount=5000`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const preview = res.body.data;
      expect(preview.daysOverdue).toBe(12);
      expect(preview.calculatedPenalty).toBe(120);
      expect(preview.remainingAmount).toBe(5000);
    });

    test('preview updates allocation dynamically when penaltyAmount is passed', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/preview?loanId=${loanId}&installmentId=${overdueEmiId}&amount=5000&penaltyAmount=120`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const preview = res.body.data;
      expect(preview.totalApplied).toBe(5120);
      expect(preview.allocationPreview.penaltyAllocated).toBe(120);
      expect(preview.allocationPreview.principalInterestAllocated).toBe(5000);
      expect(preview.allocationPreview.remainingOutstanding).toBe(4880);
      expect(preview.allocationPreview.newEmiStatus).toBe('PAID');
    });
  });

  describe('2. Validation & Security Checks', () => {
    test('rejects negative penalty amounts in record payment', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId,
          emiId: overdueEmiId,
          customerId,
          amount: 5000,
          penaltyAmount: -100,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body.error)).toMatch(/Penalty amount cannot be negative/i);
    });

    test('rejects penalty assessment on future non-overdue installment', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId,
          emiId: futureEmiId,
          customerId,
          amount: 5000,
          penaltyAmount: 150,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body.error)).toMatch(/overdue/i);
    });
  });

  describe('3. Payment Execution, Persistence & Non-Disappearance', () => {
    let recordedPaymentId: string;

    test('records payment with ₹5,000 P&I and ₹120 penalty, stores penalty_amount in payments table', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId,
          emiId: overdueEmiId,
          customerId,
          amount: 5000,
          penaltyAmount: 120,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
          idempotencyKey: `IDEMP_PENALTY_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      recordedPaymentId = data.paymentId || data.id;

      expect(data.amountCollected).toBe(5120);
      expect(data.paymentAmount).toBe(5000);
      expect(data.penaltyAmount).toBe(120);

      // Verify row in database
      const payDb = await queryPostgres(
        'SELECT amount, penalty_amount FROM payments WHERE id = $1',
        [recordedPaymentId]
      );
      expect(payDb.rows.length).toBe(1);
      expect(Number(payDb.rows[0].amount)).toBe(5120);
      expect(Number(payDb.rows[0].penalty_amount)).toBe(120);
    });

    test('receipt retrieval retains penalty information and penalty does NOT disappear', async () => {
      const receiptRes = await request(app)
        .get(`/api/v1/payments/receipt/${recordedPaymentId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(receiptRes.status).toBe(200);
      expect(receiptRes.body.success).toBe(true);
      const receipt = receiptRes.body.data;

      expect(receipt.amount).toBe(5120);
      expect(receipt.penaltyAmount).toBe(120);
      expect(receipt.paymentAmount).toBe(5000);
      expect(receipt.allocations[0].penaltyComponent).toBe(120);
      expect(receipt.allocations[0].principalComponent).toBe(5000);
    });

    test('payment detail endpoint retains penaltyAmount and allocationComponent', async () => {
      const detailRes = await request(app)
        .get(`/api/v1/payments/${recordedPaymentId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.success).toBe(true);
      const detail = detailRes.body.data;

      expect(detail.penaltyAmount).toBe(120);
      expect(detail.paymentAmount).toBe(5000);
      expect(detail.amount).toBe(5120);

      const emiAlloc = detail.allocations?.find((a: any) => a.installmentNumber === 1);
      expect(emiAlloc).toBeDefined();
      expect(emiAlloc.penaltyComponent).toBe(120);
      expect(emiAlloc.principalComponent).toBe(5000);
    });
  });
});
