import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import {
  UserRole,
  PaymentMode,
  CollectionSource,
  PaymentStatus,
  formatDateDDMMYYYY,
  InterestMethod,
  RepaymentFrequency,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Dealer Payment Approval, Address Validation, and System Integrations', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  let superAdminToken: string;
  let adminToken: string;
  let dealer1Token: string;
  let dealer2Token: string;
  let agentToken: string;

  let dealer1Id: string;
  let dealer2Id: string;

  let customer1Id: string;
  let loan1Id: string;
  let customer2Id: string;
  let loan2Id: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Seed Dealers
    dealer1Id = uuidv4();
    dealer2Id = uuidv4();

    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES 
         ($1, $2, 'Premier Mobiles', 'Owner One', $3, 'Delhi', 'Shop 101, Lajpat Nagar', 'ACTIVE', NOW(), NOW()),
         ($4, $5, 'Apex Electronics', 'Owner Two', $6, 'Noida', 'Shop 202, Sector 18', 'ACTIVE', NOW(), NOW())`,
      [
        dealer1Id, `DLR_${runId}_1`, `9811${numId}1`,
        dealer2Id, `DLR_${runId}_2`, `9811${numId}2`,
      ]
    );

    // 2. Seed Users
    const superAdminId = uuidv4();
    const adminId = uuidv4();
    const dealer1UserId = uuidv4();
    const dealer2UserId = uuidv4();
    const agentUserId = uuidv4();

    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'Super Admin User', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $4, 'Admin Manager', 'ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($8, $9, $10, $4, 'Dealer One User', 'DEALER', $11, 'ACTIVE', NOW(), NOW()),
         ($12, $13, $14, $4, 'Dealer Two User', 'DEALER', $15, 'ACTIVE', NOW(), NOW()),
         ($16, $17, $18, $4, 'Recovery Agent User', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, `sa_${runId}@test.com`, `9821${numId}1`, hash,
        adminId, `admin_${runId}@test.com`, `9821${numId}2`,
        dealer1UserId, `dealer1_${runId}@test.com`, `9821${numId}3`, dealer1Id,
        dealer2UserId, `dealer2_${runId}@test.com`, `9821${numId}4`, dealer2Id,
        agentUserId, `agent_${runId}@test.com`, `9821${numId}5`,
      ]
    );

    // Login users
    const [saLogin, adminLogin, d1Login, d2Login, agLogin] = await Promise.all([
      request(app).post('/api/v1/auth/login').send({ email: `sa_${runId}@test.com`, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: `admin_${runId}@test.com`, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: `dealer1_${runId}@test.com`, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: `dealer2_${runId}@test.com`, password: 'Password@123' }),
      request(app).post('/api/v1/auth/login').send({ email: `agent_${runId}@test.com`, password: 'Password@123' }),
    ]);

    superAdminToken = saLogin.body.data.tokens.accessToken;
    adminToken = adminLogin.body.data.tokens.accessToken;
    dealer1Token = d1Login.body.data.tokens.accessToken;
    dealer2Token = d2Login.body.data.tokens.accessToken;
    agentToken = agLogin.body.data.tokens.accessToken;

    // 3. Onboard Customer 1 under Dealer 1
    const onb1 = await request(app)
      .post('/api/v1/customers/onboard')
      .set('Authorization', `Bearer ${dealer1Token}`)
      .send({
        customer: {
          fullName: `Borrower Alpha ${runId}`,
          primaryPhone: `9831${numId}1`,
          addressLine1: 'Flat 101, Palm Court, Lajpat Nagar',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110024',
          areaRoute: 'CENTRAL_DELHI',
        },
        loan: {
          principalAmount: 20000,
          downPayment: 5000,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-06',
          dealerId: dealer1Id,
        },
      });

    expect(onb1.status).toBe(201);
    customer1Id = onb1.body.data.customer.id;
    loan1Id = onb1.body.data.loan.id;

    // Approve and disburse Loan 1 so it's active
    await request(app).post(`/api/v1/loans/${loan1Id}/approve`).set('Authorization', `Bearer ${adminToken}`).send();
    await request(app).post(`/api/v1/loans/${loan1Id}/disburse`).set('Authorization', `Bearer ${adminToken}`).send();

    // 4. Onboard Customer 2 under Dealer 2
    const onb2 = await request(app)
      .post('/api/v1/customers/onboard')
      .set('Authorization', `Bearer ${dealer2Token}`)
      .send({
        customer: {
          fullName: `Borrower Beta ${runId}`,
          primaryPhone: `9831${numId}2`,
          addressLine1: 'House 42, Sector 18',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'NOIDA_SEC_18',
        },
        loan: {
          principalAmount: 30000,
          downPayment: 6000,
          annualInterestRate: 5.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-06',
          dealerId: dealer2Id,
        },
      });

    expect(onb2.status).toBe(201);
    customer2Id = onb2.body.data.customer.id;
    loan2Id = onb2.body.data.loan.id;

    await request(app).post(`/api/v1/loans/${loan2Id}/approve`).set('Authorization', `Bearer ${adminToken}`).send();
    await request(app).post(`/api/v1/loans/${loan2Id}/disburse`).set('Authorization', `Bearer ${adminToken}`).send();
  });

  describe('Requirement 1: Dealer-Recorded EMI Payment & Admin Approval Workflow', () => {
    let pendingPaymentId: string;
    let initialOutstandingBalance: number;

    beforeAll(async () => {
      const loanRes = await request(app).get(`/api/v1/loans/${loan1Id}`).set('Authorization', `Bearer ${adminToken}`);
      initialOutstandingBalance = Number(loanRes.body.data.outstanding_balance || loanRes.body.data.outstandingBalance);
    });

    test('1.1 Dealer records payment -> enters PENDING_VERIFICATION and creates notification', async () => {
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 3100.0,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.DEALER,
          dealerId: dealer1Id,
          referenceNumber: `CASH_${runId}_01`,
          notes: 'Customer paid cash at store counter',
          idempotencyKey: `dpay_${runId}_01`,
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.data.status).toBe(PaymentStatus.PENDING_VERIFICATION);
      expect(payRes.body.data.receiptNumber).toBeDefined();
      pendingPaymentId = payRes.body.data.paymentId || payRes.body.data.id;

      // Verify in-app notifications created for admins
      const notifs = await queryPostgres(
        `SELECT * FROM notifications WHERE type = 'DEALER_APPROVAL_REQUIRED' AND metadata->>'paymentId' = $1`,
        [pendingPaymentId]
      );
      expect(notifs.rows.length).toBeGreaterThan(0);
    });

    test('1.2 Loan balance and total_paid are NOT altered while payment is pending verification', async () => {
      const loanRes = await request(app).get(`/api/v1/loans/${loan1Id}`).set('Authorization', `Bearer ${adminToken}`);
      const currentOutstanding = Number(loanRes.body.data.outstanding_balance || loanRes.body.data.outstandingBalance);
      const totalPaid = Number(loanRes.body.data.total_paid || loanRes.body.data.totalPaid);

      expect(currentOutstanding).toBe(initialOutstandingBalance);
      expect(totalPaid).toBe(0);
    });

    test('1.3 Dealer CANNOT approve their own payment -> 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send();

      expect(res.status).toBe(403);
    });

    test('1.4 Collection Agent CANNOT approve payments -> 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send();

      expect(res.status).toBe(403);
    });

    test('1.5 Authorized Admin approves payment -> status SUCCESS and loan balance updated', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(PaymentStatus.SUCCESS);

      // Verify loan outstanding decreased and total_paid increased
      const loanRes = await request(app).get(`/api/v1/loans/${loan1Id}`).set('Authorization', `Bearer ${adminToken}`);
      const updatedOutstanding = Number(loanRes.body.data.outstanding_balance || loanRes.body.data.outstandingBalance);
      const totalPaid = Number(loanRes.body.data.total_paid || loanRes.body.data.totalPaid);

      expect(totalPaid).toBe(3100.0);
      expect(updatedOutstanding).toBe(initialOutstandingBalance - 3100.0);
    });

    test('1.6 Repeated approval call is idempotent and does not double-allocate', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(PaymentStatus.SUCCESS);

      // Check balance again: must remain exactly unchanged
      const loanRes = await request(app).get(`/api/v1/loans/${loan1Id}`).set('Authorization', `Bearer ${adminToken}`);
      const currentOutstanding = Number(loanRes.body.data.outstanding_balance || loanRes.body.data.outstandingBalance);
      const totalPaid = Number(loanRes.body.data.total_paid || loanRes.body.data.totalPaid);

      expect(totalPaid).toBe(3100.0);
      expect(currentOutstanding).toBe(initialOutstandingBalance - 3100.0);
    });

    test('1.7 Authorized Admin can reject a pending dealer payment with reason', async () => {
      // Record a second payment
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 3100.0,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.DEALER,
          dealerId: dealer1Id,
          referenceNumber: `CASH_${runId}_REJECT`,
          notes: 'Questionable cash submission',
          idempotencyKey: `dpay_${runId}_reject`,
        });

      expect(payRes.status).toBe(201);
      const rejectedPayId = payRes.body.data.paymentId || payRes.body.data.id;

      // Admin rejects
      const rejRes = await request(app)
        .post(`/api/v1/payments/${rejectedPayId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cash not deposited into company branch' });

      expect(rejRes.status).toBe(200);
      expect(rejRes.body.data.status).toBe(PaymentStatus.REJECTED);

      // Verify rejected payment cannot be approved
      const tryApprove = await request(app)
        .post(`/api/v1/payments/${rejectedPayId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send();

      expect(tryApprove.status).toBe(400);

      // Verify loan balance is NOT changed by rejected payment
      const loanRes = await request(app).get(`/api/v1/loans/${loan1Id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(Number(loanRes.body.data.total_paid || loanRes.body.data.totalPaid)).toBe(3100.0);
    });

    test('1.8 Dealer B CANNOT record payment for Dealer A customer loan -> 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealer2Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 1000.0,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.DEALER,
          dealerId: dealer2Id,
          idempotencyKey: `dpay_${runId}_cross`,
        });

      expect(res.status).toBe(403);
    });

    test('1.9 Direct customer payment bypasses dealer approval workflow immediately', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: loan2Id,
          customerId: customer2Id,
          amount: 2500.0,
          paymentMode: PaymentMode.UPI,
          collectionSource: CollectionSource.DIRECT_CUSTOMER,
          referenceNumber: `UPI_DIRECT_${runId}`,
          idempotencyKey: `dir_pay_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(PaymentStatus.SUCCESS);
    });
  });

  describe('Requirement 2: Address Validation & Alias Support', () => {
    test('2.1 Customer onboarding succeeds when using address alias address_line1', async () => {
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: `Alias Customer 1 ${runId}`,
            primaryPhone: `9841${numId}1`,
            address_line1: 'Building 12, Cyber Park',
            city: 'Gurgaon',
            state: 'Haryana',
            pincode: '122002',
            areaRoute: 'GURGAON_CYBER',
          },
          loan: {
            principalAmount: 25000,
            downPayment: 5000,
            annualInterestRate: 4.0,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-06',
            firstEmiDate: '2026-11-06',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.customer.addressLine1).toBe('Building 12, Cyber Park');
    });

    test('2.2 Customer onboarding succeeds when using address alias address', async () => {
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: `Alias Customer 2 ${runId}`,
            primaryPhone: `9841${numId}2`,
            address: 'Shop 45, Mall Road Market',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110054',
            areaRoute: 'NORTH_DELHI',
          },
          loan: {
            principalAmount: 25000,
            downPayment: 5000,
            annualInterestRate: 4.0,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-06',
            firstEmiDate: '2026-11-06',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.customer.addressLine1).toBe('Shop 45, Mall Road Market');
    });

    test('2.3 Missing or whitespace-only addressLine1 is rejected with 422', async () => {
      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customer: {
            fullName: `Invalid Customer ${runId}`,
            primaryPhone: `9841${numId}3`,
            addressLine1: '   ',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110054',
            areaRoute: 'NORTH_DELHI',
          },
          loan: {
            principalAmount: 25000,
            downPayment: 5000,
            annualInterestRate: 4.0,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-06',
            firstEmiDate: '2026-11-06',
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Requirement 3: Date Formatting Tests', () => {
    test('3.1 formatDateDDMMYYYY produces zero-padded DD/MM/YYYY without timezone drift', () => {
      expect(formatDateDDMMYYYY('2026-10-06')).toBe('06/10/2026');
      expect(formatDateDDMMYYYY('2026-01-09')).toBe('09/01/2026');
      expect(formatDateDDMMYYYY('2026-02-28')).toBe('28/02/2026');
      expect(formatDateDDMMYYYY('2026-10-06T00:00:00.000Z')).toBe('06/10/2026');
    });
  });

  describe('Requirement 5: Manually Selectable EMI Start Date & Monthly Flat Interest', () => {
    test('5.1 First installment uses manually selected firstEmiDate exactly', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-15',
          firstEmiDate: '2026-11-20',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.firstEmiDate).toBe('2026-11-20');
      expect(res.body.data.schedule[0].dueDate).toBe('2026-11-20');
      expect(res.body.data.schedule[1].dueDate).toBe('2026-12-20');
      expect(res.body.data.schedule[2].dueDate).toBe('2027-01-20');
    });

    test('5.2 Monthly flat interest: 10,000 principal at 4% monthly flat for 6 months = 400/mo interest, 2,400 total interest', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-06',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.totalInterest).toBe(2400);
      expect(res.body.data.totalPayable).toBe(12400);
      // Monthly installment = 12400 / 6 = 2066.67
      expect(res.body.data.emiAmount).toBe(2066.67);
    });
  });
});
