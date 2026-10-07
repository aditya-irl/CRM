import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import {
  UserRole,
  DealerStatus,
  LoanStatus,
  InterestMethod,
  RepaymentFrequency,
  PaymentMode,
  CollectionSource,
  formatDateDDMMYYYY,
  normalizeNumericLeadingZeros,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Customer Financing, Device Registry, and Dealer EMI Payment Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@crmtest.com`;
  const dealerAUserEmail = `dealer_a_${runId}@crmtest.com`;
  const dealerBUserEmail = `dealer_b_${runId}@crmtest.com`;

  let adminToken: string;
  let dealerAToken: string;
  let dealerBToken: string;

  let adminId: string;
  let dealerAUserId: string;
  let dealerBUserId: string;

  let dealerAId: string;
  let dealerACode: string;
  let dealerBId: string;
  let dealerBCode: string;

  let customerDealerAId: string;
  let customerDirectId: string;

  let loanDealerAId: string;
  let loanDealerAAccNo: string;
  let loanDirectId: string;
  let loanDirectAccNo: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    dealerAUserId = uuidv4();
    dealerBUserId = uuidv4();

    dealerAId = uuidv4();
    dealerACode = `DLR_${runId}_A`.toUpperCase();
    dealerBId = uuidv4();
    dealerBCode = `DLR_${runId}_B`.toUpperCase();

    // 1. Create Super Admin
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [adminId, adminEmail, `9811${numId}0`, hash]
    );

    // 2. Create Partner Store A and Store B
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'Dadri Market', 'Shop 10, Dadri Market', NOW(), NOW())`,
      [dealerAId, dealerACode, `Dadri Tech Hub ${runId}`, 'Ramesh Sharma', `9822${numId}1`, `store_a_${runId}@dealers.com`]
    );

    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'Noida Sec 18', 'Shop 20, Noida Sec 18', NOW(), NOW())`,
      [dealerBId, dealerBCode, `Noida Mobile Plaza ${runId}`, 'Suresh Verma', `9822${numId}2`, `store_b_${runId}@dealers.com`]
    );

    // 3. Create Dealer User accounts linked to dealers
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User A', 'DEALER', $5, 'ACTIVE', NOW(), NOW())`,
      [dealerAUserId, dealerAUserEmail, `9833${numId}1`, hash, dealerAId]
    );

    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User B', 'DEALER', $5, 'ACTIVE', NOW(), NOW())`,
      [dealerBUserId, dealerBUserEmail, `9833${numId}2`, hash, dealerBId]
    );

    // 4. Authenticate users
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const dealerALogin = await request(app).post('/api/v1/auth/login').send({ email: dealerAUserEmail, password: 'Password@123' });
    dealerAToken = dealerALogin.body.data.tokens.accessToken;

    const dealerBLogin = await request(app).post('/api/v1/auth/login').send({ email: dealerBUserEmail, password: 'Password@123' });
    dealerBToken = dealerBLogin.body.data.tokens.accessToken;

    // 5. Create Customer 1 (Dealer A originated with financed device)
    customerDealerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '123 Market St', 'Greater Noida', 'Uttar Pradesh', '201310', 'Dadri', NOW(), NOW())`,
      [customerDealerAId, `CUST_${runId}_A`, 'Amit Kumar', `9844${numId}1`]
    );

    // 6. Create Customer 2 (Direct Customer originated without dealer)
    customerDirectId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '456 Station Rd', 'Greater Noida', 'Uttar Pradesh', '201306', 'Noida', NOW(), NOW())`,
      [customerDirectId, `CUST_${runId}_DIR`, 'Priya Singh', `9844${numId}2`]
    );

    // 7. Create Loan 1 for Customer 1 (Dealer A, Samsung Galaxy S24 device)
    loanDealerAId = uuidv4();
    loanDealerAAccNo = `LN_${runId}_A`;
    await queryPostgres(
      `INSERT INTO loans (
         id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
         annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
         emi_amount, total_interest, total_payable, total_paid, outstanding_balance,
         disbursement_date, first_emi_date, maturity_date, status,
         device_brand, device_model, device_name, imei1, imei2, device_status,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, 60000.00, 10000.00, 50000.00,
         12.00, 'FLAT_RATE', 12, 'MONTHLY', 12,
         5000.00, 10000.00, 60000.00, 0.00, 60000.00,
         CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE + INTERVAL '365 days', 'ACTIVE',
         'Samsung', 'Galaxy S24 Ultra', 'Samsung Galaxy S24 Ultra 256GB', '869234051234567', '869234051234568', 'ACTIVE',
         NOW(), NOW()
       )`,
      [loanDealerAId, loanDealerAAccNo, customerDealerAId, dealerAId]
    );

    // Add 12 EMI installments for Loan 1
    for (let i = 1; i <= 12; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i * 30);
      const dueDateStr = d.toISOString().split('T')[0];

      await queryPostgres(
        `INSERT INTO emi_installments (
           id, loan_id, customer_id, installment_number, due_date,
           principal_component, interest_component, expected_amount, paid_amount,
           remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           4166.67, 833.33, 5000.00, 0.00,
           5000.00, 0.00, 'UPCOMING', 0, NOW(), NOW()
         )`,
        [uuidv4(), loanDealerAId, customerDealerAId, i, dueDateStr]
      );
    }

    // 8. Create Loan 2 for Customer 2 (Direct Customer, Apple iPhone 15 device, no dealer)
    loanDirectId = uuidv4();
    loanDirectAccNo = `LN_${runId}_DIR`;
    await queryPostgres(
      `INSERT INTO loans (
         id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
         annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
         emi_amount, total_interest, total_payable, total_paid, outstanding_balance,
         disbursement_date, first_emi_date, maturity_date, status,
         device_brand, device_model, device_name, imei1, imei2, device_status,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, NULL, 75000.00, 15000.00, 60000.00,
         12.00, 'FLAT_RATE', 12, 'MONTHLY', 12,
         6000.00, 12000.00, 72000.00, 0.00, 72000.00,
         CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE + INTERVAL '365 days', 'ACTIVE',
         'Apple', 'iPhone 15 Pro', 'Apple iPhone 15 Pro 128GB', '359123059876543', NULL, 'ACTIVE',
         NOW(), NOW()
       )`,
      [loanDirectId, loanDirectAccNo, customerDirectId]
    );

    // Add 12 EMI installments for Loan 2
    for (let i = 1; i <= 12; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i * 30);
      const dueDateStr = d.toISOString().split('T')[0];

      await queryPostgres(
        `INSERT INTO emi_installments (
           id, loan_id, customer_id, installment_number, due_date,
           principal_component, interest_component, expected_amount, paid_amount,
           remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           5000.00, 1000.00, 6000.00, 0.00,
           6000.00, 0.00, 'UPCOMING', 0, NOW(), NOW()
         )`,
        [uuidv4(), loanDirectId, customerDirectId, i, dueDateStr]
      );
    }
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  describe('Part 1: Customer Financing & Financed Device Visibility', () => {
    it('1. Customer Profile returns financed device specs and resolves Dealer Financing Source', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customerDealerAId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const customer = res.body.data.customer;
      const loans = res.body.data.loans;
      expect(customer.id).toBe(customerDealerAId);
      expect(loans).toBeDefined();
      expect(loans.length).toBeGreaterThan(0);

      const loan = loans[0];
      expect(loan.id).toBe(loanDealerAId);
      expect(loan.deviceBrand).toBe('Samsung');
      expect(loan.deviceModel).toBe('Galaxy S24 Ultra');
      expect(loan.deviceName).toContain('Samsung Galaxy S24 Ultra');
      expect(loan.imei1).toBe('869234051234567');
      expect(loan.imei2).toBe('869234051234568');
      expect(loan.deviceStatus).toBe('ACTIVE');

      // Financing source must be Dealer with store name
      expect(loan.financingSource).toBe('DEALER');
      expect(loan.dealerStoreName).toBe(`Dadri Tech Hub ${runId}`);
      expect(loan.pendingAmount).toBeGreaterThan(0);
    });

    it('2. Customer Profile returns Direct Customer financing source for direct loans without dealer', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customerDirectId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const loans = res.body.data.loans;
      expect(loans.length).toBeGreaterThan(0);

      const loan = loans[0];
      expect(loan.deviceBrand).toBe('Apple');
      expect(loan.deviceModel).toBe('iPhone 15 Pro');
      expect(loan.financingSource).toBe('DIRECT');
      expect(loan.dealerStoreName).toBeNull();
    });
  });

  describe('Part 2: Financed Devices Registry Endpoint & RLAC', () => {
    it('3. Admin can list all financed devices across stores and direct customers', async () => {
      const res = await request(app)
        .get('/api/v1/loans/devices')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = Array.isArray(res.body.data) ? res.body.data : res.body.data.items;
      expect(items).toBeDefined();

      const deviceA = items.find((d: any) => d.loanId === loanDealerAId);
      expect(deviceA).toBeDefined();
      expect(deviceA.deviceBrand).toBe('Samsung');
      expect(deviceA.financingSource).toBe('DEALER');
      expect(deviceA.dealerStoreName).toContain('Dadri Tech Hub');
      expect(deviceA.customerName).toBe('Amit Kumar');

      const deviceDirect = items.find((d: any) => d.loanId === loanDirectId);
      expect(deviceDirect).toBeDefined();
      expect(deviceDirect.deviceBrand).toBe('Apple');
      expect(deviceDirect.financingSource).toBe('DIRECT');
    });

    it('4. Dealer A can only view financed devices originated from Dealer A', async () => {
      const res = await request(app)
        .get('/api/v1/loans/devices')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(200);
      const items = Array.isArray(res.body.data) ? res.body.data : res.body.data.items;

      // Dealer A must see Loan 1
      const deviceA = items.find((d: any) => d.loanId === loanDealerAId);
      expect(deviceA).toBeDefined();

      // Dealer A must NOT see Direct Loan or other dealer's devices
      const deviceDirect = items.find((d: any) => d.loanId === loanDirectId);
      expect(deviceDirect).toBeUndefined();
    });

    it('5. Dealer B sees empty device list for Dealer A loans', async () => {
      const res = await request(app)
        .get('/api/v1/loans/devices')
        .set('Authorization', `Bearer ${dealerBToken}`);

      expect(res.status).toBe(200);
      const items = Array.isArray(res.body.data) ? res.body.data : res.body.data.items;
      const deviceA = items.find((d: any) => d.loanId === loanDealerAId);
      expect(deviceA).toBeUndefined();
    });
  });

  describe('Part 3 & 4: Dealer EMI Payment Recording & RLAC Enforcement', () => {
    it('6. Dealer A successfully records EMI payment for their own store loan', async () => {
      const paymentAmount = 5000.00;
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          loanId: loanDealerAId,
          customerId: customerDealerAId,
          amount: paymentAmount,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.DEALER,
          dealerId: dealerAId,
          referenceNumber: `REC_CASH_${runId}`,
          notes: 'Collected at store counter',
          idempotencyKey: `DEALER_PAY_${runId}_1`,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.receiptNumber).toBeDefined();
      expect(res.body.data.amountCollected).toBe(paymentAmount);
      expect(res.body.data.collectionSource).toBe(CollectionSource.DEALER);
      expect(res.body.data.dealerId).toBe(dealerAId);

      // Verify loan outstanding decreased
      const loanRes = await request(app)
        .get(`/api/v1/loans/${loanDealerAId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(Number(loanRes.body.data.total_paid || loanRes.body.data.totalPaid)).toBe(paymentAmount);
      expect(Number(loanRes.body.data.outstanding_balance || loanRes.body.data.outstandingBalance)).toBe(55000.00);

      // Verify dealer collections ledger reflects this collection
      const ledgerRes = await request(app)
        .get(`/api/v1/dealer-collections?dealerId=${dealerAId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(ledgerRes.status).toBe(200);
      const rec = ledgerRes.body.data.records.find((r: any) => r.loanId === loanDealerAId);
      expect(rec).toBeDefined();
      expect(Number(rec.amount)).toBe(paymentAmount);
      expect(rec.status).toBe('SUCCESS');
    });

    it('7. RLAC: Dealer B attempting to record payment for Dealer A loan returns 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealerBToken}`)
        .send({
          loanId: loanDealerAId,
          customerId: customerDealerAId,
          amount: 5000.00,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.DEALER,
          dealerId: dealerBId,
          idempotencyKey: `FORBIDDEN_PAY_${runId}_B`,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('not authorized to collect payments for this loan account');
    });

    it('8. RLAC: Dealer A attempting to record payment for Direct Customer loan returns 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          loanId: loanDirectId,
          customerId: customerDirectId,
          amount: 6000.00,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.DEALER,
          dealerId: dealerAId,
          idempotencyKey: `FORBIDDEN_DIRECT_PAY_${runId}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('not authorized to collect payments for this loan account');
    });

    it('9. RLAC: Dealer A supplying forged dealerId of Dealer B is rejected with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          loanId: loanDealerAId,
          customerId: customerDealerAId,
          amount: 5000.00,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.DEALER,
          dealerId: dealerBId, // Forged
          idempotencyKey: `FORGED_DEALER_PAY_${runId}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('cannot record payments on behalf of another dealer');
    });
  });

  describe('Part 5 & 6: Super Admin Payment & Penalty Allocation Waterfall', () => {
    it('10. Super Admin records payment allocating to penalty first according to waterfall', async () => {
      // First, add late penalty to first installment of direct loan
      const emiRes = await queryPostgres(
        `SELECT id FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC LIMIT 1`,
        [loanDirectId]
      );
      const firstEmiId = emiRes.rows[0].id;

      await queryPostgres(
        `UPDATE emi_installments SET penalty_amount = 500.00 WHERE id = $1`,
        [firstEmiId]
      );

      // Super Admin records partial payment of ₹2,500
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: loanDirectId,
          emiId: firstEmiId,
          customerId: customerDirectId,
          amount: 2500.00,
          paymentMode: PaymentMode.UPI,
          collectionSource: CollectionSource.DIRECT_CUSTOMER,
          referenceNumber: `UPI_REF_${runId}`,
          idempotencyKey: `ADMIN_PAY_WATERFALL_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.amountCollected).toBe(2500.00);

      // Inspect updated installment: penalty (500) paid first, remaining 2000 paid towards EMI
      const updatedEmi = await queryPostgres(
        `SELECT penalty_amount, paid_amount, remaining_amount FROM emi_installments WHERE id = $1`,
        [firstEmiId]
      );
      const emi = updatedEmi.rows[0];
      expect(Number(emi.penalty_amount)).toBe(0); // Penalty cleared first
      expect(Number(emi.paid_amount)).toBe(2000.00);
      expect(Number(emi.remaining_amount)).toBe(4000.00); // 6000 - 2000 = 4000 remaining
    });
  });

  describe('Group B: Date Formatting & Numeric Normalization Helpers', () => {
    it('11. formatDateDDMMYYYY formats ISO strings correctly without UTC shifting', () => {
      expect(formatDateDDMMYYYY('2026-10-07')).toBe('07/10/2026');
      expect(formatDateDDMMYYYY('2026-01-05')).toBe('05/01/2026');
      expect(formatDateDDMMYYYY('2026-12-31')).toBe('31/12/2026');
      expect(formatDateDDMMYYYY('2026-10-07T00:00:00.000Z')).toBe('07/10/2026');
    });

    it('12. normalizeNumericLeadingZeros strips leading zeros while keeping decimals and single zeros', () => {
      expect(normalizeNumericLeadingZeros('02345')).toBe('2345');
      expect(normalizeNumericLeadingZeros('000500')).toBe('500');
      expect(normalizeNumericLeadingZeros('000')).toBe('0');
      expect(normalizeNumericLeadingZeros('001.50')).toBe('1.50');
      expect(normalizeNumericLeadingZeros('000.50')).toBe('0.50');
      expect(normalizeNumericLeadingZeros('000.00')).toBe('0.00');
      expect(normalizeNumericLeadingZeros('0')).toBe('0');
      expect(normalizeNumericLeadingZeros('100')).toBe('100');
    });
  });
});
