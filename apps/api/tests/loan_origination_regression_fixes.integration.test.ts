import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import {
  UserRole,
  InterestMethod,
  RepaymentFrequency,
  ALLOWED_MONTHLY_INTEREST_RATES,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Loan Origination Regressions: Allowed Rates (4%, 5%, 6%), Method & Frequency Enforcement', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  let superAdminToken: string;
  let adminToken: string;
  let dealerToken: string;
  let dealerId: string;
  let customerId: string;
  let existingLoanId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Seed Dealer
    dealerId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES ($1, $2, 'Target Test Store', 'Dealer Partner', $3, 'Delhi', 'Shop 77, Lajpat Nagar', 'ACTIVE', NOW(), NOW())`,
      [dealerId, `DLR_${runId}`, `9871${numId}`]
    );

    // 2. Seed Users
    const superAdminId = uuidv4();
    const adminId = uuidv4();
    const dealerUserId = uuidv4();

    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, 'Super Admin User', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $8, 'Admin User', 'ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($9, $10, $11, $12, 'Dealer User', 'DEALER', $13, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, `sa_${runId}@crm.test`, `9801${numId}1`, hash,
        adminId, `admin_${runId}@crm.test`, `9801${numId}2`, hash,
        dealerUserId, `dealer_${runId}@crm.test`, `9801${numId}3`, hash, dealerId,
      ]
    );

    // Get Auth Tokens
    const saLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `sa_${runId}@crm.test`, password: 'Password@123' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `admin_${runId}@crm.test`, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const dealerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `dealer_${runId}@crm.test`, password: 'Password@123' });
    dealerToken = dealerLogin.body.data.tokens.accessToken;

    // 3. Seed Customer
    customerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, 'Regression Test Borrower', $3, '10 Civil Lines', 'Delhi', 'Delhi', '110054', 'NORTH_DELHI', NOW(), NOW())`,
      [customerId, `CUST_${runId}`, `9822${numId}`]
    );

    // 4. Seed an Existing Historical Loan with legacy rate 1.0% to ensure existing loans are unaffected
    existingLoanId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
         id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
         annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
         total_installments, emi_amount, total_interest, total_payable, total_paid,
         outstanding_balance, status, disbursement_date, first_emi_date, maturity_date,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, 10000, 2000, 8000,
         1.0, 'FLAT_RATE', 6, 'MONTHLY',
         6, 1413.33, 480, 8480, 0,
         8480, 'ACTIVE', '2026-01-01', '2026-02-01', '2026-07-01',
         NOW(), NOW()
       )`,
      [existingLoanId, `LN_${runId}_HIST`, customerId]
    );
  });

  const getErrMsg = (res: any) =>
    res.body.error?.message || (typeof res.body.error === 'string' ? res.body.error : JSON.stringify(res.body));

  describe('1. Server-side Calculation Preview (/api/v1/loans/calculate-preview)', () => {
    test.each([4, 5, 6])('Accepts allowed monthly interest rate: %p% per month', async (rate) => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: rate,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-14',
          firstEmiDate: '2026-11-14',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.monthlyInterestRate).toBe(rate);
      expect(res.body.data.netDisbursedAmount).toBe(10000);
      expect(res.body.data.schedule.length).toBe(6);
    });

    test.each([1.2, 1, 3.5, 7, 0, 12])('Rejects unsupported monthly interest rate: %p% with 400 Bad Request', async (rate) => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: rate,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-14',
          firstEmiDate: '2026-11-14',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrMsg(res)).toMatch(/4%,\s*5%,\s*or\s*6%/i);
    });

    test('Rejects non-flat interest method (REDUCING_BALANCE) with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: 4,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-14',
          firstEmiDate: '2026-11-14',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrMsg(res)).toMatch(/FLAT_RATE|Flat Rate/i);
    });

    test('Rejects non-monthly installment frequency with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: 4,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.WEEKLY,
          disbursementDate: '2026-10-14',
          firstEmiDate: '2026-11-14',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrMsg(res)).toMatch(/MONTHLY|Monthly/i);
    });
  });

  describe('2. Loan Origination API (/api/v1/loans)', () => {
    test.each([1.2, 1, 3.5, 7])('Rejects loan creation with unsupported rate: %p%', async (rate) => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          principalAmount: 20000,
          downPayment: 5000,
          annualInterestRate: rate,
          monthlyInterestRate: rate,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-14',
          firstEmiDate: '2026-11-14',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrMsg(res)).toMatch(/4%,\s*5%,\s*or\s*6%/i);
    });

    test('Rejects loan creation with REDUCING_BALANCE or non-monthly frequency', async () => {
      const resMethod = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          principalAmount: 20000,
          downPayment: 5000,
          annualInterestRate: 4,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-14',
          firstEmiDate: '2026-11-14',
        });
      expect(resMethod.status).toBe(400);
      expect(getErrMsg(resMethod)).toMatch(/FLAT_RATE|Flat Rate/i);

      const resFreq = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          principalAmount: 20000,
          downPayment: 5000,
          annualInterestRate: 4,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.DAILY,
          disbursementDate: '2026-10-14',
          firstEmiDate: '2026-11-14',
        });
      expect(resFreq.status).toBe(400);
      expect(getErrMsg(resFreq)).toMatch(/MONTHLY|Monthly/i);
    });

    test('Creates new loan successfully with allowed 5% monthly rate and returns monthlyInterestRate', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          principalAmount: 25000,
          downPayment: 5000,
          annualInterestRate: 5,
          monthlyInterestRate: 5,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-14',
          firstEmiDate: '2026-11-14',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.monthlyInterestRate).toBe(5);
      expect(res.body.data.annualInterestRate).toBe(5);
    });

    test('GET /api/v1/loans returns monthlyInterestRate for loan list', async () => {
      const res = await request(app)
        .get('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const found = res.body.data.find((l: any) => l.customerId === customerId);
      expect(found).toBeDefined();
      expect(found.monthlyInterestRate).toBeDefined();
    });
  });

  describe('3. Customer Onboarding API (/api/v1/customers/onboard)', () => {
    test.each([1.2, 1, 3.5, 7])('Rejects onboarding with unsupported monthly rate: %p%', async (rate) => {
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: `Onboard Reg Test ${Date.now()}`,
            primaryPhone: `9833${Math.floor(100000 + Math.random() * 900000)}`,
            addressLine1: '15 Civil Road',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
            areaRoute: 'CENTRAL_DELHI',
          },
          loan: {
            principalAmount: 30000,
            downPayment: 5000,
            annualInterestRate: rate,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-14',
            firstEmiDate: '2026-11-14',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrMsg(res)).toMatch(/4%,\s*5%,\s*or\s*6%/i);
    });

    test('Rejects onboarding with non-flat method or non-monthly frequency', async () => {
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: `Onboard Reg Test ${Date.now()}`,
            primaryPhone: `9834${Math.floor(100000 + Math.random() * 900000)}`,
            addressLine1: '15 Civil Road',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
            areaRoute: 'CENTRAL_DELHI',
          },
          loan: {
            principalAmount: 30000,
            downPayment: 5000,
            annualInterestRate: 4,
            interestCalcMethod: InterestMethod.REDUCING_BALANCE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-14',
            firstEmiDate: '2026-11-14',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrMsg(res)).toMatch(/FLAT_RATE|Flat Rate/i);
    });

    test('Onboards customer and originates loan with allowed 4% monthly flat rate', async () => {
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: `Onboard Reg Test Success ${Date.now()}`,
            primaryPhone: `9835${Math.floor(100000 + Math.random() * 900000)}`,
            addressLine1: '15 Civil Road',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
            areaRoute: 'CENTRAL_DELHI',
          },
          loan: {
            principalAmount: 30000,
            downPayment: 5000,
            annualInterestRate: 4,
            monthlyInterestRate: 4,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-14',
            firstEmiDate: '2026-11-14',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.loan.monthlyInterestRate).toBe(4);
    });
  });

  describe('4. Historical Loans & Schedule Integrity', () => {
    test('Existing historical loan record remains unmodified with original rate and schedule', async () => {
      const res = await request(app)
        .get(`/api/v1/loans/${existingLoanId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Legacy rate is preserved
      expect(Number(res.body.data.annualInterestRate)).toBe(1.0);
      expect(Number(res.body.data.monthlyInterestRate)).toBe(1.0);
      expect(Number(res.body.data.principalAmount)).toBe(10000);
      expect(Number(res.body.data.downPayment)).toBe(2000);
    });
  });
});
