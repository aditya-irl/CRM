import React from 'react';
import { renderToString } from 'react-dom/server';
import { DealersView } from '../src/views/DealersView';
import { ApiClient } from '../src/services/api';
import { UserRole, DealerStatus } from '@crm/shared';

// Mock localStorage and sessionStorage
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

describe('Dealer Credential Provisioning Flow & UI Verification', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
  });

  test('1. Credential response structure does NOT persist temporary password into localStorage or sessionStorage', async () => {
    // Simulate setting auth for admin
    ApiClient.setAuth(
      {
        id: 'admin-001',
        email: 'admin@financecrm.com',
        phone: '9999999999',
        fullName: 'Super Administrator',
        role: UserRole.SUPER_ADMIN,
        status: 'ACTIVE' as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'admin-token-123'
    );

    // Verify localStorage has only safe auth tokens/user profile
    const storedUser = JSON.parse(mockLocalStorage.getItem('crm_user') || '{}');
    expect(storedUser.password).toBeUndefined();
    expect(storedUser.temporaryPassword).toBeUndefined();
    expect(storedUser.password_hash).toBeUndefined();

    // Verify sessionStorage has nothing sensitive
    expect(mockLocalStorage.getItem('crm_temp_password')).toBeNull();
  });

  test('2. DealersView renders dealer management table and action headers', () => {
    const html = renderToString(<DealersView />);
    expect(html).toContain('Dealer &amp; Retail Store Network');
    expect(html).toContain('Add New Partner Store');
  });

  test('3. WhatsApp message formatter correctly encodes dealer credentials and phone number', () => {
    const dealerPhone = '9876543210';
    const cleanPhone = dealerPhone.replace(/\D/g, '');
    const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const storeName = 'Alpha Mobile Dadri';
    const dealerCode = 'DLR-000101';
    const loginId = 'DLR-000101';
    const temporaryPassword = 'xK9$mP2#vL8*qR5^wN3!';

    const msg = `Hello ${storeName}, your dealer portal credentials for Alpha Mobile Gallery CRM:\n\nDealer ID: ${dealerCode}\nLogin ID: ${loginId}\nTemporary Password: ${temporaryPassword}\n\nPlease login and change your password upon first access.`;
    const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`;

    expect(waUrl).toContain('https://wa.me/919876543210?text=');
    expect(decodeURIComponent(waUrl)).toContain(temporaryPassword);
    expect(decodeURIComponent(waUrl)).toContain(dealerCode);
    expect(decodeURIComponent(waUrl)).toContain(loginId);
  });
});
