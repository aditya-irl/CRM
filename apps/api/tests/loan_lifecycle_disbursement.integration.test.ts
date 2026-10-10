import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, getBusinessDate, addDays, LoanStatus } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Loan Lifecycle Disbursement & Manual Penalty Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const superAdminEmail = `sa_${runId}@lifecycle.com`;
  const agentAEmail = `agent_a_${runId}@lifecycle.com`;
  const agentBEmail = `agent_b_${runId}@lifecycle.com`;
  const dealerEmail = `dealer_${runId}@lifecycle.com`;

  let superAdminToken: string;
  let agentAToken: string;
  let agentBToken: string;
  let dealerToken: string;

  let superAdminId: string;
  let agentAId: string;
  let agentBId: string;
  let dealerUserId: string;
  let dealerId: string;
  let customerId: string;

  const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
  const pastDueDate = addDays(businessToday, -10);
  const futureDueDate = addDays(businessToday, 20);

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    superAdminId = uuidv4();
    agentAId = uuidv4();
    agentBId = uuidv4();
    dealerUserId = uuidv4();
    dealerId = uuidv4();
    customerId = uuidv4();

    // 1. Seed Dealer
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES ($1, $2, 'Lifecycle Store', 'Ramesh Patel', $3, 'Delhi', 'Connaught Place', 'ACTIVE', NOW(), NOW())`,
      [dealerId, `DLR-LC-${runId}`, `+9198${Date.now().toString().slice(-8)}`]
    );

    // 2. Seed Users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $4, 'Agent Alpha', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
         ($8, $9, $10, $4, 'Agent Beta', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
         ($11, $12, $13, $4, 'Store Partner', 'DEALER', $14, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, superAdminEmail, `+9191${Math.floor(10000000 + Math.random() * 90000000)}`, hash,
        agentAId, agentAEmail, `+9192${Math.floor(10000000 + Math.random() * 90000000)}`,
        agentBId, agentBEmail, `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
        dealerUserId, dealerEmail, `+9194${Math.floor(10000000 + Math.random() * 90000000)}`, dealerId,
      ]
    );

    // 3. Login
    const saLogin = await request(app).post('/api/v1/auth/login').send({ email: superAdminEmail, password: 'Password@123' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const agALogin = await request(app).post('/api/v1/auth/login').send({ email: agentAEmail, password: 'Password@123' });
    agentAToken = agALogin.body.data.tokens.accessToken;

    const agBLogin = await request(app).post('/api/v1/auth/login').send({ email: agentBEmail, password: 'Password@123' });
    agentBToken = agBLogin.body.data.tokens.accessToken;

    const dlrLogin = await request(app).post('/api/v1/auth/login').send({ email: dealerEmail, password: 'Password@123' });
    dealerToken = dlrLogin.body.data.tokens.accessToken;

    // 4. Seed Customer
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, 'Suresh Verma', $3, 'B-404, Karol Bagh', 'Delhi', 'Delhi', '110005', 'Central', NOW(), NOW())`,
      [customerId, `CUST-LC-${runId}`, `+9196${Math.floor(10000000 + Math.random() * 90000000)}`]
    );
  });

  describe('Part A: Loan Lifecycle & Activation Controls', () => {
    let unapprovedLoanId: string;
    let approvedLoanId: string;

    beforeAll(async () => {
      unapprovedLoanId = uuidv4();
      approvedLoanId = uuidv4();

      // Seed unapproved loan (PENDING_APPROVAL)
      await queryPostgres(
        `INSERT INTO loans (
          id, customer_id, dealer_id, loan_account_no, principal_amount, down_payment, net_disbursed_amount,
          total_interest, total_payable, total_paid, outstanding_balance, emi_amount, total_installments,
          tenure_months, annual_interest_rate, status, disbursement_date, first_emi_date, maturity_date,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 10000.00, 0.00, 10000.00, 0.00, 10000.00, 0.00, 10000.00, 5000.00, 2, 2, 0.00, 'PENDING_APPROVAL', $5, $5, $6, NOW(), NOW())`,
        [unapprovedLoanId, customerId, dealerId, `LN-UNAPP-${runId}`, pastDueDate, futureDueDate]
      );

      // Seed approved loan (APPROVED)
      await queryPostgres(
        `INSERT INTO loans (
          id, customer_id, dealer_id, loan_account_no, principal_amount, down_payment, net_disbursed_amount,
          total_interest, total_payable, total_paid, outstanding_balance, emi_amount, total_installments,
          tenure_months, annual_interest_rate, status, disbursement_date, first_emi_date, maturity_date,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 8750.00, 0.00, 8750.00, 0.00, 8750.00, 0.00, 8750.00, 4375.00, 2, 2, 0.00, 'APPROVED', $5, $5, $6, NOW(), NOW())`,
        [approvedLoanId, customerId, dealerId, `LN-APP-${runId}`, pastDueDate, futureDueDate]
      );
    });

    test('13. Approved loan cannot accept payment directly before disbursement/activation', async () => {
      // Payment collection against an APPROVED loan must be rejected with the exact status message
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: approvedLoanId,
          customerId,
          amount: 4375,
          penaltyAmount: 0,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error || res.body.message)).toContain('Loan is not in an active status for payment collection (current status: APPROVED)');

      // Payment preview against an APPROVED loan must also be rejected
      const prevRes = await request(app)
        .get(`/api/v1/payments/preview?loanId=${approvedLoanId}&amount=4375`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(prevRes.status).toBe(400);
      expect(JSON.stringify(prevRes.body.error || prevRes.body.message)).toContain('Loan is not in an active status for payment collection (current status: APPROVED)');
    });

    test('19. Unapproved loan cannot be activated or accept payment', async () => {
      // Payment attempt against PENDING_APPROVAL
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: unapprovedLoanId,
          customerId,
          amount: 5000,
          paymentMode: 'CASH',
        });
      expect(payRes.status).toBe(400);
      expect(JSON.stringify(payRes.body.error || payRes.body.message)).toContain('current status: PENDING_APPROVAL');

      // Disbursement attempt against PENDING_APPROVAL must be rejected
      const disbRes = await request(app)
        .post(`/api/v1/loans/${unapprovedLoanId}/disburse`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});
      expect(disbRes.status).toBe(400);
      expect(JSON.stringify(disbRes.body.error || disbRes.body.message)).toContain('pending Super Admin approval');
    });

    test('Unauthorized roles cannot disburse loans', async () => {
      const disbResAgent = await request(app)
        .post(`/api/v1/loans/${approvedLoanId}/disburse`)
        .set('Authorization', `Bearer ${agentAToken}`)
        .send({});
      expect(disbResAgent.status).toBe(403);

      const disbResDealer = await request(app)
        .post(`/api/v1/loans/${approvedLoanId}/disburse`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({});
      expect(disbResDealer.status).toBe(403);
    });

    test('14. Authorized activation disburses the loan and transitions it to ACTIVE', async () => {
      const disbRes = await request(app)
        .post(`/api/v1/loans/${approvedLoanId}/disburse`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          assignedAgentId: agentAId,
        });

      expect(disbRes.status).toBe(200);
      expect(disbRes.body.success).toBe(true);
      expect(disbRes.body.data.status).toBe(LoanStatus.ACTIVE);

      // Verify database state
      const checkLoan = await queryPostgres('SELECT status, assigned_agent_id FROM loans WHERE id = $1', [approvedLoanId]);
      expect(checkLoan.rows[0].status).toBe('ACTIVE');
      expect(checkLoan.rows[0].assigned_agent_id).toBe(agentAId);

      // Verify EMI installments were generated
      const emiCheck = await queryPostgres('SELECT COUNT(*) as count FROM emi_installments WHERE loan_id = $1', [approvedLoanId]);
      expect(parseInt(emiCheck.rows[0].count, 10)).toBe(2);
    });

    test('18. Activation retries are idempotent and do not duplicate EMI installments', async () => {
      const disbRetry = await request(app)
        .post(`/api/v1/loans/${approvedLoanId}/disburse`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          assignedAgentId: agentAId,
        });

      expect(disbRetry.status).toBe(200);
      expect(disbRetry.body.data.status).toBe(LoanStatus.ACTIVE);

      // Count of installments must still be exactly 2
      const emiCheck = await queryPostgres('SELECT COUNT(*) as count FROM emi_installments WHERE loan_id = $1', [approvedLoanId]);
      expect(parseInt(emiCheck.rows[0].count, 10)).toBe(2);
    });

    test('15. Newly ACTIVE loan now successfully accepts payment', async () => {
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: approvedLoanId,
          customerId,
          amount: 4375,
          penaltyAmount: 0,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.success).toBe(true);
      expect(payRes.body.data.receiptNumber).toMatch(/^RCP-\d+-\d+$/);
    });
  });

  describe('Part B: Manual Penalty & Collection Queue Integration Tests', () => {
    let activeLoanId: string;
    let emi1Id: string;
    let emi2Id: string;

    beforeEach(async () => {
      activeLoanId = uuidv4();
      emi1Id = uuidv4();
      emi2Id = uuidv4();

      // Seed active loan with 2 installments: 4375 each, total payable = 8750
      await queryPostgres(
        `INSERT INTO loans (
          id, customer_id, dealer_id, loan_account_no, principal_amount, down_payment, net_disbursed_amount,
          total_interest, total_payable, total_paid, outstanding_balance, emi_amount, total_installments,
          tenure_months, annual_interest_rate, status, disbursement_date, first_emi_date, maturity_date,
          assigned_agent_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 8750.00, 0.00, 8750.00, 0.00, 8750.00, 0.00, 8750.00, 4375.00, 2, 2, 0.00, 'ACTIVE', $5, $5, $6, $7, NOW(), NOW())`,
        [activeLoanId, customerId, dealerId, `LN-ACT-${Math.random().toString(36).substring(2, 7)}`, pastDueDate, futureDueDate, agentAId]
      );

      // Seed overdue installment 1 & future installment 2
      await queryPostgres(
        `INSERT INTO emi_installments (
          id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
          expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
        ) VALUES 
          ($1, $2, $3, 1, $4, 4375.00, 0.00, 4375.00, 0.00, 4375.00, 0.00, 'OVERDUE', 10, NOW(), NOW()),
          ($5, $2, $3, 2, $6, 4375.00, 0.00, 4375.00, 0.00, 4375.00, 0.00, 'UPCOMING', 0, NOW(), NOW())`,
        [emi1Id, activeLoanId, customerId, pastDueDate, emi2Id, futureDueDate]
      );
    });

    test('1. Admin payment without penalty succeeds', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: activeLoanId,
          emiId: emi1Id,
          customerId,
          amount: 4375,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe(4375);
      expect(res.body.data.penaltyAmount).toBe(0);
    });

    test('2 & 8 & 9. Admin payment with manual penalty succeeds, receipt retains penalty, audit records it', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: activeLoanId,
          emiId: emi1Id,
          customerId,
          amount: 4375,
          penaltyAmount: 150,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res.status).toBe(201);
      const paymentData = res.body.data;
      expect(paymentData.amount).toBe(4525);
      expect(paymentData.penaltyAmount).toBe(150);

      // Verify receipt retains penalty
      const receiptRes = await request(app)
        .get(`/api/v1/payments/receipt/${paymentData.id || paymentData.paymentId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(receiptRes.status).toBe(200);
      expect(receiptRes.body.data.penaltyAmount).toBe(150);
      expect(receiptRes.body.data.amount).toBe(4525);

      // Verify audit record contains penaltyAmount
      const auditRes = await queryPostgres(
        `SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'PAYMENT_COLLECTED'`,
        [paymentData.id || paymentData.paymentId]
      );
      expect(auditRes.rows.length).toBe(1);
      const auditState = typeof auditRes.rows[0].new_state === 'string'
        ? JSON.parse(auditRes.rows[0].new_state)
        : auditRes.rows[0].new_state;
      expect(auditState.penaltyAmount).toBe(150);
      expect(auditState.amount).toBe(4525);
    });

    test('3 & 4. Collection Queue payment with and without manual penalty succeeds', async () => {
      // Payment without penalty
      const resNoPen = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: activeLoanId,
          emiId: emi1Id,
          customerId,
          amount: 4375,
          penaltyAmount: 0,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });
      expect(resNoPen.status).toBe(201);

      // Next installment payment with manual penalty
      const resWithPen = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: activeLoanId,
          emiId: emi2Id,
          customerId,
          amount: 4375,
          penaltyAmount: 200,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });
      expect(resWithPen.status).toBe(201);
      expect(resWithPen.body.data.penaltyAmount).toBe(200);
    });

    test('5 & 20. Recovery Agent payment with manual penalty succeeds for assigned loan, rejects unassigned', async () => {
      // Agent B (not assigned) attempts payment on loan assigned to Agent A -> 403 Forbidden
      const resUnassigned = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentBToken}`)
        .send({
          loanId: activeLoanId,
          customerId,
          amount: 4375,
          penaltyAmount: 150,
          paymentMode: 'CASH',
          collectionSource: 'RECOVERY_AGENT',
        });
      expect(resUnassigned.status).toBe(403);
      expect(JSON.stringify(resUnassigned.body.error || resUnassigned.body.message)).toContain('not authorized to collect payments');

      // Agent A (assigned) collects with manual penalty -> 201 Created
      const resAssigned = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentAToken}`)
        .send({
          loanId: activeLoanId,
          customerId,
          amount: 4375,
          penaltyAmount: 150,
          paymentMode: 'CASH',
          collectionSource: 'RECOVERY_AGENT',
        });
      expect(resAssigned.status).toBe(201);
      expect(resAssigned.body.data.amount).toBe(4525);
      expect(resAssigned.body.data.penaltyAmount).toBe(150);
      expect(resAssigned.body.data.collectionSource).toBe('RECOVERY_AGENT');
      expect(resAssigned.body.data.agentId).toBe(agentAId);
    });

    test('6. Missing penaltyAmount safely defaults to zero', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: activeLoanId,
          customerId,
          amount: 4375,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.penaltyAmount).toBe(0);

      // Verify no fake penalty record was inserted in emi_penalties
      const penCheck = await queryPostgres('SELECT COUNT(*) as count FROM emi_penalties WHERE loan_id = $1', [activeLoanId]);
      expect(parseInt(penCheck.rows[0].count, 10)).toBe(0);
    });

    test('7. Invalid/negative penalty is rejected', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: activeLoanId,
          customerId,
          amount: 4375,
          penaltyAmount: -50,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res.status).toBe(422);
    });

    test('10 & 11. Outstanding balance and ledger remain correct; no double penalty charging', async () => {
      // 1st installment payment with penalty: 4375 principal/interest + 150 penalty
      const res1 = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: activeLoanId,
          emiId: emi1Id,
          customerId,
          amount: 4375,
          penaltyAmount: 150,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res1.status).toBe(201);

      // Verify loan outstanding balance: 8750 - 4375 = 4375 (NOT 4225!)
      const loanCheck1 = await queryPostgres('SELECT outstanding_balance, total_paid FROM loans WHERE id = $1', [activeLoanId]);
      expect(Number(loanCheck1.rows[0].outstanding_balance)).toBe(4375);
      expect(Number(loanCheck1.rows[0].total_paid)).toBe(4525);

      // Verify emi1 is PAID and penalty is 0 remaining
      const emi1Check = await queryPostgres('SELECT status, remaining_amount, penalty_amount FROM emi_installments WHERE id = $1', [emi1Id]);
      expect(emi1Check.rows[0].status).toBe('PAID');
      expect(Number(emi1Check.rows[0].remaining_amount)).toBe(0);
      expect(Number(emi1Check.rows[0].penalty_amount)).toBe(0);

      // 2nd installment payment without penalty
      const res2 = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          loanId: activeLoanId,
          emiId: emi2Id,
          customerId,
          amount: 4375,
          penaltyAmount: 0,
          paymentMode: 'CASH',
          collectionSource: 'DIRECT_CUSTOMER',
        });

      expect(res2.status).toBe(201);

      // Loan should now be CLOSED and outstanding balance exactly 0
      const loanCheck2 = await queryPostgres('SELECT status, outstanding_balance, total_paid FROM loans WHERE id = $1', [activeLoanId]);
      expect(Number(loanCheck2.rows[0].outstanding_balance)).toBe(0);
      expect(Number(loanCheck2.rows[0].total_paid)).toBe(8900);
      expect(loanCheck2.rows[0].status).toBe('CLOSED');
    });

    test('12. Existing dealer collection flow still works', async () => {
      // Enable dealer penalty setting
      await queryPostgres(
        `INSERT INTO system_settings (key, value, description, updated_at)
         VALUES ('ALLOW_DEALER_PENALTY', 'true', 'Enable dealer penalties', NOW())
         ON CONFLICT (key) DO UPDATE SET value = 'true'`
      );

      const resDealer = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          loanId: activeLoanId,
          customerId,
          amount: 1000,
          penaltyAmount: 50,
          paymentMode: 'CASH',
          collectionSource: 'DEALER',
          dealerId,
        });

      expect(resDealer.status).toBe(201);
      expect(resDealer.body.data.collectionSource).toBe('DEALER');
      expect(resDealer.body.data.dealerId).toBe(dealerId);
    });
  });
});
