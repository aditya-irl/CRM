import { NotificationChannel, NotificationType } from '@crm/shared';

export interface NotificationPayload {
  id: string;
  recipientCustomerId?: string | null;
  recipientUserId?: string | null;
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
  recipientPhone?: string;
  recipientName?: string;
}

export interface DeliveryResult {
  success: boolean;
  messageId: string;
  deliveredAt: string;
  error?: string;
}

export interface INotificationProvider {
  send(payload: NotificationPayload): Promise<DeliveryResult>;
}

/**
 * Local / Mock Notification Provider
 * Logs formatted notification payloads with structured output and stores sent events in memory for test assertions.
 */
export class LocalMockNotificationProvider implements INotificationProvider {
  private static sentMessages: Array<NotificationPayload & { deliveredAt: string; messageId: string }> = [];

  public async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const deliveredAt = new Date().toISOString();

    LocalMockNotificationProvider.sentMessages.push({
      ...payload,
      messageId,
      deliveredAt,
    });

    console.log(`[NotificationProvider: ${payload.channel}] Sent to ${payload.recipientName || 'Customer'} (${payload.recipientPhone || 'N/A'}): "${payload.title}" -> "${payload.body}"`);

    return {
      success: true,
      messageId,
      deliveredAt,
    };
  }

  public static getSentMessages() {
    return [...this.sentMessages];
  }

  public static clearSentMessages() {
    this.sentMessages = [];
  }
}

let activeProvider: INotificationProvider = new LocalMockNotificationProvider();

export function getNotificationProvider(): INotificationProvider {
  return activeProvider;
}

export function setNotificationProvider(provider: INotificationProvider) {
  activeProvider = provider;
}
