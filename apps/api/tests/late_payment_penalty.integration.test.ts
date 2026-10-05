import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, LoanStatus, getBusinessDate, addDays } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Manual Late-Payment Penalty System Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);

  const superAdminEmail = `sa_${runId}@penaltytest.com`;
  const adminEmail = `admin_${runId}@penaltytest.com`;
  const agentEmail = `agent_${runId}@penaltytest.com`;
  const dealer1UserEmail = `dealer1_${runId}@penaltytest.com`;
  const dealer2UserEmail = `dealer2_${runId}@penaltytest.com`;

  let superAdminToken: string;
  let adminToken: string;
  let agentToken: string;
  let dealer1Token: string;
  let dealer2Token: string;

  let superAdminId: string;
  let adminId: string;
  let agentId: string;
  let dealer1UserId: string;
  let dealer2UserId: string;

  let dealer1Id: string;
  let dealer2Id: string;

  let customer1Id: string;
  let customer2Id: string;

  let loan1Id: string;
  let loan2Id: string;

  let overdueEmi1Id: string;
  let upcomingEmi1Id: string;
  let overdueEmi2Id: string;

  let portalToken1: string;

  const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
  const pastDueDate = addDays(businessToday, -15);
  const futureDueDate = addDays(businessToday, 15);

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    superAdminId = uuidv4();
    adminId = uuidv4();
    agentId = uuidv4();
    dealer1UserId = uuidv4();
    dealer2UserId = uuidv4();

    dealer1Id = uuidv4();
    dealer2Id = uuidv4();

    customer1Id = uuidv4();
    customer2Id = uuidv4();

    loan1Id = uuidv4();
    loan2Id = uuidv4();

    // 1. Seed Dealers
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES 
         ($1, $2, 'Apex Mobile 1', 'Owner One', $3, 'Kasna', 'Shop 10, Kasna Market', 'ACTIVE', NOW(), NOW()),
         ($4, $5, 'Apex Mobile 2', 'Owner Two', $6, 'Dadri', 'Shop 20, Dadri Main Rd', 'ACTIVE', NOW(), NOW())`,
      [
        dealer1Id, `DLR-${runId}-01`, `+9191${Date.now().toString().slice(-8)}`,
        dealer2Id, `DLR-${runId}-02`, `+9192${Date.now().toString().slice(-8)}`,
      ]
    );

    // 2. Seed Users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'Super Admin', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $4, 'Finance Admin', 'ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($8, $9, $10, $4, 'Field Recovery Agent', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
         ($11, $12, $13, $4, 'Dealer One User', 'DEALER', $14, 'ACTIVE', NOW(), NOW()),
         ($15, $16, $17, $4, 'Dealer Two User', 'DEALER', $18, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, superAdminEmail, `+9190${Math.floor(10000000 + Math.random() * 90000000)}`, hash,
        adminId, adminEmail, `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
        agentId, agentEmail, `+9194${Math.floor(10000000 + Math.random() * 90000000)}`,
        dealer1UserId, dealer1UserEmail, `+9195${Math.floor(10000000 + Math.random() * 90000000)}`, dealer1Id,
        dealer2UserId, dealer2UserEmail, `+9196${Math.floor(10000000 + Math.random() * 90000000)}`, dealer2Id,
      ]
    );

    // 3. Login users to get tokens
    const saLogin = await request(app).post('/api/v1/auth/login').send({ email: superAdminEmail, password: 'Password@123' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const admLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = admLogin.body.data.tokens.accessToken;

    const agtLogin = await request(app).post('/api/v1/auth/login').send({ email: agentEmail, password: 'Password@123' });
    agentToken = agtLogin.body.data.tokens.accessToken;

    const d1Login = await request(app).post('/api/v1/auth/login').send({ email: dealer1UserEmail, password: 'Password@123' });
    dealer1Token = d1Login.body.data.tokens.accessToken;

    const d2Login = await request(app).post('/api/v1/auth/login').send({ email: dealer2UserEmail, password: 'Password@123' });
    dealer2Token = d2Login.body.data.tokens.accessToken;

    // 4. Seed Customers
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES 
         ($1, $2, 'Aarav Sharma', $3, '123 Market St', 'Greater Noida', 'Uttar Pradesh', '201310', 'Kasna', NOW(), NOW()),
         ($4, $5, 'Vivaan Verma', $6, '456 Station Rd', 'Greater Noida', 'Uttar Pradesh', '201306', 'Dadri', NOW(), NOW())`,
      [
        customer1Id, `CUST-${runId}-01`, `+9197${Math.floor(10000000 + Math.random() * 90000000)}`,
        customer2Id, `CUST-${runId}-02`, `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      ]
    );

    // 5. Seed Loans
    // Loan 1 (Dealer 1): 2 installments of ₹8,791.59 each, total = ₹17,583.18
    await queryPostgres(
      `INSERT INTO loans (
         id, customer_id, dealer_id, assigned_agent_id, loan_account_no,
         principal_amount, down_payment, net_disbursed_amount, total_interest, total_payable,
         total_paid, outstanding_balance, emi_amount, total_installments,
         tenure_months, annual_interest_rate, status, disbursement_date, first_emi_date, maturity_date,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         15000.00, 0.00, 15000.00, 2583.18, 17583.18,
         0.00, 17583.18, 8791.59, 2,
         2, 14.00, 'ACTIVE', $6, $6, $7,
         NOW(), NOW()
       )`,
      [loan1Id, customer1Id, dealer1Id, agentId, `LN-${runId}-001`, pastDueDate, futureDueDate]
    );

    // Loan 2 (Dealer 2)
    await queryPostgres(
      `INSERT INTO loans (
         id, customer_id, dealer_id, assigned_agent_id, loan_account_no,
         principal_amount, down_payment, net_disbursed_amount, total_interest, total_payable,
         total_paid, outstanding_balance, emi_amount, total_installments,
         tenure_months, annual_interest_rate, status, disbursement_date, first_emi_date, maturity_date,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         10000.00, 0.00, 10000.00, 1000.00, 11000.00,
         0.00, 11000.00, 5500.00, 2,
         2, 10.00, 'ACTIVE', $6, $6, $7,
         NOW(), NOW()
       )`,
      [loan2Id, customer2Id, dealer2Id, agentId, `LN-${runId}-002`, pastDueDate, futureDueDate]
    );

    // 6. Seed Installments
    overdueEmi1Id = uuidv4();
    upcomingEmi1Id = uuidv4();
    overdueEmi2Id = uuidv4();

    // Loan 1 EMI #1: Overdue by 15 days
    await queryPostgres(
      `INSERT INTO emi_installments (
         id, loan_id, customer_id, installment_number, due_date,
         principal_component, interest_component, expected_amount,
         paid_amount, remaining_amount, penalty_amount, status, days_overdue,
         created_at, updated_at
       ) VALUES 
         ($1, $2, $3, 1, $4, 7500.00, 1291.59, 8791.59, 0.00, 8791.59, 0.00, 'OVERDUE', 15, NOW(), NOW()),
         ($5, $2, $3, 2, $6, 7500.00, 1291.59, 8791.59, 0.00, 8791.59, 0.00, 'UPCOMING', 0, NOW(), NOW())`,
      [overdueEmi1Id, loan1Id, customer1Id, pastDueDate, upcomingEmi1Id, futureDueDate]
    );

    // Loan 2 EMI #1: Overdue
    await queryPostgres(
      `INSERT INTO emi_installments (
         id, loan_id, customer_id, installment_number, due_date,
         principal_component, interest_component, expected_amount,
         paid_amount, remaining_amount, penalty_amount, status, days_overdue,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 1, $4, 5000.00, 500.00, 5500.00, 0.00, 5500.00, 0.00, 'OVERDUE', 15, NOW(), NOW())`,
      [overdueEmi2Id, loan2Id, customer2Id, pastDueDate]
    );

    // 7. Generate customer portal link for loan 1
    const linkRes = await request(app)
      .post(`/api/v1/portal/loans/${loan1Id}/link`)
      .set('Authorization', `Bearer ${adminToken}`);
    portalToken1 = linkRes.body.data.token;
  });

  describe('Part 1: Super Admin System Setting for Dealer Penalties', () => {
    test('Default setting is false (OFF)', async () => {
      // Set to false first to ensure test isolation
      await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ allowDealerPenalty: false });

      const res = await request(app)
        .get('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${dealer1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.allowDealerPenalty).toBe(false);
    });

    test('Non-Super Admin cannot update dealer penalty setting (403)', async () => {
      const resAdmin = await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ allowDealerPenalty: true });
      expect(resAdmin.status).toBe(403);

      const resDealer = await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({ allowDealerPenalty: true });
      expect(resDealer.status).toBe(403);
    });

    test('Super Admin can toggle dealer penalty setting to true (ON)', async () => {
      const res = await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ allowDealerPenalty: true });

      expect(res.status).toBe(200);
      expect(res.body.data.allowDealerPenalty).toBe(true);

      const getRes = await request(app)
        .get('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${dealer1Token}`);
      expect(getRes.body.data.allowDealerPenalty).toBe(true);
    });
  });

  describe('Part 2: RBAC and RLAC on Manual Penalty Creation', () => {
    test('Unauthenticated user receives HTTP 401', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .send({ amount: 500, reason: 'Late payment' });
      expect(res.status).toBe(401);
    });

    test('Collection Agent is blocked with HTTP 403', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ amount: 500, reason: 'Late payment' });
      expect(res.status).toBe(403);
    });

    test('Dealer receives HTTP 403 when setting is OFF', async () => {
      // Turn setting OFF
      await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ allowDealerPenalty: false });

      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({ amount: 500, reason: 'Dealer attempt while OFF' });

      expect(res.status).toBe(403);
    });

    test('Dealer receives HTTP 403 when attempting another dealer EMI even when setting is ON', async () => {
      // Turn setting ON
      await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ allowDealerPenalty: true });

      // Dealer 1 attempts to add penalty on Dealer 2 EMI
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmi2Id}/penalties`)
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({ amount: 300, reason: 'Cross dealer attempt' });

      expect(res.status).toBe(403);
    });

    test('Dealer can add penalty to own customer overdue EMI when setting is ON', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({ amount: 200, reason: 'First late penalty by dealer' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.penalty.amount).toBe(200);
      expect(res.body.data.installment.penaltyAmount).toBe(200);
    });

    test('Super Admin and Admin can add penalty to overdue EMI', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 300, reason: 'Second late penalty by admin' });

      expect(res.status).toBe(201);
      expect(res.body.data.penalty.amount).toBe(300);
      // Total penalty on EMI 1 should now be 200 + 300 = 500
      expect(res.body.data.installment.penaltyAmount).toBe(500);
    });
  });

  describe('Part 3: Overdue and Input Validations', () => {
    test('Non-overdue upcoming EMI is rejected (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${upcomingEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ amount: 100, reason: 'Invalid upcoming attempt' });

      expect(res.status).toBe(400);
      expect(res.body.error?.message || res.body.error).toMatch(/overdue/i);
    });

    test('Negative or zero amount is rejected (400)', async () => {
      const resZero = await request(app)
        .post(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ amount: 0, reason: 'Zero amount' });
      expect(resZero.status).toBe(400);

      const resNeg = await request(app)
        .post(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ amount: -50, reason: 'Negative amount' });
      expect(resNeg.status).toBe(400);
    });

    test('Missing or empty reason is rejected (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ amount: 100, reason: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error?.message || res.body.error).toMatch(/reason/i);
    });
  });

  describe('Part 4: Financial Calculations and Penalties Listing', () => {
    test('Multiple penalty entries exist and active penalty total equals sum', async () => {
      const res = await request(app)
        .get(`/api/v1/emi/${overdueEmi1Id}/penalties`)
        .set('Authorization', `Bearer ${dealer1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.penalties.length).toBe(2);
      expect(res.body.data.activePenaltyTotal).toBe(500);
      expect(res.body.data.penaltyAmount).toBe(500);
    });

    test('Loan outstanding balance correctly increased by the penalty amounts', async () => {
      const loanRes = await queryPostgres(
        'SELECT outstanding_balance FROM loans WHERE id = $1',
        [loan1Id]
      );
      // Original 17583.18 + 500 penalty = 18083.18
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(18083.18);
    });
  });

  describe('Part 5: Payment Waterfall Integration (Penalty Paid First)', () => {
    test('Partial payment pays penalty first, leaves correct balance and does NOT mark EMI paid', async () => {
      // Overdue EMI 1: expected 8791.59, penalty 500, total due 9291.59.
      // Customer pays 8791.59:
      // ₹500 goes to penalty!
      // ₹8291.59 goes to principal/interest.
      // Remaining EMI due = ₹500. Status must NOT be PAID.
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 8791.59,
          paymentMode: 'UPI',
          collectionSource: 'RECOVERY_AGENT',
          agentId,
          referenceNumber: 'UPI-WATERFALL-01',
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.success).toBe(true);

      // Verify installment state
      const emiRes = await queryPostgres(
        'SELECT paid_amount, remaining_amount, penalty_amount, status FROM emi_installments WHERE id = $1',
        [overdueEmi1Id]
      );
      const emi = emiRes.rows[0];
      expect(Number(emi.paid_amount)).toBe(8291.59);
      expect(Number(emi.remaining_amount)).toBe(500);
      expect(Number(emi.penalty_amount)).toBe(0); // Penalty is fully paid
      expect(emi.status).not.toBe('PAID');

      // Verify penalties in emi_penalties table are marked PAID
      const pensRes = await queryPostgres(
        'SELECT amount, paid_amount, status FROM emi_penalties WHERE emi_installment_id = $1 ORDER BY created_at ASC',
        [overdueEmi1Id]
      );
      expect(pensRes.rows[0].status).toBe('PAID');
      expect(pensRes.rows[1].status).toBe('PAID');
    });

    test('Second payment clears the remaining balance and marks EMI fully PAID', async () => {
      // Pay remaining 500
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 500,
          paymentMode: 'CASH',
          collectionSource: 'RECOVERY_AGENT',
          agentId,
          referenceNumber: 'CASH-WATERFALL-02',
        });

      expect(payRes.status).toBe(201);

      const emiRes = await queryPostgres(
        'SELECT paid_amount, remaining_amount, status FROM emi_installments WHERE id = $1',
        [overdueEmi1Id]
      );
      expect(Number(emiRes.rows[0].remaining_amount)).toBe(0);
      expect(emiRes.rows[0].status).toBe('PAID');
    });
  });

  describe('Part 6: Payment Reversal and Penalty Balance Restoration', () => {
    test('Reversing a payment restores penalty paid amount and status to ACTIVE', async () => {
      // Get the payment ID of the second payment (amount 500)
      const payRes = await queryPostgres(
        `SELECT id FROM payments WHERE loan_id = $1 AND amount = 500 AND is_reversal = FALSE`,
        [loan1Id]
      );
      const paymentId = payRes.rows[0].id;

      const revRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/reverse`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Reversal testing' });

      expect(revRes.status).toBe(200);

      // Verify EMI 1 status restored to non-PAID with 500 remaining
      const emiRes = await queryPostgres(
        'SELECT paid_amount, remaining_amount, status FROM emi_installments WHERE id = $1',
        [overdueEmi1Id]
      );
      expect(Number(emiRes.rows[0].remaining_amount)).toBe(500);
      expect(emiRes.rows[0].status).not.toBe('PAID');
    });
  });

  describe('Part 7: Penalty Waiver / Reversal by Administrator', () => {
    let testPenaltyId: string;

    beforeAll(async () => {
      // Add a penalty on overdueEmi2Id (Loan 2) to test waiver
      const addRes = await request(app)
        .post(`/api/v1/emi/${overdueEmi2Id}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 400, reason: 'Penalty to be waived' });
      testPenaltyId = addRes.body.data.penalty.id;
    });

    test('Non-admin cannot waive penalty (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/penalties/${testPenaltyId}/waive`)
        .set('Authorization', `Bearer ${dealer2Token}`)
        .send({ reason: 'Dealer cannot waive' });
      expect(res.status).toBe(403);
    });

    test('Admin can waive active penalty', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/penalties/${testPenaltyId}/waive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Customer hardship waiver approved' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('WAIVED');

      // Verify penalty in DB
      const penRes = await queryPostgres(
        'SELECT status, reversal_reason FROM emi_penalties WHERE id = $1',
        [testPenaltyId]
      );
      expect(penRes.rows[0].status).toBe('WAIVED');
      expect(penRes.rows[0].reversal_reason).toBe('Customer hardship waiver approved');
    });
  });

  describe('Part 8: Customer Portal Penalty Breakdown and Privacy', () => {
    test('Customer portal response returns totalPenaltyAmount and installment breakdown', async () => {
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: portalToken1 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      expect(data).toHaveProperty('totalPenaltyAmount');
      expect(data).toHaveProperty('outstandingBalance');
      expect(data.installments.length).toBeGreaterThan(0);

      const inst1 = data.installments[0];
      expect(inst1).toHaveProperty('penaltyAmount');
      expect(inst1).toHaveProperty('totalDue');
      expect(inst1).toHaveProperty('daysOverdue');

      // Ensure customer-safe payload (no internal user IDs or secrets)
      expect(data).not.toHaveProperty('created_by');
      expect(data).not.toHaveProperty('password');
      expect(data).not.toHaveProperty('assignedAgentId');
    });

    test('Invalid portal token is rejected with 401', async () => {
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: 'cpt_invalid_xyz_00000000000000' });
      expect(res.status).toBe(401);
    });
  });

  describe('Part 9: Audit Trail Integrity', () => {
    test('Penalty mutations create immutable audit log records', async () => {
      const auditRes = await queryPostgres(
        `SELECT action, entity, new_state FROM audit_logs 
         WHERE action IN ('PENALTY_ADDED', 'PENALTY_WAIVED', 'SYSTEM_SETTING_UPDATED')
         ORDER BY created_at DESC`
      );

      const actions = auditRes.rows.map((r) => r.action);
      expect(actions).toContain('PENALTY_ADDED');
      expect(actions).toContain('PENALTY_WAIVED');
      expect(actions).toContain('SYSTEM_SETTING_UPDATED');
    });
  });

  afterAll(async () => {
    try {
      await queryPostgres(`DELETE FROM emi_penalties WHERE loan_id IN ($1, $2)`, [loan1Id, loan2Id]);
      await queryPostgres(`DELETE FROM payments WHERE loan_id IN ($1, $2)`, [loan1Id, loan2Id]);
      await queryPostgres(`DELETE FROM customer_portal_tokens WHERE loan_id IN ($1, $2)`, [loan1Id, loan2Id]);
      await queryPostgres(`DELETE FROM emi_installments WHERE loan_id IN ($1, $2)`, [loan1Id, loan2Id]);
      await queryPostgres(`DELETE FROM loans WHERE id IN ($1, $2)`, [loan1Id, loan2Id]);
      await queryPostgres(`DELETE FROM customers WHERE id IN ($1, $2)`, [customer1Id, customer2Id]);
      await queryPostgres(`DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5)`, [superAdminId, adminId, agentId, dealer1UserId, dealer2UserId]);
      await queryPostgres(`DELETE FROM dealers WHERE id IN ($1, $2)`, [dealer1Id, dealer2Id]);
    } catch (e) {
      // Ignore cleanup error if already deleted
    }
  });
});

