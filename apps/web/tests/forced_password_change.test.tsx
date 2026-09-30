import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from '../src/App';
import { ChangePasswordView } from '../src/views/ChangePasswordView';
import { ApiClient } from '../src/services/api';
import { IUser, UserRole, UserStatus } from '@crm/shared';

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

describe('Forced Password Change & Dealer Security Guard Tests', () => {
  const originalFetch = global.fetch;

  const mockDealerUserWithTempPass: IUser = {
    id: 'user-dealer-001',
    email: 'dealer1@store.com',
    phone: '9876543210',
    fullName: 'Rathore Electronics',
    role: UserRole.DEALER,
    status: UserStatus.ACTIVE,
    dealerId: 'dlr-uuid-1',
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockDealerUserNormal: IUser = {
    ...mockDealerUserWithTempPass,
    mustChangePassword: false,
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockLocalStorage.clear();
  });

  describe('1. Route & Component Guarding for Temporary Passwords', () => {
    test('Dealer with mustChangePassword=true is immediately forced into Change Password screen', () => {
      ApiClient.setAuth(mockDealerUserWithTempPass, 'mock-dealer-token-xyz');

      const html = renderToString(<App />);

      // Must display mandatory Change Password view
      expect(html).toContain('Temporary Password Reset');
      expect(html).toContain('Security Requirement');
      expect(html).toContain('Rathore Electronics');
      expect(html).toContain('Current Temporary Password');
      expect(html).toContain('New Permanent Password');
      expect(html).toContain('Confirm New Password');

      // Must NOT display protected application elements
      expect(html).not.toContain('Store Partner Dashboard');
      expect(html).not.toContain('Dealer Isolated');
      expect(html).not.toContain('Direct Collections Ledger');
      expect(html).not.toContain('Run Midnight Engine');
      expect(html).not.toContain('Add Customer');
    });

    test('Protected dealer routes and navigation are completely inaccessible while flag is true', () => {
      ApiClient.setAuth(mockDealerUserWithTempPass, 'mock-dealer-token-xyz');

      const html = renderToString(<App />);

      // Sidebar navigation tabs must NOT be rendered
      expect(html).not.toContain('crm-sidebar');
      expect(html).not.toContain('Store Customers');
      expect(html).not.toContain('Financed Loans');
      expect(html).not.toContain('Store Collections');
      expect(html).not.toContain('Settlement Ledger');

      // The forced screen must be authoritative
      expect(html).toContain('forced-change-password-screen');
    });

    test('Dealer with mustChangePassword=false gets full access to Dealer Dashboard', () => {
      ApiClient.setAuth(mockDealerUserNormal, 'mock-dealer-token-xyz');

      const html = renderToString(<App />);

      // Must render Dealer Dashboard and navigation
      expect(html).toContain('Store Partner Dashboard');
      expect(html).toContain('Dealer Isolated');
      expect(html).toContain('Rathore Electronics');
      expect(html).not.toContain('Temporary Password Reset');
      expect(html).not.toContain('forced-change-password-screen');
    });
  });

  describe('2. State Persistence across Browser Refresh and Navigation', () => {
    test('Simulating browser refresh preserves the forced-password lock when mustChangePassword=true', () => {
      // Step 1: User logs in with temporary password, stored in localStorage
      ApiClient.setAuth(mockDealerUserWithTempPass, 'mock-dealer-token-xyz');

      // Step 2: Fresh reload of App (equivalent to browser page refresh)
      const freshUser = ApiClient.getUser();
      expect(freshUser?.mustChangePassword).toBe(true);

      const html = renderToString(<App />);
      expect(html).toContain('Temporary Password Reset');
      expect(html).not.toContain('Store Partner Dashboard');
    });

    test('Simulating browser refresh opens application normally after password is reset', () => {
      // Step 1: User state updated with mustChangePassword=false
      ApiClient.setAuth(mockDealerUserNormal, 'mock-dealer-token-xyz');

      // Step 2: Fresh reload of App
      const freshUser = ApiClient.getUser();
      expect(freshUser?.mustChangePassword).toBe(false);

      const html = renderToString(<App />);
      expect(html).toContain('Store Partner Dashboard');
      expect(html).not.toContain('Temporary Password Reset');
    });
  });

  describe('3. ChangePasswordView Component Features & Interactions', () => {
    test('Renders all required password fields, visibility toggles, and sign out button', () => {
      const html = renderToString(
        <ChangePasswordView
          user={mockDealerUserWithTempPass}
          onSuccess={() => {}}
          onLogout={() => {}}
        />
      );

      expect(html).toContain('current-password-input');
      expect(html).toContain('new-password-input');
      expect(html).toContain('confirm-password-input');
      expect(html).toContain('toggle-current-password');
      expect(html).toContain('toggle-new-password');
      expect(html).toContain('toggle-confirm-password');
      expect(html).toContain('submit-change-password');
      expect(html).toContain('logout-button');
      expect(html).toContain('Sign Out');
    });
  });

  describe('4. ApiClient.changePassword & API Error Handling', () => {
    test('4.1 Failed password change with 401 returns "Current password is incorrect" and preserves session', async () => {
      ApiClient.setAuth(mockDealerUserWithTempPass, 'mock-dealer-token-xyz');

      // Mock backend 401 response for wrong current password
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: {
            message: 'Current password is incorrect',
            code: 'UNAUTHORIZED',
          },
        }),
      });

      await expect(
        ApiClient.changePassword('WrongTemp@123', 'NewPermanent@2026')
      ).rejects.toThrow('Current password is incorrect');

      // User must NOT be logged out from wrong password attempt
      expect(ApiClient.getToken()).toBe('mock-dealer-token-xyz');
      expect(ApiClient.getUser()?.mustChangePassword).toBe(true);
    });

    test('4.2 Failed password change with 400 validation error safely surfaces message', async () => {
      ApiClient.setAuth(mockDealerUserWithTempPass, 'mock-dealer-token-xyz');

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: {
            message: 'New password must be at least 6 characters',
            code: 'VALIDATION_ERROR',
          },
        }),
      });

      await expect(
        ApiClient.changePassword('ValidTemp@123', '123')
      ).rejects.toThrow('New password must be at least 6 characters');

      // User still locked
      expect(ApiClient.getUser()?.mustChangePassword).toBe(true);
    });

    test('4.3 Successful password change updates local user state to mustChangePassword=false', async () => {
      ApiClient.setAuth(mockDealerUserWithTempPass, 'mock-dealer-token-xyz');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            success: true,
            message: 'Password changed successfully',
          },
          timestamp: new Date().toISOString(),
        }),
      });

      const res = await ApiClient.changePassword('ValidTemp@123', 'NewPermanent@2026');
      expect(res.success).toBe(true);
      expect(res.message).toBe('Password changed successfully');

      // Local storage must be automatically updated with mustChangePassword=false
      const updatedUser = ApiClient.getUser();
      expect(updatedUser?.mustChangePassword).toBe(false);

      // Now App renders dealer dashboard instead of change password screen
      const html = renderToString(<App />);
      expect(html).toContain('Store Partner Dashboard');
      expect(html).not.toContain('Temporary Password Reset');
    });
  });
});
