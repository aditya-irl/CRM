import React from 'react';
import { renderToString } from 'react-dom/server';
import { Sidebar } from '../src/components/Sidebar';
import { DealerPayablesView } from '../src/views/DealerPayablesView';
import { DealerCollectionsView } from '../src/views/DealerCollectionsView';
import { DealerSettlementsView } from '../src/views/DealerSettlementsView';
import { DealersView } from '../src/views/DealersView';
import { DashboardView } from '../src/views/DashboardView';
import { DealerDashboardView } from '../src/views/DealerDashboardView';
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

  describe('6. Store-level and Dashboard Navigation Wiring for Payables', () => {
    test('Sidebar renders Company Payables for Admin and Company Payments for Dealer', () => {
      const htmlAdmin = renderToString(
        <Sidebar activeTab="dashboard" onSelectTab={() => {}} user={adminUser} />
      );
      expect(htmlAdmin).toContain('Company Payables');

      const htmlDealer = renderToString(
        <Sidebar activeTab="dashboard" onSelectTab={() => {}} user={dealerUser} />
      );
      expect(htmlDealer).toContain('Company Payments');
    });

    test('DealersView accepts onNavigateToPayables handler and renders network header', () => {
      ApiClient.setAuth(adminUser, 'admin-token');
      const mockPayables = jest.fn();

      const html = renderToString(
        <DealersView
          onNavigateToCollections={() => {}}
          onNavigateToSettlements={() => {}}
          onNavigateToPayables={mockPayables}
        />
      );

      expect(html).toContain('Dealer &amp; Retail Store Network');
      expect(html).toContain('Total Partner Stores');
    });

    test('DashboardView renders Company Payables button in Dealer Reconciliation section', () => {
      ApiClient.setAuth(adminUser, 'admin-token');
      const mockNav = jest.fn();
      const mockStats: any = {
        period: {
          startDate: '2026-10-01',
          endDate: '2026-10-31',
          preset: 'this-month',
        },
        topKpis: {
          totalDisbursed: 100000,
          disbursedLoanCount: 10,
          activePortfolio: 80000,
          activeLoanCount: 8,
          totalCollections: 50000,
          collectionCount: 20,
          totalOverdueAmount: 5000,
          overdueLoanCount: 2,
          overdueCustomerCount: 2,
          collectionEfficiencyPercent: 95,
          totalDueAmount: 52000,
        },
        sourceBreakdown: {
          directCustomer: { amount: 20000, count: 8, sharePercent: 40 },
          dealer: { amount: 25000, count: 10, sharePercent: 50 },
          recoveryAgent: { amount: 5000, count: 2, sharePercent: 10 },
        },
        trends: {
          collections: [],
          disbursements: [],
        },
        portfolioSummary: {
          totalOutstandingPrincipal: 70000,
          totalOutstandingInterest: 10000,
          totalOverdue: 5000,
          activeLoans: 8,
          closedLoans: 2,
          overdueLoans: 2,
          totalCustomers: 10,
        },
        agingBuckets: {
          current: { count: 6, amount: 60000 },
          dpd1To30: { count: 1, amount: 2500 },
          dpd31To60: { count: 1, amount: 2500 },
          dpd61To90: { count: 0, amount: 0 },
          dpd90Plus: { count: 0, amount: 0 },
        },
        dealerReconciliation: {
          totalCollectedThroughDealers: 25000,
          totalDealerSettled: 20000,
          outstandingDealerRemittance: 5000,
          unsettledDealersCount: 1,
          dealers: [],
        },
        recoveryAgentSummary: {
          totalAgentCollections: 5000,
          paymentCount: 2,
          todayCollections: 0,
          monthCollections: 5000,
          agents: [],
        },
        directCustomerSummary: {
          totalDirectCollections: 20000,
          paymentCount: 8,
          todayCollections: 0,
          monthCollections: 20000,
          averagePayment: 2500,
        },
        overdueSummary: {
          totalOverdueAmount: 5000,
          overdueLoanCount: 2,
          overdueCustomerCount: 2,
          averageOverdueAmount: 2500,
          recoveryQueue: {
            totalAccounts: 2,
            dpd1To30: 1,
            dpd31To60: 1,
            dpd61To90: 0,
            dpd90Plus: 0,
            assignedCount: 1,
            unassignedCount: 1,
          },
        },
        operationalMetrics: {
          averageLoanAmount: 10000,
          averageEmiAmount: 2500,
          averagePaymentAmount: 2500,
          activeCustomersCount: 10,
          activeDealersCount: 2,
          activeAgentsCount: 1,
        },
        recentCollections: [],
        recentSettlements: [],
        executiveMetrics: {
          averageLoanTicket: 10000,
          defaultRatePercent: 0,
          netCashFlow: 50000,
        },
      };

      const html = renderToString(
        <DashboardView onNavigateToTab={mockNav} user={adminUser} initialStats={mockStats} />
      );

      expect(html).toContain('Company Payables');
      expect(html).toContain('Settlements View');
    });

    test('DealerDashboardView renders Company Payments quick action for Store Partner', () => {
      ApiClient.setAuth(dealerUser, 'dealer-token');
      const mockNav = jest.fn();

      const html = renderToString(
        <DealerDashboardView onNavigateToTab={mockNav} />
      );

      expect(html).toContain('Company Payments');
    });
  });

  describe('7. Dealer Settlement UI Layout & Statuses', () => {
    test('DealerSettlementsView renders professional finance KPI cards and structured tables', () => {
      ApiClient.setAuth(adminUser, 'admin-token');

      const html = renderToString(
        <DealerSettlementsView
          onNavigateToDealers={() => {}}
          onNavigateToCollections={() => {}}
        />
      );

      // Verify title & badges
      expect(html).toContain('EMI Collections &amp; Settlement');
      expect(html).toContain('Dealer Cash Remittance Ledger');

      // Verify 5 finance KPI cards in simple English
      expect(html).toContain('Waiting For Approval');
      expect(html).toContain('Approved Collections');
      expect(html).toContain('Money Collected By Dealer');
      expect(html).toContain('Money Still To Be Submitted');
      expect(html).toContain('Money Already Submitted');

      // Verify ledger tabs
      expect(html).toContain('EMI Collections Ledger');
      expect(html).toContain('Remittance Batches &amp; Reconciliation');

      // Verify action buttons
      expect(html).toContain('Record Settlement');
      expect(html).toContain('Customer Collection Ledger');
    });
  });
});
