import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, getBusinessDate, addDays } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Advance and Late EMI Penalty Management & Customer Portal Sync Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);

  const superAdminEmail = `sa_${runId}@penaltysync.com`;
  const adminEmail = `admin_${runId}@penaltysync.com`;
  const agentEmail = `agent_${runId}@penaltysync.com`;
  const dealer1UserEmail = `dealer1_${runId}@penaltysync.com`;
  const dealer2UserEmail = `dealer2_${runId}@penaltysync.com`;

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

  let customerAId: string;
  let customerBId: string;

  let loanAId: string;
  let loanBId: string;

  let upcomingEmiId: string;
  let overdueEmiId: string;
  let paidEmiId: string;
  let emiLoanBId: string;

  let portalTokenA: string;
  let portalTokenB: string;

  const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
  const pastDueDate = addDays(businessToday, -10);
  const futureDueDate = addDays(businessToday, 20);

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    superAdminId = uuidv4();
    adminId = uuidv4();
    agentId = uuidv4();
    dealer1UserId = uuidv4();
    dealer2UserId = uuidv4();

    dealer1Id = uuidv4();
    dealer2Id = uuidv4();

    customerAId = uuidv4();
    customerBId = uuidv4();

    loanAId = uuidv4();
    loanBId = uuidv4();

    upcomingEmiId = uuidv4();
    overdueEmiId = uuidv4();
    paidEmiId = uuidv4();
    emiLoanBId = uuidv4();

    // 1. Seed Dealers
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES 
         ($1, $2, 'Store A', 'Owner A', $3, 'Kasna', 'Market A', 'ACTIVE', NOW(), NOW()),
         ($4, $5, 'Store B', 'Owner B', $6, 'Dadri', 'Market B', 'ACTIVE', NOW(), NOW())`,
      [
        dealer1Id, `DLR-${runId}-01`, `+9192${Date.now().toString().slice(-8)}`,
        dealer2Id, `DLR-${runId}-02`, `+9193${Date.now().toString().slice(-8)}`,
      ]
    );

    // 2. Seed Users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'Super Admin Sync', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $4, 'Admin Sync', 'ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($8, $9, $10, $4, 'Agent Sync', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
         ($11, $12, $13, $4, 'Dealer 1 Sync', 'DEALER', $14, 'ACTIVE', NOW(), NOW()),
         ($15, $16, $17, $4, 'Dealer 2 Sync', 'DEALER', $18, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, superAdminEmail, `+9190${Math.floor(10000000 + Math.random() * 90000000)}`, hash,
        adminId, adminEmail, `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
        agentId, agentEmail, `+9194${Math.floor(10000000 + Math.random() * 90000000)}`,
        dealer1UserId, dealer1UserEmail, `+9195${Math.floor(10000000 + Math.random() * 90000000)}`, dealer1Id,
        dealer2UserId, dealer2UserEmail, `+9196${Math.floor(10000000 + Math.random() * 90000000)}`, dealer2Id,
      ]
    );

    // 3. Login to retrieve access tokens
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
         ($1, $2, 'Customer A Sync', $3, '123 Market St', 'Greater Noida', 'Uttar Pradesh', '201310', 'Kasna', NOW(), NOW()),
         ($4, $5, 'Customer B Sync', $6, '456 Station Rd', 'Greater Noida', 'Uttar Pradesh', '201306', 'Dadri', NOW(), NOW())`,
      [
        customerAId, `CUST-A-${runId}`, `+9197${Math.floor(10000000 + Math.random() * 90000000)}`,
        customerBId, `CUST-B-${runId}`, `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
      ]
    );

    // 5. Seed Loans: Loan A (10,000 principal, 10,000 balance), Loan B (5,000 balance)
    await queryPostgres(
      `INSERT INTO loans (
        id, customer_id, dealer_id, assigned_agent_id, loan_account_no,
        principal_amount, down_payment, net_disbursed_amount, total_interest, total_payable,
        total_paid, outstanding_balance, emi_amount, total_installments,
        tenure_months, annual_interest_rate, status, disbursement_date, first_emi_date, maturity_date,
        created_at, updated_at
      ) VALUES 
        ($1, $2, $3, $4, $5,
         10000.00, 0.00, 10000.00, 0.00, 10000.00,
         0.00, 10000.00, 3333.33, 3,
         3, 0.00, 'ACTIVE', $6, $6, $7,
         NOW(), NOW()
        ),
        ($8, $9, $10, $4, $11,
         5000.00, 0.00, 5000.00, 0.00, 5000.00,
         0.00, 5000.00, 5000.00, 1,
         1, 0.00, 'ACTIVE', $6, $6, $7,
         NOW(), NOW()
        )`,
      [
        loanAId, customerAId, dealer1Id, agentId, `LN-SYNC-A-${runId}`, pastDueDate, futureDueDate,
        loanBId, customerBId, dealer2Id, `LN-SYNC-B-${runId}`,
      ]
    );

    // 6. Seed Installments for Loan A:
    // EMI 1: Upcoming unpaid (due in 20 days, expected 3333.33, remaining 3333.33)
    // EMI 2: Overdue unpaid (due 10 days ago, expected 3333.33, remaining 3333.33)
    // EMI 3: Paid (due 40 days ago, expected 3333.34, paid 3333.34, remaining 0, status PAID)
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component,
        interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
        status, days_overdue, created_at, updated_at
      ) VALUES 
        ($1, $2, $3, 1, $4, 3333.33, 0, 3333.33, 0, 3333.33, 0, 'UPCOMING', 0, NOW(), NOW()),
        ($5, $2, $3, 2, $6, 3333.33, 0, 3333.33, 0, 3333.33, 0, 'OVERDUE', 10, NOW(), NOW()),
        ($7, $2, $3, 3, $8, 3333.34, 0, 3333.34, 3333.34, 0, 0, 'PAID', 0, NOW(), NOW())`,
      [
        upcomingEmiId, loanAId, customerAId, futureDueDate,
        overdueEmiId, pastDueDate,
        paidEmiId, addDays(businessToday, -40),
      ]
    );

    // Seed Installment for Loan B
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component,
        interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
        status, days_overdue, created_at, updated_at
      ) VALUES 
        ($1, $2, $3, 1, $4, 5000, 0, 5000, 0, 5000, 0, 'UPCOMING', 0, NOW(), NOW())`,
      [
        emiLoanBId, loanBId, customerBId, futureDueDate,
      ]
    );

    // 7. Generate customer portal tokens
    const linkResA = await request(app).post(`/api/v1/portal/loans/${loanAId}/link`).set('Authorization', `Bearer ${adminToken}`);
    portalTokenA = linkResA.body.data.token;

    const linkResB = await request(app).post(`/api/v1/portal/loans/${loanBId}/link`).set('Authorization', `Bearer ${adminToken}`);
    portalTokenB = linkResB.body.data.token;
  });

  describe('1 & 2. Advance and Overdue Penalty Creation by Admin', () => {
    test('1. Admin can add a penalty to an upcoming unpaid EMI', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 250, reason: 'Advance pre-collection charge' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.penalty.amount).toBe(250);
      expect(res.body.data.installment.penaltyAmount).toBe(250);
      expect(res.body.data.installment.totalDue).toBe(3583.33); // 3333.33 + 250
    });

    test('2. Admin can add a penalty to an overdue EMI', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 350, reason: 'Late payment penalty' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.penalty.amount).toBe(350);
      expect(res.body.data.installment.penaltyAmount).toBe(350);
      expect(res.body.data.installment.totalDue).toBe(3683.33); // 3333.33 + 350
    });
  });

  describe('3, 4, 5. Customer Portal Display and Loan Balance Verification', () => {
    test('3. Customer portal shows the newly added penalties before payment', async () => {
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: portalTokenA });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      // Total penalty across installments should be 250 + 350 = 600
      expect(data.totalPenaltyAmount).toBe(600);

      // Verify EMI 1 (Upcoming): has penalty 250
      const emi1 = data.installments.find((i: any) => i.installmentNumber === 1);
      expect(emi1).toBeDefined();
      expect(emi1.penaltyAmount).toBe(250);
      expect(emi1.remainingAmount).toBe(3333.33);

      // Verify EMI 2 (Overdue): has penalty 350
      const emi2 = data.installments.find((i: any) => i.installmentNumber === 2);
      expect(emi2).toBeDefined();
      expect(emi2.penaltyAmount).toBe(350);
      expect(emi2.remainingAmount).toBe(3333.33);
    });

    test('4. Customer-facing total due is recalculated correctly per installment', async () => {
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: portalTokenA });

      const emi1 = res.body.data.installments.find((i: any) => i.installmentNumber === 1);
      const emi2 = res.body.data.installments.find((i: any) => i.installmentNumber === 2);

      expect(emi1.totalDue).toBe(3583.33);
      expect(emi2.totalDue).toBe(3683.33);
    });

    test('5. Loan outstanding balance increases by exactly the additional penalty amount', async () => {
      const loanRes = await queryPostgres(
        'SELECT outstanding_balance FROM loans WHERE id = $1',
        [loanAId]
      );
      // Original 10000 + 250 (upcoming penalty) + 350 (overdue penalty) = 10600
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(10600);
    });
  });

  describe('6. Deduplication and Double-Charge Protection', () => {
    test('6. Repeated identical requests within 5s cannot double-charge the penalty', async () => {
      // Rapid retry with identical amount and reason on upcomingEmiId
      const resRetry = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 250, reason: 'Advance pre-collection charge' });

      expect(resRetry.status).toBe(201);
      expect(resRetry.body.data.isDuplicateReplay).toBe(true);

      // Verify DB penalty count on upcomingEmiId remains exactly 1
      const countRes = await queryPostgres(
        'SELECT COUNT(*) as count FROM emi_penalties WHERE emi_installment_id = $1 AND status = \'ACTIVE\'',
        [upcomingEmiId]
      );
      expect(Number(countRes.rows[0].count)).toBe(1);

      // Verify loan outstanding balance was NOT incremented again
      const loanRes = await queryPostgres(
        'SELECT outstanding_balance FROM loans WHERE id = $1',
        [loanAId]
      );
      expect(Number(loanRes.rows[0].outstanding_balance)).toBe(10600);
    });
  });

  describe('7. Ineligible Installment Rejection', () => {
    test('7a. Fully paid installment rejects penalty additions with HTTP 400', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${paidEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, reason: 'Attempt on paid EMI' });

      expect(res.status).toBe(400);
      expect(res.body.error?.message || res.body.error).toMatch(/paid/i);
    });

    test('7b. Zero or negative penalty amount is rejected with HTTP 400', async () => {
      const resZero = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 0, reason: 'Zero amount' });
      expect(resZero.status).toBe(400);

      const resNeg = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: -100, reason: 'Negative amount' });
      expect(resNeg.status).toBe(400);
    });
  });

  describe('8 & 9. Authorization and Role Enforcement', () => {
    test('8. Collection Agents cannot add penalties (HTTP 403)', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ amount: 100, reason: 'Agent attempt' });

      expect(res.status).toBe(403);
    });

    test('9a. Dealer cannot add penalty to upcoming installments (HTTP 400)', async () => {
      // Enable dealer penalty setting
      await request(app)
        .patch('/api/v1/settings/dealer-penalty')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ allowDealerPenalty: true });

      const res = await request(app)
        .post(`/api/v1/emi/${upcomingEmiId}/penalties`)
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({ amount: 100, reason: 'Dealer upcoming attempt' });

      expect(res.status).toBe(400);
      expect(res.body.error?.message || res.body.error).toMatch(/overdue/i);
    });

    test('9b. Dealer cannot add penalty to another store loan (HTTP 403)', async () => {
      // Dealer 2 tries to add penalty to Dealer 1 loan
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmiId}/penalties`)
        .set('Authorization', `Bearer ${dealer2Token}`)
        .send({ amount: 100, reason: 'Cross store attempt' });

      expect(res.status).toBe(403);
    });
  });

  describe('10. Pending Agent Collection Concurrency Guard', () => {
    let pendingPaymentId: string;

    beforeAll(async () => {
      // Agent records a collection on overdueEmiId (pending approval)
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId: loanAId,
          customerId: customerAId,
          emiId: overdueEmiId,
          amount: 1000,
          paymentMode: 'CASH',
          collectionSource: 'RECOVERY_AGENT',
          agentId,
          referenceNumber: `CASH-PENDING-${runId}`,
        });
      pendingPaymentId = payRes.body.data.paymentId;
    });

    test('10. Rejects penalty modifications while an agent collection is pending approval (HTTP 409)', async () => {
      const res = await request(app)
        .post(`/api/v1/emi/${overdueEmiId}/penalties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, reason: 'Conflict test' });

      expect(res.status).toBe(409);
      expect(res.body.error?.message || res.body.error).toMatch(/pending approval/i);
    });

    afterAll(async () => {
      // Clean up the pending payment (reject it)
      if (pendingPaymentId) {
        await request(app)
          .post(`/api/v1/payments/${pendingPaymentId}/reject`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ reason: 'Test cleanup' });
      }
    });
  });

  describe('11 & 12. Payment Allocation and Persistence', () => {
    test('11. Payment allocation pays penalty first in waterfall allocation', async () => {
      // Pay 500 on loan:
      // Installment 1 (upcomingEmiId) is first in waterfall order.
      // Existing penalty on upcomingEmiId is 250.
      // ₹250 should satisfy the penalty on installment 1 completely!
      // ₹250 should go to remaining base installment balance (3333.33 - 250 = 3083.33).
      const payRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          loanId: loanAId,
          customerId: customerAId,
          emiId: upcomingEmiId,
          amount: 500,
          paymentMode: 'UPI',
          collectionSource: 'RECOVERY_AGENT',
          agentId,
          referenceNumber: `UPI-ALLOC-${runId}`,
        });

      expect(payRes.status).toBe(201);

      // Approve collection
      await request(app)
        .post(`/api/v1/payments/${payRes.body.data.paymentId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      // Verify installment 1 state (penalty cleared first, remainder reduces principal)
      const emiRes = await queryPostgres(
        'SELECT paid_amount, remaining_amount, penalty_amount, status FROM emi_installments WHERE id = $1',
        [upcomingEmiId]
      );
      const emi = emiRes.rows[0];
      expect(Number(emi.penalty_amount)).toBe(0); // Penalty is 100% paid
      expect(Number(emi.paid_amount)).toBe(250);
      expect(Number(emi.remaining_amount)).toBe(3083.33);

      // Verify installment 1 penalty record marked PAID
      const penRes = await queryPostgres(
        'SELECT status, paid_amount FROM emi_penalties WHERE emi_installment_id = $1',
        [upcomingEmiId]
      );
      expect(penRes.rows[0].status).toBe('PAID');
      expect(Number(penRes.rows[0].paid_amount)).toBe(250);

      // Verify installment 2 state (untouched because waterfall satisfied on installment 1)
      const emi2Res = await queryPostgres(
        'SELECT paid_amount, remaining_amount, penalty_amount, status FROM emi_installments WHERE id = $1',
        [overdueEmiId]
      );
      const emi2 = emi2Res.rows[0];
      expect(Number(emi2.penalty_amount)).toBe(350);
      expect(Number(emi2.remaining_amount)).toBe(3333.33);
    });

    test('12. Penalty data persists correctly after fresh query / page reload', async () => {
      // Re-fetch portal loan data
      const res = await request(app)
        .get('/api/v1/portal/loan')
        .query({ token: portalTokenA });

      expect(res.status).toBe(200);
      const data = res.body.data;

      // Installment 1 penalty is now 0 (paid), remaining is 3083.33, totalDue is 3083.33
      const emi1 = data.installments.find((i: any) => i.installmentNumber === 1);
      expect(emi1.penaltyAmount).toBe(0);
      expect(emi1.totalDue).toBe(3083.33);

      // Overdue EMI 2 still has its 350 penalty, remaining is 3333.33, totalDue is 3683.33
      const emi2 = data.installments.find((i: any) => i.installmentNumber === 2);
      expect(emi2.penaltyAmount).toBe(350);
      expect(emi2.totalDue).toBe(3683.33);

      // Total penalty remaining is 350
      expect(data.totalPenaltyAmount).toBe(350);
    });
  });

  describe('13 & 14. Customer Isolation and Anti-Caching', () => {
    test('13. Customer A cannot access Customer B loan or penalty details', async () => {
      const resA = await request(app).get('/api/v1/portal/loan').query({ token: portalTokenA });
      const resB = await request(app).get('/api/v1/portal/loan').query({ token: portalTokenB });

      expect(resA.body.data.loanAccountNo).toBe(`LN-SYNC-A-${runId}`);
      expect(resB.body.data.loanAccountNo).toBe(`LN-SYNC-B-${runId}`);

      // Ensure no crossover
      expect(resA.body.data.loanAccountNo).not.toBe(resB.body.data.loanAccountNo);
      expect(resA.body.data.customerName).toContain('Customer A');
      expect(resB.body.data.customerName).toContain('Customer B');
    });

    test('14. Portal endpoint sends no-cache headers to prevent stale cache', async () => {
      const res = await request(app).get('/api/v1/portal/loan').query({ token: portalTokenA });
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['cache-control']).toContain('no-cache');
      expect(res.headers['pragma']).toBe('no-cache');
    });
  });

  afterAll(async () => {
    try {
      await queryPostgres('DELETE FROM emi_penalties WHERE loan_id IN ($1, $2)', [loanAId, loanBId]);
      await queryPostgres('DELETE FROM payments WHERE loan_id IN ($1, $2)', [loanAId, loanBId]);
      await queryPostgres('DELETE FROM customer_portal_tokens WHERE loan_id IN ($1, $2)', [loanAId, loanBId]);
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id IN ($1, $2)', [loanAId, loanBId]);
      await queryPostgres('DELETE FROM loans WHERE id IN ($1, $2)', [loanAId, loanBId]);
      await queryPostgres('DELETE FROM customers WHERE id IN ($1, $2)', [customerAId, customerBId]);
      await queryPostgres('DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5)', [superAdminId, adminId, agentId, dealer1UserId, dealer2UserId]);
      await queryPostgres('DELETE FROM dealers WHERE id IN ($1, $2)', [dealer1Id, dealer2Id]);
    } catch {
      // Ignore cleanup error
    }
  });
});
