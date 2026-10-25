const mockPreferencesStore: Record<string, string> = {};
const mockSecureStorageStore: Record<string, any> = {};

jest.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: jest.fn(async (key: string) => mockSecureStorageStore[key] ?? null),
    set: jest.fn(async (key: string, value: any) => {
      mockSecureStorageStore[key] = value;
    }),
    remove: jest.fn(async (key: string) => {
      delete mockSecureStorageStore[key];
    }),
  },
}));

jest.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: jest.fn(async ({ key }: { key: string }) => ({ value: mockPreferencesStore[key] || null })),
    set: jest.fn(async ({ key, value }: { key: string; value: string }) => {
      mockPreferencesStore[key] = value;
    }),
    remove: jest.fn(async ({ key }: { key: string }) => {
      delete mockPreferencesStore[key];
    }),
  },
}));

import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Preferences } from '@capacitor/preferences';
import { ApiClient, buildApiUrl, DEFAULT_PRODUCTION_API_BASE } from '../src/services/api';

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

describe('Capacitor Mobile Integration & Native Resilience', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    ApiClient.logout();
    for (const k of Object.keys(mockPreferencesStore)) {
      delete mockPreferencesStore[k];
    }
    for (const k of Object.keys(mockSecureStorageStore)) {
      delete mockSecureStorageStore[k];
    }
    const mockSession = createMockStorage();
    const mockLocal = createMockStorage();
    (global as any).sessionStorage = mockSession;
    (global as any).localStorage = mockLocal;
    (global as any).window = {
      location: {
        origin: 'http://localhost:3000',
        hash: '',
      },
      sessionStorage: mockSession,
      localStorage: mockLocal,
      dispatchEvent: jest.fn(),
    };
    (import.meta as any).env = {};
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('buildApiUrl Environment & Platform Resolution', () => {
    it('routes to relative /api/v1 for standard web browsers', () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
      expect(buildApiUrl('/dealers')).toBe('/api/v1/dealers');
      expect(buildApiUrl('')).toBe('/api/v1');
    });

    it('defaults to confirmed production HTTPS backend when running on native Capacitor without override', () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      expect(buildApiUrl('/dealers')).toBe(`${DEFAULT_PRODUCTION_API_BASE}/dealers`);
      expect(buildApiUrl('')).toBe(DEFAULT_PRODUCTION_API_BASE);
      expect(buildApiUrl('/dealers')).toBe('https://crm-api-a3fd.onrender.com/api/v1/dealers');
    });

    it('respects valid trusted VITE_API_BASE_URL override on native platforms', () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      (import.meta as any).env.VITE_API_BASE_URL = 'https://custom-api.onrender.com/api/v1';

      expect(buildApiUrl('/loans')).toBe('https://custom-api.onrender.com/api/v1/loans');
    });

    it('rejects untrusted API base URL override and falls back safely to production', () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      (window as any).__CRM_API_BASE_URL__ = 'https://malicious-phishing-crm.com/api/v1';

      // Falls back to confirmed production base
      expect(buildApiUrl('/loans')).toBe(`${DEFAULT_PRODUCTION_API_BASE}/loans`);
    });
  });

  describe('Hardware Keystore Token Security & Session Restoration', () => {
    const mockUser = {
      id: 'usr_mobile_admin_01',
      email: 'admin@alphamobile.com',
      role: 'ADMIN',
      name: 'Mobile Administrator',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('restores authentication session from hardware SecureStorage on native launch', async () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      mockSecureStorageStore['crm_access_token'] = 'tok_secure_active_123';
      mockSecureStorageStore['crm_refresh_token'] = 'tok_secure_refresh_456';
      mockSecureStorageStore['crm_user'] = JSON.stringify(mockUser);

      const restored = await ApiClient.restoreNativeSession();
      expect(restored).toBe(true);
      expect(ApiClient.getToken()).toBe('tok_secure_active_123');
      expect(ApiClient.getRefreshToken()).toBe('tok_secure_refresh_456');
      expect(ApiClient.getUser()?.email).toBe('admin@alphamobile.com');
    });

    it('persists authentication tokens to SecureStorage and NEVER writes to unencrypted Preferences', async () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

      ApiClient.setAuth(mockUser as any, 'tok_new_mobile', 'tok_refresh_mobile');
      await Promise.resolve();

      expect(SecureStorage.set).toHaveBeenCalledWith('crm_access_token', 'tok_new_mobile');
      expect(SecureStorage.set).toHaveBeenCalledWith('crm_refresh_token', 'tok_refresh_mobile');
      expect(SecureStorage.set).toHaveBeenCalledWith('crm_user', JSON.stringify(mockUser));
      expect(mockSecureStorageStore['crm_access_token']).toBe('tok_new_mobile');

      // Security assertion: unencrypted Preferences MUST NOT receive tokens
      expect(Preferences.set).not.toHaveBeenCalled();
      expect(mockPreferencesStore['crm_access_token']).toBeUndefined();
    });

    it('removes authentication tokens from SecureStorage and purges legacy keys on logout', () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      mockSecureStorageStore['crm_access_token'] = 'tok_new_mobile';
      mockPreferencesStore['crm_access_token'] = 'tok_legacy_unencrypted';

      ApiClient.logout();

      expect(SecureStorage.remove).toHaveBeenCalledWith('crm_access_token');
      expect(SecureStorage.remove).toHaveBeenCalledWith('crm_refresh_token');
      expect(SecureStorage.remove).toHaveBeenCalledWith('crm_user');
      expect(Preferences.remove).toHaveBeenCalledWith({ key: 'crm_access_token' });
      expect(mockSecureStorageStore['crm_access_token']).toBeUndefined();
      expect(ApiClient.getToken()).toBeNull();
      expect(ApiClient.getUser()).toBeNull();
    });

    it('fails safely and dispatches recoverable error event if SecureStorage read throws', async () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      (SecureStorage.get as any).mockRejectedValueOnce(new Error('Keystore authentication failed'));

      const restored = await ApiClient.restoreNativeSession();
      expect(restored).toBe(false);
      expect(ApiClient.getToken()).toBeNull();
      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'crm_secure_storage_error',
        })
      );
    });

    it('fails safely and dispatches recoverable error event if SecureStorage write throws without leaking to Preferences', async () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      (SecureStorage.set as any).mockRejectedValueOnce(new Error('Keystore locked or disabled'));

      ApiClient.setAuth(mockUser as any, 'tok_failing_write');

      // Give microtasks time to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(Preferences.set).not.toHaveBeenCalled();
      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'crm_secure_storage_error',
        })
      );
    });

    it('concurrent API requests await pending session restoration on native launch', async () => {
      jest.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      mockSecureStorageStore['crm_access_token'] = 'tok_restored_concurrent';
      mockSecureStorageStore['crm_user'] = JSON.stringify(mockUser);

      // Trigger restoration
      const restorePromise = ApiClient.restoreNativeSession();

      // Mock fetch
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [] }),
      });

      // Fire API request while restore is in flight
      const requestPromise = (ApiClient as any).request('/dealers');

      await Promise.all([restorePromise, requestPromise]);

      expect((global as any).fetch).toHaveBeenCalledWith(
        'https://crm-api-a3fd.onrender.com/api/v1/dealers',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer tok_restored_concurrent',
          }),
        })
      );
    });
  });
});
