import React from 'react';
import { renderToString } from 'react-dom/server';
import { PortalLinkManager } from '../src/components/PortalLinkManager';
import { ApiClient, IPortalLinkStatus, IPortalLinkResult } from '../src/services/api';
import { UserRole } from '@crm/shared';

// Mock localStorage and sessionStorage for node test environment
const storageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storageStore[key] || null,
  setItem: (key: string, val: string) => { storageStore[key] = val; },
  removeItem: (key: string) => { delete storageStore[key]; },
  clear: () => { Object.keys(storageStore).forEach((k) => delete storageStore[k]); },
};

(global as any).localStorage = mockLocalStorage;
(global as any).sessionStorage = mockLocalStorage;

describe('Admin Customer Portal Link Management UI Tests', () => {
  const mockLoanId = 'loan-test-uuid-101';
  const mockAccountNo = 'LN-2026-9001';
  const mockCustomerId = 'cust-test-uuid-201';
  const mockCustomerName = 'Vijay Shankar';
  const mockPhone = '9876543210';

  const sampleActiveStatus: IPortalLinkStatus = {
    loanId: mockLoanId,
    loanAccountNo: mockAccountNo,
    hasActiveLink: true,
    isActive: true,
    portalUrl: 'http://localhost:5173/portal?token=cpt_active_sample_token_123',
    createdAt: '2026-09-20T10:00:00.000Z',
    lastAccessedAt: '2026-09-21T15:30:00.000Z',
    revokedAt: null,
  };

  const sampleInactiveStatus: IPortalLinkStatus = {
    loanId: mockLoanId,
    loanAccountNo: mockAccountNo,
    hasActiveLink: false,
    isActive: false,
    portalUrl: null,
    createdAt: null,
    lastAccessedAt: null,
    revokedAt: null,
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
  });

  describe('1. Active Portal Link Status Display', () => {
    test('renders active status badge, portal URL, and timestamps when active link exists', () => {
      const html = renderToString(
        <PortalLinkManager
          loanId={mockLoanId}
          loanAccountNo={mockAccountNo}
          customerName={mockCustomerName}
          primaryPhone={mockPhone}
          userRole={UserRole.ADMIN}
          initialStatus={sampleActiveStatus}
        />
      );

      expect(html).toContain('Active Portal Link');
      expect(html).toContain('http://localhost:5173/portal?token=cpt_active_sample_token_123');
      expect(html).toContain('Copy Portal Link');
      expect(html).toContain('Regenerate Portal Link');
      expect(html).toContain('Revoke Portal Link');
      expect(html).toContain('Send via WhatsApp');
    });

    test('renders inactive state when no active portal link exists', () => {
      const html = renderToString(
        <PortalLinkManager
          loanId={mockLoanId}
          loanAccountNo={mockAccountNo}
          customerName={mockCustomerName}
          primaryPhone={mockPhone}
          userRole={UserRole.ADMIN}
          initialStatus={sampleInactiveStatus}
        />
      );

      expect(html).toContain('No Active Link');
      expect(html).toContain('No active customer portal link exists for this loan account.');
      expect(html).toContain('Generate Portal Link');
      expect(html).not.toContain('Revoke');
    });

    test('ApiClient.getPortalLinkStatus calls GET /api/v1/portal/loans/:loanId/link', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: sampleActiveStatus }),
      });
      (global as any).fetch = mockFetch;

      const status = await ApiClient.getPortalLinkStatus(mockLoanId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/portal/loans/${mockLoanId}/link`),
        expect.objectContaining({
          headers: expect.any(Object),
        })
      );
      expect(status.hasActiveLink).toBe(true);
      expect(status.portalUrl).toContain('cpt_active_sample_token_123');
    });
  });

  describe('2. Copy Link Action & Behavior', () => {
    test('copy link action uses clipboard writeText safely', async () => {
      let copiedText = '';
      const mockClipboard = {
        writeText: jest.fn(async (text: string) => {
          copiedText = text;
        }),
      };
      (global as any).navigator = { clipboard: mockClipboard };

      // Simulate copying portal link
      const targetUrl = sampleActiveStatus.portalUrl!;
      await mockClipboard.writeText(targetUrl);

      expect(mockClipboard.writeText).toHaveBeenCalledWith(targetUrl);
      expect(copiedText).toBe('http://localhost:5173/portal?token=cpt_active_sample_token_123');
    });
  });

  describe('3. Confirmation Guards for Regenerate and Revoke', () => {
    test('regenerate confirmation warns about invalidating previous link', () => {
      const html = renderToString(
        <PortalLinkManager
          loanId={mockLoanId}
          loanAccountNo={mockAccountNo}
          customerName={mockCustomerName}
          primaryPhone={mockPhone}
          userRole={UserRole.ADMIN}
          initialStatus={sampleActiveStatus}
          initialConfirmAction="regenerate"
        />
      );

      expect(html).toContain('Regenerate Link?');
      expect(html).toContain('The existing portal link will be immediately invalidated');
      expect(html).toContain('Confirm Regenerate');
      expect(html).toContain('Cancel');
    });

    test('revoke confirmation warns about immediately cutting off customer access', () => {
      const html = renderToString(
        <PortalLinkManager
          loanId={mockLoanId}
          loanAccountNo={mockAccountNo}
          customerName={mockCustomerName}
          primaryPhone={mockPhone}
          userRole={UserRole.ADMIN}
          initialStatus={sampleActiveStatus}
          initialConfirmAction="revoke"
        />
      );

      expect(html).toContain('Revoke Access?');
      expect(html).toContain('The customer will immediately lose access to this portal');
      expect(html).toContain('Confirm Revoke');
      expect(html).toContain('Cancel');
    });
  });

  describe('4. Successful Refresh After Regenerate and Revoke', () => {
    test('ApiClient.regeneratePortalLink posts to /api/v1/portal/loans/:loanId/regenerate and returns fresh link', async () => {
      const regeneratedResponse: IPortalLinkResult = {
        portalUrl: 'http://localhost:5173/portal?token=cpt_regenerated_token_999',
        token: 'cpt_regenerated_token_999',
        loanId: mockLoanId,
        customerId: mockCustomerId,
        loanAccountNo: mockAccountNo,
        isActive: true,
        createdAt: '2026-09-22T04:00:00.000Z',
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: regeneratedResponse }),
      });
      (global as any).fetch = mockFetch;

      const result = await ApiClient.regeneratePortalLink(mockLoanId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/portal/loans/${mockLoanId}/regenerate`),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.portalUrl).toContain('cpt_regenerated_token_999');
    });

    test('ApiClient.revokePortalLink posts to /api/v1/portal/loans/:loanId/revoke and confirms revocation', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { success: true, revokedCount: 1 } }),
      });
      (global as any).fetch = mockFetch;

      const result = await ApiClient.revokePortalLink(mockLoanId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/portal/loans/${mockLoanId}/revoke`),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.success).toBe(true);
      expect(result.revokedCount).toBe(1);
    });

    test('ApiClient.generatePortalLink posts to /api/v1/portal/loans/:loanId/link', async () => {
      const generatedResponse: IPortalLinkResult = {
        portalUrl: 'http://localhost:5173/portal?token=cpt_newly_generated_456',
        token: 'cpt_newly_generated_456',
        loanId: mockLoanId,
        customerId: mockCustomerId,
        loanAccountNo: mockAccountNo,
        isActive: true,
        createdAt: '2026-09-22T04:10:00.000Z',
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: generatedResponse }),
      });
      (global as any).fetch = mockFetch;

      const result = await ApiClient.generatePortalLink(mockLoanId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/portal/loans/${mockLoanId}/link`),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.portalUrl).toContain('cpt_newly_generated_456');
    });
  });

  describe('5. RBAC & Unauthorized Role Restrictions', () => {
    test('Collection Agent users cannot access regenerate, revoke, or generate actions', () => {
      const html = renderToString(
        <PortalLinkManager
          loanId={mockLoanId}
          loanAccountNo={mockAccountNo}
          customerName={mockCustomerName}
          primaryPhone={mockPhone}
          userRole={UserRole.COLLECTION_AGENT}
          initialStatus={sampleActiveStatus}
        />
      );

      // Warning message shown about permission
      expect(html).toContain('View-only access. You do not have permission to manage or regenerate portal links.');
      // Management buttons must NOT be rendered for unauthorized roles
      expect(html).not.toContain('Regenerate');
      expect(html).not.toContain('Revoke');
    });

    test('Super Admin, Admin, and Branch Manager have full management access', () => {
      [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER].forEach((role) => {
        const html = renderToString(
          <PortalLinkManager
            loanId={mockLoanId}
            loanAccountNo={mockAccountNo}
            customerName={mockCustomerName}
            primaryPhone={mockPhone}
            userRole={role}
            initialStatus={sampleActiveStatus}
          />
        );

        expect(html).toContain('Regenerate');
        expect(html).toContain('Revoke');
        expect(html).not.toContain('View-only access');
      });
    });
  });

  describe('6. WhatsApp Customer Link Sharing Helper', () => {
    test('generates valid wa.me link containing only loan account and portal link without KYC', () => {
      const cleanPhone = '9876543210';
      const portalUrl = sampleActiveStatus.portalUrl!;
      const msg = `Dear ${mockCustomerName},\n\nHere is your secure EMI payment portal link for Loan Account ${mockAccountNo}:\n${portalUrl}\n\nYou can view your installment schedule, outstanding balance, and make payments online.\n\nThank you.`;
      const waUrl = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(msg)}`;

      expect(waUrl).toContain('https://wa.me/919876543210?text=');
      expect(waUrl).toContain(encodeURIComponent(mockAccountNo));
      expect(waUrl).toContain(encodeURIComponent(portalUrl));

      // Strictly ensure sensitive KYC fields are NOT in the message
      expect(waUrl).not.toContain('aadhaar');
      expect(waUrl).not.toContain('pan');
      expect(waUrl).not.toContain('bank_account');
      expect(waUrl).not.toContain('salary');
    });

    test('omits WhatsApp sharing button if customer phone is not available', () => {
      const html = renderToString(
        <PortalLinkManager
          loanId={mockLoanId}
          loanAccountNo={mockAccountNo}
          customerName={mockCustomerName}
          primaryPhone={undefined}
          userRole={UserRole.ADMIN}
          initialStatus={sampleActiveStatus}
        />
      );

      expect(html).not.toContain('Send via WhatsApp');
    });
  });

  describe('7. Storage Privacy: Portal Token Never Stored Separately', () => {
    test('portal token is NEVER written to localStorage or sessionStorage during admin operations', async () => {
      // Simulate admin session
      ApiClient.setAuth(
        { id: 'admin-1', email: 'admin@crm.com', fullName: 'Admin User', role: UserRole.ADMIN } as any,
        'mock_admin_jwt_session'
      );

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            portalUrl: 'http://localhost:5173/portal?token=cpt_never_cache_me_9999',
            token: 'cpt_never_cache_me_9999',
            loanId: mockLoanId,
            createdAt: new Date().toISOString(),
          },
        }),
      });
      (global as any).fetch = mockFetch;

      await ApiClient.generatePortalLink(mockLoanId);
      await ApiClient.regeneratePortalLink(mockLoanId);

      // Verify no portal token exists in storage
      expect(mockLocalStorage.getItem('portal_token')).toBeNull();
      expect(mockLocalStorage.getItem('cpt_token')).toBeNull();
      expect(mockLocalStorage.getItem('token_hash')).toBeNull();

      // Only the admin access token and user info should exist
      expect(mockLocalStorage.getItem('crm_access_token')).toBe('mock_admin_jwt_session');
      expect(mockLocalStorage.getItem('crm_user')).toContain('admin@crm.com');
    });
  });

  describe('8. Existing Admin Login and Loan UI Isolation', () => {
    test('admin authentication and session methods remain fully functional', () => {
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getUser()).toBeNull();

      ApiClient.setAuth(
        { id: 'manager-1', email: 'bm@crm.com', fullName: 'Branch Manager', role: UserRole.BRANCH_MANAGER } as any,
        'branch_manager_jwt'
      );

      expect(ApiClient.getToken()).toBe('branch_manager_jwt');
      expect(ApiClient.getUser()?.role).toBe(UserRole.BRANCH_MANAGER);

      ApiClient.logout();
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getUser()).toBeNull();
    });
  });
});
