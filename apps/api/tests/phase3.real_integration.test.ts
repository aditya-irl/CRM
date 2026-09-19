import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { getRedisClient, closeRedisConnection, acquireDistributedLock, releaseDistributedLock } from '../src/core/redis';
import { getQueue, closeAllQueues, QUEUE_NAMES } from '../src/core/queue';
import { EMIStateEngineJob } from '../src/jobs/emi-state-engine.job';
import { ReminderDispatcherJob } from '../src/jobs/reminder-dispatcher.job';
import { BackgroundScheduler } from '../src/jobs/scheduler';
import { NotificationWorker } from '../src/modules/notifications/notification.worker';
import { LocalMockNotificationProvider, setNotificationProvider } from '../src/modules/notifications/notification.provider';
import {
  EMIStatus,
  NotificationStatus,
  NotificationType,
  getBusinessDate,
  addDays,
  computeEmiStatus,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';

describe('PHASE 3: Real Integration & Security Test Suite (EMI State Machine & BullMQ Workers)', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-5);

  let customerId: string;
  let loanId: string;

  let upcomingEmiId: string;
  let dueTodayEmiId: string;
  let overdueEmiId: string;
  let paidEmiId: string;
  let partiallyPaidEmiId: string;

  const businessBaseDate = '2026-06-15'; // Base reference date for testing

  beforeAll(async () => {
    // 1. Seed Customer and Loan in PostgreSQL
    const custRes = await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_at, updated_at
      ) VALUES (
        uuid_generate_v4(), $1, $2, $3, '100 Ring Road', 'Bengaluru', 'Karnataka', '560001', $4, TRUE, NOW(), NOW()
      ) RETURNING id`,
      [`CUST-P3-${runId}`, `Anand Verma (${runId})`, `+9198730${numId}`, `ROUTE-P3-${runId}`]
    );
    customerId = custRes.rows[0].id;

    const loanRes = await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date, status, created_at, updated_at
      ) VALUES (
        uuid_generate_v4(), $1, $2, 50000.00, 0.00, 50000.00,
        0.1200, 'FLAT_RATE', 5, 'MONTHLY',
        5, 10500.00, 2500.00, 52500.00, 10500.00,
        42000.00, '2026-01-01', '2026-06-01', '2026-10-01', 'ACTIVE', NOW(), NOW()
      ) RETURNING id`,
      [`LN-P3-${runId}`, customerId]
    );
    loanId = loanRes.rows[0].id;

    // 2. Create specific test EMI installments relative to businessBaseDate (2026-06-15):
    // EMI 1: Due on 2026-06-25 (Future -> UPCOMING)
    upcomingEmiId = uuidv4();
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 1, '2026-06-25', 10000, 500, 10500, 0, 10500, 0, 'UPCOMING', 0, NOW(), NOW())`,
      [upcomingEmiId, loanId, customerId]
    );

    // EMI 2: Due on 2026-06-15 (Today -> DUE_TODAY)
    dueTodayEmiId = uuidv4();
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 2, '2026-06-15', 10000, 500, 10500, 0, 10500, 0, 'UPCOMING', 0, NOW(), NOW())`,
      [dueTodayEmiId, loanId, customerId]
    );

    // EMI 3: Due on 2026-06-05 (10 days past due -> OVERDUE)
    overdueEmiId = uuidv4();
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 3, '2026-06-05', 10000, 500, 10500, 0, 10500, 0, 'DUE_TODAY', 0, NOW(), NOW())`,
      [overdueEmiId, loanId, customerId]
    );

    // EMI 4: Fully Paid (paid_amount = 10500, remaining_amount = 0 -> PAID)
    paidEmiId = uuidv4();
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 4, '2026-06-01', 10000, 500, 10500, 10500, 0, 0, 'PAID', 0, NOW(), NOW())`,
      [paidEmiId, loanId, customerId]
    );

    // EMI 5: Partially Paid in future (paid_amount = 4000, remaining_amount = 6500, due 2026-06-20)
    partiallyPaidEmiId = uuidv4();
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 5, '2026-06-20', 10000, 500, 10500, 4000, 6500, 0, 'UPCOMING', 0, NOW(), NOW())`,
      [partiallyPaidEmiId, loanId, customerId]
    );
  });

  afterAll(async () => {
    await closeAllQueues();
    await closePostgresPool();
    await closeRedisConnection();
  });

  describe('1. Pure Deterministic EMI State Evaluator', () => {
    it('Accurately evaluates UPCOMING, DUE_TODAY, PARTIALLY_PAID, OVERDUE, and PAID states', () => {
      // Future
      const res1 = computeEmiStatus({
        dueDate: '2026-06-25',
        expectedAmount: 10000,
        paidAmount: 0,
        businessToday: '2026-06-15',
      });
      expect(res1.status).toBe(EMIStatus.UPCOMING);
      expect(res1.daysOverdue).toBe(0);

      // Due Today
      const res2 = computeEmiStatus({
        dueDate: '2026-06-15',
        expectedAmount: 10000,
        paidAmount: 0,
        businessToday: '2026-06-15',
      });
      expect(res2.status).toBe(EMIStatus.DUE_TODAY);
      expect(res2.daysOverdue).toBe(0);

      // Overdue (5 days overdue)
      const res3 = computeEmiStatus({
        dueDate: '2026-06-10',
        expectedAmount: 10000,
        paidAmount: 0,
        businessToday: '2026-06-15',
      });
      expect(res3.status).toBe(EMIStatus.OVERDUE);
      expect(res3.daysOverdue).toBe(5);

      // Fully Paid past due date must remain PAID with 0 days overdue
      const res4 = computeEmiStatus({
        dueDate: '2026-05-01',
        expectedAmount: 10000,
        paidAmount: 10000,
        businessToday: '2026-06-15',
      });
      expect(res4.status).toBe(EMIStatus.PAID);
      expect(res4.daysOverdue).toBe(0);
      expect(res4.isPaid).toBe(true);
    });
  });

  describe('2. Real PostgreSQL State Transition Job Execution', () => {
    it('Transitions installments to exact states for simulated date 2026-06-15', async () => {
      const result = await EMIStateEngineJob.runDailyTransition(businessBaseDate);

      expect(result.executedForDate).toBe(businessBaseDate);
      expect(result.totalEvaluated).toBeGreaterThanOrEqual(5);

      // 1. Verify Due Today EMI
      const dueRes = await queryPostgres('SELECT status, days_overdue FROM emi_installments WHERE id = $1', [dueTodayEmiId]);
      expect(dueRes.rows[0].status).toBe('DUE_TODAY');
      expect(Number(dueRes.rows[0].days_overdue)).toBe(0);

      // 2. Verify Overdue EMI (2026-06-15 - 2026-06-05 = 10 days)
      const overdueRes = await queryPostgres('SELECT status, days_overdue FROM emi_installments WHERE id = $1', [overdueEmiId]);
      expect(overdueRes.rows[0].status).toBe('OVERDUE');
      expect(Number(overdueRes.rows[0].days_overdue)).toBe(10);

      // 3. Verify Upcoming EMI remains UPCOMING
      const upRes = await queryPostgres('SELECT status, days_overdue FROM emi_installments WHERE id = $1', [upcomingEmiId]);
      expect(upRes.rows[0].status).toBe('UPCOMING');

      // 4. Verify Paid EMI remains PAID
      const paidRes = await queryPostgres('SELECT status, days_overdue FROM emi_installments WHERE id = $1', [paidEmiId]);
      expect(paidRes.rows[0].status).toBe('PAID');
      expect(Number(paidRes.rows[0].days_overdue)).toBe(0);

      // 5. Verify Partially Paid in future
      const partialRes = await queryPostgres('SELECT status, days_overdue FROM emi_installments WHERE id = $1', [partiallyPaidEmiId]);
      expect(partialRes.rows[0].status).toBe('PARTIALLY_PAID');
    });

    it('Corrects stale database state (Paid EMI erroneously stored as OVERDUE is reconciled to PAID)', async () => {
      // Erroneously mark a paid EMI as OVERDUE in DB
      const staleEmiId = uuidv4();
      await queryPostgres(
        `INSERT INTO emi_installments (
          id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
          expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
        ) VALUES ($1, $2, $3, 99, '2026-05-01', 5000, 200, 5200, 5200, 0, 0, 'OVERDUE', 45, NOW(), NOW())`,
        [staleEmiId, loanId, customerId]
      );

      // Run transition job
      await EMIStateEngineJob.runDailyTransition(businessBaseDate);

      // Verify reconciled to PAID
      const res = await queryPostgres('SELECT status, days_overdue, remaining_amount FROM emi_installments WHERE id = $1', [staleEmiId]);
      expect(res.rows[0].status).toBe('PAID');
      expect(Number(res.rows[0].days_overdue)).toBe(0);
      expect(Number(res.rows[0].remaining_amount)).toBe(0);
    });

    it('Re-running the transition job is completely idempotent with 0 duplicate state modifications', async () => {
      const run1 = await EMIStateEngineJob.runDailyTransition(businessBaseDate);
      expect(run1.dueTodayUpdated).toBe(0);
      expect(run1.overdueUpdated).toBe(0);
      expect(run1.unchanged).toBeGreaterThanOrEqual(5);
    });
  });

  describe('3. Automated Reminder Generation & Idempotency', () => {
    it('Generates Due Today and Overdue reminders in PostgreSQL with exact idempotency keys', async () => {
      // Add T-7, T-3, T-1 installments
      const t7Id = uuidv4();
      const t3Id = uuidv4();
      const t1Id = uuidv4();

      await queryPostgres(
        `INSERT INTO emi_installments (id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at)
         VALUES
           ($1, $4, $5, 10, '2026-06-22', 10000, 500, 10500, 0, 10500, 0, 'UPCOMING', 0, NOW(), NOW()),
           ($2, $4, $5, 11, '2026-06-18', 10000, 500, 10500, 0, 10500, 0, 'UPCOMING', 0, NOW(), NOW()),
           ($3, $4, $5, 12, '2026-06-16', 10000, 500, 10500, 0, 10500, 0, 'UPCOMING', 0, NOW(), NOW())`,
        [t7Id, t3Id, t1Id, loanId, customerId]
      );

      const result = await ReminderDispatcherJob.runReminderGeneration(businessBaseDate);

      expect(result.executedForDate).toBe(businessBaseDate);
      expect(result.newRemindersCreated).toBeGreaterThanOrEqual(5);

      // Verify notifications exist in PostgreSQL
      const notifsRes = await queryPostgres(
        `SELECT type, idempotency_key, status, title
         FROM notifications
         WHERE recipient_customer_id = $1`,
        [customerId]
      );

      const types = notifsRes.rows.map((n) => n.type);
      expect(types).toContain('DUE_TODAY');
      expect(types).toContain('OVERDUE');
      expect(types).toContain('REMINDER_T_MINUS_7');
      expect(types).toContain('REMINDER_T_MINUS_3');
      expect(types).toContain('REMINDER_T_MINUS_1');

      const dueTodayNotif = notifsRes.rows.find((n) => n.type === 'DUE_TODAY');
      expect(dueTodayNotif.idempotency_key).toBe(`REMINDER:DUE_TODAY:${dueTodayEmiId}:${businessBaseDate}`);
    });

    it('Concurrent workers executing state transitions run without collision or deadlocks', async () => {
      const [res1, res2] = await Promise.all([
        EMIStateEngineJob.runDailyTransition(businessBaseDate),
        EMIStateEngineJob.runDailyTransition(businessBaseDate),
      ]);

      expect(res1.executedForDate).toBe(businessBaseDate);
      expect(res2.executedForDate).toBe(businessBaseDate);
    });

    it('Re-running reminder generation suppresses duplicates (0 new reminders created)', async () => {
      // Initial run establishes reminders for current active loans
      await ReminderDispatcherJob.runReminderGeneration(businessBaseDate);
      // Re-run immediately to verify duplicate suppression
      const result = await ReminderDispatcherJob.runReminderGeneration(businessBaseDate);

      expect(result.newRemindersCreated).toBe(0);
      expect(result.duplicateRemindersSuppressed).toBeGreaterThanOrEqual(5);
    });
  });

  describe('4. BullMQ Notification Delivery Worker', () => {
    it('Worker consumes pending notification and updates status to SENT with delivery timestamp', async () => {
      // Find a pending notification created for this customer
      const notifRes = await queryPostgres(
        `SELECT id FROM notifications WHERE recipient_customer_id = $1 AND status = 'PENDING' LIMIT 1`,
        [customerId]
      );

      expect(notifRes.rows.length).toBe(1);
      const notifId = notifRes.rows[0].id;

      // Process job using NotificationWorker
      const jobResult = await NotificationWorker.processJob({
        data: { notificationId: notifId },
      } as any);

      expect(jobResult.delivered).toBe(true);
      expect(jobResult.deliveredAt).toBeDefined();

      // Verify in PostgreSQL that status is now SENT
      const updatedNotif = await queryPostgres('SELECT status, sent_at FROM notifications WHERE id = $1', [notifId]);
      expect(updatedNotif.rows[0].status).toBe('SENT');
      expect(updatedNotif.rows[0].sent_at).not.toBeNull();
    });
  });

  describe('5. Distributed Lock Scheduling & Concurrency', () => {
    it('Distributed lock protects daily maintenance and prevents simultaneous double-execution', async () => {
      // Direct lock acquisition
      const lockKey = 'cron:test-concurrency-lock';
      const lock1 = await acquireDistributedLock(lockKey, 30000);
      expect(lock1.acquired).toBe(true);

      // Second attempt while lock1 is held must be rejected
      const lock2 = await acquireDistributedLock(lockKey, 30000);
      expect(lock2.acquired).toBe(false);

      // Release lock1
      await releaseDistributedLock(lockKey, lock1.lockId);

      // Third attempt after release must succeed
      const lock3 = await acquireDistributedLock(lockKey, 30000);
      expect(lock3.acquired).toBe(true);
      await releaseDistributedLock(lockKey, lock3.lockId);
    });
  });

  describe('6. Immutable Audit Trail Integration', () => {
    it('Verifies EMI_MARKED_DUE and EMI_REMINDER_SCHEDULED audit records exist', async () => {
      const auditRes = await queryPostgres(
        `SELECT action, entity, entity_id FROM audit_logs
         WHERE action IN ('EMI_MARKED_DUE', 'EMI_MARKED_OVERDUE', 'EMI_REMINDER_SCHEDULED')
         ORDER BY created_at DESC LIMIT 50`
      );

      const actions = auditRes.rows.map((a) => a.action);
      expect(actions).toContain('EMI_MARKED_DUE');
      expect(actions).toContain('EMI_REMINDER_SCHEDULED');
    });
  });
});
