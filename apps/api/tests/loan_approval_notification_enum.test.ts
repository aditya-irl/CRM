import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, LoanStatus, NotificationType, InterestMethod, RepaymentFrequency } from '@crm/shared';

describe('Loan Approval Notification Enum & Lifecycle Regression Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);

  const superAdminEmail = `sa_${runId}@loanapprovaltest.com`;
  const dealerUserEmail = `dealer_${runId}@loanapprovaltest.com`;

  let superAdminToken: string;
  let dealerToken: string;

  let superAdminId: string;
  let dealerUserId: string;
  let dealerId: string;
  let customerId: string;

  let testLoan1Id: string;
  let testLoan2Id: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    superAdminId = uuidv4();
    dealerUserId = uuidv4();
    dealerId = uuidv4();
    customerId = uuidv4();
    testLoan1Id = uuidv4();
    testLoan2Id = uuidv4();

    // 1. Seed Dealer Store
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES ($1, $2, 'Approval Test Partner', 'Partner Owner', $3, 'Delhi', 'Connaught Place', 'ACTIVE', NOW(), NOW())`,
      [dealerId, `DLR-${runId}`, `+9198${Date.now().toString().slice(-8)}`]
    );

    // 2. Seed Users: Super Admin and Dealer User
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'Super Admin User', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $4, 'Dealer User', 'DEALER', $8, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, superAdminEmail, `+9190${Math.floor(10000000 + Math.random() * 90000000)}`, hash,
        dealerUserId, dealerUserEmail, `+9195${Math.floor(10000000 + Math.random() * 90000000)}`, dealerId,
      ]
    );

    // 3. Link Dealer to Dealer User
    await queryPostgres('UPDATE dealers SET user_id = $1 WHERE id = $2', [dealerUserId, dealerId]);

    // 4. Seed Customer
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES ($1, $2, 'Approval Borrower', $3, 'Main Street', 'Delhi', 'Delhi', '110001', 'CENTRAL_DELHI', NOW(), NOW())`,
      [customerId, `CUST-${runId}`, `+9197${Math.floor(10000000 + Math.random() * 90000000)}`]
    );

    // 5. Seed Dealer-Originated Loans in PENDING_APPROVAL status
    // Loan 1 for approval and disbursement flow
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        device_brand, device_model, device_name, imei1,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 20000, 2000, 18000,
        5.0, 'FLAT_RATE', 6, 'MONTHLY',
        6, 3900, 5400, 23400, 0,
        23400, '2026-10-16', '2026-11-16', '2027-04-16',
        'Samsung', 'Galaxy A54', 'Samsung Galaxy A54', '358291048291038',
        'PENDING_APPROVAL', $5, NOW(), NOW()
      )`,
      [testLoan1Id, `LN-APPR-${runId}-1`, customerId, dealerId, dealerUserId]
    );

    // Loan 2 for rejection flow
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        device_brand, device_model, device_name, imei1,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 15000, 1500, 13500,
        4.0, 'FLAT_RATE', 6, 'MONTHLY',
        6, 2790, 3240, 16740, 0,
        16740, '2026-10-16', '2026-11-16', '2027-04-16',
        'Xiaomi', 'Redmi Note 13', 'Xiaomi Redmi Note 13', '864291048291039',
        'PENDING_APPROVAL', $5, NOW(), NOW()
      )`,
      [testLoan2Id, `LN-APPR-${runId}-2`, customerId, dealerId, dealerUserId]
    );

    // 6. Obtain auth tokens
    const saLogin = await request(app).post('/api/v1/auth/login').send({ email: superAdminEmail, password: 'Password@123' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const dealerLogin = await request(app).post('/api/v1/auth/login').send({ email: dealerUserEmail, password: 'Password@123' });
    dealerToken = dealerLogin.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    try {
      await queryPostgres('DELETE FROM notifications WHERE recipient_user_id IN ($1, $2)', [superAdminId, dealerUserId]);
      await queryPostgres('DELETE FROM emi_installments WHERE loan_id IN ($1, $2)', [testLoan1Id, testLoan2Id]);
      await queryPostgres('DELETE FROM loans WHERE id IN ($1, $2)', [testLoan1Id, testLoan2Id]);
      await queryPostgres('DELETE FROM customers WHERE id = $1', [customerId]);
      await queryPostgres('DELETE FROM users WHERE id IN ($1, $2)', [superAdminId, dealerUserId]);
      await queryPostgres('DELETE FROM dealers WHERE id = $1', [dealerId]);
    } catch {}
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // -------------------------------------------------------------------------
  // 1. PostgreSQL Enum Verification
  // -------------------------------------------------------------------------
  test('PostgreSQL notification_type enum contains LOAN_APPROVED and all required lifecycle types', async () => {
    const res = await queryPostgres<{ enumlabel: string }>(`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'notification_type'
      ORDER BY e.enumsortorder;
    `);

    const enumValues = res.rows.map((r) => r.enumlabel);

    expect(enumValues).toContain(NotificationType.LOAN_APPROVED);
    expect(enumValues).toContain(NotificationType.LOAN_REJECTED);
    expect(enumValues).toContain(NotificationType.LOAN_DISBURSED);
    expect(enumValues).toContain(NotificationType.DEALER_PAYMENT_RECORDED);
    expect(enumValues).toContain(NotificationType.LOAN_APPROVAL_REQUEST);
    expect(enumValues).toContain(NotificationType.DEALER_APPROVAL_REQUIRED);
  });

  // -------------------------------------------------------------------------
  // 2. Loan Approval Execution & Notification Persistence
  // -------------------------------------------------------------------------
  test('Super Admin approves pending dealer loan without enum error and persists LOAN_APPROVED notification', async () => {
    const res = await request(app)
      .post(`/api/v1/loans/${testLoan1Id}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ notes: 'Verified borrower credentials and device info. Approved.' });

    // Must return HTTP 200 without PostgreSQL notification_type enum error
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(LoanStatus.APPROVED);

    // Verify loan status in database
    const loanCheck = await queryPostgres('SELECT status FROM loans WHERE id = $1', [testLoan1Id]);
    expect(loanCheck.rows[0].status).toBe(LoanStatus.APPROVED);

    // Verify LOAN_APPROVED notification was successfully persisted for the dealer
    const notifCheck = await queryPostgres(
      `SELECT id, recipient_user_id, channel, type, title, body, status, metadata
       FROM notifications
       WHERE recipient_user_id = $1 AND type = 'LOAN_APPROVED'`,
      [dealerUserId]
    );

    expect(notifCheck.rows.length).toBe(1);
    const notif = notifCheck.rows[0];
    expect(notif.recipient_user_id).toBe(dealerUserId);
    expect(notif.type).toBe('LOAN_APPROVED');
    expect(notif.channel).toBe('IN_APP');
    expect(notif.title).toContain(`LN-APPR-${runId}-1`);
    expect(notif.body).toContain('approved by administration');

    const meta = typeof notif.metadata === 'string' ? JSON.parse(notif.metadata) : notif.metadata;
    expect(meta.loanId).toBe(testLoan1Id);
    expect(meta.status).toBe(LoanStatus.APPROVED);
  });

  // -------------------------------------------------------------------------
  // 3. Dealer Retrieval of Loan Approval Notification
  // -------------------------------------------------------------------------
  test('Dealer retrieves LOAN_APPROVED notification via GET /api/v1/notifications', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${dealerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications.length).toBeGreaterThanOrEqual(1);

    const approvedNotif = res.body.data.notifications.find(
      (n: any) => n.type === 'LOAN_APPROVED' && n.metadata?.loanId === testLoan1Id
    );
    expect(approvedNotif).toBeDefined();
    expect(approvedNotif.title).toContain(`LN-APPR-${runId}-1`);
  });

  // -------------------------------------------------------------------------
  // 4. Loan Rejection Execution & LOAN_REJECTED Notification Persistence
  // -------------------------------------------------------------------------
  test('Super Admin rejects pending dealer loan and persists LOAN_REJECTED notification', async () => {
    const rejectionReason = 'Incomplete KYC documentation and invalid phone';
    const res = await request(app)
      .post(`/api/v1/loans/${testLoan2Id}/reject`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ reason: rejectionReason });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(LoanStatus.REJECTED);

    // Verify LOAN_REJECTED notification in database
    const notifCheck = await queryPostgres(
      `SELECT id, recipient_user_id, channel, type, title, body, status, metadata
       FROM notifications
       WHERE recipient_user_id = $1 AND type = 'LOAN_REJECTED'`,
      [dealerUserId]
    );

    expect(notifCheck.rows.length).toBe(1);
    const notif = notifCheck.rows[0];
    expect(notif.type).toBe('LOAN_REJECTED');
    expect(notif.title).toContain(`LN-APPR-${runId}-2`);
    expect(notif.body).toContain(rejectionReason);
  });

  // -------------------------------------------------------------------------
  // 5. Loan Disbursement Execution & LOAN_DISBURSED Notification Persistence
  // -------------------------------------------------------------------------
  test('Super Admin disburses approved loan and persists LOAN_DISBURSED notification', async () => {
    const res = await request(app)
      .post(`/api/v1/loans/${testLoan1Id}/disburse`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(LoanStatus.ACTIVE);

    // Verify LOAN_DISBURSED notification in database
    const notifCheck = await queryPostgres(
      `SELECT id, recipient_user_id, channel, type, title, body, status, metadata
       FROM notifications
       WHERE recipient_user_id = $1 AND type = 'LOAN_DISBURSED'`,
      [dealerUserId]
    );

    expect(notifCheck.rows.length).toBe(1);
    const notif = notifCheck.rows[0];
    expect(notif.type).toBe('LOAN_DISBURSED');
    expect(notif.title).toContain(`LN-APPR-${runId}-1`);
  });

  // -------------------------------------------------------------------------
  // 6. Transactional Atomicity: Notification Failure Prevents Inconsistent Loan State
  // -------------------------------------------------------------------------
  test('Transaction rollback prevents inconsistent loan state if notification fails', async () => {
    const unapprovedLoanId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 10000, 1000, 9000,
        4.0, 'FLAT_RATE', 6, 'MONTHLY',
        6, 1860, 2160, 11160, 0,
        11160, '2026-10-16', '2026-11-16', '2027-04-16',
        'PENDING_APPROVAL', $5, NOW(), NOW()
      )`,
      [unapprovedLoanId, `LN-FAIL-${runId}`, customerId, dealerId, dealerUserId]
    );

    // Simulate atomic transactional failure:
    // If an invalid notification type were passed to client.query inside runPostgresTransaction,
    // the whole transaction must roll back leaving status as PENDING_APPROVAL.
    try {
      const { runPostgresTransaction } = require('../src/database/postgres');
      await runPostgresTransaction(async (client: any) => {
        // Step 1: Update loan to APPROVED
        await client.query("UPDATE loans SET status = 'APPROVED' WHERE id = $1", [unapprovedLoanId]);

        // Step 2: Attempt to insert invalid notification type
        await client.query(
          `INSERT INTO notifications (id, recipient_user_id, channel, type, title, body, status, scheduled_for, created_at)
           VALUES ($1, $2, 'IN_APP', 'NON_EXISTENT_ENUM_VALUE', 'Title', 'Body', 'PENDING', NOW(), NOW())`,
          [uuidv4(), dealerUserId]
        );
      });
    } catch (err: any) {
      // Expected to fail with enum error
      expect(err.message).toMatch(/enum.*notification_type/i);
    }

    // Crucial check: verify that loan is still PENDING_APPROVAL (rolled back)
    const checkState = await queryPostgres('SELECT status FROM loans WHERE id = $1', [unapprovedLoanId]);
    expect(checkState.rows[0].status).toBe(LoanStatus.PENDING_APPROVAL);

    // Clean up
    await queryPostgres('DELETE FROM loans WHERE id = $1', [unapprovedLoanId]);
  });
});
