import React from 'react';
import { renderToString } from 'react-dom/server';
import { Sidebar } from '../src/components/Sidebar';
import { DealerPayablesView } from '../src/views/DealerPayablesView';
import { DealerCollectionsView } from '../src/views/DealerCollectionsView';
import { ApiClient } from '../src/services/api';
import { UserRole, IUser } from '@crm/shared';

// Mock storage
const storage: Record<string, string> = {};
const mockStorage = {
  getItem: (key: string) => storage[key] || null,
  setItem: (key: string, val: string) => {
    storage[key] = val;
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  },
};

(global as any).localStorage = mockStorage;
(global as any).sessionStorage = mockStorage;

describe('Company Payables / Company Payments & Navigation Separation Tests', () => {
  const adminUser: IUser = {
    id: 'admin-001',
    email: 'admin@financecrm.com',
    phone: '9876543210',
    fullName: 'Finance Admin',
    role: UserRole.SUPER_ADMIN,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const dealerUser: IUser = {
    id: 'dealer-user-001',
    email: 'dealer@store.com',
    phone: '9123456789',
    fullName: 'Metro Electronics Partner',
    role: UserRole.DEALER,
    status: 'ACTIVE' as any,
    dealerId: 'dealer-uuid-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  describe('1. Sidebar Terminology Separation', () => {
    test('Admin sidebar displays "Company Payables"', () => {
      const html = renderToString(
        <Sidebar activeTab="dealer-payables" onSelectTab={() => {}} user={adminUser} />
      );

      expect(html).toContain('Company Payables');
      expect(html).not.toContain('Store Payables &amp; Payouts');
      expect(html).not.toContain('Company Payments');
    });

    test('Dealer sidebar displays "Company Payments" and does not display "Company Payables"', () => {
      const html = renderToString(
        <Sidebar activeTab="dealer-payables" onSelectTab={() => {}} user={dealerUser} />
      );

      expect(html).toContain('Company Payments');
      expect(html).not.toContain('Company Payables');
      expect(html).not.toContain('Store Payables &amp; Payouts');
    });
  });

  describe('2. DealerPayablesView Header & Role-Specific Labels', () => {
    test('Admin view renders "Company Payables" and admin-facing labels', () => {
      ApiClient.setAuth(adminUser, 'admin-token');

      const html = renderToString(
        <DealerPayablesView onNavigateToDealers={() => {}} />
      );

      // Header
      expect(html).toContain('Company Payables');
      expect(html).toContain('Company to Dealer Payouts');
      expect(html).toContain('Manage payments owed by the company to partner dealers for financed products.');

      // KPI card titles
      expect(html).toContain('Total Payable to Dealers');
      expect(html).toContain('Total Paid to Dealers');
      expect(html).toContain('Remaining Payable');
      expect(html).toContain('Eligible Financed Phones');

      // Tabs
      expect(html).toContain('Dealer-wise Payables Summary');
      expect(html).toContain('Payout History');

      // Admin controls present
      expect(html).toContain('Manage Partner Stores');
      expect(html).toContain('Record Company Payout');

      // Old confusing wording must NOT exist
      expect(html).not.toContain('WE NEED TO PAY');
      expect(html).not.toContain('ALREADY PAID');
      expect(html).not.toContain('STILL LEFT TO PAY');
      expect(html).not.toContain('Store Payables &amp; Payouts');
    });

    test('Dealer view renders "Company Payments" and clear dealer-facing payee terminology', () => {
      ApiClient.setAuth(dealerUser, 'dealer-token');

      const html = renderToString(
        <DealerPayablesView initialDealerId="dealer-uuid-123" />
      );

      // Header
      expect(html).toContain('Company Payments');
      expect(html).toContain('Disbursements from Finance Company');
      expect(html).toContain('Track payments received from the finance company for your eligible financed products.');

      // KPI card titles
      expect(html).toContain('Amount Payable to Your Store');
      expect(html).toContain('Amount Received from Company');
      expect(html).toContain('Remaining Amount Due from Company');
      expect(html).toContain('Eligible Financed Phones');

      // Tabs
      expect(html).toContain('Store Payout Overview');
      expect(html).toContain('Payout History');

      // Table columns
      expect(html).toContain('Amount Payable to Your Store');
      expect(html).toContain('Amount Received from Company');
      expect(html).toContain('Remaining Amount Due from Company');

      // Old confusing wording must NOT exist
      expect(html).not.toContain('WE NEED TO PAY');
      expect(html).not.toContain('ALREADY PAID');
      expect(html).not.toContain('STILL LEFT TO PAY');
      expect(html).not.toContain('Store Payables &amp; Payouts');
    });
  });

  describe('3. Dealer Data Isolation & Control Restrictions in DealerPayablesView', () => {
    test('Dealer view does NOT render Admin payout creation or store management buttons', () => {
      ApiClient.setAuth(dealerUser, 'dealer-token');

      const html = renderToString(
        <DealerPayablesView initialDealerId="dealer-uuid-123" />
      );

      // Admin buttons must be hidden for dealers
      expect(html).not.toContain('Manage Partner Stores');
      expect(html).not.toContain('Record Company Payout');
      expect(html).not.toContain('All Retail Stores');
    });
  });

  describe('4. "Manage Partner Store" Navigation Isolation in DealerCollectionsView', () => {
    test('DealerCollectionsView hides "Manage Partner Stores" button for Dealer', () => {
      ApiClient.setAuth(dealerUser, 'dealer-token');

      const html = renderToString(
        <DealerCollectionsView
          initialDealerId="dealer-uuid-123"
          onNavigateToDealers={undefined}
          onNavigateToSettlements={() => {}}
        />
      );

      expect(html).not.toContain('Manage Partner Stores');
      expect(html).toContain('Dealer Collections Ledger');
    });

    test('DealerCollectionsView displays "Manage Partner Stores" button for Admin when handler provided', () => {
      ApiClient.setAuth(adminUser, 'admin-token');
      const mockNav = jest.fn();

      const html = renderToString(
        <DealerCollectionsView
          onNavigateToDealers={mockNav}
          onNavigateToSettlements={() => {}}
        />
      );

      expect(html).toContain('Manage Partner Stores');
    });
  });

  describe('5. Financial Separation Safeguards', () => {
    test('Financial calculation text preserves Net Payable = Financed Principal - Down Payment', () => {
      ApiClient.setAuth(dealerUser, 'dealer-token');

      const html = renderToString(
        <DealerPayablesView initialDealerId="dealer-uuid-123" />
      );

      expect(html).toContain(
        'Calculated strictly from eligible disbursed loans (product price minus down payment collected).'
      );
    });
  });
});
