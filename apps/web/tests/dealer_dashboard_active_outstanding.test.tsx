import React from 'react';
import { renderToString } from 'react-dom/server';
import { DealerDashboardView } from '../src/views/DealerDashboardView';
import { ApiClient } from '../src/services/api';
import { UserRole, IUser, IDealerDashboardMetrics } from '@crm/shared';

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

describe('Dealer Dashboard: Active Outstanding Card Role Visibility Tests', () => {
  const dealerUser: IUser = {
    id: 'user-dealer-01',
    email: 'dealer@store.com',
    phone: '9876543210',
    fullName: 'Store Partner Rahul',
    role: UserRole.DEALER,
    status: 'ACTIVE' as any,
    dealerId: 'dlr-store-01',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const adminUser: IUser = {
    id: 'user-admin-01',
    email: 'admin@financecrm.com',
    phone: '9876543211',
    fullName: 'System Admin',
    role: UserRole.ADMIN,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const branchManagerUser: IUser = {
    id: 'user-bm-01',
    email: 'bm@financecrm.com',
    phone: '9876543212',
    fullName: 'Branch Manager Priya',
    role: UserRole.BRANCH_MANAGER,
    status: 'ACTIVE' as any,
    assignedBranch: 'North Zone',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const baseDealerMetrics: IDealerDashboardMetrics = {
    dealer: {
      id: 'dlr-store-01',
      dealerCode: 'DLR-NORTH-01',
      storeName: 'Galaxy Retail Store',
      ownerName: 'Rahul Verma',
      phone: '9876543210',
      email: 'dealer@store.com',
      address: 'Shop 10 Main Market',
      areaCity: 'North Zone',
      status: 'ACTIVE' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    metrics: {
      totalCustomers: 45,
      activeLoans: 30,
      approvedLoans: 5,
      pendingLoans: 2,
      closedLoans: 10,
      totalFinancedAmount: 750000,
      totalCollectedAmount: 180000,
      unsettledCollectionAmount: 25000,
      totalSettledAmount: 155000,
    },
    recentLoans: [
      {
        id: 'loan-001',
        loanAccountNo: 'LA-2026-1001',
        customerName: 'Suresh Raina',
        customerCode: 'CUST-1001',
        primaryPhone: '9811122233',
        principalAmount: 25000,
        emiAmount: 4180,
        outstandingBalance: 20900,
        status: 'ACTIVE',
        disbursementDate: '2026-09-01',
      },
    ],
    recentCollections: [],
    recentSettlements: [],
  };

  const managementDealerMetrics: IDealerDashboardMetrics = {
    ...baseDealerMetrics,
    metrics: {
      ...baseDealerMetrics.metrics,
      totalOutstandingBalance: 570000,
    },
  };

  beforeEach(() => {
    mockStorage.clear();
  });

  test('1. Dealer user does NOT see Active Outstanding metric card', () => {
    ApiClient.setAuth(dealerUser, 'dealer-test-token');

    const html = renderToString(
      <DealerDashboardView userRole={UserRole.DEALER} initialData={baseDealerMetrics} />
    );

    // Active Outstanding card must NOT be rendered for Dealer role
    expect(html).not.toContain('Active Outstanding');
    expect(html).not.toContain('Remaining balance on active loans');
    expect(html).not.toContain('active-outstanding-card');

    // Other dealer cards MUST still be rendered
    expect(html).toContain('Store Borrowers');
    expect(html).toContain('Active Financed Phones');
    expect(html).toContain('Financed Portfolio');
    expect(html).toContain('Total Store Collections');
    expect(html).toContain('Pending Remittance');
  });

  test('2. Admin user viewing dealer metrics DOES see Active Outstanding card', () => {
    ApiClient.setAuth(adminUser, 'admin-test-token');

    const html = renderToString(
      <DealerDashboardView userRole={UserRole.ADMIN} initialData={managementDealerMetrics} />
    );

    // Active Outstanding card MUST be rendered for Admin
    expect(html).toContain('Active Outstanding');
    expect(html).toContain('Remaining balance on active loans');
    expect(html).toContain('5,70,000');
  });

  test('3. Branch Manager viewing dealer metrics DOES see Active Outstanding card', () => {
    ApiClient.setAuth(branchManagerUser, 'bm-test-token');

    const html = renderToString(
      <DealerDashboardView userRole={UserRole.BRANCH_MANAGER} initialData={managementDealerMetrics} />
    );

    // Active Outstanding card MUST be rendered for Branch Manager
    expect(html).toContain('Active Outstanding');
    expect(html).toContain('Remaining balance on active loans');
    expect(html).toContain('5,70,000');
  });

  test('4. Dealer user retains individual customer loan actions and operation tabs', () => {
    ApiClient.setAuth(dealerUser, 'dealer-test-token');

    const html = renderToString(
      <DealerDashboardView userRole={UserRole.DEALER} initialData={baseDealerMetrics} />
    );

    // Operational subtabs and record payment buttons remain functional
    expect(html).toContain('Financed Phones');
    expect(html).toContain('Record EMI');
    expect(html).toContain('LA-2026-1001');
    expect(html).toContain('Suresh Raina');
  });

  test('5. When totalOutstandingBalance is omitted/undefined, Active Outstanding card is never rendered', () => {
    ApiClient.setAuth(adminUser, 'admin-test-token');

    // Even if user is Admin, if data has no totalOutstandingBalance, do not render broken card
    const html = renderToString(
      <DealerDashboardView userRole={UserRole.ADMIN} initialData={baseDealerMetrics} />
    );

    expect(html).not.toContain('Active Outstanding');
    expect(html).not.toContain('active-outstanding-card');
  });
});
