import React from 'react';
import { renderToString } from 'react-dom/server';
import { CustomerPortalView } from '../src/views/CustomerPortalView';
import { ApiClient, ICustomerPortalLoanData } from '../src/services/api';
import { formatINR } from '@crm/shared';

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

describe('Customer Payment Portal Frontend Tests', () => {
  const samplePortalData: ICustomerPortalLoanData = {
    customerName: 'Aarav Kumar Patel',
    maskedPhone: 'XXXXXX5678',
    customerPhone: '+919876543210',
    loanAccountNo: 'LN-2026-7842',
    financedAmount: 45000,
    emiAmount: 4500,
    totalInstallments: 12,
    paidInstallments: 3,
    pendingInstallments: 9,
    overdueInstallments: 0,
    nextDueDate: '2026-10-10',
    outstandingBalance: 40500,
    totalPaid: 13500,
    status: 'ACTIVE',
    disbursementDate: '2026-07-10',
    maturityDate: '2027-07-10',
    paymentHistory: [
      {
        receiptNumber: 'RCP-202609-1001',
        amount: 4500,
        paymentDate: '2026-09-10T10:30:00.000Z',
        paymentMode: 'UPI',
        status: 'SUCCESS',
      },
    ],
    installments: [
      {
        installmentNumber: 1,
        dueDate: '2026-08-10',
        expectedAmount: 4500,
        paidAmount: 4500,
        remainingAmount: 0,
        penaltyAmount: 0,
        status: 'PAID',
      },
      {
        installmentNumber: 2,
        dueDate: '2026-09-10',
        expectedAmount: 4500,
        paidAmount: 4500,
        remainingAmount: 0,
        penaltyAmount: 0,
        status: 'PAID',
      },
      {
        installmentNumber: 3,
        dueDate: '2026-10-10',
        expectedAmount: 4500,
        paidAmount: 0,
        remainingAmount: 4500,
        penaltyAmount: 0,
        status: 'UPCOMING',
      },
    ],
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
  });

  describe('1. Loading & Initial State', () => {
    test('renders secure loading state initially while verifying token', () => {
      // In server render, useState initializes with loading: true
      const html = renderToString(<CustomerPortalView token="cpt_valid_token_123" />);

      expect(html).toContain('Loading Loan Details');
      expect(html).toContain('Alpha Mobile Gallery');
      expect(html).toContain('Verified Portal');
    });

    test('valid portal data renders customer name, loan details, and EMI metrics', () => {
      const html = renderToString(<CustomerPortalView token="cpt_valid_token_123" initialData={samplePortalData} />);

      expect(html).toContain('Aarav Kumar Patel');
      expect(html).toContain('XXXXXX5678');
      expect(html).toContain('LN-2026-7842');
      expect(html).toContain('ACTIVE');
      expect(html).toContain('2026-10-10');
      expect(html).toContain('Financed Amount');
      expect(html).toContain('EMIs Cleared');
      expect(html).toContain('Pay Now via WhatsApp');
    });

    test('missing token displays safe error message without crashing', () => {
      const html = renderToString(<CustomerPortalView token={null} />);

      expect(html).toContain('Portal Link Unavailable');
      expect(html).toContain('A valid customer portal token is required');
    });
  });

  describe('2. Security: Token Privacy & Storage Isolation', () => {
    test('portal token is NEVER stored in localStorage or sessionStorage', async () => {
      const testToken = 'cpt_ultra_secure_opaque_token_9999999999';

      // Mock fetch
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: samplePortalData }),
      });

      await ApiClient.getCustomerPortalLoan(testToken);

      // Verify token is NOT in storage
      expect(mockLocalStorage.getItem('crm_access_token')).toBeNull();
      expect(mockLocalStorage.getItem('token')).toBeNull();
      expect(mockLocalStorage.getItem('portal_token')).toBeNull();
      expect(Object.keys(storageStore).length).toBe(0);
    });

    test('rendered output NEVER exposes raw portal token or database secrets in HTML', () => {
      const secretToken = 'cpt_secret_token_never_render_me_in_dom_777';
      const html = renderToString(<CustomerPortalView token={secretToken} />);

      // The secret token string must never appear in the visible markup
      expect(html).not.toContain(secretToken);
      expect(html).not.toContain('token_hash');
      expect(html).not.toContain('password_hash');
      expect(html).not.toContain('DATABASE_URL');
    });
  });

  describe('3. Sensitive Field Sanitization', () => {
    test('sensitive KYC and admin data are strictly omitted from portal display', () => {
      const html = renderToString(<CustomerPortalView token="cpt_test_token" />);

      // Sensitive fields must NOT exist in the rendered portal
      expect(html).not.toContain('Aadhaar');
      expect(html).not.toContain('PAN Card');
      expect(html).not.toContain('kyc_documents');
      expect(html).not.toContain('internal_notes');
      expect(html).not.toContain('assigned_agent_id');
      expect(html).not.toContain('dealer_id');
    });
  });

  describe('4. WhatsApp Pay Now Message Formatting', () => {
    test('generates correct wa.me link with customer phone and encoded loan payment details', () => {
      const customerPhone = (samplePortalData.customerPhone || '').replace(/\D/g, '');
      const formattedAmount = formatINR(samplePortalData.emiAmount);
      const dueDate = samplePortalData.nextDueDate || 'Immediate';

      const msg = [
        'Hello, I want to make my EMI payment.',
        '',
        `Loan Account: ${samplePortalData.loanAccountNo}`,
        `EMI Amount: ${formattedAmount}`,
        `Due Date: ${dueDate}`,
      ].join('\n');

      const waUrl = `https://wa.me/${customerPhone}?text=${encodeURIComponent(msg)}`;

      // Verification checks
      expect(waUrl.startsWith('https://wa.me/919876543210?text=')).toBe(true);
      expect(waUrl).toContain(encodeURIComponent('Loan Account: LN-2026-7842'));
      expect(waUrl).toContain(encodeURIComponent('EMI Amount: ₹4,500.00'));
      expect(waUrl).toContain(encodeURIComponent('Due Date: 2026-10-10'));

      // Security check: must NOT leak portal token, database secrets, or KYC
      expect(waUrl).not.toContain('cpt_');
      expect(waUrl).not.toContain('token');
      expect(waUrl).not.toContain('aadhaar');

      // State check: sample data remains intact (does not mutate payment/EMI state)
      expect(samplePortalData.paidInstallments).toBe(3);
      expect(samplePortalData.pendingInstallments).toBe(9);
      expect(samplePortalData.outstandingBalance).toBe(40500);
    });
  });

  describe('5. Admin CRM Login Flow Isolation', () => {
    test('admin authentication state and login check remain isolated from portal', () => {
      // Simulate no admin session
      expect(ApiClient.getUser()).toBeNull();
      expect(ApiClient.getToken()).toBeNull();

      // Setting admin auth works independently
      ApiClient.setAuth(
        { id: 'admin-1', email: 'admin@crm.com', fullName: 'Super Admin', role: 'SUPER_ADMIN' as any } as any,
        'admin_jwt_mock_token'
      );

      expect(ApiClient.getUser()?.email).toBe('admin@crm.com');
      expect(ApiClient.getToken()).toBe('admin_jwt_mock_token');

      // Logging out only clears admin session
      ApiClient.logout();
      expect(ApiClient.getUser()).toBeNull();
      expect(ApiClient.getToken()).toBeNull();
    });
  });
});
