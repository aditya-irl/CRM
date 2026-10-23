import React from 'react';
import { renderToString } from 'react-dom/server';
import { CustomerPortalView } from '../src/views/CustomerPortalView';
import { ApiClient, ICustomerPortalLoanData } from '../src/services/api';
import { launchCashfreeRedirectCheckout, loadCashfreeSDK } from '../src/utils/cashfree';

// Mock storage
const storageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storageStore[key] || null,
  setItem: (key: string, val: string) => { storageStore[key] = val; },
  removeItem: (key: string) => { delete storageStore[key]; },
  clear: () => { Object.keys(storageStore).forEach((k) => delete storageStore[k]); },
};

(global as any).localStorage = mockLocalStorage;
(global as any).sessionStorage = mockLocalStorage;

const mockWindow: any = {
  location: { search: '?token=test_tok' },
  Cashfree: undefined,
};
(global as any).window = mockWindow;

const mockDocument: any = {
  getElementById: jest.fn(() => null),
  createElement: jest.fn((tag: string) => {
    return {
      id: '',
      src: '',
      async: false,
      onload: null as any,
      onerror: null as any,
      addEventListener: jest.fn(),
    };
  }),
  head: {
    appendChild: jest.fn((el: any) => {
      // Simulate successful script load
      mockWindow.Cashfree = jest.fn().mockImplementation(() => ({
        checkout: jest.fn().mockResolvedValue({ error: null }),
      }));
      if (el.onload) {
        el.onload();
      }
    }),
  },
};
(global as any).document = mockDocument;

describe('Customer Portal Cashfree Redirect Checkout Tests', () => {
  const samplePortalData: ICustomerPortalLoanData = {
    customerName: 'Aarav Kumar Patel',
    maskedPhone: 'XXXXXX5678',
    customerPhone: '+919876543210',
    loanAccountNo: 'LN-2026-7842',
    financedAmount: 45000,
    emiAmount: 4500,
    totalInstallments: 12,
    paidInstallments: 2,
    pendingInstallments: 10,
    overdueInstallments: 1,
    nextDueDate: '2026-10-10',
    outstandingBalance: 40500,
    totalPaid: 9000,
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
        penaltyAmount: 250,
        status: 'OVERDUE',
      },
      {
        installmentNumber: 4,
        dueDate: '2026-11-10',
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
    mockWindow.location = { search: '?token=test_tok' };
    mockWindow.Cashfree = undefined;
  });

  describe('1. Portal UI Cashfree Checkout Controls', () => {
    it('renders "Pay Outstanding EMI Online" button and checkout banner', () => {
      const html = renderToString(<CustomerPortalView initialData={samplePortalData} initialToken="test_tok" />);

      // Ensure Pay Online CTA and details are rendered
      expect(html).toContain('Pay Outstanding EMI Online');
      expect(html).toContain('Cashfree Redirect Checkout');
      expect(html).toContain('Pay Now via WhatsApp');
    });

    it('renders "Pay Now" action buttons in EMI Schedule table for unpaid installments', () => {
      const html = renderToString(<CustomerPortalView initialData={samplePortalData} initialToken="test_tok" />);

      // Must render Pay Now button for overdue EMI 3 and upcoming EMI 4
      expect(html).toContain('Pay Now');
      // Already paid installments must display Paid
      expect(html).toContain('Paid');
    });

    it('renders Cashfree badge and description', () => {
      const html = renderToString(<CustomerPortalView initialData={samplePortalData} initialToken="test_tok" />);

      expect(html).toContain('Cashfree Payments');
      expect(html).toContain('SECURE CHECKOUT');
    });
  });

  describe('2. Cashfree SDK Dynamic Loader & Redirect Initiation', () => {
    it('loads Cashfree SDK script and returns instance', async () => {
      const cf = await loadCashfreeSDK('sandbox');
      expect(cf).toBeDefined();
    });

    it('invokes Cashfree.checkout with redirect target and paymentSessionId', async () => {
      const mockCheckout = jest.fn().mockResolvedValue({ error: null });
      mockWindow.Cashfree = jest.fn().mockImplementation(() => ({
        checkout: mockCheckout,
      }));

      await launchCashfreeRedirectCheckout({
        paymentSessionId: 'session_test_123',
        environment: 'sandbox',
      });

      expect(mockCheckout).toHaveBeenCalledWith({
        paymentSessionId: 'session_test_123',
        redirectTarget: '_self',
      });
    });
  });

  describe('3. API Client Cashfree Integration Methods', () => {
    it('sends POST /api/v1/portal/payment/orders with portal token query parameter', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          data: {
            orderId: 'CF_CRM_TEST_101',
            paymentSessionId: 'session_abc_999',
            orderAmount: 4750,
            orderCurrency: 'INR',
            installmentNumber: 3,
            dueDate: '2026-10-10',
            loanAccountNo: 'LN-2026-7842',
            environment: 'sandbox',
          },
        }),
      });
      (global as any).fetch = mockFetch;

      const order = await ApiClient.createCustomerPortalPaymentOrder('portal_token_xyz', 3);

      expect(order.orderId).toBe('CF_CRM_TEST_101');
      expect(order.paymentSessionId).toBe('session_abc_999');
      expect(order.orderAmount).toBe(4750);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/portal/payment/orders?token=portal_token_xyz');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ installmentNumber: 3 });
    });

    it('sends GET /api/v1/portal/payment/orders/:orderId/verify with token parameter', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            orderId: 'CF_CRM_TEST_101',
            status: 'PAID',
            orderAmount: 4750,
            installmentNumber: 3,
            cfPaymentId: 'cf_pay_998877',
            receiptNumber: 'RCP-202610-001',
            paidAt: '2026-10-10T14:00:00.000Z',
            message: 'Payment verified successfully and recorded in loan ledger.',
          },
        }),
      });
      (global as any).fetch = mockFetch;

      const result = await ApiClient.verifyCustomerPortalPaymentOrder(
        'portal_token_xyz',
        'CF_CRM_TEST_101'
      );

      expect(result.status).toBe('PAID');
      expect(result.receiptNumber).toBe('RCP-202610-001');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/portal/payment/orders/CF_CRM_TEST_101/verify?token=portal_token_xyz');
    });
  });
});
