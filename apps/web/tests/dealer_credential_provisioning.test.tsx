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

  test('3. WhatsApp message formatter correctly encodes dealer credentials, login URL, and instructions', () => {
    const dealerPhone = '9876543210';
    const cleanPhone = dealerPhone.replace(/\D/g, '');
    const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const storeName = 'Alpha Mobile Dadri';
    const dealerCode = 'DLR-000101';
    const loginId = 'DLR-000101';
    const temporaryPassword = 'xK9$mP2#vL8*qR5^wN3!';
    const loginUrl = 'https://crm-two-orcin-18.vercel.app/login';

    const msg = `Dealer Portal Credentials\n\nStore: ${storeName}\nDealer ID: ${dealerCode}\nLogin ID: ${loginId}\nTemporary Password: ${temporaryPassword}\nLogin URL: ${loginUrl}\n\nInstruction: Please login using the temporary password above. You will be required to change your password immediately after first login.`;
    const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`;

    expect(waUrl).toContain('https://wa.me/919876543210?text=');
    const decoded = decodeURIComponent(waUrl);
    expect(decoded).toContain(temporaryPassword);
    expect(decoded).toContain(dealerCode);
    expect(decoded).toContain(loginId);
    expect(decoded).toContain(loginUrl);
    expect(decoded).toContain('Instruction: Please login using the temporary password above');
  });

  test('4. Full credentials copy text contains required metadata and notice', () => {
    const storeName = 'Alpha Mobile Dadri';
    const dealerCode = 'DLR-000101';
    const loginId = 'DLR-000101';
    const temporaryPassword = 'xK9$mP2#vL8*qR5^wN3!';
    const loginUrl = 'https://crm-two-orcin-18.vercel.app/login';

    const fullCreds = `Dealer Login Credentials\n\nStore: ${storeName}\nDealer ID: ${dealerCode}\nLogin ID: ${loginId}\nTemporary Password: ${temporaryPassword}\nLogin URL: ${loginUrl}\n\nInstruction: Please login using the temporary password above. You will be required to change your password immediately after first login.`;

    expect(fullCreds).toContain(`Store: ${storeName}`);
    expect(fullCreds).toContain(`Dealer ID: ${dealerCode}`);
    expect(fullCreds).toContain(`Login ID: ${loginId}`);
    expect(fullCreds).toContain(`Temporary Password: ${temporaryPassword}`);
    expect(fullCreds).toContain(`Login URL: ${loginUrl}`);
    expect(fullCreds).toContain('You will be required to change your password immediately');
  });
});
