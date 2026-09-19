import { Job } from 'bullmq';
import { queryPostgres } from '../../database/postgres';
import { createWorker, QUEUE_NAMES } from '../../core/queue';
import { getNotificationProvider } from './notification.provider';
import { NotificationChannel, NotificationType, NotificationStatus } from '@crm/shared';

export interface DispatchNotificationJobData {
  notificationId: string;
}

export class NotificationWorker {
  /**
   * Process a single notification delivery job.
   */
  public static async processJob(job: Job<DispatchNotificationJobData>) {
    const { notificationId } = job.data;
    if (!notificationId) {
      throw new Error('notificationId is required for notification delivery');
    }

    // 1. Fetch notification and customer contact details from PostgreSQL
    const res = await queryPostgres(
      `SELECT n.*, c.full_name as customer_name, c.primary_phone as customer_phone
       FROM notifications n
       LEFT JOIN customers c ON n.recipient_customer_id = c.id
       WHERE n.id = $1`,
      [notificationId]
    );

    if (res.rows.length === 0) {
      throw new Error(`Notification ${notificationId} not found`);
    }

    const notif = res.rows[0];

    // If already sent, skip (idempotent delivery guard)
    if (notif.status === NotificationStatus.SENT) {
      return { skipped: true, reason: 'Already sent', notificationId };
    }

    const provider = getNotificationProvider();

    try {
      const result = await provider.send({
        id: notif.id,
        recipientCustomerId: notif.recipient_customer_id,
        recipientUserId: notif.recipient_user_id,
        channel: notif.channel as NotificationChannel,
        type: notif.type as NotificationType,
        title: notif.title,
        body: notif.body,
        recipientName: notif.customer_name,
        recipientPhone: notif.customer_phone,
      });

      if (result.success) {
        await queryPostgres(
          `UPDATE notifications
           SET status = $1, sent_at = $2, error_message = NULL
           WHERE id = $3`,
          [NotificationStatus.SENT, result.deliveredAt, notificationId]
        );

        return {
          delivered: true,
          notificationId,
          messageId: result.messageId,
          deliveredAt: result.deliveredAt,
        };
      } else {
        await queryPostgres(
          `UPDATE notifications
           SET status = $1, error_message = $2
           WHERE id = $3`,
          [NotificationStatus.FAILED, result.error || 'Delivery failed', notificationId]
        );

        throw new Error(result.error || 'Delivery provider reported failure');
      }
    } catch (err: any) {
      await queryPostgres(
        `UPDATE notifications
         SET status = $1, error_message = $2
         WHERE id = $3`,
        [NotificationStatus.FAILED, err.message, notificationId]
      );
      throw err;
    }
  }

  /**
   * Start the BullMQ worker for notification delivery.
   */
  public static startWorker() {
    return createWorker<DispatchNotificationJobData>(
      QUEUE_NAMES.NOTIFICATIONS,
      NotificationWorker.processJob
    );
  }
}
