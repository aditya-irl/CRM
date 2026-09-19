import request from 'supertest';
import app from '../src/app';
import { getPostgresPool, queryPostgres, closePostgresPool } from '../src/database/postgres';
import { getRedisClient, closeRedisConnection } from '../src/core/redis';
import { UserRole, PaymentMode, LoanStatus, EMIStatus } from '@crm/shared';
import bcrypt from 'bcryptjs';

describe('PHASE 4: Real Integration & Concurrency Test Suite (PostgreSQL Financial Payment Engine)', () => {
  let superAdminToken: string;
  let adminToken: string;
  let agent1Token: string;
  let agent2Token: string;

  let superAdminId: string;
  let adminId: string;
  let agent1Id: string;
  let agent2Id: string;

  let customer1Id: string;
  let customer2Id: string;

  let loan1Id: string; // Customer 1 loan
  let loan2Id: string; // Customer 2 loan

  const testSuffix = Math.random().toString(36).substring(2, 8);

  beforeAll(async () => {
    // 1. Ensure PostgreSQL connection pool is ready
    getPostgresPool();

    // 2. Create Isolated Test Users in PostgreSQL
    const saEmail = `sa-p4-${testSuffix}@crm.test`;
    const admEmail = `adm-p4-${testSuffix}@crm.test`;
    const ag1Email = `ag1-p4-${testSuffix}@crm.test`;
    const ag2Email = `ag2-p4-${testSuffix}@crm.test`;
    const numId = Math.floor(10000 + Math.random() * 90000);

    const hash = bcrypt.hashSync('Password@123', 10);

    // Direct seed Super Admin in PostgreSQL
    const saRes = await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, 'Super Admin P4', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [saEmail, `98741${numId}`, hash]
    );
    superAdminId = saRes.rows[0].id;

    const saLogin = await request(app).post('/api/v1/auth/login').send({
      email: saEmail,
      password: 'Password@123',
    });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    // Admin
    const admRes = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: admEmail,
        password: 'Password@123',
        fullName: 'Branch Admin P4',
        phone: `98742${numId}`,
        role: UserRole.ADMIN,
      });
    adminId = admRes.body.data.id;

    const admLogin = await request(app).post('/api/v1/auth/login').send({
      email: admEmail,
      password: 'Password@123',
    });
    adminToken = admLogin.body.data.tokens.accessToken;

    // Agent 1
    const ag1Res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: ag1Email,
        password: 'Password@123',
        fullName: 'Agent North P4',
        phone: `98743${numId}`,
        role: UserRole.COLLECTION_AGENT,
      });
    agent1Id = ag1Res.body.data.id;

    const ag1Login = await request(app).post('/api/v1/auth/login').send({
      email: ag1Email,
      password: 'Password@123',
    });
    agent1Token = ag1Login.body.data.tokens.accessToken;

    // Agent 2
    const ag2Res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: ag2Email,
        password: 'Password@123',
        fullName: 'Agent South P4',
        phone: `98744${numId}`,
        role: UserRole.COLLECTION_AGENT,
      });
    agent2Id = ag2Res.body.data.id;

    const ag2Login = await request(app).post('/api/v1/auth/login').send({
      email: ag2Email,
      password: 'Password@123',
    });
    agent2Token = ag2Login.body.data.tokens.accessToken;

    // 3. Create Test Customers
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Ramesh Kumar ${testSuffix}`,
        primaryPhone: `98745${Math.floor(10000 + Math.random() * 90000)}`,
        addressLine1: '101 Karol Bagh',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110005',
        areaRoute: 'NORTH_ZONE',
      });
    customer1Id = c1Res.body.data.id;

    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Suresh Patel ${testSuffix}`,
        primaryPhone: `98746${Math.floor(10000 + Math.random() * 90000)}`,
        addressLine1: '202 Hauz Khas',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110016',
        areaRoute: 'SOUTH_ZONE',
      });
    customer2Id = c2Res.body.data.id;

    // 4. Assign Customer 1 -> Agent 1, Customer 2 -> Agent 2
    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agent1Id,
        customerId: customer1Id,
        areaRoute: 'NORTH_ZONE',
        effectiveFrom: '2026-01-01',
      });

    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agent2Id,
        customerId: customer2Id,
        areaRoute: 'SOUTH_ZONE',
        effectiveFrom: '2026-01-01',
      });

    // 5. Create Loans:
    // Loan 1 for Customer 1 (₹60,000 principal, 6 months, Flat Rate 10% -> ₹63,000 total payable, 6 EMIs of ₹10,500)
    const l1Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        principalAmount: 60000,
        annualInterestRate: 10.0,
        interestCalcMethod: 'FLAT_RATE',
        tenureMonths: 6,
        installmentFrequency: 'MONTHLY',
        disbursementDate: '2026-09-01',
        firstEmiDate: '2026-10-01',
        assignedAgentId: agent1Id,
      });
    loan1Id = l1Res.body.data.id;

    // Loan 2 for Customer 2 (₹30,000 principal, 6 months -> ₹31,500 total payable, 6 EMIs of ₹5,250)
    const l2Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        principalAmount: 30000,
        annualInterestRate: 10.0,
        interestCalcMethod: 'FLAT_RATE',
        tenureMonths: 6,
        installmentFrequency: 'MONTHLY',
        disbursementDate: '2026-09-01',
        firstEmiDate: '2026-10-01',
        assignedAgentId: agent2Id,
      });
    loan2Id = l2Res.body.data.id;
  });

  afterAll(async () => {
    await closePostgresPool();
    await closeRedisConnection();
  });

  describe('1. Single EMI Full & Partial Payment Allocation', () => {
    it('processes partial payment against EMI 1, updating remaining amount and status', async () => {
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 4000.0,
          paymentMode: PaymentMode.CASH,
          notes: 'Partial installment payment',
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.success).toBe(true);
      expect(payRes.body.data.receiptNumber).toMatch(/^RCP-\d+-\d+$/);
      expect(payRes.body.data.amountCollected).toBe(4000);
      expect(payRes.body.data.remainingLoanOutstanding).toBe(59000); // 63000 - 4000

      // Verify EMI 1 state in PostgreSQL
      const emiRes = await queryPostgres(
        'SELECT * FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
        [loan1Id]
      );
      const emi1 = emiRes.rows[0];
      expect(Number(emi1.paid_amount)).toBe(4000);
      expect(Number(emi1.remaining_amount)).toBe(6500); // 10500 - 4000
      expect(emi1.status).toBe('PARTIALLY_PAID');

      // Verify Loan state in PostgreSQL
      const loanRes = await queryPostgres('SELECT * FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(loanRes.rows[0].total_paid)).toBe(4000);
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(59000);
    });

    it('processes remaining balance for EMI 1, transitioning status to PAID', async () => {
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 6500.0,
          paymentMode: PaymentMode.UPI,
          referenceNumber: 'UPI-TXN-987654321',
          notes: 'Clearing remaining balance of EMI 1',
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.data.amountCollected).toBe(6500);
      expect(payRes.body.data.remainingLoanOutstanding).toBe(52500); // 59000 - 6500

      // Verify EMI 1 in PostgreSQL
      const emiRes = await queryPostgres(
        'SELECT * FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
        [loan1Id]
      );
      const emi1 = emiRes.rows[0];
      expect(Number(emi1.paid_amount)).toBe(10500);
      expect(Number(emi1.remaining_amount)).toBe(0);
      expect(emi1.status).toBe('PAID');
    });
  });

  describe('2. Multi-EMI Waterfall Allocation & Last-Cent Conservation', () => {
    it('allocates payment across multiple installments chronologically (EMI 2 & EMI 3)', async () => {
      // EMI 2 is ₹10,500, EMI 3 is ₹10,500. We pay ₹15,000:
      // Should fully pay EMI 2 (₹10,500) and partially pay EMI 3 (₹4,500).
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 15000.0,
          paymentMode: PaymentMode.BANK_TRANSFER,
          referenceNumber: 'NEFT-20260615-112233',
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.data.allocatedInstallments.length).toBe(2);

      const [alloc1, alloc2] = payRes.body.data.allocatedInstallments;
      expect(alloc1.installmentNumber).toBe(2);
      expect(alloc1.allocatedAmount).toBe(10500);
      expect(alloc1.newStatus).toBe(EMIStatus.PAID);

      expect(alloc2.installmentNumber).toBe(3);
      expect(alloc2.allocatedAmount).toBe(4500);
      expect(alloc2.newPaidAmount).toBe(4500);
      expect(alloc2.newRemainingAmount).toBe(6000); // 10500 - 4500
      expect(alloc2.newStatus).toBe(EMIStatus.PARTIALLY_PAID);

      // Verify Loan balance in PostgreSQL
      const loanRes = await queryPostgres('SELECT * FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(loanRes.rows[0].total_paid)).toBe(25500); // 4000 + 6500 + 15000
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(37500); // 63000 - 25500
    });
  });

  describe('3. Idempotency & Duplicate Request Protection', () => {
    it('returns the same receipt on replay with identical idempotency key without duplicate deduction', async () => {
      const idempotencyKey = `PAY-IDEM-${testSuffix}-001`;

      // 1. Initial Request
      const firstRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 2000.0,
          paymentMode: PaymentMode.CASH,
          idempotencyKey,
        });

      expect(firstRes.status).toBe(201);
      const receiptNumber = firstRes.body.data.receiptNumber;

      // 2. Replay Request with same key
      const replayRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 2000.0,
          paymentMode: PaymentMode.CASH,
          idempotencyKey,
        });

      expect(replayRes.status).toBe(200);
      expect(replayRes.body.data.receiptNumber).toBe(receiptNumber);
      expect(replayRes.body.data.isIdempotentReplay).toBe(true);

      // Verify in DB that only 1 payment was inserted for this idempotency key
      const countRes = await queryPostgres(
        'SELECT COUNT(*) as count FROM payments WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
    });

    it('handles concurrent duplicate payment requests safely (exactly 1 financial transaction created)', async () => {
      const concurrentKey = `CONC-IDEM-${testSuffix}-002`;

      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${agent1Token}`)
          .send({
            loanId: loan1Id,
            customerId: customer1Id,
            amount: 1000.0,
            paymentMode: PaymentMode.UPI,
            idempotencyKey: concurrentKey,
          }),
        request(app)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${agent1Token}`)
          .send({
            loanId: loan1Id,
            customerId: customer1Id,
            amount: 1000.0,
            paymentMode: PaymentMode.UPI,
            idempotencyKey: concurrentKey,
          }),
      ]);

      // Both should succeed (one 201, one 200/201 replay)
      expect([200, 201]).toContain(resA.status);
      expect([200, 201]).toContain(resB.status);

      // Both must point to the same receipt number
      const receiptA = resA.body.data.receiptNumber;
      const receiptB = resB.body.data.receiptNumber;
      expect(receiptA).toBe(receiptB);

      // Verify only 1 payment record in PostgreSQL
      const dbRes = await queryPostgres(
        'SELECT COUNT(*) as count FROM payments WHERE idempotency_key = $1',
        [concurrentKey]
      );
      expect(parseInt(dbRes.rows[0].count, 10)).toBe(1);
    });
  });

  describe('4. Concurrency & Row-Level Locking Safety (PostgreSQL FOR UPDATE)', () => {
    it('serializes concurrent payments against the same loan without lost updates or race conditions', async () => {
      // Loan 2 for Customer 2 has ₹31,500 total payable.
      // Fire 2 concurrent payments of ₹5,000 each with distinct idempotency keys.
      const key1 = `CONC-PAY1-${testSuffix}`;
      const key2 = `CONC-PAY2-${testSuffix}`;

      const [pay1Res, pay2Res] = await Promise.all([
        request(app)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${agent2Token}`)
          .send({
            loanId: loan2Id,
            customerId: customer2Id,
            amount: 5000.0,
            paymentMode: PaymentMode.CASH,
            idempotencyKey: key1,
          }),
        request(app)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${agent2Token}`)
          .send({
            loanId: loan2Id,
            customerId: customer2Id,
            amount: 5000.0,
            paymentMode: PaymentMode.CASH,
            idempotencyKey: key2,
          }),
      ]);

      expect(pay1Res.status).toBe(201);
      expect(pay2Res.status).toBe(201);

      // Verify Loan 2 state in PostgreSQL: total_paid must be exactly 10,000, outstanding must be 21,500
      const loanRes = await queryPostgres('SELECT * FROM loans WHERE id = $1', [loan2Id]);
      expect(Number(loanRes.rows[0].total_paid)).toBe(10000);
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(21500);

      // Verify EMI 1 & EMI 2 of Loan 2 in PostgreSQL:
      // EMI 1 (expected ₹5,250) is fully paid (₹5,250, remaining 0, PAID)
      // EMI 2 (expected ₹5,250) receives excess ₹4,750 (remaining ₹500, PARTIALLY_PAID)
      const emiRes = await queryPostgres(
        'SELECT * FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
        [loan2Id]
      );
      const emi1 = emiRes.rows[0];
      const emi2 = emiRes.rows[1];

      expect(Number(emi1.paid_amount)).toBe(5250);
      expect(Number(emi1.remaining_amount)).toBe(0);
      expect(emi1.status).toBe('PAID');

      expect(Number(emi2.paid_amount)).toBe(4750);
      expect(Number(emi2.remaining_amount)).toBe(500);
      expect(emi2.status).toBe('PARTIALLY_PAID');
    });
  });

  describe('5. Row-Level Access Control (RLAC) & IDOR Defense', () => {
    it('blocks Agent 1 from collecting payments for Agent 2 customer with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan2Id, // Loan 2 belongs to Customer 2 / Agent 2
          customerId: customer2Id,
          amount: 1000.0,
          paymentMode: PaymentMode.CASH,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      const errMsg = typeof res.body.error === 'object' ? res.body.error.message : res.body.error;
      expect(errMsg).toMatch(/not authorized/i);
    });

    it('blocks Agent 1 from viewing receipts of Agent 2 customer with 403 Forbidden', async () => {
      // Find a payment from Loan 2
      const payRes = await queryPostgres(
        'SELECT id FROM payments WHERE loan_id = $1 LIMIT 1',
        [loan2Id]
      );
      const paymentId = payRes.rows[0].id;

      const getRes = await request(app)
        .get(`/api/v1/payments/receipt/${paymentId}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(getRes.status).toBe(403);
    });

    it('allows Admin to view any receipt across all agents', async () => {
      const payRes = await queryPostgres(
        'SELECT id FROM payments WHERE loan_id = $1 LIMIT 1',
        [loan2Id]
      );
      const paymentId = payRes.rows[0].id;

      const getRes = await request(app)
        .get(`/api/v1/payments/receipt/${paymentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.paymentId).toBe(paymentId);
      expect(getRes.body.data.customer.id).toBe(customer2Id);
    });
  });

  describe('6. Overpayment Rejection & Transaction Atomicity', () => {
    it('rejects payment amount exceeding loan outstanding balance', async () => {
      const loanRes = await queryPostgres('SELECT outstanding_balance FROM loans WHERE id = $1', [loan2Id]);
      const currentOutstanding = Number(loanRes.rows[0].outstanding_balance);

      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: loan2Id,
          customerId: customer2Id,
          amount: currentOutstanding + 5000,
          paymentMode: PaymentMode.CASH,
        });

      expect(res.status).toBe(400);
      const errMsg = typeof res.body.error === 'object' ? res.body.error.message : res.body.error;
      expect(errMsg).toMatch(/exceeds outstanding loan balance/i);
    });
  });

  describe('7. Payment Reversals & Balance Restoration', () => {
    let paymentToReverseId: string;
    let paymentAmount: number;

    beforeAll(async () => {
      // Make a fresh payment on Loan 2 to test reversal
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: loan2Id,
          customerId: customer2Id,
          amount: 3000.0,
          paymentMode: PaymentMode.UPI,
          referenceNumber: 'REV-TEST-TXN',
        });

      paymentToReverseId = payRes.body.data.paymentId;
      paymentAmount = 3000.0;
    });

    it('Agent is forbidden from reversing payments (Admin only)', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${paymentToReverseId}/reverse`)
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          reason: 'Customer requested refund due to wrong account transfer',
        });

      expect(res.status).toBe(403);
    });

    it('Admin successfully reverses payment, restoring loan and installment balances', async () => {
      // Get state before reversal
      const loanBefore = await queryPostgres('SELECT * FROM loans WHERE id = $1', [loan2Id]);
      const outstandingBefore = Number(loanBefore.rows[0].outstanding_balance);
      const totalPaidBefore = Number(loanBefore.rows[0].total_paid);

      const revRes = await request(app)
        .post(`/api/v1/payments/${paymentToReverseId}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Customer paid twice by mistake on UPI portal',
        });

      expect(revRes.status).toBe(200);
      expect(revRes.body.success).toBe(true);
      expect(revRes.body.data.reversedPaymentId).toBe(paymentToReverseId);
      expect(revRes.body.data.reversalReceipt).toMatch(/^REV-RCP-/);

      // Verify original payment in PostgreSQL marked REVERSED
      const origPay = await queryPostgres('SELECT * FROM payments WHERE id = $1', [paymentToReverseId]);
      expect(origPay.rows[0].status).toBe('REVERSED');
      expect(origPay.rows[0].reversal_reason).toBe('Customer paid twice by mistake on UPI portal');

      // Verify reversal audit record exists in PostgreSQL
      const revPay = await queryPostgres(
        'SELECT * FROM payments WHERE reversed_payment_id = $1',
        [paymentToReverseId]
      );
      expect(revPay.rows.length).toBe(1);
      expect(revPay.rows[0].is_reversal).toBe(true);

      // Verify Loan 2 balances restored
      const loanAfter = await queryPostgres('SELECT * FROM loans WHERE id = $1', [loan2Id]);
      expect(Number(loanAfter.rows[0].outstanding_balance)).toBe(outstandingBefore + paymentAmount);
      expect(Number(loanAfter.rows[0].total_paid)).toBe(totalPaidBefore - paymentAmount);
    });

    it('prevents double-reversal of the same payment', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${paymentToReverseId}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Attempting second reversal on already reversed payment',
        });

      expect(res.status).toBe(400);
      const errMsg = typeof res.body.error === 'object' ? res.body.error.message : res.body.error;
      expect(errMsg).toMatch(/already reversed/i);
    });
  });

  describe('8. Immutable Audit Trail & Financial Invariants', () => {
    it('verifies PAYMENT_COLLECTED and PAYMENT_REVERSED audit logs in PostgreSQL', async () => {
      const logsRes = await request(app)
        .get('/api/v1/audit-logs?limit=50')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(logsRes.status).toBe(200);
      const logs = Array.isArray(logsRes.body.data) ? logsRes.body.data : logsRes.body.data.logs;

      const collectedAudit = logs.find((l: any) => l.action === 'PAYMENT_COLLECTED');
      expect(collectedAudit).toBeDefined();
      expect(collectedAudit.entity).toBe('Payment');

      const reversedAudit = logs.find((l: any) => l.action === 'PAYMENT_REVERSED');
      expect(reversedAudit).toBeDefined();
      expect(reversedAudit.entity).toBe('Payment');
    });

    it('verifies strict financial invariants across loans and installments in PostgreSQL', async () => {
      const loans = await queryPostgres('SELECT id, total_payable, total_paid, outstanding_balance FROM loans WHERE id IN ($1, $2)', [loan1Id, loan2Id]);

      for (const loan of loans.rows) {
        const totalPayable = Number(loan.total_payable);
        const totalPaid = Number(loan.total_paid);
        const outstanding = Number(loan.outstanding_balance);

        // Invariant 1: total_payable - total_paid == outstanding_balance
        expect(Math.round((totalPayable - totalPaid) * 100)).toBe(Math.round(outstanding * 100));

        // Invariant 2: sum of installment paid_amount == loan.total_paid
        const emiSumRes = await queryPostgres(
          'SELECT COALESCE(SUM(paid_amount), 0) as sum_paid FROM emi_installments WHERE loan_id = $1',
          [loan.id]
        );
        const sumPaid = Number(emiSumRes.rows[0].sum_paid);
        expect(Math.round(sumPaid * 100)).toBe(Math.round(totalPaid * 100));

        // Invariant 3: no negative values
        expect(totalPaid).toBeGreaterThanOrEqual(0);
        expect(outstanding).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('9. Multi-Payment Reversal Safety (Payment A + Payment B, Reverse Payment A)', () => {
    let multiRevLoanId: string;
    let paymentAId: string;
    let paymentBId: string;

    beforeAll(async () => {
      // Create dedicated loan: ₹60,000 principal, 6 months -> ₹63,000 total payable (6 EMIs of ₹10,500 each)
      const loanRes = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer1Id,
          principalAmount: 60000,
          annualInterestRate: 10.0,
          interestCalcMethod: 'FLAT_RATE',
          tenureMonths: 6,
          installmentFrequency: 'MONTHLY',
          disbursementDate: '2026-09-01',
          firstEmiDate: '2026-10-01',
          assignedAgentId: agent1Id,
        });
      multiRevLoanId = loanRes.body.data.id;

      // 1. Payment A: ₹15,000 (Allocates ₹10,500 to EMI 1 [PAID] and ₹4,500 to EMI 2 [PARTIALLY_PAID])
      const payARes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: multiRevLoanId,
          customerId: customer1Id,
          amount: 15000.0,
          paymentMode: PaymentMode.CASH,
          notes: 'Payment A for multi-reversal test',
        });
      paymentAId = payARes.body.data.paymentId;

      // 2. Payment B: ₹10,000 (Allocates remaining ₹6,000 to EMI 2 [PAID] and ₹4,000 to EMI 3 [PARTIALLY_PAID])
      const payBRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: multiRevLoanId,
          customerId: customer1Id,
          amount: 10000.0,
          paymentMode: PaymentMode.UPI,
          notes: 'Payment B for multi-reversal test',
        });
      paymentBId = payBRes.body.data.paymentId;
    });

    it('reverses Payment A while preserving Payment B financial allocation and invariants', async () => {
      // Prior state: Total Paid = ₹25,000, Outstanding = ₹38,000
      const revRes = await request(app)
        .post(`/api/v1/payments/${paymentAId}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Customer requested reversal of Payment A only',
        });

      expect(revRes.status).toBe(200);
      expect(revRes.body.success).toBe(true);

      // Verify Loan totals: only Payment B (₹10,000) remains active
      const loanRes = await queryPostgres('SELECT * FROM loans WHERE id = $1', [multiRevLoanId]);
      const loan = loanRes.rows[0];
      expect(Number(loan.total_paid)).toBe(10000);
      expect(Number(loan.outstanding_balance)).toBe(53000); // 63000 - 10000

      // Verify Installments:
      // Active payment of ₹10,000 is cleanly waterfalled to EMI 1 (₹10,000 paid, ₹500 remaining, PARTIALLY_PAID)
      // EMI 2 and EMI 3 are reset to ₹0 paid, ₹10,500 remaining
      const instRes = await queryPostgres(
        'SELECT * FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
        [multiRevLoanId]
      );

      const emi1 = instRes.rows[0];
      const emi2 = instRes.rows[1];
      const emi3 = instRes.rows[2];

      expect(Number(emi1.paid_amount)).toBe(10000);
      expect(Number(emi1.remaining_amount)).toBe(500);
      expect(emi1.status).toBe('PARTIALLY_PAID');

      expect(Number(emi2.paid_amount)).toBe(0);
      expect(Number(emi2.remaining_amount)).toBe(10500);

      expect(Number(emi3.paid_amount)).toBe(0);
      expect(Number(emi3.remaining_amount)).toBe(10500);

      // Verify Invariants:
      const sumPaid = instRes.rows.reduce((sum, r) => sum + Number(r.paid_amount), 0);
      expect(sumPaid).toBe(10000);
      expect(Number(loan.total_payable) - Number(loan.total_paid)).toBe(Number(loan.outstanding_balance));
    });
  });

  describe('10. Idempotency Key Payload Conflict Detection', () => {
    it('rejects duplicate request using same idempotency key with different payment amount (409 Conflict)', async () => {
      const conflictKey = `IDEM-CONFLICT-${testSuffix}-001`;

      // 1. Initial Payment of ₹2,500
      const pay1Res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 2500.0,
          paymentMode: PaymentMode.CASH,
          idempotencyKey: conflictKey,
        });

      expect(pay1Res.status).toBe(201);
      expect(pay1Res.body.data.amountCollected).toBe(2500);

      // Get loan total_paid after initial payment
      const loanBefore = await queryPostgres('SELECT total_paid, outstanding_balance FROM loans WHERE id = $1', [loan1Id]);

      // 2. Conflicting Request with same idempotency key but amount ₹8,000
      const conflictRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 8000.0,
          paymentMode: PaymentMode.CASH,
          idempotencyKey: conflictKey,
        });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.success).toBe(false);
      const errMsg = typeof conflictRes.body.error === 'object' ? conflictRes.body.error.message : conflictRes.body.error;
      expect(errMsg).toMatch(/different payment payload/i);

      // Verify no balance changed from the conflicting request
      const loanAfter = await queryPostgres('SELECT total_paid, outstanding_balance FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(loanAfter.rows[0].total_paid)).toBe(Number(loanBefore.rows[0].total_paid));
      expect(Number(loanAfter.rows[0].outstanding_balance)).toBe(Number(loanBefore.rows[0].outstanding_balance));

      // Verify only 1 payment with this idempotency key exists in PostgreSQL
      const dbCount = await queryPostgres('SELECT COUNT(*) as count FROM payments WHERE idempotency_key = $1', [conflictKey]);
      expect(parseInt(dbCount.rows[0].count, 10)).toBe(1);
    });
  });
});
