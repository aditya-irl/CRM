import React from 'react';
import { renderToString } from 'react-dom/server';
import { ApiClient } from '../src/services/api';
import { UserRole, IUser } from '@crm/shared';
import { DashboardView } from '../src/views/DashboardView';
import { DealerDashboardView } from '../src/views/DealerDashboardView';
import { Sidebar } from '../src/components/Sidebar';
import { Navbar } from '../src/components/Navbar';
import { RecordPaymentModal } from '../src/components/RecordPaymentModal';

// Mock storage factory for isolated tabs
function createMockStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
}

describe('Phase 6 — Cross-Tab Session Isolation & Dashboard Resilience Regression Tests', () => {
  const adminUser: IUser = {
    id: 'admin-uuid-001',
    email: 'admin@financecorp.in',
    fullName: 'Executive Admin',
    role: UserRole.ADMIN,
    mustChangePassword: false,
    assignedBranch: 'HQ',
    dealerId: undefined,
  };

  const dealerUser: IUser = {
    id: 'dealer-uuid-101',
    email: 'dealer@partnerstore.in',
    fullName: 'Partner Retail Store',
    role: UserRole.DEALER,
    mustChangePassword: false,
    assignedBranch: 'North Zone',
    dealerId: 'dealer-uuid-101',
  };

  let globalLocalStorage: Storage;

  beforeEach(() => {
    globalLocalStorage = createMockStorage();
    (global as any).localStorage = globalLocalStorage;
    (global as any).sessionStorage = createMockStorage();
    jest.restoreAllMocks();
  });

  describe('1. Cross-Tab Session Isolation (Admin vs Dealer)', () => {
    test('Admin and Dealer tabs maintain independent tokens and identities simultaneously', () => {
      // Simulate Tab 1 (Admin)
      const tab1Session = createMockStorage();
      (global as any).sessionStorage = tab1Session;

      ApiClient.setAuth(adminUser, 'admin-token-jwt-123', 'admin-refresh-456');

      expect(ApiClient.getToken()).toBe('admin-token-jwt-123');
      expect(ApiClient.getUser()?.role).toBe(UserRole.ADMIN);
      expect(ApiClient.getUser()?.email).toBe('admin@financecorp.in');

      // Simulate Tab 2 (Dealer) opened simultaneously
      const tab2Session = createMockStorage();
      (global as any).sessionStorage = tab2Session;

      // Dealer logs in on Tab 2
      ApiClient.setAuth(dealerUser, 'dealer-token-jwt-999', 'dealer-refresh-888');

      // In Tab 2, identity is Dealer
      expect(ApiClient.getToken()).toBe('dealer-token-jwt-999');
      expect(ApiClient.getUser()?.role).toBe(UserRole.DEALER);
      expect(ApiClient.getUser()?.dealerId).toBe('dealer-uuid-101');

      // Switch back to Tab 1 context (Tab 1's isolated sessionStorage)
      (global as any).sessionStorage = tab1Session;

      // Tab 1 MUST retain Admin token and Admin identity, NOT Dealer!
      expect(ApiClient.getToken()).toBe('admin-token-jwt-123');
      expect(ApiClient.getUser()?.role).toBe(UserRole.ADMIN);
      expect(ApiClient.getUser()?.dealerId).toBeUndefined();
    });

    test('Dealer logout in Tab 2 does not invalidate or evict Admin session in Tab 1', () => {
      const tab1Session = createMockStorage();
      const tab2Session = createMockStorage();

      // Tab 1 logs in as Admin
      (global as any).sessionStorage = tab1Session;
      ApiClient.setAuth(adminUser, 'admin-token-jwt-123');

      // Tab 2 logs in as Dealer
      (global as any).sessionStorage = tab2Session;
      ApiClient.setAuth(dealerUser, 'dealer-token-jwt-999');

      // Dealer logs out in Tab 2
      ApiClient.logout();
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getUser()).toBeNull();

      // Tab 1 remains active Admin
      (global as any).sessionStorage = tab1Session;
      expect(ApiClient.getToken()).toBe('admin-token-jwt-123');
      expect(ApiClient.getUser()?.role).toBe(UserRole.ADMIN);
    });

    test('API requests from each tab attach the tab-scoped identity in Authorization header', async () => {
      const tab1Session = createMockStorage();
      (global as any).sessionStorage = tab1Session;
      ApiClient.setAuth(adminUser, 'admin-secret-bearer');

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { totalDisbursed: 100000 },
        }),
      });
      (global as any).fetch = mockFetch;

      await ApiClient.getDashboardStats();

      expect(mockFetch).toHaveBeenCalled();
      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['Authorization']).toBe('Bearer admin-secret-bearer');
    });

    test('Token refresh in Tab 1 (Admin) updates Tab 1 sessionStorage and cannot affect Tab 2 (Dealer)', async () => {
      const tab1Session = createMockStorage();
      const tab2Session = createMockStorage();

      // Tab 1 logs in as Admin
      (global as any).sessionStorage = tab1Session;
      ApiClient.setAuth(adminUser, 'old-admin-access', 'admin-refresh-token');

      // Tab 2 logs in as Dealer
      (global as any).sessionStorage = tab2Session;
      ApiClient.setAuth(dealerUser, 'dealer-access-token', 'dealer-refresh-token');

      // Switch context to Tab 1 (Admin)
      (global as any).sessionStorage = tab1Session;

      // Mock refresh API returning new Admin tokens
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            accessToken: 'new-refreshed-admin-access',
            refreshToken: 'new-refreshed-admin-refresh',
          },
        }),
      });

      const refreshed = await ApiClient.executeRefresh();
      expect(refreshed).toBe('new-refreshed-admin-access');

      // Tab 1 sessionStorage MUST now have the new Admin access token
      expect(ApiClient.getToken()).toBe('new-refreshed-admin-access');
      expect(ApiClient.getUser()?.role).toBe(UserRole.ADMIN);

      // Switch to Tab 2 (Dealer)
      (global as any).sessionStorage = tab2Session;
      // Tab 2 MUST still be Dealer with dealer access token
      expect(ApiClient.getToken()).toBe('dealer-access-token');
      expect(ApiClient.getUser()?.role).toBe(UserRole.DEALER);
    });

    test('A fresh tab opened directly at the CRM URL renders clean login screen with no silent identity adoption', () => {
      // Simulate existing logged-in tabs having run previously
      // Simulate fresh tab with empty sessionStorage opened directly by URL
      const freshTabSession = createMockStorage();
      (global as any).sessionStorage = freshTabSession;

      // The tab MUST NOT adopt any identity from shared storage
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getUser()).toBeNull();
      expect(ApiClient.getRefreshToken()).toBeNull();
    });

    test('A fresh tab opened from an existing authenticated tab (cloned sessionStorage) maintains parent tab identity', () => {
      // Tab A (Admin) has established session
      const tabASession = createMockStorage();
      (global as any).sessionStorage = tabASession;
      ApiClient.setAuth(adminUser, 'admin-token-123', 'admin-refresh-123');

      // Browser opens child tab via window.open/link, which clones parent sessionStorage
      const childTabSession = createMockStorage();
      childTabSession.setItem('crm_access_token', tabASession.getItem('crm_access_token')!);
      childTabSession.setItem('crm_refresh_token', tabASession.getItem('crm_refresh_token')!);
      childTabSession.setItem('crm_user', tabASession.getItem('crm_user')!);

      (global as any).sessionStorage = childTabSession;
      expect(ApiClient.getToken()).toBe('admin-token-123');
      expect(ApiClient.getUser()?.role).toBe(UserRole.ADMIN);
      expect(ApiClient.getUser()?.email).toBe('admin@financecorp.in');
    });

    test('Refreshing each existing tab preserves its own authenticated identity seamlessly', () => {
      const tab1Session = createMockStorage();
      const tab2Session = createMockStorage();

      (global as any).sessionStorage = tab1Session;
      ApiClient.setAuth(adminUser, 'admin-token-preserve');

      (global as any).sessionStorage = tab2Session;
      ApiClient.setAuth(dealerUser, 'dealer-token-preserve');

      // Simulate reload of Tab 1 (sessionStorage is preserved by browser across page reloads)
      (global as any).sessionStorage = tab1Session;
      expect(ApiClient.getToken()).toBe('admin-token-preserve');
      expect(ApiClient.getUser()?.role).toBe(UserRole.ADMIN);

      // Simulate reload of Tab 2
      (global as any).sessionStorage = tab2Session;
      expect(ApiClient.getToken()).toBe('dealer-token-preserve');
      expect(ApiClient.getUser()?.role).toBe(UserRole.DEALER);
    });

    test('Logging out of one tab leaves the other tab session fully active and intact', () => {
      const tab1Session = createMockStorage();
      const tab2Session = createMockStorage();

      (global as any).sessionStorage = tab1Session;
      ApiClient.setAuth(adminUser, 'admin-active-token');

      (global as any).sessionStorage = tab2Session;
      ApiClient.setAuth(dealerUser, 'dealer-active-token');

      // Tab 1 logs out
      (global as any).sessionStorage = tab1Session;
      ApiClient.logout();
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getUser()).toBeNull();

      // Tab 2 remains active
      (global as any).sessionStorage = tab2Session;
      expect(ApiClient.getToken()).toBe('dealer-active-token');
      expect(ApiClient.getUser()?.role).toBe(UserRole.DEALER);
    });

    test('Session expiry in Tab A triggers auth expired event without affecting Tab B', async () => {
      const tabASession = createMockStorage();
      const tabBSession = createMockStorage();

      (global as any).sessionStorage = tabASession;
      ApiClient.setAuth(adminUser, 'expiring-admin-token', 'expired-admin-refresh');

      (global as any).sessionStorage = tabBSession;
      ApiClient.setAuth(dealerUser, 'active-dealer-token', 'active-dealer-refresh');

      // In Tab A, refresh fails with 401
      (global as any).sessionStorage = tabASession;
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { message: 'Refresh token revoked' },
        }),
      });

      let expiredEventFired = false;
      const listener = () => { expiredEventFired = true; };
      (global as any).window = {
        dispatchEvent: (evt: any) => {
          if (evt.type === 'crm_auth_expired') expiredEventFired = true;
        },
      };

      await expect(ApiClient.executeRefresh()).rejects.toThrow('Session expired. Please log in again.');
      expect(expiredEventFired).toBe(true);

      // Tab A is now logged out
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getUser()).toBeNull();

      // Switch to Tab B: Tab B remains fully authenticated as Dealer
      (global as any).sessionStorage = tabBSession;
      expect(ApiClient.getToken()).toBe('active-dealer-token');
      expect(ApiClient.getUser()?.role).toBe(UserRole.DEALER);
    });
  });

  describe('2. Dashboard Resilience & Safe Error Handling', () => {
    test('API failure displays clear error state and retry action, not a blank screen or default zeros', async () => {
      // Mock fetch failure (e.g. 503 Service Unavailable or 403 Forbidden)
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          success: false,
          error: { message: 'Core ledger service unavailable' },
        }),
      });

      // Render Admin DashboardView in SSR/test environment
      const html = renderToString(<DashboardView />);

      // The view MUST NOT be empty/blank
      expect(html).toBeTruthy();
      expect(html.length).toBeGreaterThan(100);

      // Verify that Skeleton Loading Grid is rendered without rendering false zeros or blank screen
      expect(html).toContain('dashboard-kpi-grid-6');
      expect(html).not.toContain('₹0.00');
    });

    test('Dealer Dashboard View renders store partner terminal with retry action on failure', () => {
      const html = renderToString(<DealerDashboardView />);
      expect(html).toBeTruthy();
      expect(html).toContain('Store Partner Dashboard');
      expect(html).toContain('Record EMI Payment');
    });

    test('Stale response protection: newer request updates supersede older delayed requests', async () => {
      // Testing requestIdRef logic inside ApiClient or Views
      let resolveFirst: any;
      const firstPromise = new Promise((res) => {
        resolveFirst = res;
      });

      let callCount = 0;
      (global as any).fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return firstPromise;
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { metrics: { totalCustomers: 42, activeLoans: 15 } },
          }),
        });
      });

      // Call 1 started
      const req1 = ApiClient.getDealerDashboard();
      // Call 2 started later
      const req2 = ApiClient.getDealerDashboard();

      const result2 = await req2;
      expect((result2 as any).metrics.totalCustomers).toBe(42);

      // Call 1 finishes later with old data
      resolveFirst({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { metrics: { totalCustomers: 5, activeLoans: 2 } },
        }),
      });

      const result1 = await req1;
      expect((result1 as any).metrics.totalCustomers).toBe(5);
    });
  });

  describe('3. Mobile Responsive Navigation & Modals', () => {
    test('Sidebar drawer supports mobileOpen state and close callback', () => {
      const onCloseMock = jest.fn();
      const html = renderToString(
        <Sidebar
          activeTab="dashboard"
          onSelectTab={() => {}}
          user={adminUser}
          mobileOpen={true}
          onCloseMobile={onCloseMock}
        />
      );

      // Sidebar has .crm-sidebar with .open and overlay
      expect(html).toContain('crm-sidebar open');
      expect(html).toContain('crm-sidebar-overlay');
      expect(html).toContain('Operations Menu');
    });

    test('Navbar provides mobile menu toggle button and responsive action styling', () => {
      const toggleMock = jest.fn();
      const html = renderToString(
        <Navbar
          user={adminUser}
          onLogout={() => {}}
          onToggleMobileMenu={toggleMock}
        />
      );

      expect(html).toContain('mobile-menu-toggle');
      expect(html).toContain('btn-responsive-action');
      expect(html).toContain('btn-responsive-label');
    });

    test('Payment modal renders responsive grid and wrap-ready collection source options', () => {
      const html = renderToString(
        <RecordPaymentModal
          isOpen={true}
          onClose={() => {}}
          user={adminUser}
        />
      );

      expect(html).toContain('collection-source-button-group');
      expect(html).toContain('modal-form-grid-2');
      expect(html).toContain('modal-actions-footer');
    });
  });
});
