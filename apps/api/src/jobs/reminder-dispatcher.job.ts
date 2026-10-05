import { v4 as uuidv4 } from 'uuid';
import { queryPostgres } from '../database/postgres';
import { db } from '../database/db';
import {
  getBusinessDate,
  addDays,
  NotificationChannel,
  NotificationType,
  NotificationStatus,
  formatINR,
} from '@crm/shared';
import { getQueue, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from '../core/queue';
import { AuditService } from '../modules/audit/audit.service';

export interface ReminderGenerationResult {
  executedForDate: string;
  totalCandidates: number;
  newRemindersCreated: number;
  duplicateRemindersSuppressed: number;
  enqueuedJobsCount: number;
}

export class ReminderDispatcherJob {
  /**
   * Idempotent reminder scheduler for T-7, T-3, T-1, Due Today, and Overdue EMIs.
   * Runs deterministically with Asia/Kolkata timezone interpretation.
   */
  public static async runReminderGeneration(simulatedDate?: string): Promise<ReminderGenerationResult> {
    const businessToday = getBusinessDate(simulatedDate, 'Asia/Kolkata');
    console.log(`[ReminderDispatcherJob] Checking for reminders on Asia/Kolkata date: ${businessToday}`);

    const tMinus7 = addDays(businessToday, 7);
    const tMinus3 = addDays(businessToday, 3);
    const tMinus1 = addDays(businessToday, 1);

    // 1. Fetch eligible active unpaid installments
    const querySql = `
      SELECT e.id, e.due_date, e.expected_amount, e.paid_amount, e.remaining_amount,
             e.status, e.days_overdue, e.customer_id,
             c.full_name as customer_name, c.primary_phone as customer_phone,
             l.loan_account_no
      FROM emi_installments e
      JOIN loans l ON e.loan_id = l.id
      JOIN customers c ON e.customer_id = c.id
      WHERE l.status = 'ACTIVE'
        AND e.status != 'PAID'
        AND (
          e.due_date = $1 OR -- T-7
          e.due_date = $2 OR -- T-3
          e.due_date = $3 OR -- T-1
          e.due_date = $4 OR -- Due Today
          e.due_date < $4 -- Overdue
        )
    `;

    const candidatesRes = await queryPostgres(querySql, [tMinus7, tMinus3, tMinus1, businessToday]);
    const candidates = candidatesRes.rows;

    let newRemindersCreated = 0;
    let duplicateRemindersSuppressed = 0;
    let enqueuedJobsCount = 0;

    const notifQueue = getQueue(QUEUE_NAMES.NOTIFICATIONS);

    for (const emi of candidates) {
      const dueDate = getBusinessDate(emi.due_date, 'Asia/Kolkata');
      const remainingAmt = Number(emi.remaining_amount) > 0 ? Number(emi.remaining_amount) : Number(emi.expected_amount);

      let reminderType: NotificationType;
      let title: string;
      let body: string;

      if (dueDate === tMinus7) {
        reminderType = NotificationType.REMINDER_T_MINUS_7;
        title = `Upcoming EMI Reminder: ${emi.loan_account_no}`;
        body = `Dear ${emi.customer_name}, your EMI of ${formatINR(remainingAmt)} for loan ${emi.loan_account_no} is due in 7 days (${dueDate}).`;
      } else if (dueDate === tMinus3) {
        reminderType = NotificationType.REMINDER_T_MINUS_3;
        title = `Upcoming EMI Reminder: ${emi.loan_account_no}`;
        body = `Dear ${emi.customer_name}, your EMI of ${formatINR(remainingAmt)} for loan ${emi.loan_account_no} is due in 3 days (${dueDate}).`;
      } else if (dueDate === tMinus1) {
        reminderType = NotificationType.REMINDER_T_MINUS_1;
        title = `Urgent: EMI Due Tomorrow (${emi.loan_account_no})`;
        body = `Dear ${emi.customer_name}, your EMI of ${formatINR(remainingAmt)} for loan ${emi.loan_account_no} is due tomorrow (${dueDate}).`;
      } else if (dueDate === businessToday) {
        reminderType = NotificationType.DUE_TODAY;
        title = `EMI Due Today: ${emi.loan_account_no}`;
        body = `Dear ${emi.customer_name}, your EMI of ${formatINR(remainingAmt)} for loan ${emi.loan_account_no} is due today. Please keep payment ready.`;
      } else {
        reminderType = NotificationType.OVERDUE;
        title = `Overdue Notice: ${emi.loan_account_no}`;
        body = `Dear ${emi.customer_name}, your EMI of ${formatINR(remainingAmt)} for loan ${emi.loan_account_no} was due on ${dueDate} and is currently OVERDUE. Please settle immediately.`;
      }

      const idempotencyKey = `REMINDER:${reminderType}:${emi.id}:${businessToday}`;

      // Insert with PostgreSQL ON CONFLICT DO NOTHING (idempotency guard)
      const insertSql = `
        INSERT INTO notifications (
          id, recipient_customer_id, channel, type, title, body, status,
          idempotency_key, scheduled_for, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;

      const notifId = uuidv4();
      const insertRes = await queryPostgres(insertSql, [
        notifId,
        emi.customer_id,
        NotificationChannel.WHATSAPP,
        reminderType,
        title,
        body,
        NotificationStatus.PENDING,
        idempotencyKey,
      ]);

      if (insertRes.rows.length > 0) {
        newRemindersCreated++;

        // Enqueue to BullMQ for asynchronous delivery
        try {
          await notifQueue.add(
            'dispatch-notification',
            { notificationId: notifId },
            {
              jobId: idempotencyKey, // BullMQ level deduplication
              ...DEFAULT_JOB_OPTIONS,
            }
          );
          enqueuedJobsCount++;
        } catch {
          // Handled gracefully in offline testing
        }

        await AuditService.log({
          action: 'EMI_REMINDER_SCHEDULED',
          entity: 'EMIInstallment',
          entityId: emi.id,
          newState: { reminderType, idempotencyKey, businessToday },
        });
      } else {
        duplicateRemindersSuppressed++;
      }
    }

    // Sync to SQLite for legacy fallback
    try {
      const dueTodayRows = db.prepare(`
        SELECT e.*, c.full_name, c.primary_phone, l.loan_account_no
        FROM emi_installments e
        JOIN loans l ON e.loan_id = l.id
        JOIN customers c ON e.customer_id = c.id
        WHERE l.status = 'ACTIVE' AND e.status != 'PAID' AND e.due_date = ?
      `).all(businessToday) as any[];

      const insertNotifStmt = db.prepare(`
        INSERT OR IGNORE INTO notifications (
          id, recipient_customer_id, channel, type, title, body, status,
          idempotency_key, scheduled_for, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of dueTodayRows) {
        insertNotifStmt.run(
          uuidv4(), row.customer_id, NotificationChannel.WHATSAPP, NotificationType.DUE_TODAY,
          `EMI Due Today: ${row.loan_account_no}`,
          `Dear ${row.full_name}, your EMI is due today.`,
          NotificationStatus.PENDING, `DUE_TODAY:${row.id}:${businessToday}`,
          new Date().toISOString(), new Date().toISOString()
        );
      }
    } catch {
      // Safe fallback
    }

    console.log(
      `[ReminderDispatcherJob] Completed: ${newRemindersCreated} new reminders created, ${duplicateRemindersSuppressed} duplicates suppressed, ${enqueuedJobsCount} jobs enqueued.`
    );

    return {
      executedForDate: businessToday,
      totalCandidates: candidates.length,
      newRemindersCreated,
      duplicateRemindersSuppressed,
      enqueuedJobsCount,
    };
  }
}
