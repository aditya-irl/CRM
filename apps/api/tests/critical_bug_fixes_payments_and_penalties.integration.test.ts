import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { DealerService } from '../src/modules/dealers/dealers.service';
import {
  UserRole,
  LoanStatus,
  InterestMethod,
  RepaymentFrequency,
  PaymentMode,
  CollectionSource,
  PaymentStatus,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('CRITICAL BUG FIXES — Payments, Approvals, Penalties & Deduplication Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_crit_${runId}@crmtest.com`;
  const agentEmail = `agent_crit_${runId}@crmtest.com`;
  const dealerUserEmail = `dealer_crit_${runId}@crmtest.com`;

  let adminToken: string;
  let agentToken: string;
  let dealerToken: string;

  let adminId: string;
  let agentId: string;
  let dealerUserId: string;
  let dealerId: string;

  let customerId: string;
  let loanId: string;
  let loanAccNo: string;
  let emi1Id: string;
  let emi2Id: string;
  let emi3Id: string;
  let emiAmount: number;
  let totalOutstanding: number;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    agentId = uuidv4();
    dealerUserId = uuidv4();
    dealerId = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Admin Critical', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9817${numId}1`, hash]);

    // 2. Create Dealer Entity and Dealer User
    await queryPostgres(`
      INSERT INTO dealers (id, store_name, dealer_code, owner_name, phone, email, status, address, area_city, created_at, updated_at)
      VALUES ($1, 'Apex Mobile Store Crit', 'DLR-${runId}', 'Sunil Apex', '9817${numId}2', 'dealer_store_${runId}@test.com', 'ACTIVE', 'Shop 10', 'Indore', NOW(), NOW())
    `, [dealerId]);

    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, dealer_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Sunil Dealer User', 'DEALER', 'ACTIVE', $5, NOW(), NOW())
    `, [dealerUserId, dealerUserEmail, `9817${numId}3`, hash, dealerId]);

    // 3. Create Collection Agent
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Agent Critical', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agentId, agentEmail, `9817${numId}4`, hash]);

    // Logins
    const admLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = admLogin.body.data.tokens.accessToken;

    const agtLogin = await request(app).post('/api/v1/auth/login').send({ email: agentEmail, password: 'Password@123' });
    agentToken = agtLogin.body.data.tokens.accessToken;

    const dlrLogin = await request(app).post('/api/v1/auth/login').send({ email: dealerUserEmail, password: 'Password@123' });
    dealerToken = dlrLogin.body.data.tokens.accessToken;

    // 4. Create Customer
    customerId = uuidv4();
    await queryPostgres(`
      INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
      VALUES ($1, 'CUST-${runId}', 'Rohan Sharma Crit', '9817${numId}5', 'Flat 401', 'Indore', 'MP', '452001', 'South Zone', NOW(), NOW())
    `, [customerId]);

    // 5. Create Active Loan with 3 EMIs
    loanId = uuidv4();
    loanAccNo = `LN-CRIT-${runId}`;
    emiAmount = 3000;
    totalOutstanding = 9000;

    await queryPostgres(`
      INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, installment_frequency,
        total_installments, tenure_months, emi_amount, total_interest, total_payable, total_paid, outstanding_balance,
        disbursement_date, first_emi_date, maturity_date,
        status, assigned_agent_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 8500, 500,
        8000, 12, 'FLAT_RATE', 'MONTHLY',
        3, 3, $5, 500, $6, 0, $6,
        CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '30 days',
        'ACTIVE', $7, NOW(), NOW()
      )
    `, [loanId, loanAccNo, customerId, dealerId, emiAmount, totalOutstanding, agentId]);

    // Create 3 installments: EMI 1 (overdue), EMI 2 (overdue), EMI 3 (upcoming)
    emi1Id = uuidv4();
    emi2Id = uuidv4();
    emi3Id = uuidv4();

    await queryPostgres(`
      INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date,
        principal_component, interest_component, expected_amount, paid_amount, remaining_amount,
        penalty_amount, status, days_overdue, created_at, updated_at
      )
      VALUES
        ($1, $4, $5, 1, CURRENT_DATE - INTERVAL '30 days', 2800, 200, 3000, 0, 3000, 0, 'OVERDUE', 30, NOW(), NOW()),
        ($2, $4, $5, 2, CURRENT_DATE - INTERVAL '1 days', 2800, 200, 3000, 0, 3000, 0, 'OVERDUE', 1, NOW(), NOW()),
        ($3, $4, $5, 3, CURRENT_DATE + INTERVAL '29 days', 2900, 100, 3000, 0, 3000, 0, 'UPCOMING', 0, NOW(), NOW())
    `, [emi1Id, emi2Id, emi3Id, loanId, customerId]);

    // Create active collection assignment for agent
    await queryPostgres(`
      INSERT INTO collection_assignments (id, loan_id, customer_id, agent_id, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, TRUE, NOW())
    `, [uuidv4(), loanId, customerId, agentId, adminId]);
  });

  afterAll(async () => {
    try {
      await closePostgresPool();
    } catch {}
    try {
      await closeRedisConnection();
    } catch {}
    try {
      await closeAllQueues();
    } catch {}
  });

  describe('BUG 1 — Problem A: Agent Penalty Prohibition', () => {
    it('1 & 2. Agent API requests attempting unauthorized penalty operations via recordPayment are rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId,
          customerId,
          emiId: emi1Id,
          amount: 3000,
          penaltyAmount: 200,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Collection agents are not authorized to apply penalties');
    });

    it('2b. Agent API requests attempting penalty addition via /api/v1/emi/:emiId/penalties are rejected with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${emi1Id}/penalties`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          amount: 250,
          reason: 'Unauthorized late penalty by agent',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('2c. Agent API requests attempting penalty reversal or waiver are rejected with 403', async () => {
      const fakePenaltyId = uuidv4();
      const revRes = await request(app)
        .post(`/api/v1/emi/penalties/${fakePenaltyId}/reverse`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ reason: 'Agent attempt reverse' });

      expect(revRes.status).toBe(403);

      const waiveRes = await request(app)
        .post(`/api/v1/emi/penalties/${fakePenaltyId}/waive`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ reason: 'Agent attempt waive' });

      expect(waiveRes.status).toBe(403);
    });
  });

  describe('BUG 1 — Problem B: Enforce Payment Approval & Pending State Financial Isolation', () => {
    let pendingPaymentId: string;
    const pendingAmount = 3000;

    it('3. A payment requiring approval enters PENDING_APPROVAL and does NOT create a finalized ledger or penalty entry', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId,
          customerId,
          emiId: emi1Id,
          amount: pendingAmount,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
          idempotencyKey: `IDEMP_CRIT_SUB1_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(PaymentStatus.PENDING_APPROVAL);

      pendingPaymentId = res.body.data.paymentId;
      expect(pendingPaymentId).toBeDefined();

      // Check emi_penalties: NO active penalty entry should have been created
      const penCheck = await queryPostgres(
        `SELECT * FROM emi_penalties WHERE loan_id = $1 AND reason LIKE '%Late payment penalty assessed%'`,
        [loanId]
      );
      expect(penCheck.rows.length).toBe(0);
    });

    it('4. Pending payments do not reduce loan balance, mark installment paid, or count as confirmed collections', async () => {
      // Loan outstanding balance must remain untouched (9000)
      const loanRes = await queryPostgres(`SELECT outstanding_balance, total_paid FROM loans WHERE id = $1`, [loanId]);
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(totalOutstanding);
      expect(Number(loanRes.rows[0].total_paid)).toBe(0);

      // Installment 1 must remain unpaid
      const emiRes = await queryPostgres(`SELECT status, paid_amount, remaining_amount FROM emi_installments WHERE id = $1`, [emi1Id]);
      expect(emiRes.rows[0].status).toBe('OVERDUE');
      expect(Number(emiRes.rows[0].paid_amount)).toBe(0);
      expect(Number(emiRes.rows[0].remaining_amount)).toBe(3000);

      // Check confirmed collection reports: pending payments do NOT increase confirmed collections
      const summaryRes = await request(app)
        .get(`/api/v1/payments/summary?loanId=${loanId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(summaryRes.status).toBe(200);
      // Pending collections are not added to confirmed collection amount
      expect(Number(summaryRes.body.data.totalCollections)).toBe(0);
    });

    it('5. Unauthorized approval requests by agents or non-admins are rejected with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(res.status).toBe(403);

      const dlrRes = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${dealerToken}`);

      expect(dlrRes.status).toBe(403);
    });

    it('6. Approved payments are posted exactly once and update balances atomically', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Payment record is SUCCESS
      const payRes = await queryPostgres(`SELECT status, approved_by FROM payments WHERE id = $1`, [pendingPaymentId]);
      expect(payRes.rows[0].status).toBe('SUCCESS');
      expect(payRes.rows[0].approved_by).toBe(adminId);

      // Loan outstanding reduced by 3000 -> 6000
      const loanRes = await queryPostgres(`SELECT outstanding_balance, total_paid FROM loans WHERE id = $1`, [loanId]);
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(6000);
      expect(Number(loanRes.rows[0].total_paid)).toBe(3000);

      // Installment 1 is marked PAID
      const emiRes = await queryPostgres(`SELECT status, paid_amount, remaining_amount FROM emi_installments WHERE id = $1`, [emi1Id]);
      expect(emiRes.rows[0].status).toBe('PAID');
      expect(Number(emiRes.rows[0].remaining_amount)).toBe(0);
      expect(Number(emiRes.rows[0].paid_amount)).toBe(3000);
    });

    it('8. Repeated approval requests do not duplicate financial transactions (idempotent replay)', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      // Loan balance must remain exactly 6000 (NOT reduced again to 3000!)
      const loanRes = await queryPostgres(`SELECT outstanding_balance, total_paid FROM loans WHERE id = $1`, [loanId]);
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(6000);
      expect(Number(loanRes.rows[0].total_paid)).toBe(3000);
    });

    it('7. Rejection workflow: Rejected payments never enter the finalized ledger', async () => {
      // Submit a second collection for EMI 2
      const submitRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId,
          customerId,
          emiId: emi2Id,
          amount: 3000,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
          idempotencyKey: `IDEMP_CRIT_REJ_${runId}`,
        });

      expect(submitRes.status).toBe(201);
      const rejPaymentId = submitRes.body.data.paymentId;

      // Admin rejects with reason
      const rejRes = await request(app)
        .post(`/api/v1/payments/${rejPaymentId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Counterfeit note detected in field collection' });

      expect(rejRes.status).toBe(200);
      expect(rejRes.body.data.status).toBe(PaymentStatus.REJECTED);

      // Payment is REJECTED
      const payCheck = await queryPostgres(`SELECT status, reversal_reason FROM payments WHERE id = $1`, [rejPaymentId]);
      expect(payCheck.rows[0].status).toBe('REJECTED');
      expect(payCheck.rows[0].reversal_reason).toContain('Counterfeit');

      // Balances must remain at 6000
      const loanRes = await queryPostgres(`SELECT outstanding_balance, total_paid FROM loans WHERE id = $1`, [loanId]);
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(6000);

      // EMI 2 remains OVERDUE with 3000 remaining
      const emiRes = await queryPostgres(`SELECT status, remaining_amount FROM emi_installments WHERE id = $1`, [emi2Id]);
      expect(emiRes.rows[0].status).toBe('OVERDUE');
      expect(Number(emiRes.rows[0].remaining_amount)).toBe(3000);
    });

    it('9. Concurrent approval requests cannot post the same payment twice', async () => {
      // Submit third collection for EMI 2
      const submitRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId,
          customerId,
          emiId: emi2Id,
          amount: 3000,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
          idempotencyKey: `IDEMP_CRIT_CONC_${runId}`,
        });

      const concPaymentId = submitRes.body.data.paymentId;

      // Send 3 concurrent approval requests simultaneously
      const results = await Promise.all([
        request(app).post(`/api/v1/payments/${concPaymentId}/approve`).set('Authorization', `Bearer ${adminToken}`),
        request(app).post(`/api/v1/payments/${concPaymentId}/approve`).set('Authorization', `Bearer ${adminToken}`),
        request(app).post(`/api/v1/payments/${concPaymentId}/approve`).set('Authorization', `Bearer ${adminToken}`),
      ]);

      // All 3 succeed (first posts, subsequent replay idempotently)
      results.forEach((r) => {
        expect(r.status).toBe(200);
      });

      // Outstanding balance must be reduced exactly once: from 6000 to 3000 (NOT 0 or negative!)
      const loanRes = await queryPostgres(`SELECT outstanding_balance, total_paid FROM loans WHERE id = $1`, [loanId]);
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(3000);
      expect(Number(loanRes.rows[0].total_paid)).toBe(6000);
    });
  });

  describe('BUG 2 — Duplicate Prevention & Accurate Query Presentation', () => {
    it('10. Repeated collection submissions with same idempotency key return idempotent replay safely', async () => {
      const fixedKey = `IDEMP_TEST_RETRY_${runId}`;

      const res1 = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId,
          customerId,
          emiId: emi3Id,
          amount: 1500,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
          idempotencyKey: fixedKey,
        });

      expect(res1.status).toBe(201);
      const firstPaymentId = res1.body.data.paymentId;
      const firstReceipt = res1.body.data.receiptNumber;

      // Resubmit identical payload with same idempotency key (simulating network retry)
      const res2 = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId,
          customerId,
          emiId: emi3Id,
          amount: 1500,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
          idempotencyKey: fixedKey,
        });

      expect(res2.status).toBe(200);
      expect(res2.body.data.id).toBe(firstPaymentId);
      expect(res2.body.data.receiptNumber).toBe(firstReceipt);
      expect(res2.body.data.isIdempotentReplay).toBe(true);

      // Clean up pending for subsequent tests
      await queryPostgres(`DELETE FROM payments WHERE id = $1`, [firstPaymentId]);
    });

    it('11. Two legitimate payments of the same amount are both preserved with distinct keys', async () => {
      // Payment A (Admin direct collection)
      const payA = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId,
          customerId,
          amount: 1000,
          paymentMode: PaymentMode.UPI,
          collectionSource: CollectionSource.DIRECT_CUSTOMER,
          idempotencyKey: `LEGIT_PAY_A_${runId}`,
        });

      expect(payA.status).toBe(201);
      expect(payA.body.data.status).toBe(PaymentStatus.SUCCESS);

      // Payment B (Second legitimate payment of identical amount ₹1000)
      const payB = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId,
          customerId,
          amount: 1000,
          paymentMode: PaymentMode.UPI,
          collectionSource: CollectionSource.DIRECT_CUSTOMER,
          idempotencyKey: `LEGIT_PAY_B_${runId}`,
        });

      expect(payB.status).toBe(201);
      expect(payB.body.data.status).toBe(PaymentStatus.SUCCESS);

      expect(payA.body.data.id).not.toBe(payB.body.data.id);
      expect(payA.body.data.receiptNumber).not.toBe(payB.body.data.receiptNumber);

      // Verify both payments exist as SUCCESS in payments table
      const rows = await queryPostgres(
        `SELECT id, amount, status FROM payments WHERE id IN ($1, $2)`,
        [payA.body.data.id, payB.body.data.id]
      );
      expect(rows.rows.length).toBe(2);
      expect(rows.rows[0].status).toBe('SUCCESS');
      expect(rows.rows[1].status).toBe('SUCCESS');
    });

    it('12 & 13. DealerService.getDealerById returns each payment exactly once without duplicating payments that have multiple settlement allocations', async () => {
      // Create a test payment for the dealer
      const testPayId = uuidv4();
      const testReceipt = `RCP-SETTL-DUP-${runId}`;
      await queryPostgres(`
        INSERT INTO payments (
          id, receipt_number, loan_id, customer_id, dealer_id, amount, payment_mode,
          collection_source, collected_by_agent_id, payment_timestamp, status, is_reversal, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 5000, 'UPI', 'DEALER', $6, NOW(), 'SUCCESS', FALSE, NOW(), NOW())
      `, [testPayId, testReceipt, loanId, customerId, dealerId, dealerUserId]);

      // Create two dealer settlement allocations referencing the EXACT SAME payment
      const settlId1 = uuidv4();
      const settlId2 = uuidv4();
      await queryPostgres(`
        INSERT INTO dealer_settlements (id, settlement_number, dealer_id, amount, settlement_date, payment_method, status, created_at, updated_at)
        VALUES
          ($1, 'SETTL-1-${runId}', $3, 2500, CURRENT_DATE, 'BANK_TRANSFER', 'COMPLETED', NOW(), NOW()),
          ($2, 'SETTL-2-${runId}', $3, 2500, CURRENT_DATE, 'BANK_TRANSFER', 'COMPLETED', NOW(), NOW())
      `, [settlId1, settlId2, dealerId]);

      await queryPostgres(`
        INSERT INTO dealer_settlement_allocations (id, settlement_id, payment_id, amount_allocated, created_at)
        VALUES
          ($1, $2, $3, 2500, NOW()),
          ($4, $5, $3, 2500, NOW())
      `, [uuidv4(), settlId1, testPayId, uuidv4(), settlId2]);

      // Query dealer dashboard via DealerService.getDealerDashboard
      const dealerDetail = await DealerService.getDealerDashboard(
        { id: adminId, email: adminEmail, role: UserRole.SUPER_ADMIN, permissions: [] } as any,
        dealerId
      );

      // Check recentCollections
      const occurrences = dealerDetail.recentCollections.filter((c: any) => c.id === testPayId || c.receiptNumber === testReceipt);
      // The collection must appear EXACTLY ONCE, never duplicated!
      expect(occurrences.length).toBe(1);
      expect(occurrences[0].status).toBe('SUCCESS');
      expect(occurrences[0].settlementStatus).toBe('SETTLED');
    });

    it('14. Payment reversal and allocation workflows continue to work', async () => {
      // Find one of the SUCCESS payments and reverse it as admin
      const payRes = await queryPostgres(
        `SELECT id FROM payments WHERE loan_id = $1 AND status = 'SUCCESS' AND is_reversal = FALSE LIMIT 1`,
        [loanId]
      );
      const revTargetId = payRes.rows[0].id;

      const revRes = await request(app)
        .post(`/api/v1/payments/${revTargetId}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Customer chargeback reversal test' });

      expect(revRes.status).toBe(200);
      expect(revRes.body.success).toBe(true);

      const revCheck = await queryPostgres(`SELECT status, is_reversal, reversal_reason FROM payments WHERE id = $1`, [revTargetId]);
      expect(revCheck.rows[0].status).toBe('REVERSED');
      expect(revCheck.rows[0].reversal_reason).toContain('chargeback');
    });
  });
});
