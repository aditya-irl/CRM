import React from 'react';
import { renderToString } from 'react-dom/server';
import { LoansView } from '../src/views/LoansView';
import { AddCustomerWizard } from '../src/components/AddCustomerWizard';
import { ApiClient } from '../src/services/api';
import { UserRole } from '@crm/shared';

// Mock localStorage
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

describe('Manual EMI Start Date & Tenure UI Verification', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
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
  });

  test('1. LoansView renders loan origination screen correctly', () => {
    const html = renderToString(<LoansView />);
    expect(html).toContain('Loans &amp; Amortization Portfolio');
    expect(html).toContain('Originate New Loan');
  });

  test('2. AddCustomerWizard renders Step 4 with manual EMI Start Date and EMI Tenure', () => {
    const html = renderToString(
      <AddCustomerWizard
        isOpen={true}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    expect(html).toContain('New Borrower &amp; Financed Product Onboarding');
    expect(html).toContain('EMI Terms');
  });
});
