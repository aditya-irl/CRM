import { ApiClient } from '../src/services/api';

describe('Automatic Refresh-Token Authentication Tests', () => {
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

  describe('A. Access token expires -> refresh succeeds -> original request retries successfully', () => {
    test('transparently refreshes token and retries protected call on 401', async () => {
      mockLocalStorage.setItem('crm_access_token', 'expired-access-token');
      mockLocalStorage.setItem('crm_refresh_token', 'initial-refresh-token');

      const calls: Array<{ url: string; authHeader?: string; body?: any }> = [];

      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        const authHeader = (init?.headers as Record<string, string>)?.[
          Object.keys(init?.headers || {}).find((k) => k.toLowerCase() === 'authorization') || ''
        ];
        calls.push({ url, authHeader, body });

        // First call: protected endpoint with expired token -> 401
        if (url.includes('/reports/dashboard-stats') && authHeader === 'Bearer expired-access-token') {
          return {
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ success: false, error: { message: 'Invalid or expired token' } }),
          };
        }

        // Second call: /auth/refresh with refresh token -> 200
        if (url.includes('/auth/refresh')) {
          expect(body?.refreshToken).toBe('initial-refresh-token');
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: true,
              data: {
                accessToken: 'new-valid-access-token',
                refreshToken: 'rotated-refresh-token',
                expiresIn: 900,
              },
            }),
          };
        }

        // Third call: retried protected endpoint with new token -> 200
        if (url.includes('/reports/dashboard-stats') && authHeader === 'Bearer new-valid-access-token') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: true,
              data: { totalLoans: 42, totalCustomers: 100 },
            }),
          };
        }

        throw new Error(`Unexpected request: ${url}`);
      });

      const stats = await ApiClient.getDashboardStats();

      // Assert data returned from retry
      expect(stats).toEqual({ totalLoans: 42, totalCustomers: 100 });

      // Assert localStorage updated with new tokens
      expect(ApiClient.getToken()).toBe('new-valid-access-token');
      expect(ApiClient.getRefreshToken()).toBe('rotated-refresh-token');

      // Assert exact sequence of 3 calls: initial 401 -> refresh -> retry
      expect(calls.length).toBe(3);
      expect(calls[0].url).toContain('/reports/dashboard-stats');
      expect(calls[0].authHeader).toBe('Bearer expired-access-token');
      expect(calls[1].url).toContain('/auth/refresh');
      expect(calls[2].url).toContain('/reports/dashboard-stats');
      expect(calls[2].authHeader).toBe('Bearer new-valid-access-token');

      // Assert crm_auth_expired was NOT dispatched
      expect(mockWindow.dispatchEvent).not.toHaveBeenCalled();
    });
  });

  describe('B. Multiple simultaneous 401s -> exactly one refresh request', () => {
    test('deduplicates concurrent refresh requests and retries all callers with the new token', async () => {
      mockLocalStorage.setItem('crm_access_token', 'simultaneous-expired-token');
      mockLocalStorage.setItem('crm_refresh_token', 'shared-refresh-token');

      let refreshCount = 0;

      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const authHeader = (init?.headers as Record<string, string>)?.[
          Object.keys(init?.headers || {}).find((k) => k.toLowerCase() === 'authorization') || ''
        ];

        if (url.includes('/auth/refresh')) {
          refreshCount++;
          // Simulate slight network latency
          await new Promise((r) => setTimeout(r, 25));
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: true,
              data: {
                accessToken: 'shared-new-access-token',
                refreshToken: 'shared-rotated-refresh-token',
                expiresIn: 900,
              },
            }),
          };
        }

        // Before refresh: 401
        if (authHeader === 'Bearer simultaneous-expired-token') {
          return {
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ success: false, error: { message: 'Token expired' } }),
          };
        }

        // After refresh with new token: 200
        if (authHeader === 'Bearer shared-new-access-token') {
          if (url.includes('/reports/dashboard-stats')) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ success: true, data: { metric: 'stats' } }),
            };
          }
          if (url.includes('/customers')) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ success: true, data: [{ id: 'c1' }] }),
            };
          }
          if (url.includes('/reports/agent-performance')) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ success: true, data: [{ agent: 'a1' }] }),
            };
          }
        }

        throw new Error(`Unexpected request: ${url}`);
      });

      // Fire 3 simultaneous API calls
      const [res1, res2, res3] = await Promise.all([
        ApiClient.getDashboardStats(),
        ApiClient.getCustomers(),
        ApiClient.getAgentPerformance(),
      ]);

      expect(res1).toEqual({ metric: 'stats' });
      expect(res2).toEqual([{ id: 'c1' }]);
      expect(res3).toEqual([{ agent: 'a1' }]);

      // Concurrency protection verification: EXACTLY ONE refresh call
      expect(refreshCount).toBe(1);
      expect(ApiClient.getToken()).toBe('shared-new-access-token');
    });
  });

  describe('C. Refresh fails -> logout / session-expired event', () => {
    test('clears auth tokens and dispatches crm_auth_expired when refresh returns 401', async () => {
      mockLocalStorage.setItem('crm_access_token', 'expired-token');
      mockLocalStorage.setItem('crm_refresh_token', 'revoked-refresh-token');

      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          return {
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: false,
              error: { code: 'UNAUTHORIZED', message: 'Invalid or expired refresh token' },
            }),
          };
        }

        return {
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: false, error: { message: 'jwt expired' } }),
        };
      });

      await expect(ApiClient.getDashboardStats()).rejects.toThrow(
        'Session expired. Please log in again.'
      );

      // Verify tokens were cleared
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getRefreshToken()).toBeNull();

      // Verify auth expired event was dispatched
      expect(mockWindow.dispatchEvent).toHaveBeenCalled();
    });
  });

  describe('D. Login 401 -> "Invalid credentials", no refresh attempt', () => {
    test('never attempts refresh on /auth/login and throws backend error', async () => {
      let refreshAttempted = false;

      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          refreshAttempted = true;
          return { ok: true, json: async () => ({ success: true }) };
        }

        if (url.includes('/auth/login')) {
          return {
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: false,
              error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
            }),
          };
        }

        throw new Error(`Unexpected url: ${url}`);
      });

      await expect(ApiClient.login('user@test.com', 'WrongPass')).rejects.toThrow(
        'Invalid credentials'
      );
      expect(refreshAttempted).toBe(false);
      expect(mockWindow.dispatchEvent).not.toHaveBeenCalled();
    });
  });

  describe('E. Refresh endpoint itself does not recursively refresh', () => {
    test('executeRefresh does not loop if the refresh endpoint returns 401', async () => {
      mockLocalStorage.setItem('crm_refresh_token', 'bad-refresh');
      let refreshCallCount = 0;

      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          refreshCallCount++;
          return {
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: false,
              error: { message: 'Session revoked' },
            }),
          };
        }
        throw new Error(`Unexpected: ${url}`);
      });

      await expect(ApiClient.executeRefresh()).rejects.toThrow(
        'Session expired. Please log in again.'
      );
      // Ensure exactly 1 call was made and no recursion occurred
      expect(refreshCallCount).toBe(1);
    });
  });

  describe('F. Existing protected-route 401 behavior still works when refresh is unavailable', () => {
    test('clears auth and throws session expired when no refresh token exists', async () => {
      mockLocalStorage.setItem('crm_access_token', 'token-without-refresh');
      // No crm_refresh_token set

      let refreshAttempted = false;
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          refreshAttempted = true;
          return { ok: true };
        }
        return {
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: false, error: { message: 'Unauthorized' } }),
        };
      });

      await expect(ApiClient.getDashboardStats()).rejects.toThrow(
        'Session expired. Please log in again.'
      );

      expect(refreshAttempted).toBe(false);
      expect(ApiClient.getToken()).toBeNull();
      expect(mockWindow.dispatchEvent).toHaveBeenCalled();
    });
  });
});
