import { queryPostgres } from '../../database/postgres';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { INotification, NotificationType, NotificationStatus, UserRole } from '@crm/shared';

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
  page?: number;
}

export class NotificationApiService {
  /**
   * Check if user is an authorized admin
   */
  private static isAdminRole(role: UserRole): boolean {
    return role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN || role === UserRole.BRANCH_MANAGER;
  }

  /**
   * List notifications addressed to the authenticated user.
   * Admin-only notifications (e.g. DEALER_APPROVAL_REQUIRED) are strictly hidden from non-admin roles.
   */
  public static async listNotifications(
    user: AuthenticatedUser,
    options: ListNotificationsOptions = {}
  ): Promise<{ notifications: INotification[]; unreadCount: number; total: number }> {
    const unreadOnly = Boolean(options.unreadOnly);
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);
    const page = Math.max(options.page || 1, 1);
    const offset = (page - 1) * limit;

    const isAdmin = this.isAdminRole(user.role);

    // 1. Calculate unread count
    let unreadSql = `
      SELECT COUNT(*)::int as count
      FROM notifications
      WHERE recipient_user_id = $1 AND status != 'READ'
    `;
    const unreadParams: any[] = [user.id];

    if (!isAdmin) {
      unreadSql += ` AND type NOT IN ('${NotificationType.DEALER_APPROVAL_REQUIRED}', '${NotificationType.LOAN_APPROVAL_REQUEST}')`;
    }

    const unreadRes = await queryPostgres(unreadSql, unreadParams);
    const unreadCount = parseInt(unreadRes.rows[0]?.count || '0', 10);

    // 2. Fetch notifications
    let querySql = `
      SELECT id, recipient_customer_id, recipient_user_id, channel, type,
             title, body, status, idempotency_key, scheduled_for, sent_at,
             error_message, metadata, created_at
      FROM notifications
      WHERE recipient_user_id = $1
    `;
    const queryParams: any[] = [user.id];
    let pIdx = 2;

    if (unreadOnly) {
      querySql += ` AND status != 'READ'`;
    }

    if (!isAdmin) {
      querySql += ` AND type NOT IN ('${NotificationType.DEALER_APPROVAL_REQUIRED}', '${NotificationType.LOAN_APPROVAL_REQUEST}')`;
    }

    // Total count matching filter
    const totalSql = `SELECT COUNT(*)::int as count FROM (${querySql}) as sub`;
    const totalRes = await queryPostgres(totalSql, queryParams);
    const total = parseInt(totalRes.rows[0]?.count || '0', 10);

    querySql += ` ORDER BY created_at DESC LIMIT $${pIdx} OFFSET $${pIdx + 1}`;
    queryParams.push(limit, offset);

    const rowsRes = await queryPostgres(querySql, queryParams);

    const notifications: INotification[] = rowsRes.rows.map((row: any) => ({
      id: row.id,
      recipientCustomerId: row.recipient_customer_id,
      recipientUserId: row.recipient_user_id,
      channel: row.channel,
      type: row.type,
      title: row.title,
      body: row.body,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      scheduledFor: row.scheduled_for,
      sentAt: row.sent_at,
      errorMessage: row.error_message,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || null),
      createdAt: row.created_at,
    }));

    return { notifications, unreadCount, total };
  }

  /**
   * Mark a specific notification as read.
   */
  public static async markAsRead(
    notificationId: string,
    user: AuthenticatedUser
  ): Promise<{ notification: INotification; unreadCount: number }> {
    const updateRes = await queryPostgres(
      `UPDATE notifications
       SET status = 'READ'
       WHERE id = $1 AND recipient_user_id = $2
       RETURNING *`,
      [notificationId, user.id]
    );

    if (updateRes.rows.length === 0) {
      throw new Error('Notification not found or access denied');
    }

    const row = updateRes.rows[0];
    const notification: INotification = {
      id: row.id,
      recipientCustomerId: row.recipient_customer_id,
      recipientUserId: row.recipient_user_id,
      channel: row.channel,
      type: row.type,
      title: row.title,
      body: row.body,
      status: NotificationStatus.READ,
      idempotencyKey: row.idempotency_key,
      scheduledFor: row.scheduled_for,
      sentAt: row.sent_at,
      errorMessage: row.error_message,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || null),
      createdAt: row.created_at,
    };

    const isAdmin = this.isAdminRole(user.role);
    let countSql = `SELECT COUNT(*)::int as count FROM notifications WHERE recipient_user_id = $1 AND status != 'READ'`;
    if (!isAdmin) {
      countSql += ` AND type NOT IN ('${NotificationType.DEALER_APPROVAL_REQUIRED}', '${NotificationType.LOAN_APPROVAL_REQUEST}')`;
    }
    const unreadRes = await queryPostgres(countSql, [user.id]);
    const unreadCount = parseInt(unreadRes.rows[0]?.count || '0', 10);

    return { notification, unreadCount };
  }

  /**
   * Mark all unread notifications for the user as read.
   */
  public static async markAllAsRead(
    user: AuthenticatedUser
  ): Promise<{ success: boolean; unreadCount: number }> {
    await queryPostgres(
      `UPDATE notifications
       SET status = 'READ'
       WHERE recipient_user_id = $1 AND status != 'READ'`,
      [user.id]
    );
    return { success: true, unreadCount: 0 };
  }

  /**
   * Fast unread count query
   */
  public static async getUnreadCount(user: AuthenticatedUser): Promise<{ unreadCount: number }> {
    const isAdmin = this.isAdminRole(user.role);
    let sql = `SELECT COUNT(*)::int as count FROM notifications WHERE recipient_user_id = $1 AND status != 'READ'`;
    if (!isAdmin) {
      sql += ` AND type NOT IN ('${NotificationType.DEALER_APPROVAL_REQUIRED}', '${NotificationType.LOAN_APPROVAL_REQUEST}')`;
    }
    const res = await queryPostgres(sql, [user.id]);
    return { unreadCount: parseInt(res.rows[0]?.count || '0', 10) };
  }
}
