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
  PaymentStatus,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Agent Collection Approval Workflow + Admin EMI Penalty Management Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_apr_${runId}@crmtest.com`;
  const managerEmail = `mgr_apr_${runId}@crmtest.com`;
  const agent1Email = `agent1_apr_${runId}@crmtest.com`;
  const agent2Email = `agent2_apr_${runId}@crmtest.com`;

  let adminToken: string;
  let managerToken: string;
  let agent1Token: string;
  let agent2Token: string;

  let adminId: string;
  let managerId: string;
  let agent1Id: string;
  let agent2Id: string;

  let dealerId: string;

  let customer1Id: string;
  let customer2Id: string;

  let loan1Id: string;
  let loan1AccNo: string;
  let loan1FirstEmiId: string;
  let loan1SecondEmiId: string;
  let loan1ThirdEmiId: string;
  let loan1EmiAmount: number;
  let loan1TotalOutstanding: number;

  let loan2Id: string;
  let loan2AccNo: string;
  let loan2FirstEmiId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agent1Id = uuidv4();
    agent2Id = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Super Admin Apr', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9816${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Manager Apr', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9816${numId}2`, hash]);

    // 3. Create Recovery Agent 1
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Agent One Apr', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent1Id, agent1Email, `9816${numId}3`, hash]);

    // 4. Create Recovery Agent 2
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Agent Two Apr', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent2Id, agent2Email, `9816${numId}4`, hash]);

    // Logins
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'Password@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const a1Login = await request(app).post('/api/v1/auth/login').send({ email: agent1Email, password: 'Password@123' });
    agent1Token = a1Login.body.data.tokens.accessToken;

    const a2Login = await request(app).post('/api/v1/auth/login').send({ email: agent2Email, password: 'Password@123' });
    agent2Token = a2Login.body.data.tokens.accessToken;

    // Create Dealer
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Auto Store ${runId}`,
        ownerName: 'Sunil Auto',
        phone: `9827${numId}1`,
        address: 'MG Road Sector 29',
        areaCity: 'Gurugram',
      });
    dealerId = dealerRes.body.data.id;

    // Create Customer 1 (Assigned to Agent 1)
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Ramesh Kumar ${runId}`,
        primaryPhone: `9848${numId}1`,
        addressLine1: 'Flat 402, Green Glen',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122001',
        areaRoute: `ROUTE-GG-${runId}`,
      });
    customer1Id = c1Res.body.data.id;

    // Create Customer 2 (Assigned to Agent 2)
    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Suresh Verma ${runId}`,
        primaryPhone: `9848${numId}2`,
        addressLine1: 'House 12, DLF Phase 1',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122002',
        areaRoute: `ROUTE-DLF-${runId}`,
      });
    customer2Id = c2Res.body.data.id;

    // Assign Customer 1 to Agent 1, Customer 2 to Agent 2
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, NOW())
    `, [uuidv4(), agent1Id, customer1Id, `ROUTE-GG-${runId}`, adminId]);

    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, NOW())
    `, [uuidv4(), agent2Id, customer2Id, `ROUTE-DLF-${runId}`, adminId]);

    // Create Loan 1 (12 months, ₹24,000 principal, 6% flat)
    const l1Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        dealerId,
        principalAmount: 24000,
        downPayment: 0,
        annualInterestRate: 6,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        tenureMonths: 12,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agent1Id,
        status: LoanStatus.ACTIVE,
      });
    loan1Id = l1Res.body.data.id;
    loan1AccNo = l1Res.body.data.loanAccountNo;

    // Fetch installments for Loan 1
    const emis1 = await queryPostgres(
      `SELECT id, installment_number, expected_amount, remaining_amount, due_date FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC`,
      [loan1Id]
    );
    loan1FirstEmiId = emis1.rows[0].id;
    loan1SecondEmiId = emis1.rows[1].id;
    loan1ThirdEmiId = emis1.rows[2].id;
    loan1EmiAmount = Number(emis1.rows[0].expected_amount);

    const loanRow = await queryPostgres(`SELECT outstanding_balance FROM loans WHERE id = $1`, [loan1Id]);
    loan1TotalOutstanding = Number(loanRow.rows[0].outstanding_balance);

    // Create Loan 2 (Assigned to Agent 2)
    const l2Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        dealerId,
        principalAmount: 12000,
        downPayment: 0,
        annualInterestRate: 6,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        tenureMonths: 6,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agent2Id,
        status: LoanStatus.ACTIVE,
      });
    loan2Id = l2Res.body.data.id;
    loan2AccNo = l2Res.body.data.loanAccountNo;

    const emis2 = await queryPostgres(
      `SELECT id, installment_number, expected_amount, due_date FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC`,
      [loan2Id]
    );
    loan2FirstEmiId = emis2.rows[0].id;
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  describe('Part 1: Agent Collection Approval Workflow', () => {
    let pendingPaymentId: string;
    let pendingReceiptNumber: string;

    it('1. Agent submits a valid collection: status is PENDING_APPROVAL and no ledger entry is posted', async () => {
      // Record initial official payments count
      const beforePayments = await queryPostgres(`SELECT COUNT(*)::int as cnt FROM payments WHERE loan_id = $1 AND status = 'SUCCESS'`, [loan1Id]);

      const submitRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          emiId: loan1FirstEmiId,
          amount: loan1EmiAmount,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
          notes: 'Collected cash at door',
        });

      expect(submitRes.status).toBe(201);
      expect(submitRes.body.success).toBe(true);
      expect(submitRes.body.data.status).toBe(PaymentStatus.PENDING_APPROVAL);
      expect(submitRes.body.data.allocatedInstallments).toHaveLength(0);

      pendingPaymentId = submitRes.body.data.paymentId;
      pendingReceiptNumber = submitRes.body.data.receiptNumber;
      expect(pendingPaymentId).toBeDefined();

      // Verify no approved ledger payments created
      const afterPayments = await queryPostgres(`SELECT COUNT(*)::int as cnt FROM payments WHERE loan_id = $1 AND status = 'SUCCESS'`, [loan1Id]);
      expect(afterPayments.rows[0].cnt).toBe(beforePayments.rows[0].cnt);

      // Verify payment row status is PENDING_APPROVAL
      const payRow = await queryPostgres(`SELECT status, is_reversal FROM payments WHERE id = $1`, [pendingPaymentId]);
      expect(payRow.rows[0].status).toBe(PaymentStatus.PENDING_APPROVAL);
      expect(payRow.rows[0].is_reversal).toBe(false);
    });

    it('2. Pending collection does not reduce the official outstanding balance or mark EMI as paid', async () => {
      const loanRow = await queryPostgres(`SELECT outstanding_balance FROM loans WHERE id = $1`, [loan1Id]);
      expect(Number(loanRow.rows[0].outstanding_balance)).toBe(loan1TotalOutstanding);

      const emiRow = await queryPostgres(`SELECT status, paid_amount, remaining_amount FROM emi_installments WHERE id = $1`, [loan1FirstEmiId]);
      expect(emiRow.rows[0].status).not.toBe('PAID');
      expect(Number(emiRow.rows[0].paid_amount)).toBe(0);
      expect(Number(emiRow.rows[0].remaining_amount)).toBe(loan1EmiAmount);
    });

    it('3. Receipt for pending collection is clearly marked as pending acknowledgment', async () => {
      const receiptRes = await request(app)
        .get(`/api/v1/payments/receipt/${pendingPaymentId}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(receiptRes.status).toBe(200);
      expect(receiptRes.body.data.status).toBe(PaymentStatus.PENDING_APPROVAL);
      expect(receiptRes.body.data.isPending).toBe(true);
      expect(receiptRes.body.data.isApproved).toBe(false);
      expect(receiptRes.body.data.receiptTitle).toContain('Acknowledgment');
      expect(receiptRes.body.data.allocations).toHaveLength(0);
    });

    it('4. Duplicate pending submission for the same obligation is blocked with 409 Conflict', async () => {
      const dupRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          emiId: loan1FirstEmiId,
          amount: loan1EmiAmount,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
        });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.success).toBe(false);
      expect(dupRes.body.error.message).toContain('already pending approval');
    });

    it('5. Agent queue shows pending status and pending collection amount', async () => {
      const queueRes = await request(app)
        .get('/api/v1/emi/agent-queue')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(queueRes.status).toBe(200);
      const queueItem = queueRes.body.data.items.find((i: any) => i.installmentId === loan1FirstEmiId);
      expect(queueItem).toBeDefined();
      expect(queueItem.hasPendingCollection).toBe(true);
      expect(queueItem.pendingCollectionAmount).toBe(loan1EmiAmount);
      expect(queueItem.pendingPaymentId).toBe(pendingPaymentId);
    });

    it('6. Agent dashboard distinguishes pending collections from approved collections', async () => {
      const dashRes = await request(app)
        .get('/api/v1/emi/agent-dashboard')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(dashRes.status).toBe(200);
      // Pending collection is in todayPending, NOT in todayCollected
      expect(dashRes.body.data.todayPending).toBeGreaterThanOrEqual(loan1EmiAmount);
      expect(dashRes.body.data.todayPendingCount).toBeGreaterThanOrEqual(1);
    });

    it('7. Agent cannot approve their own or other submissions', async () => {
      const aprRes = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(aprRes.status).toBe(403);
    });

    it('8. Agent cannot record payment for another agent assigned customer', async () => {
      const unauthRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan2Id,
          customerId: customer2Id,
          amount: 1000,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
        });

      expect(unauthRes.status).toBe(403);
      expect(unauthRes.body.error.message).toMatch(/authorized|assigned/i);
    });

    it('9. Admin pending collections queue displays pending submission with full details', async () => {
      const listRes = await request(app)
        .get(`/api/v1/agent-collections?status=PENDING_APPROVAL&agentId=${agent1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listRes.status).toBe(200);
      const pendingRec = listRes.body.data.records.find((r: any) => r.id === pendingPaymentId);
      expect(pendingRec).toBeDefined();
      expect(pendingRec.status).toBe(PaymentStatus.PENDING_APPROVAL);
      expect(pendingRec.loanAccountNo).toBe(loan1AccNo);
      expect(pendingRec.amount).toBe(loan1EmiAmount);
      expect(listRes.body.data.summary.pendingCount).toBeGreaterThanOrEqual(1);
      expect(listRes.body.data.summary.pendingAmount).toBeGreaterThanOrEqual(loan1EmiAmount);
    });

    it('10. Admin approves pending collection: posts exactly once to ledger, updates balances and receipt', async () => {
      const beforeApproved = await queryPostgres(`SELECT COUNT(*)::int as cnt FROM payments WHERE loan_id = $1 AND status = 'SUCCESS'`, [loan1Id]);

      const approveRes = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.success).toBe(true);
      expect(approveRes.body.data.status).toBe(PaymentStatus.SUCCESS);

      // Outstanding balance is now reduced by loan1EmiAmount
      const afterLoan = await queryPostgres(`SELECT outstanding_balance FROM loans WHERE id = $1`, [loan1Id]);
      expect(Number(afterLoan.rows[0].outstanding_balance)).toBe(loan1TotalOutstanding - loan1EmiAmount);

      // EMI 1 is marked as PAID
      const afterEmi = await queryPostgres(`SELECT status, paid_amount, remaining_amount FROM emi_installments WHERE id = $1`, [loan1FirstEmiId]);
      expect(afterEmi.rows[0].status).toBe('PAID');
      expect(Number(afterEmi.rows[0].paid_amount)).toBe(loan1EmiAmount);
      expect(Number(afterEmi.rows[0].remaining_amount)).toBe(0);

      // Exactly one official payment added
      const afterApproved = await queryPostgres(`SELECT COUNT(*)::int as cnt FROM payments WHERE loan_id = $1 AND status = 'SUCCESS'`, [loan1Id]);
      expect(afterApproved.rows[0].cnt).toBe(beforeApproved.rows[0].cnt + 1);

      // Receipt is now official
      const receiptRes = await request(app)
        .get(`/api/v1/payments/receipt/${pendingPaymentId}`)
        .set('Authorization', `Bearer ${agent1Token}`);
      expect(receiptRes.body.data.status).toBe(PaymentStatus.SUCCESS);
      expect(receiptRes.body.data.isApproved).toBe(true);
      expect(receiptRes.body.data.isPending).toBe(false);
      expect(receiptRes.body.data.allocations.length).toBeGreaterThan(0);
    });

    it('11. Repeated approval of already approved payment is idempotent and safe', async () => {
      const repeatRes = await request(app)
        .post(`/api/v1/payments/${pendingPaymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(repeatRes.status).toBe(200);
      expect(repeatRes.body.data.status).toBe(PaymentStatus.SUCCESS);
      expect(repeatRes.body.data.isApproved).toBe(true);

      // Balance remains unchanged (no double allocation)
      const afterLoan = await queryPostgres(`SELECT outstanding_balance FROM loans WHERE id = $1`, [loan1Id]);
      expect(Number(afterLoan.rows[0].outstanding_balance)).toBe(loan1TotalOutstanding - loan1EmiAmount);
    });

    it('12. Rejection workflow: Admin rejects with reason, preserves history, allows retrying submission', async () => {
      // 1. Agent submits collection for EMI 2
      const sub2Res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          emiId: loan1SecondEmiId,
          amount: loan1EmiAmount,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
        });
      expect(sub2Res.status).toBe(201);
      const sub2PaymentId = sub2Res.body.data.paymentId;

      // 2. Reject without reason is rejected by validation
      const rejFailRes = await request(app)
        .post(`/api/v1/payments/${sub2PaymentId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(rejFailRes.status).toBe(422);

      // 3. Reject with reason succeeds
      const rejRes = await request(app)
        .post(`/api/v1/payments/${sub2PaymentId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cash denomination mismatch; customer re-verification required' });

      expect(rejRes.status).toBe(200);
      expect(rejRes.body.success).toBe(true);
      expect(rejRes.body.data.status).toBe(PaymentStatus.REJECTED);

      // Preserved with reason in database
      const dbRow = await queryPostgres(`SELECT status, reversal_reason FROM payments WHERE id = $1`, [sub2PaymentId]);
      expect(dbRow.rows[0].status).toBe(PaymentStatus.REJECTED);
      expect(dbRow.rows[0].reversal_reason).toContain('Cash denomination mismatch');

      // Zero financial ledger impact
      const loanRow = await queryPostgres(`SELECT outstanding_balance FROM loans WHERE id = $1`, [loan1Id]);
      expect(Number(loanRow.rows[0].outstanding_balance)).toBe(loan1TotalOutstanding - loan1EmiAmount);

      // 4. Retry submission is permitted now that rejected submission is no longer blocking
      const retryRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          emiId: loan1SecondEmiId,
          amount: loan1EmiAmount,
          paymentMode: PaymentMode.UPI,
          referenceNumber: 'UPI987654321',
          collectionSource: CollectionSource.RECOVERY_AGENT,
        });
      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.status).toBe(PaymentStatus.PENDING_APPROVAL);

      // Clean up by approving retry
      await request(app)
        .post(`/api/v1/payments/${retryRes.body.data.paymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);
    });
  });

  describe('Part 2: Admin EMI Penalty Management', () => {
    let upcomingEmiId: string;
    let originalEmiAmount: number;

    beforeAll(async () => {
      // EMI 3 is completely unpaid and has no pending payments
      upcomingEmiId = loan1ThirdEmiId;
      const emiRes = await queryPostgres(
        `SELECT expected_amount, remaining_amount, penalty_amount, due_date
         FROM emi_installments WHERE id = $1`,
        [upcomingEmiId]
      );
      originalEmiAmount = Number(emiRes.rows[0].expected_amount);
    });

    it('1. Admin can add a penalty in advance to an upcoming unpaid EMI', async () => {
      const penaltyRes = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 250,
          reason: 'Advance administrative late penalty assessed by Admin',
        });

      expect(penaltyRes.status).toBe(201);
      expect(penaltyRes.body.success).toBe(true);
      expect(penaltyRes.body.data.installment.penaltyAmount).toBe(250);
      expect(penaltyRes.body.data.installment.totalDue).toBe(originalEmiAmount + 250);

      // Verify emi_installments row
      const emiRow = await queryPostgres(`SELECT penalty_amount, remaining_amount FROM emi_installments WHERE id = $1`, [upcomingEmiId]);
      expect(Number(emiRow.rows[0].penalty_amount)).toBe(250);
      expect(Number(emiRow.rows[0].remaining_amount)).toBe(originalEmiAmount);

      // Verify emi_penalties audit row
      const auditPen = await queryPostgres(`SELECT * FROM emi_penalties WHERE emi_installment_id = $1`, [upcomingEmiId]);
      expect(auditPen.rows.length).toBeGreaterThanOrEqual(1);
      expect(Number(auditPen.rows[0].amount)).toBe(250);
    });

    it('2. Branch Manager can add a penalty to an eligible EMI', async () => {
      // Find another upcoming EMI (e.g. installment 4)
      const emiRes = await queryPostgres(
        `SELECT id, installment_number, expected_amount FROM emi_installments
         WHERE loan_id = $1 AND status != 'PAID' AND id != $2 ORDER BY installment_number ASC LIMIT 1`,
        [loan1Id, upcomingEmiId]
      );
      const nextEmiId = emiRes.rows[0].id;

      const mgrRes = await request(app)
        .post(`/api/v1/emi/${nextEmiId}/penalties`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          amount: 150,
          reason: 'Field visit penalty assessed by Branch Manager',
        });

      expect(mgrRes.status).toBe(201);
      expect(mgrRes.body.success).toBe(true);
      expect(mgrRes.body.data.installment.penaltyAmount).toBe(150);
    });

    it('3. Agent cannot add or modify penalties', async () => {
      const agentRes = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          amount: 500,
          reason: 'Unauthorized agent penalty attempt',
        });

      expect(agentRes.status).toBe(403);
    });

    it('4. Agent queue displays authoritative total due with Admin-assigned penalty', async () => {
      const queueRes = await request(app)
        .get('/api/v1/emi/agent-queue')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(queueRes.status).toBe(200);
      const queueItem = queueRes.body.data.items.find((i: any) => i.installmentId === upcomingEmiId);
      expect(queueItem).toBeDefined();
      expect(queueItem.penaltyAmount).toBe(250);
      expect(queueItem.totalDue).toBe(originalEmiAmount + 250);
      expect(queueItem.expectedAmount).toBe(originalEmiAmount);
    });

    it('5. Cannot add penalty to fully paid EMI', async () => {
      const paidRes = await request(app)
        .post(`/api/v1/emi/${loan1FirstEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100,
          reason: 'Attempted penalty on paid EMI',
        });

      expect(paidRes.status).toBe(400);
      expect(paidRes.body.error.message).toContain('fully paid');
    });

    it('6. Penalty and Collection Approval lifecycle with penalty allocation', async () => {
      // 1. Agent submits collection for total due: originalEmiAmount + ₹250 penalty
      const submitRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          emiId: upcomingEmiId,
          amount: originalEmiAmount + 250,
          paymentMode: PaymentMode.CASH,
          collectionSource: CollectionSource.RECOVERY_AGENT,
        });

      expect(submitRes.status).toBe(201);
      const paymentId = submitRes.body.data.paymentId;
      expect(submitRes.body.data.status).toBe(PaymentStatus.PENDING_APPROVAL);

      // 2. Modifying penalty while collection is pending approval is blocked with 409
      const blockPenRes = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 300,
          reason: 'Attempt to change penalty during pending approval',
        });
      expect(blockPenRes.status).toBe(409);
      expect(blockPenRes.body.error.message).toContain('pending approval');

      // 3. Admin approves payment
      const aprRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(aprRes.status).toBe(200);
      expect(aprRes.body.success).toBe(true);

      // 4. EMI is now settled (both remaining and penalty cleared)
      const emiAfter = await queryPostgres(`SELECT status, paid_amount, remaining_amount, penalty_amount FROM emi_installments WHERE id = $1`, [upcomingEmiId]);
      expect(emiAfter.rows[0].status).toBe('PAID');
      expect(Number(emiAfter.rows[0].remaining_amount)).toBe(0);
      expect(Number(emiAfter.rows[0].penalty_amount)).toBe(0);

      // Penalty row marked as PAID
      const penRow = await queryPostgres(`SELECT status, paid_amount FROM emi_penalties WHERE emi_installment_id = $1`, [upcomingEmiId]);
      expect(penRow.rows[0].status).toBe('PAID');
      expect(Number(penRow.rows[0].paid_amount)).toBe(250);
    });
  });
});
