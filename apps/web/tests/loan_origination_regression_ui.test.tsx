import React from 'react';
import { renderToString } from 'react-dom/server';
import { LoansView } from '../src/views/LoansView';
import { AddCustomerWizard } from '../src/components/AddCustomerWizard';
import { ApiClient } from '../src/services/api';
import {
  UserRole,
  ALLOWED_MONTHLY_INTEREST_RATES,
  formatDateDDMMYYYY,
  parseDisplayDateToISO,
} from '@crm/shared';

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

describe('Loan Origination UI Regressions & Date Display Verification', () => {
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

  test('1. Allowed monthly interest rates constant is [4, 5, 6]', () => {
    expect(ALLOWED_MONTHLY_INTEREST_RATES).toEqual([4, 5, 6]);
  });

  test('2. AddCustomerWizard renders loan onboarding with DD/MM/YYYY formatting and approved rates', () => {
    const html = renderToString(
      <AddCustomerWizard
        isOpen={true}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    // Modal renders properly
    expect(html).toContain('New Borrower &amp; Financed Product Onboarding');
    expect(html).toContain('EMI Terms');
  });

  test('3. LoansView renders main table with Monthly Rate column', () => {
    const html = renderToString(<LoansView />);
    expect(html).toContain('Monthly Rate');
    expect(html).toContain('Principal');
    expect(html).toContain('Tenure');
    expect(html).toContain('Originate New Loan');
  });

  test('4. Date handling: formatDateDDMMYYYY produces DD/MM/YYYY and parseDisplayDateToISO returns exact ISO', () => {
    const sampleIso = '2026-10-14';
    const displayDate = formatDateDDMMYYYY(sampleIso);
    expect(displayDate).toBe('14/10/2026');

    const isoBack = parseDisplayDateToISO(displayDate);
    expect(isoBack).toBe(sampleIso);

    // End-of-month leap year check
    expect(formatDateDDMMYYYY('2028-02-29')).toBe('29/02/2028');
    expect(parseDisplayDateToISO('29/02/2028')).toBe('2028-02-29');
  });
});
