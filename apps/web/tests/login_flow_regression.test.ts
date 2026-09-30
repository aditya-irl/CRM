import React from 'react';
import { renderToString } from 'react-dom/server';
import { buildApiUrl, ApiClient } from '../src/services/api';
import { LoginView } from '../src/views/LoginView';

describe('Login Flow & Authentication Regression Tests', () => {
  const originalFetch = global.fetch;
  const storageStore: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => storageStore[key] || null,
    setItem: (key: string, val: string) => { storageStore[key] = val; },
    removeItem: (key: string) => { delete storageStore[key]; },
    clear: () => { Object.keys(storageStore).forEach((k) => delete storageStore[k]); },
  };

  const eventListeners: Record<string, Function[]> = {};
  const mockWindow = {
    dispatchEvent: jest.fn((event: any) => {
      const type = event?.type || event;
      (eventListeners[type] || []).forEach((fn) => fn(event));
      return true;
    }),
    addEventListener: (type: string, fn: Function) => {
      eventListeners[type] = eventListeners[type] || [];
      eventListeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: Function) => {
      if (eventListeners[type]) {
        eventListeners[type] = eventListeners[type].filter((cb) => cb !== fn);
      }
    },
  };

  beforeAll(() => {
    (global as any).localStorage = mockLocalStorage;
    (global as any).sessionStorage = mockLocalStorage;
    (global as any).window = mockWindow;
    (global as any).Event = class Event {
      type: string;
      constructor(type: string) { this.type = type; }
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockLocalStorage.clear();
    mockWindow.dispatchEvent.mockClear();
    Object.keys(eventListeners).forEach((k) => delete eventListeners[k]);
    jest.restoreAllMocks();
  });

  describe('buildApiUrl — URL Normalization & Sanitization', () => {
    test('constructs default relative /api/v1/auth/login when no env is configured', () => {
      const url = buildApiUrl('/auth/login');
      expect(url).toBe('/api/v1/auth/login');
    });

    test('handles endpoint without leading slash', () => {
      const url = buildApiUrl('auth/login');
      expect(url).toBe('/api/v1/auth/login');
    });

    test('handles trailing and leading spaces in endpoint', () => {
      const url = buildApiUrl('  /auth/login  ');
      expect(url).toBe('/api/v1/auth/login');
    });

    test('eliminates duplicate consecutive slashes in path', () => {
      const url = buildApiUrl('///auth///login');
      expect(url).toBe('/api/v1/auth/login');
    });
  });

  describe('ApiClient 401 Handling — Login vs Protected Endpoints', () => {
    test('POST /auth/login returning 401 parses backend "Invalid credentials" and does NOT throw "Session expired. Please log in again."', async () => {
      const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: false,
          error: { message: 'Invalid credentials' },
        }),
      } as any);

      // Verify it throws "Invalid credentials", NOT "Session expired. Please log in again."
      await expect(ApiClient.login('admin@financecrm.com', 'WrongPassword123!')).rejects.toThrow(
        'Invalid credentials'
      );
      await expect(ApiClient.login('admin@financecrm.com', 'WrongPassword123!')).rejects.not.toThrow(
        'Session expired. Please log in again.'
      );

      // Verify crm_auth_expired was NOT dispatched
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    test('POST /auth/login handles empty body / proxy 401 by throwing "Invalid credentials"', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as any);

      await expect(ApiClient.login('admin@financecrm.com', 'WrongPass')).rejects.toThrow(
        'Invalid credentials'
      );
    });

    test('Protected endpoint returning 401 maintains session-expired behavior and dispatches crm_auth_expired', async () => {
      mockLocalStorage.setItem('crm_access_token', 'valid-or-expired-token');
      mockLocalStorage.setItem('crm_user', JSON.stringify({ email: 'test@financecrm.com' }));

      let authExpiredDispatched = false;
      const listener = () => { authExpiredDispatched = true; };
      window.addEventListener('crm_auth_expired', listener);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: false,
          error: { message: 'Invalid or expired token' },
        }),
      } as any);

      await expect(ApiClient.getDashboardStats()).rejects.toThrow(
        'Session expired. Please log in again.'
      );

      // Verify token and user are cleared
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getUser()).toBeNull();
      expect(authExpiredDispatched).toBe(true);

      window.removeEventListener('crm_auth_expired', listener);
    });

    test('POST /auth/change-password returning 401 maintains "Current password is incorrect" error without session wipe', async () => {
      mockLocalStorage.setItem('crm_access_token', 'active-token');

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: false,
          error: { message: 'Current password is incorrect' },
        }),
      } as any);

      await expect(ApiClient.changePassword('WrongOld', 'NewPassword123!')).rejects.toThrow(
        'Current password is incorrect'
      );
      // Token must not be wiped on wrong current password
      expect(ApiClient.getToken()).toBe('active-token');
    });
  });

  describe('ApiClient.login — Request & Response Handling', () => {
    test('successfully logs in, stores token and user in localStorage', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'admin@financecrm.com',
        fullName: 'Mr. Sparsh',
        role: 'SUPER_ADMIN',
        assignedBranch: 'Headquarters',
      };
      const mockTokens = {
        accessToken: 'mock-access-token-jwt',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          data: {
            user: mockUser,
            tokens: mockTokens,
          },
        }),
      } as any);

      const loggedInUser = await ApiClient.login('admin@financecrm.com', 'ValidPassword123!');

      expect(loggedInUser.id).toBe('user-123');
      expect(ApiClient.getToken()).toBe('mock-access-token-jwt');
      expect(ApiClient.getUser()?.email).toBe('admin@financecrm.com');
      expect(ApiClient.getUser()?.fullName).toBe('Mr. Sparsh');
    });

    test('REGRESSION: handles empty body / proxy 500 without throwing "The string did not match the expected pattern."', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: async () => {
          const err = new Error('The string did not match the expected pattern.');
          err.name = 'SyntaxError';
          throw err;
        },
      } as any);

      await expect(ApiClient.login('admin@financecrm.com', 'Pass')).rejects.toThrow(
        /Unable to reach the API server \(HTTP 500\)/
      );
    });

    test('REGRESSION: handles HTML error page from proxy/gateway gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as any);

      await expect(ApiClient.login('admin@financecrm.com', 'Pass')).rejects.toThrow(
        /Unable to reach the API server \(HTTP 502\)/
      );
    });

    test('handles structured API error message from backend', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: false,
          error: { message: 'Account is temporarily locked.' },
        }),
      } as any);

      await expect(ApiClient.login('locked@email.com', 'pass')).rejects.toThrow(
        'Account is temporarily locked.'
      );
    });
  });

  describe('LoginView Component — Demo Credentials & Preset Buttons Removal Verification', () => {
    test('renders completely clean login UI with no demo credentials or preset quick login buttons', () => {
      const html = renderToString(React.createElement(LoginView, { onSuccess: () => {} }));

      // Verify no Quick Login / Preset sections
      expect(html).not.toContain('Quick Preset Logins');
      expect(html).not.toContain('Quick Login');
      expect(html).not.toContain('Preset Logins');

      // Verify no hardcoded demo credentials
      expect(html).not.toContain('Admin@123456');
      expect(html).not.toContain('Agent@123456');
      expect(html).not.toContain('Manager@123456');
      expect(html).not.toContain('Vikram Malhotra');
      expect(html).not.toContain('Rahul Sharma');
      expect(html).not.toContain('Anita Deshmukh');
      expect(html).not.toContain('agent.rahul@financecrm.com');
      expect(html).not.toContain('manager@financecrm.com');

      // Verify default input values are empty
      expect(html).toContain('value=""');

      // Verify official branding remains intact
      expect(html).toContain('Enterprise EMI Platform');
      expect(html).toContain('Alpha Mobile Gallery');
      expect(html).toContain('Shubh Pvt Ltd');
      expect(html).toContain('ACID Ledger Protected');
    });
  });
});
