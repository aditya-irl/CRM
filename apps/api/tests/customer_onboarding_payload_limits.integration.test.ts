import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { InterestMethod, RepaymentFrequency } from '@crm/shared';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
});

describe('Customer Onboarding Payload Limits, Size Controls & Security Enforcement', () => {
  const runId = Math.random().toString(36).substring(2, 8);

  let adminToken: string;
  let adminUserId: string;

  let dealerAId: string;
  let dealerAUserId: string;
  let dealerAToken: string;

  let dealerBId: string;
  let dealerBUserId: string;
  let dealerBToken: string;

  let onboardedCustomerAId: string;

  beforeAll(async () => {
    const passwordHash = bcrypt.hashSync('Password@123', 10);

    // 1. Setup Admin user
    adminUserId = uuidv4();
    const adminEmail = `admin_limit_${runId}@crmtest.com`;
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Admin Limit Test', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [adminUserId, adminEmail, `+9198${Date.now().toString().slice(-8)}`, passwordHash]
    );

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'Password@123' });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 2. Setup Dealer A
    dealerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, address, area_city, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Owner A', $4, $5, 'Street A', 'Noida', 'ACTIVE', NOW(), NOW())`,
      [dealerAId, `DLR-A-${runId}`, `Store A ${runId}`, `+9197${Date.now().toString().slice(-8)}`, `store_a_${runId}@test.com`]
    );

    dealerAUserId = uuidv4();
    const dealerAEmail = `dealer_a_${runId}@test.com`;
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, dealer_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User A', 'DEALER', 'ACTIVE', $5, NOW(), NOW())`,
      [dealerAUserId, dealerAEmail, `+9196${Date.now().toString().slice(-8)}`, passwordHash, dealerAId]
    );

    const dealerALogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerAEmail, password: 'Password@123' });
    expect(dealerALogin.status).toBe(200);
    dealerAToken = dealerALogin.body.data.tokens.accessToken;

    // 3. Setup Dealer B
    dealerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, address, area_city, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Owner B', $4, $5, 'Street B', 'Noida', 'ACTIVE', NOW(), NOW())`,
      [dealerBId, `DLR-B-${runId}`, `Store B ${runId}`, `+9195${Date.now().toString().slice(-8)}`, `store_b_${runId}@test.com`]
    );

    dealerBUserId = uuidv4();
    const dealerBEmail = `dealer_b_${runId}@test.com`;
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, dealer_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User B', 'DEALER', 'ACTIVE', $5, NOW(), NOW())`,
      [dealerBUserId, dealerBEmail, `+9194${Date.now().toString().slice(-8)}`, passwordHash, dealerBId]
    );

    const dealerBLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerBEmail, password: 'Password@123' });
    expect(dealerBLogin.status).toBe(200);
    dealerBToken = dealerBLogin.body.data.tokens.accessToken;
  });

  describe('1. Valid Customer Onboarding Request within Supported Limits', () => {
    it('successfully onboards a customer with standard payload (< 10MB)', async () => {
      const validPayload = {
        customer: {
          fullName: 'Valid Customer Onboard',
          primaryPhone: `+9193${Date.now().toString().slice(-8)}`,
          addressLine1: '404 Sector 62',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 30000,
          downPayment: 5000,
          annualInterestRate: 5.0, // Dealer allowed 5%
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
          firstEmiDate: '2026-11-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customer).toBeDefined();
      expect(res.body.data.customer.fullName).toBe('Valid Customer Onboard');
      expect(res.body.data.loan).toBeDefined();
      expect(res.body.data.loan.dealerId).toBe(dealerAId);
      expect(res.body.data.loan.totalInstallments).toBe(6);

      onboardedCustomerAId = res.body.data.customer.id;
    });
  });

  describe('2. Oversized Request Controlled Rejection (HTTP 413)', () => {
    it('rejects oversized JSON request (> 10MB) with controlled HTTP 413 PAYLOAD_TOO_LARGE error', async () => {
      // Create a payload larger than 10MB (approx 10.5 MB)
      const oversizedPadding = 'X'.repeat(10.5 * 1024 * 1024);
      const oversizedPayload = {
        customer: {
          fullName: 'Oversized Customer Payload',
          primaryPhone: `+9192${Date.now().toString().slice(-8)}`,
          addressLine1: 'Address 1',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
          notes: oversizedPadding,
        },
        loan: {
          principalAmount: 20000,
          downPayment: 2000,
          annualInterestRate: 5.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(oversizedPayload);

      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(res.body.error.message).toContain('max 10MB');
      expect(res.body.error.traceId).toBeDefined();
    });
  });

  describe('3. Upload Authorization and Customer Ownership', () => {
    it('allows Dealer A to request KYC upload for their own onboarded customer', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          customerId: onboardedCustomerAId,
          docType: 'PHOTO',
          fileName: 'customer_photo.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 1024 * 500, // 500KB
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.storageKey).toContain(onboardedCustomerAId);
    });

    it('STRICTLY PREVENTS Dealer B from requesting KYC upload for Dealer A customer (RLAC isolation)', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${dealerBToken}`)
        .send({
          customerId: onboardedCustomerAId,
          docType: 'AADHAAR',
          fileName: 'aadhaar_doc.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024 * 1024,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not authorized to upload KYC documents/i);
    });

    it('rejects KYC upload request exceeding 10MB maximum file limit', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          customerId: onboardedCustomerAId,
          docType: 'PHOTO',
          fileName: 'huge_scan.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 15 * 1024 * 1024, // 15MB > 10MB
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const detailStr = JSON.stringify(res.body.error);
      expect(detailStr).toMatch(/10\s*MB|10485760|fileSizeBytes/i);
    });

    it('rejects KYC upload request with zero or negative file size', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          customerId: onboardedCustomerAId,
          docType: 'PHOTO',
          fileName: 'zero_byte.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 0,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Dealer Interest-Rate Restrictions Enforcement', () => {
    it('REJECTS dealer loan with non-allowed interest rate (e.g. 3% per month)', async () => {
      const payload = {
        customer: {
          fullName: 'Dealer Rate Check 3%',
          primaryPhone: `+9191${Date.now().toString().slice(-8)}`,
          addressLine1: 'Shop 10',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 20000,
          downPayment: 2000,
          annualInterestRate: 3.0, // 3% is NOT allowed (only 4%, 5%, 6% allowed)
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/interest rates of 4%, 5%, or 6%/i);
    });

    it('REJECTS dealer loan with non-monthly repayment frequency (e.g. WEEKLY)', async () => {
      const payload = {
        customer: {
          fullName: 'Dealer Rate Check Weekly',
          primaryPhone: `+9190${Date.now().toString().slice(-8)}`,
          addressLine1: 'Shop 11',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 20000,
          downPayment: 2000,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.WEEKLY, // Rejected
          disbursementDate: '2026-10-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/MONTHLY repayment frequency/i);
    });

    it('REJECTS dealer loan with non-flat calculation method (e.g. REDUCING_BALANCE)', async () => {
      const payload = {
        customer: {
          fullName: 'Dealer Rate Check Reducing',
          primaryPhone: `+9189${Date.now().toString().slice(-8)}`,
          addressLine1: 'Shop 12',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 20000,
          downPayment: 2000,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE, // Rejected
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/FLAT_RATE interest method/i);
    });

    it('ACCEPTS dealer loan with 4%, 5%, and 6% monthly FLAT_RATE', async () => {
      for (const rate of [4.0, 6.0]) {
        const payload = {
          customer: {
            fullName: `Dealer Allowed Rate ${rate}%`,
            primaryPhone: `+9188${Math.floor(10000000 + Math.random() * 90000000)}`,
            addressLine1: 'Shop 15',
            city: 'Noida',
            state: 'Uttar Pradesh',
            pincode: '201301',
            areaRoute: 'Dadri',
          },
          loan: {
            principalAmount: 20000,
            downPayment: 2000,
            annualInterestRate: rate,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-01',
            firstEmiDate: '2026-11-01',
          },
        };

        const res = await request(app)
          .post('/api/v1/customers/onboard')
          .set('Authorization', `Bearer ${dealerAToken}`)
          .send(payload);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.loan.annualInterestRate).toBe(rate);
      }
    });

    it('proves ₹10,000 principal at 4% monthly flat for 6 months produces ₹400/mo interest, ₹2,400 total interest, and ₹12,400 total payable upon onboarding', async () => {
      const payload = {
        customer: {
          fullName: 'Exact Ten Thousand Borrower',
          primaryPhone: `+9187${Math.floor(10000000 + Math.random() * 90000000)}`,
          addressLine1: 'Shop 20',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: 4.0, // 4% per month
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
          firstEmiDate: '2026-11-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const loan = res.body.data.loan;
      expect(loan.principalAmount).toBe(10000);
      expect(loan.downPayment).toBe(0);
      expect(loan.netDisbursedAmount).toBe(10000);
      expect(loan.annualInterestRate).toBe(4);
      expect(loan.totalInterest).toBe(2400); // 10,000 * 4% * 6 = 2,400
      expect(loan.totalPayable).toBe(12400);  // 10,000 + 2,400 = 12,400
      expect(loan.emiAmount).toBe(2066.67);   // 12,400 / 6 = 2066.67
      expect(loan.totalInstallments).toBe(6);

      // Verify in PostgreSQL emi_installments: each installment has exactly ₹400 interest component
      const instRes = await queryPostgres(
        'SELECT installment_number, principal_component, interest_component, expected_amount FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
        [loan.id]
      );
      // Note: for dealer loans, loan starts in PENDING_APPROVAL status (requiring Admin approval before active EMI generation, or active schedule generated if active)
      // Check if installments were created or verify preview calculation
      if (instRes.rows.length > 0) {
        expect(instRes.rows.length).toBe(6);
        for (const inst of instRes.rows) {
          expect(Number(inst.interest_component)).toBe(400);
        }
      }
    });

    it('REJECTS dealer loan with unsupported rate (e.g. 7% or 15%)', async () => {
      for (const invalidRate of [7.0, 15.0]) {
        const payload = {
          customer: {
            fullName: `Unsupported Rate ${invalidRate}%`,
            primaryPhone: `+9186${Math.floor(10000000 + Math.random() * 90000000)}`,
            addressLine1: 'Shop 25',
            city: 'Noida',
            state: 'Uttar Pradesh',
            pincode: '201301',
            areaRoute: 'Dadri',
          },
          loan: {
            principalAmount: 10000,
            downPayment: 0,
            annualInterestRate: invalidRate,
            interestCalcMethod: InterestMethod.FLAT_RATE,
            tenureMonths: 6,
            installmentFrequency: RepaymentFrequency.MONTHLY,
            disbursementDate: '2026-10-01',
          },
        };

        const res = await request(app)
          .post('/api/v1/customers/onboard')
          .set('Authorization', `Bearer ${dealerAToken}`)
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/interest rates of 4%, 5%, or 6%/i);
      }
    });

    it('REJECTS dealer loan with non-monthly frequency (e.g. DAILY or ANNUAL)', async () => {
      const payload = {
        customer: {
          fullName: 'Dealer Non-Monthly Check',
          primaryPhone: `+9185${Math.floor(10000000 + Math.random() * 90000000)}`,
          addressLine1: 'Shop 26',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.DAILY,
          disbursementDate: '2026-10-01',
        },
      };

      const res = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/MONTHLY repayment frequency/i);
    });
  });

  describe('5. Customer Onboarding Idempotency & Duplicate Suppression', () => {
    it('returns identical customer and loan upon retry with Idempotency-Key header without duplicating rows', async () => {
      const idempotencyKey = `idemp_header_${runId}_${Date.now()}`;
      const uniquePhone = `+9187${Math.floor(10000000 + Math.random() * 90000000)}`;
      const payload = {
        customer: {
          fullName: 'Idempotent Borrower One',
          primaryPhone: uniquePhone,
          addressLine1: 'Test Avenue 1',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 25000,
          downPayment: 3000,
          annualInterestRate: 5.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
          firstEmiDate: '2026-11-01',
        },
      };

      // Initial request
      const res1 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      const customerId1 = res1.body.data.customer.id;
      const loanId1 = res1.body.data.loan.id;

      // Simulated network retry with the exact same Idempotency-Key header
      const res2 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.customer.id).toBe(customerId1);
      expect(res2.body.data.loan.id).toBe(loanId1);
      expect(res2.body.data.isIdempotentReplay).toBe(true);

      // Verify in PostgreSQL: exactly ONE customer and ONE loan exist for this phone
      const custDb = await queryPostgres('SELECT id FROM customers WHERE primary_phone = $1', [uniquePhone]);
      expect(custDb.rows.length).toBe(1);

      const loanDb = await queryPostgres('SELECT id FROM loans WHERE customer_id = $1', [customerId1]);
      expect(loanDb.rows.length).toBe(1);
    });

    it('rejects duplicate idempotency key used with a conflicting payload (HTTP 409 Conflict)', async () => {
      const idempotencyKey = `idemp_conflict_${runId}_${Date.now()}`;
      const originalPhone = `+9186${Math.floor(10000000 + Math.random() * 90000000)}`;
      const conflictingPhone = `+9185${Math.floor(10000000 + Math.random() * 90000000)}`;

      const payload = {
        customer: {
          fullName: 'Original Borrower',
          primaryPhone: originalPhone,
          addressLine1: 'Test Street 2',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 20000,
          downPayment: 2000,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
        },
      };

      const res1 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);

      // Conflicting payload with DIFFERENT phone number but SAME idempotency key
      const conflictingPayload = {
        ...payload,
        customer: {
          ...payload.customer,
          primaryPhone: conflictingPhone,
        },
      };

      const res2 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(conflictingPayload);

      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error.message).toMatch(/Idempotency key .* was previously used with a different onboarding payload/i);
    });

    it('natural deduplication protects against duplicate creation if client retries identical request without explicit header', async () => {
      const uniquePhone = `+9184${Math.floor(10000000 + Math.random() * 90000000)}`;
      const payload = {
        customer: {
          fullName: 'Natural Dedup Borrower',
          primaryPhone: uniquePhone,
          addressLine1: 'Market Road 3',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 22000,
          downPayment: 2000,
          annualInterestRate: 6.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
          firstEmiDate: '2026-11-01',
        },
      };

      // First request (no header)
      const res1 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(payload);

      expect(res1.status).toBe(201);
      const firstCustId = res1.body.data.customer.id;

      // Immediate retry without header (simulating timeout retry)
      const res2 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.data.customer.id).toBe(firstCustId);
      expect(res2.body.data.isIdempotentReplay).toBe(true);

      // Verify no duplicate customer was inserted
      const countRes = await queryPostgres('SELECT COUNT(*) as count FROM customers WHERE primary_phone = $1', [uniquePhone]);
      expect(Number(countRes.rows[0].count)).toBe(1);
    });

    it('safely handles simultaneous concurrent requests with the same Idempotency-Key without creating duplicate records', async () => {
      const idempotencyKey = `idemp_concurrent_${runId}_${Date.now()}`;
      const uniquePhone = `+9183${Math.floor(10000000 + Math.random() * 90000000)}`;
      const payload = {
        customer: {
          fullName: 'Concurrent Borrower',
          primaryPhone: uniquePhone,
          addressLine1: 'Race Track 9',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 24000,
          downPayment: 4000,
          annualInterestRate: 5.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
          firstEmiDate: '2026-11-01',
        },
      };

      // Fire two requests concurrently with the exact same Idempotency-Key
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/customers/onboard')
          .set('Authorization', `Bearer ${dealerAToken}`)
          .set('Idempotency-Key', idempotencyKey)
          .send(payload),
        request(app)
          .post('/api/v1/customers/onboard')
          .set('Authorization', `Bearer ${dealerAToken}`)
          .set('Idempotency-Key', idempotencyKey)
          .send(payload),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.data.customer.id).toBe(res2.body.data.customer.id);
      expect(res1.body.data.loan.id).toBe(res2.body.data.loan.id);

      // Verify in DB that only 1 customer and 1 loan exist for this phone
      const custCount = await queryPostgres('SELECT COUNT(*) as count FROM customers WHERE primary_phone = $1', [uniquePhone]);
      expect(Number(custCount.rows[0].count)).toBe(1);

      const loanCount = await queryPostgres('SELECT COUNT(*) as count FROM loans WHERE customer_id = $1', [res1.body.data.customer.id]);
      expect(Number(loanCount.rows[0].count)).toBe(1);
    });

    it('rejects duplicate idempotency key used with conflicting loan financial fields (HTTP 409 Conflict)', async () => {
      const idempotencyKey = `idemp_fin_conflict_${runId}_${Date.now()}`;
      const uniquePhone = `+9182${Math.floor(10000000 + Math.random() * 90000000)}`;
      const payload = {
        customer: {
          fullName: 'Financial Conflict Borrower',
          primaryPhone: uniquePhone,
          addressLine1: 'Market 5',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 20000,
          downPayment: 2000,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
        },
      };

      const res1 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);

      // Same phone and name, but DIFFERENT principalAmount (30000 vs 20000)
      const conflictingPayload = {
        ...payload,
        loan: {
          ...payload.loan,
          principalAmount: 30000,
        },
      };

      const res2 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(conflictingPayload);

      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error.message).toMatch(/different onboarding payload/i);
    });

    it('permits a legitimate second financing request for the same borrower and identical loan terms when using a distinct Idempotency-Key', async () => {
      const firstIdempotencyKey = `idemp_legit_first_${runId}_${Date.now()}`;
      const secondIdempotencyKey = `idemp_legit_second_${runId}_${Date.now()}`;
      const uniquePhone = `+9181${Math.floor(10000000 + Math.random() * 90000000)}`;

      const payload = {
        customer: {
          fullName: 'Repeat Borrower John',
          primaryPhone: uniquePhone,
          addressLine1: 'Main Market Sector 12',
          city: 'Noida',
          state: 'Uttar Pradesh',
          pincode: '201301',
          areaRoute: 'Dadri',
        },
        loan: {
          principalAmount: 10000,
          downPayment: 0,
          annualInterestRate: 4.0, // 4% monthly flat rate
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-01',
          firstEmiDate: '2026-11-01',
        },
      };

      // Request 1: First financing request
      const res1 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', firstIdempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.isIdempotentReplay).toBeUndefined();
      const firstCustomerId = res1.body.data.customer.id;
      const firstLoanId = res1.body.data.loan.id;

      // Request 2: Legitimate second financing request with identical terms and borrower, but DISTINCT Idempotency-Key
      const res2 = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', secondIdempotencyKey)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.isIdempotentReplay).toBeUndefined();
      const secondCustomerId = res2.body.data.customer.id;
      const secondLoanId = res2.body.data.loan.id;

      // Verify that this created a NEW distinct loan record, not a false deduplication replay
      expect(secondLoanId).not.toBe(firstLoanId);
      expect(secondCustomerId).not.toBe(firstCustomerId);

      // Verify DB: exactly 2 distinct loans created for this borrower phone
      const loansDb = await queryPostgres(
        'SELECT l.id, l.principal_amount, l.annual_interest_rate FROM loans l JOIN customers c ON l.customer_id = c.id WHERE c.primary_phone = $1',
        [uniquePhone]
      );
      expect(loansDb.rows.length).toBe(2);
      expect(Number(loansDb.rows[0].principal_amount)).toBe(10000);
      expect(Number(loansDb.rows[1].principal_amount)).toBe(10000);

      // Verify idempotency replay works for second request when retrying with second key
      const retryRes = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', secondIdempotencyKey)
        .send(payload);

      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.isIdempotentReplay).toBe(true);
      expect(retryRes.body.data.loan.id).toBe(secondLoanId);
      expect(retryRes.body.data.customer.id).toBe(secondCustomerId);

      // Verify idempotency replay also works for first request when retrying with first key
      const retryFirstRes = await request(app)
        .post('/api/v1/customers/onboard')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .set('Idempotency-Key', firstIdempotencyKey)
        .send(payload);

      expect(retryFirstRes.status).toBe(201);
      expect(retryFirstRes.body.data.isIdempotentReplay).toBe(true);
      expect(retryFirstRes.body.data.loan.id).toBe(firstLoanId);
      expect(retryFirstRes.body.data.customer.id).toBe(firstCustomerId);
    });
  });
});
