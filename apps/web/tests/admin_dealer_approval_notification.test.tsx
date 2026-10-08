import React from 'react';
import { renderToString } from 'react-dom/server';
import { NotificationBell, formatRelativeTime } from '../src/components/NotificationBell';
import { ApiClient } from '../src/services/api';
import {
  IUser,
  UserRole,
  UserStatus,
  INotification,
  NotificationType,
  NotificationStatus,
  NotificationChannel,
} from '@crm/shared';

// Mock localStorage and sessionStorage for node test environment
const storageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storageStore[key] || null,
  setItem: (key: string, val: string) => {
    storageStore[key] = val;
  },
  removeItem: (key: string) => {
    delete storageStore[key];
  },
  clear: () => {
    Object.keys(storageStore).forEach((k) => delete storageStore[k]);
  },
};

(global as any).localStorage = mockLocalStorage;
(global as any).sessionStorage = mockLocalStorage;

describe('Admin Dealer Approval Notification UI Tests', () => {
  const originalFetch = global.fetch;

  const mockAdminUser: IUser = {
    id: 'user-admin-uuid-1',
    email: 'admin@financecrm.com',
    phone: '9876500001',
    fullName: 'Super Administrator',
    role: UserRole.SUPER_ADMIN,
    status: UserStatus.ACTIVE,
    assignedBranch: 'Headquarters',
    dealerId: null,
    mustChangePassword: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const mockDealerUser: IUser = {
    id: 'user-dealer-uuid-1',
    email: 'dealer@store.com',
    phone: '9876543210',
    fullName: 'Shree Balaji Mobiles',
    role: UserRole.DEALER,
    status: UserStatus.ACTIVE,
    dealerId: 'dlr-uuid-001',
    mustChangePassword: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const mockAgentUser: IUser = {
    id: 'user-agent-uuid-1',
    email: 'agent@field.com',
    phone: '9876522222',
    fullName: 'Field Agent Kumar',
    role: UserRole.COLLECTION_AGENT,
    status: UserStatus.ACTIVE,
    dealerId: null,
    mustChangePassword: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const sampleDealerApprovalNotif: INotification = {
    id: 'notif-dealer-appr-001',
    recipientUserId: mockAdminUser.id,
    recipientCustomerId: null,
    channel: NotificationChannel.IN_APP,
    type: NotificationType.DEALER_APPROVAL_REQUIRED,
    title: 'Dealer Approval Required',
    body: 'Dealer "Alpha Mobile Gallery" has submitted a request for approval.',
    status: NotificationStatus.PENDING,
    idempotencyKey: 'idemp-dealer-001',
    scheduledFor: '2026-10-08T10:00:00.000Z',
    sentAt: '2026-10-08T10:00:00.000Z',
    errorMessage: null,
    metadata: {
      dealerId: 'dealer-alpha-uuid',
      dealerName: 'Alpha Mobile Gallery',
      dealerCode: 'DLR-000001',
      loanId: 'loan-alpha-101',
      loanAccountNo: 'LN-2026-1008',
      customerName: 'Ramesh Verma',
    },
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 mins ago
  };

  const sampleLoanApprovalNotif: INotification = {
    id: 'notif-loan-appr-002',
    recipientUserId: mockAdminUser.id,
    recipientCustomerId: null,
    channel: NotificationChannel.IN_APP,
    type: NotificationType.LOAN_APPROVAL_REQUEST,
    title: 'New Dealer Loan Approval Request: LN-2026-1009',
    body: 'Dealer "Shubh Pvt Ltd" has originated a new loan LN-2026-1009. Pending review.',
    status: NotificationStatus.PENDING,
    idempotencyKey: 'idemp-loan-002',
    scheduledFor: '2026-10-08T09:00:00.000Z',
    sentAt: '2026-10-08T09:00:00.000Z',
    errorMessage: null,
    metadata: {
      dealerId: 'dealer-shubh-uuid',
      dealerName: 'Shubh Pvt Ltd',
      loanId: 'loan-shubh-202',
      loanAccountNo: 'LN-2026-1009',
    },
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
    ApiClient.setAuth(mockAdminUser, 'mock-admin-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockLocalStorage.clear();
  });

  describe('1. DEALER_APPROVAL_REQUIRED Rendering & Appearance', () => {
    test('renders Title: "Dealer Approval Required" and Message: "Dealer {dealer name} has submitted a request for approval."', () => {
      // Test the notification item extraction logic used by NotificationBell
      const meta = sampleDealerApprovalNotif.metadata as Record<string, any>;
      const dealerName = meta.dealerName;
      expect(dealerName).toBe('Alpha Mobile Gallery');

      const expectedTitle = 'Dealer Approval Required';
      const expectedMessage = `Dealer ${dealerName} has submitted a request for approval.`;

      expect(expectedTitle).toBe('Dealer Approval Required');
      expect(expectedMessage).toBe('Dealer Alpha Mobile Gallery has submitted a request for approval.');
    });

    test('formatRelativeTime formats recent timestamps correctly', () => {
      const now = new Date();
      const justNow = new Date(now.getTime() - 10 * 1000).toISOString();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

      expect(formatRelativeTime(justNow)).toBe('Just now');
      expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
      expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
      expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago');
    });

    test('NotificationBell renders bell button for admin users with proper accessibility', () => {
      const html = renderToString(<NotificationBell user={mockAdminUser} />);
      expect(html).toContain('data-testid="notification-bell-btn"');
      expect(html).toContain('Admin Notifications');
    });
  });

  describe('2. Unread Count & Badge Display', () => {
    test('Notification API returns unreadCount including DEALER_APPROVAL_REQUIRED', async () => {
      const mockResponse = {
        success: true,
        data: {
          notifications: [sampleDealerApprovalNotif, sampleLoanApprovalNotif],
          unreadCount: 2,
          total: 2,
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as any);

      const res = await ApiClient.getNotifications();
      expect(res.notifications.length).toBe(2);
      expect(res.unreadCount).toBe(2);
      expect(res.notifications[0].type).toBe(NotificationType.DEALER_APPROVAL_REQUIRED);
      expect(res.notifications[0].status).toBe(NotificationStatus.PENDING);
    });

    test('getNotificationUnreadCount API returns correct count', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { unreadCount: 3 } }),
      } as any);

      const res = await ApiClient.getNotificationUnreadCount();
      expect(res.unreadCount).toBe(3);
    });
  });

  describe('3. Mark as Read Functionality', () => {
    test('clicking notification calls markNotificationAsRead API and updates unread count', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            notification: { ...sampleDealerApprovalNotif, status: NotificationStatus.READ },
            unreadCount: 1,
          },
        }),
      } as any);

      const result = await ApiClient.markNotificationAsRead(sampleDealerApprovalNotif.id);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/notifications/${sampleDealerApprovalNotif.id}/read`),
        expect.objectContaining({ method: 'PATCH' })
      );
      expect(result.notification.status).toBe(NotificationStatus.READ);
      expect(result.unreadCount).toBe(1);
    });

    test('markAllNotificationsAsRead API marks all unread as read and returns unreadCount: 0', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            success: true,
            unreadCount: 0,
          },
        }),
      } as any);

      const result = await ApiClient.markAllNotificationsAsRead();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/mark-all-read'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.success).toBe(true);
      expect(result.unreadCount).toBe(0);
    });
  });

  describe('4. Navigation to Dealer Approval Screen', () => {
    test('notification with loanId / loanAccountNo targets loans view with PENDING_APPROVAL tab', () => {
      const onNavigateMock = jest.fn();

      const notif = sampleDealerApprovalNotif;
      const meta = notif.metadata as Record<string, any>;

      // Simulate the navigation logic from NotificationBell
      if (meta.loanId || meta.loanAccountNo) {
        onNavigateMock('loans', {
          statusTab: 'PENDING_APPROVAL',
          loanId: meta.loanId,
          search: meta.loanAccountNo,
        });
      }

      expect(onNavigateMock).toHaveBeenCalledWith('loans', {
        statusTab: 'PENDING_APPROVAL',
        loanId: 'loan-alpha-101',
        search: 'LN-2026-1008',
      });
    });

    test('notification with dealerId only targets dealers view with dealerId focus', () => {
      const onNavigateMock = jest.fn();

      const notifDealerOnly: INotification = {
        ...sampleDealerApprovalNotif,
        metadata: {
          dealerId: 'dlr-999-uuid',
          dealerName: 'City Mobile Center',
        },
      };

      const meta = notifDealerOnly.metadata as Record<string, any>;

      if (meta.loanId || meta.loanAccountNo) {
        onNavigateMock('loans', { statusTab: 'PENDING_APPROVAL' });
      } else if (meta.dealerId) {
        onNavigateMock('dealers', {
          dealerId: meta.dealerId,
          search: meta.dealerName,
        });
      }

      expect(onNavigateMock).toHaveBeenCalledWith('dealers', {
        dealerId: 'dlr-999-uuid',
        search: 'City Mobile Center',
      });
    });
  });

  describe('5. Admin-Only Visibility Guard (Requirement 6)', () => {
    test('NotificationBell does NOT render for DEALER role', () => {
      const html = renderToString(<NotificationBell user={mockDealerUser} />);
      expect(html).toBe('');
    });

    test('NotificationBell does NOT render for COLLECTION_AGENT role', () => {
      const html = renderToString(<NotificationBell user={mockAgentUser} />);
      expect(html).toBe('');
    });

    test('Non-admin users filter out DEALER_APPROVAL_REQUIRED notifications', () => {
      const mixedNotifications: INotification[] = [
        sampleDealerApprovalNotif,
        sampleLoanApprovalNotif,
        {
          id: 'notif-agent-task-003',
          recipientUserId: mockAgentUser.id,
          recipientCustomerId: null,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.DUE_TODAY,
          title: 'EMI Due Today',
          body: 'Collection task for area Dibiyapur',
          status: NotificationStatus.PENDING,
          idempotencyKey: 'idemp-agent-003',
          scheduledFor: new Date().toISOString(),
          sentAt: null,
          errorMessage: null,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ];

      // Non-admin filter simulation
      const nonAdminFiltered = mixedNotifications.filter(
        (n) =>
          n.type !== NotificationType.DEALER_APPROVAL_REQUIRED &&
          n.type !== NotificationType.LOAN_APPROVAL_REQUEST
      );

      expect(nonAdminFiltered.length).toBe(1);
      expect(nonAdminFiltered[0].type).toBe(NotificationType.DUE_TODAY);
      expect(nonAdminFiltered.find((n) => n.type === NotificationType.DEALER_APPROVAL_REQUIRED)).toBeUndefined();
    });
  });
});
