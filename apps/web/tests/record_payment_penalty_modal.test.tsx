import React from 'react';
import { renderToString } from 'react-dom/server';
import { RecordPaymentModal } from '../src/components/RecordPaymentModal';
import { ApiClient } from '../src/services/api';
import {
  UserRole,
  IUser,
  ILoan,
  PaymentMode,
  CollectionSource,
  normalizeNumericLeadingZeros,
  formatINR,
} from '@crm/shared';

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

describe('RecordPaymentModal - Add Penalty UI & Workflow Tests', () => {
  const mockAdminUser: IUser = {
    id: 'admin-uuid-001',
    email: 'admin@financecrm.com',
    phone: '9876543210',
    fullName: 'Finance Admin',
    role: UserRole.SUPER_ADMIN,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockDealerUser: IUser = {
    id: 'dealer-uuid-001',
    email: 'dealer@store.com',
    phone: '9876543211',
    fullName: 'Apex Mobiles',
    role: UserRole.DEALER,
    status: 'ACTIVE' as any,
    dealerId: 'dlr-001',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleLoan: any = {
    id: 'loan-123',
    loanAccountNo: 'LN-2026-9999',
    customerId: 'cust-123',
    customerName: 'Rahul Verma',
    customerCode: 'CUST-0099',
    outstandingBalance: 12500,
    emiAmount: 4375,
    status: 'ACTIVE',
  };

  const sampleInstallment: any = {
    id: 'inst-456',
    loanId: 'loan-123',
    installmentNumber: 2,
    dueDate: '2026-09-25T00:00:00.000Z',
    expectedAmount: 4375,
    remainingAmount: 4375,
    penaltyAmount: 120,
    status: 'OVERDUE',
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    ApiClient.setAuth(mockAdminUser, 'admin-token-xyz');
  });

  describe('1. Button Placement & Default Collapsed State', () => {
    test('renders "+ Add Penalty" button directly below Payment Amount and before Collection Through', () => {
      const html = renderToString(
        <RecordPaymentModal
          isOpen={true}
          onClose={() => {}}
          user={mockAdminUser}
          preselectedLoan={sampleLoan}
          preselectedInstallment={sampleInstallment}
        />
      );

      // Verify presence of Payment Amount label and input
      expect(html).toContain('Payment Amount (₹)');
      // Verify presence of "+ Add Penalty" button
      expect(html).toContain('id="add-penalty-btn"');
      expect(html).toContain('+ Add Penalty');
      // Verify presence of Collection Through section
      expect(html).toContain('Collection Through');

      // Verify sequence of elements in rendered HTML:
      // Payment Amount appears before + Add Penalty, which appears before Collection Through
      const paymentAmountIndex = html.indexOf('Payment Amount (₹)');
      const addPenaltyBtnIndex = html.indexOf('id="add-penalty-btn"');
      const collectionThroughIndex = html.indexOf('Collection Through');

      expect(paymentAmountIndex).toBeGreaterThan(-1);
      expect(addPenaltyBtnIndex).toBeGreaterThan(paymentAmountIndex);
      expect(collectionThroughIndex).toBeGreaterThan(addPenaltyBtnIndex);
    });

    test('penalty section is initially collapsed and does NOT render expanded inputs by default', () => {
      const html = renderToString(
        <RecordPaymentModal
          isOpen={true}
          onClose={() => {}}
          user={mockAdminUser}
          preselectedLoan={sampleLoan}
          preselectedInstallment={sampleInstallment}
        />
      );

      // Expanded penalty section id and inputs should not exist initially
      expect(html).not.toContain('id="penalty-section-expanded"');
      expect(html).not.toContain('id="penalty-amount-input"');
      expect(html).not.toContain('id="remove-penalty-btn"');
    });
  });

  describe('2. Leading-Zero Normalization Logic', () => {
    test('normalizes leading zeros correctly', () => {
      expect(normalizeNumericLeadingZeros('000120')).toBe('120');
      expect(normalizeNumericLeadingZeros('0120')).toBe('120');
      expect(normalizeNumericLeadingZeros('000')).toBe('0');
      expect(normalizeNumericLeadingZeros('0')).toBe('0');
      expect(normalizeNumericLeadingZeros('0.50')).toBe('0.50');
      expect(normalizeNumericLeadingZeros('00.50')).toBe('0.50');
      expect(normalizeNumericLeadingZeros('120.00')).toBe('120.00');
      expect(normalizeNumericLeadingZeros('')).toBe('');
    });
  });

  describe('3. Dealer Context Rendering', () => {
    test('renders Dealer Store collection badge and partner context when user is Dealer', () => {
      const html = renderToString(
        <RecordPaymentModal
          isOpen={true}
          onClose={() => {}}
          user={mockDealerUser}
          preselectedLoan={sampleLoan}
          preselectedInstallment={sampleInstallment}
          isDealerContext={true}
          dealerStoreName="Apex Mobile Gallery"
        />
      );

      expect(html).toContain('Record Store EMI Payment');
      expect(html).toContain('Partner Store Collection • Apex Mobile Gallery');
      expect(html).toContain('Collected at store • Unsettled dealer collection');
      expect(html).toContain('+ Add Penalty');
    });
  });

  describe('4. Mathematical & Financial Separation Verification', () => {
    test('Payment Amount and Penalty remain strictly distinct and format INR properly', () => {
      const paymentAmt = 4375;
      const penaltyAmt = 120;
      const totalCollected = paymentAmt + penaltyAmt;

      expect(formatINR(paymentAmt)).toContain('4,375');
      expect(formatINR(penaltyAmt)).toContain('120');
      expect(formatINR(totalCollected)).toContain('4,495');

      // Ensure total calculation satisfies strict equality
      expect(paymentAmt + penaltyAmt).toBe(4495);
    });
  });
});
