import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { PaymentMode, CollectionSource, InterestMethod, RepaymentFrequency } from '@crm/shared';

describe('Integration Tests: Device Brand/Model Preservation and Authoritative Payment Penalty Handling', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  let superAdminId: string, superAdminToken: string;
  let dealerId: string, dealerCode: string;
  let dealerUserId: string, dealerToken: string;

  let customerId: string;
  let loanId: string;
  let loanNo: string;

  let nullDeviceCustomerId: string;
  let nullDeviceLoanId: string;
  let nullDeviceLoanNo: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Create Dealer
    dealerId = uuidv4();
    dealerCode = `DLR_FIX_${runId}`.toUpperCase();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, $3, 'Owner Fix', $4, $5, 'ACTIVE', 'Bangalore', '100 Feet Rd', NOW(), NOW())`,
      [dealerId, dealerCode, `Store Fix ${runId}`, `9871${numId}1`, `store_fix_${runId}@crm.test`]
    );

    // 2. Create Users
    superAdminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Super Admin Fix', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [superAdminId, `superadmin_${runId}@crm.test`, `9872${numId}1`, hash]
    );

    dealerUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User Fix', 'DEALER', $5, 'ACTIVE', NOW(), NOW())`,
      [dealerUserId, `dealer_${runId}@crm.test`, `9873${numId}1`, hash, dealerId]
    );

    // Login tokens
    const saLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `superadmin_${runId}@crm.test`, password: 'Password@123' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const dlrLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `dealer_${runId}@crm.test`, password: 'Password@123' });
    dealerToken = dlrLogin.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    if (loanId) {
      await queryPostgres('DELETE FROM payments WHERE loan_id = $1', [loanId]);
      await queryPostgres('DELETE FROM emi_penalties WHERE emi_installment_id IN (SELECT id FROM emi_installments WHERE loan_id = $1)', [loanId]);
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id = $1', [loanId]);
      await queryPostgres('DELETE FROM loans WHERE id = $1', [loanId]);
    }
    if (nullDeviceLoanId) {
      await queryPostgres('DELETE FROM payments WHERE loan_id = $1', [nullDeviceLoanId]);
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id = $1', [nullDeviceLoanId]);
      await queryPostgres('DELETE FROM loans WHERE id = $1', [nullDeviceLoanId]);
    }
    if (customerId) {
      await queryPostgres('DELETE FROM customers WHERE id = $1', [customerId]);
    }
    if (nullDeviceCustomerId) {
      await queryPostgres('DELETE FROM customers WHERE id = $1', [nullDeviceCustomerId]);
    }

    await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id IN ($1, $2)", [superAdminId, dealerUserId]);
    await queryPostgres("UPDATE dealers SET status = 'INACTIVE' WHERE id = $1", [dealerId]);

    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // =========================================================================
  // ISSUE 1: DEVICE BRAND & MODEL PRESERVATION
  // =========================================================================
  describe('Issue 1: Preserve Dealer-Originated Device Brand and Model', () => {
    it('1. Dealer onboards customer with Samsung Galaxy A55 5G -> preserves brand & model in returned loan and database', async () => {
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          customer: {
            fullName: `Ramesh Kumar ${runId}`,
            primaryPhone: `+9199${numId}11`,
            alternatePhone: `+9199${numId}22`,
            addressLine1: '12 1st Main Road, Indiranagar',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560038',
            areaRoute: 'Bangalore-East',
          },
          loan: {
            principalAmount: 30000,
            downPayment: 8000,
            annualInterestRate: 14,
            interestCalcMethod: InterestMethod.REDUCING_BALANCE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-09-01',
            firstEmiDate: '2026-10-01',
            deviceBrand: 'Samsung',
            deviceModel: 'Galaxy A55 5G',
            deviceName: 'Samsung Galaxy A55 5G',
            imei1: '860123456789012',
            imei2: '860123456789013',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      customerId = data.customer.id;
      loanId = data.loan.id;
      loanNo = data.loan.loanAccountNo;

      // Verify returned loan object contains explicit device info
      expect(data.loan.deviceBrand).toBe('Samsung');
      expect(data.loan.deviceModel).toBe('Galaxy A55 5G');
      expect(data.loan.deviceName).toBe('Samsung Galaxy A55 5G');
      expect(data.loan.imei1).toBe('860123456789012');

      // Verify never returned placeholders
      expect(data.loan.deviceBrand).not.toBe('Smart Device');
      expect(data.loan.deviceModel).not.toContain('Asset (');
    });

    it('2. GET /api/v1/loans/:id returns preserved deviceBrand and deviceModel without fallback pollution', async () => {
      const res = await request(app)
        .get(`/api/v1/loans/${loanId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const loan = res.body.data;
      expect(loan.deviceBrand).toBe('Samsung');
      expect(loan.deviceModel).toBe('Galaxy A55 5G');
      expect(loan.deviceName).toBe('Samsung Galaxy A55 5G');
      expect(loan.imei1).toBe('860123456789012');
    });

    it('3. GET /api/v1/loans lists loans with actual deviceBrand and deviceModel', async () => {
      const res = await request(app)
        .get(`/api/v1/loans?search=${loanNo}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const item = res.body.data.find((l: any) => l.id === loanId);
      expect(item).toBeDefined();
      expect(item.deviceBrand).toBe('Samsung');
      expect(item.deviceModel).toBe('Galaxy A55 5G');
      expect(item.deviceModel).not.toBe(`Asset (${loanNo})`);
    });

    it('4. Dealer dashboard GET /api/v1/dealers/dashboard returns recentLoans with real device information', async () => {
      const res = await request(app)
        .get('/api/v1/dealers/dashboard')
        .set('Authorization', `Bearer ${dealerToken}`);

      expect(res.status).toBe(200);
      const recentLoans = res.body.data.recentLoans;
      const targetLoan = recentLoans.find((l: any) => l.id === loanId);
      expect(targetLoan).toBeDefined();
      expect(targetLoan.deviceBrand).toBe('Samsung');
      expect(targetLoan.deviceModel).toBe('Galaxy A55 5G');
    });

    it('5. Loan without entered brand/model returns null instead of synthetic "Smart Device" or "Asset (LN-xxxx)"', async () => {
      nullDeviceCustomerId = uuidv4();
      nullDeviceLoanId = uuidv4();
      nullDeviceLoanNo = `LN-NULL-${runId}`;

      await queryPostgres(
        `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_at, updated_at)
         VALUES ($1, $2, 'Null Device Customer', $3, 'Indiranagar', 'Bengaluru', 'Karnataka', '560038', 'East', TRUE, NOW(), NOW())`,
        [nullDeviceCustomerId, `CUST_NULL_${runId}`, `+919844${numId}`]
      );

      await queryPostgres(
        `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                            tenure_months, total_installments, annual_interest_rate, emi_amount, total_interest, total_payable, outstanding_balance,
                            status, disbursement_date, first_emi_date, maturity_date, device_brand, device_model, device_name, imei1, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 25000, 5000, 20000, 6, 6, 12, 4500, 2000, 27000, 27000, 'ACTIVE', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months', NULL, NULL, NULL, NULL, NOW(), NOW())`,
        [nullDeviceLoanId, nullDeviceLoanNo, nullDeviceCustomerId, dealerId]
      );

      const res = await request(app)
        .get(`/api/v1/loans/${nullDeviceLoanId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const loan = res.body.data;
      expect(loan.deviceBrand).toBeNull();
      expect(loan.deviceModel).toBeNull();
      expect(loan.deviceName).toBeNull();
      expect(loan.deviceBrand).not.toBe('Smart Device');
      expect(loan.deviceModel).not.toBe(`Asset (${nullDeviceLoanNo})`);
    });

    it('6. GET /api/v1/loans/devices returns clean "Not provided" for loans with no device brand/model', async () => {
      const res = await request(app)
        .get('/api/v1/loans/devices')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const devices = res.body.data;
      const nullDeviceItem = devices.find((d: any) => d.id === nullDeviceLoanId);
      if (nullDeviceItem) {
        expect(nullDeviceItem.deviceBrand).toBe('Not provided');
        expect(nullDeviceItem.deviceModel).toBe('Not provided');
        expect(nullDeviceItem.deviceBrand).not.toBe('Smart Device');
        expect(nullDeviceItem.deviceModel).not.toContain('Asset (');
      }
    });
  });

  // =========================================================================
  // ISSUE 2: AUTHORITATIVE PAYMENT PREVIEW & PENALTY SECTION
  // =========================================================================
  describe('Issue 2: Authoritative Payment Preview & Penalty Handling', () => {
    let overdueEmiId: string;

    beforeAll(async () => {
      // Approve and activate loan if needed, and insert an overdue installment with active penalty
      await queryPostgres(
        `UPDATE loans SET status = 'ACTIVE' WHERE id = $1`,
        [loanId]
      );

      overdueEmiId = uuidv4();
      // Insert an installment due 15 days ago with 500 penalty
      await queryPostgres(
        `INSERT INTO emi_installments (
           id, loan_id, customer_id, installment_number, due_date, principal_component,
           interest_component, expected_amount, paid_amount, remaining_amount,
           penalty_amount, status, created_at, updated_at
         ) VALUES (
           $1, $2, $3, 1, CURRENT_DATE - INTERVAL '15 days', 4500, 500, 5000, 0, 5000, 500, 'OVERDUE', NOW(), NOW()
         )`,
        [overdueEmiId, loanId, customerId]
      );

      // Insert active penalty record
      await queryPostgres(
        `INSERT INTO emi_penalties (
           id, emi_installment_id, loan_id, amount, paid_amount, status, reason, created_by, created_at, updated_at
         ) VALUES (
           $1, $2, $3, 500, 0, 'ACTIVE', 'Late payment', $4, NOW(), NOW()
         )`,
        [uuidv4(), overdueEmiId, loanId, superAdminId]
      );
    });

    it('1. GET /api/v1/payments/preview calculates authoritative days overdue, penalty, and total due', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/preview?loanId=${loanId}&installmentId=${overdueEmiId}&amount=5500`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const preview = res.body.data;
      expect(preview.loanId).toBe(loanId);
      expect(preview.installmentId).toBe(overdueEmiId);
      expect(preview.daysOverdue).toBeGreaterThanOrEqual(14);
      expect(preview.remainingAmount).toBe(5000);
      expect(preview.penaltyAmount).toBe(500);
      expect(preview.totalDue).toBe(5500);

      // Waterfall preview: penalty satisfied first, then P&I
      expect(preview.allocationPreview).toBeDefined();
      expect(preview.allocationPreview.penaltyAllocated).toBe(500);
      expect(preview.allocationPreview.principalInterestAllocated).toBe(5000);
      expect(preview.remainingAfterPayment).toBe(0);
      expect(preview.allocationPreview.newEmiStatus).toBe('PAID');
    });

    it('2. GET /api/v1/payments/preview for partial payment satisfies penalty first and retains remaining P&I', async () => {
      const partialPayment = 2000;
      const res = await request(app)
        .get(`/api/v1/payments/preview?loanId=${loanId}&installmentId=${overdueEmiId}&amount=${partialPayment}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const preview = res.body.data;

      // 500 to penalty, remaining 1500 to P&I
      expect(preview.allocationPreview.penaltyAllocated).toBe(500);
      expect(preview.allocationPreview.principalInterestAllocated).toBe(1500);
      // Total due was 5500. After 2000, 3500 remains
      expect(preview.remainingAfterPayment).toBe(3500);
    });

    it('3. GET /api/v1/payments/preview for on-schedule loan returns 0 days overdue and 0 penalty', async () => {
      const onScheduleEmiId = uuidv4();
      await queryPostgres(
        `INSERT INTO emi_installments (
           id, loan_id, customer_id, installment_number, due_date, principal_component,
           interest_component, expected_amount, paid_amount, remaining_amount,
           penalty_amount, status, created_at, updated_at
         ) VALUES (
           $1, $2, $3, 1, CURRENT_DATE + INTERVAL '10 days', 4500, 500, 5000, 0, 5000, 0, 'UPCOMING', NOW(), NOW()
         )`,
        [onScheduleEmiId, nullDeviceLoanId, nullDeviceCustomerId]
      );

      const res = await request(app)
        .get(`/api/v1/payments/preview?loanId=${nullDeviceLoanId}&installmentId=${onScheduleEmiId}&amount=5000`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const preview = res.body.data;
      expect(preview.daysOverdue).toBe(0);
      expect(preview.penaltyAmount).toBe(0);
      expect(preview.remainingAmount).toBe(5000);
      expect(preview.totalDue).toBe(5000);
      expect(preview.allocationPreview.penaltyAllocated).toBe(0);
      expect(preview.allocationPreview.principalInterestAllocated).toBe(5000);

      // Clean up installment
      await queryPostgres('DELETE FROM emi_installments WHERE id = $1', [onScheduleEmiId]);
    });

    it('4. POST /api/v1/payments records payment, allocates penalty first, and returns structured receipt with penalty', async () => {
      const paymentRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId,
          emiId: overdueEmiId,
          customerId,
          amount: 5500,
          paymentMode: PaymentMode.UPI,
          collectionSource: CollectionSource.DIRECT_CUSTOMER,
          referenceNumber: `UPI-TEST-${runId}`,
          notes: 'Test penalty payment',
          idempotencyKey: `TEST_IDEMP_${runId}`,
        });

      expect(paymentRes.status).toBe(201);
      const rec = paymentRes.body.data;
      expect(rec.amountCollected).toBe(5500);
      expect(rec.allocatedInstallments).toBeDefined();

      const overdueAlloc = rec.allocatedInstallments.find((a: any) => a.emiId === overdueEmiId);
      expect(overdueAlloc).toBeDefined();
      expect(overdueAlloc.allocatedToPenalty).toBe(500);
      expect(overdueAlloc.allocatedToPrincipalInterest).toBe(5000);
      expect(overdueAlloc.newStatus).toBe('PAID');

      // Verify receipt endpoint returns deviceBrand and penalty details
      const receiptRes = await request(app)
        .get(`/api/v1/payments/receipt/${rec.paymentId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(receiptRes.status).toBe(200);
      const receipt = receiptRes.body.data;
      expect(receipt.loan.deviceBrand).toBe('Samsung');
      expect(receipt.loan.deviceModel).toBe('Galaxy A55 5G');
      expect(receipt.loan.financedDevice).toBe('Samsung Galaxy A55 5G');

      // Verify payment details endpoint returns device details
      const detailRes = await request(app)
        .get(`/api/v1/payments/${rec.paymentId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(detailRes.status).toBe(200);
      const paymentDetail = detailRes.body.data;
      expect(paymentDetail.deviceBrand).toBe('Samsung');
      expect(paymentDetail.deviceModel).toBe('Galaxy A55 5G');
      expect(paymentDetail.financedItem).toBe('Samsung Galaxy A55 5G');
    });
  });
});
