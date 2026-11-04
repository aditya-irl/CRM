import React from 'react';
import { renderToString } from 'react-dom/server';
import { DealerDashboardView } from '../src/views/DealerDashboardView';
import { CustomersView } from '../src/views/CustomersView';
import { LoansView } from '../src/views/LoansView';
import { DevicesView } from '../src/views/DevicesView';
import { DealerPayablesView } from '../src/views/DealerPayablesView';
import { DealerSettlementsView } from '../src/views/DealerSettlementsView';
import {
  DealerMobileCustomerCard,
  DealerMobileLoanCard,
  DealerMobileDeviceCard,
  MobileBottomNav,
  MobileMoreSheet,
} from '../src/components/mobile';
import { AddCustomerWizard } from '../src/components/AddCustomerWizard';
import { ApiClient } from '../src/services/api';
import { UserRole, IUser, ICustomer, ILoan, IDeviceItem } from '@crm/shared';

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

describe('Dealer Mobile Experience Tests (Phase 3)', () => {
  const dealerUser: IUser = {
    id: 'user-dealer-42',
    email: 'alpha.mobiles@store.com',
    phone: '9876501234',
    fullName: 'Rajesh Sharma',
    role: UserRole.DEALER,
    dealerId: 'dealer-alpha-01',
    assignedBranch: 'Dadri Main Market',
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
    ApiClient.setAuth(dealerUser, 'mock-dealer-token-abc');
  });

  // =========================================================================
  // 1. DEALER MOBILE NAVIGATION & SHELL INTEGRATION
  // =========================================================================
  describe('1. Dealer Mobile Navigation & Role-Based Shell', () => {
    test('Dealer bottom navigation renders authorized tabs: Home, Customers, Loans, Inventory, More, Logout', () => {
      const html = renderToString(
        <MobileBottomNav
          activeTab="dashboard"
          onSelectTab={() => {}}
          user={dealerUser}
          onOpenMore={() => {}}
        />
      );

      expect(html).toContain('Home');
      expect(html).toContain('Customers');
      expect(html).toContain('Loans');
      expect(html).toContain('Inventory');
      expect(html).toContain('More');
      expect(html).toContain('Logout');

      expect(html).toContain('mobile-nav-tab-dashboard');
      expect(html).toContain('mobile-nav-tab-customers');
      expect(html).toContain('mobile-nav-tab-loans');
      expect(html).toContain('mobile-nav-tab-devices');
      expect(html).toContain('mobile-nav-tab-more');
      expect(html).toContain('mobile-nav-tab-logout');
    });

    test('Dealer More Sheet exposes store features and hides unauthorized administrative menus', () => {
      const html = renderToString(
        <MobileMoreSheet
          isOpen={true}
          onClose={() => {}}
          onSelectTab={() => {}}
          user={dealerUser}
          onLogout={() => {}}
          activeTab="dashboard"
        />
      );

      // Authorized dealer features
      expect(html).toContain('Store Settlements');
      expect(html).toContain('Company Payments');
      expect(html).toContain('Store Collections Ledger');
      expect(html).toContain('WhatsApp Partner Support');
      expect(html).toContain('Store Partner Profile');
      expect(html).toContain('Sign Out of Account');

      // Unauthorized features must be hidden
      expect(html).not.toContain('Audit Trail &amp; Logs');
      expect(html).not.toContain('Field Recovery Agents');
      expect(html).not.toContain('Field Officer Profile');
    });
  });

  // =========================================================================
  // 2. DEALER MOBILE DASHBOARD VIEW
  // =========================================================================
  describe('2. Dealer Mobile Dashboard View', () => {
    test('renders mobile store header with store details and refresh button', () => {
      const html = renderToString(<DealerDashboardView onNavigateToTab={() => {}} />);

      expect(html).toContain('dealer-mobile-header');
      expect(html).toContain('dealer-mobile-refresh-btn');
      expect(html).toContain('Retail Partner Store');
    });

    test('renders all 6 dealer mobile performance KPI cards', () => {
      const html = renderToString(<DealerDashboardView onNavigateToTab={() => {}} />);

      expect(html).toContain('kpi-dealer-today-disbursed');
      expect(html).toContain('kpi-dealer-customers');
      expect(html).toContain('kpi-dealer-financed-portfolio');
      expect(html).toContain('kpi-dealer-collections');
      expect(html).toContain('kpi-dealer-pending-remittance');
      expect(html).toContain('kpi-dealer-pending-loans');
    });

    test('renders 4 mobile quick action buttons with >= 48px touch target support', () => {
      const html = renderToString(<DealerDashboardView onNavigateToTab={() => {}} />);

      expect(html).toContain('dealer-quick-add-cust-btn');
      expect(html).toContain('dealer-quick-create-loan-btn');
      expect(html).toContain('dealer-quick-inventory-btn');
      expect(html).toContain('dealer-quick-record-emi-btn');
      expect(html).toContain('dealer-touch-btn-48');
    });

    test('maintains dual-view architecture: both dealer-mobile-view and dealer-desktop-view exist', () => {
      const html = renderToString(<DealerDashboardView onNavigateToTab={() => {}} />);

      expect(html).toContain('dealer-mobile-view');
      expect(html).toContain('dealer-desktop-view');
    });
  });

  // =========================================================================
  // 3. DEALER MOBILE CUSTOMER CARD & CUSTOMERS VIEW
  // =========================================================================
  describe('3. Dealer Mobile Customer Card & Customers View', () => {
    const mockCustomer: ICustomer = {
      id: 'cust-101',
      fullName: 'Sunil Kumar',
      customerCode: 'CUST-SK-01',
      primaryPhone: '9876543210',
      alternatePhone: '9812345678',
      addressLine1: 'Shop 5, Alpha 1 Commercial Belt',
      city: 'Greater Noida',
      state: 'Uttar Pradesh',
      pincode: '201308',
      areaRoute: 'Alpha 1 Market',
      activeLoansCount: 1,
      totalOutstanding: 14500,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    test('renders customer card with name, code, phone, route, outstanding and 48px actions', () => {
      const html = renderToString(
        <DealerMobileCustomerCard
          customer={mockCustomer}
          onViewProfile={() => {}}
          onWhatsApp={() => {}}
        />
      );

      expect(html).toContain('Sunil Kumar');
      expect(html).toContain('CUST-SK-01');
      expect(html).toContain('9876543210');
      expect(html).toContain('Alpha 1 Market');
      expect(html).toContain('KYC Verified');
      expect(html).toContain('dealer-customer-call-btn');
      expect(html).toContain('dealer-customer-whatsapp-btn');
      expect(html).toContain('dealer-customer-profile-btn');
      expect(html).toContain('tel:9876543210');
      expect(html).toContain('dealer-touch-btn-48');
    });

    test('CustomersView maintains dual-view with desktop-only-table-view and mobile-only-card-view', () => {
      const html = renderToString(<CustomersView />);

      expect(html).toContain('desktop-only-table-view');
      expect(html).toContain('mobile-only-card-view');
    });
  });

  // =========================================================================
  // 4. DEALER CUSTOMER ONBOARDING WIZARD
  // =========================================================================
  describe('4. Dealer Customer Onboarding Wizard (AddCustomerWizard)', () => {
    test('renders 5-step wizard with mobile touch targets and numeric/tel input modes', () => {
      const html = renderToString(
        <AddCustomerWizard
          isOpen={true}
          onClose={() => {}}
          onSuccess={() => {}}
        />
      );

      // Verify wizard header and step progress bar
      expect(html).toContain('New Borrower &amp; Financed Product Onboarding');
      expect(html).toContain('Customer Info');
      expect(html).toContain('KYC Vault');
      expect(html).toContain('Financed Item');
      expect(html).toContain('EMI Terms');
      expect(html).toContain('Review &amp; Book');

      // Verify mobile inputMode attributes for software keyboard adaptation
      expect(html).toContain('inputMode="tel"');
      expect(html).toContain('inputMode="numeric"');

      // Verify sticky footer actions with touch targets
      expect(html).toContain('wizard-sticky-footer');
      expect(html).toContain('dealer-touch-btn-48');
      expect(html).toContain('Continue to Step');
    });
  });

  // =========================================================================
  // 5. DEALER MOBILE LOAN CARD & LOANS VIEW
  // =========================================================================
  describe('5. Dealer Mobile Loan Card & Loans View', () => {
    const mockLoan: ILoan = {
      id: 'loan-101',
      loanAccountNo: 'LN-2026-9001',
      customerId: 'cust-101',
      customerName: 'Sunil Kumar',
      customerCode: 'CUST-SK-01',
      principalAmount: 25000,
      downPayment: 5000,
      emiAmount: 3750,
      totalPayable: 30000,
      totalPaid: 11250,
      outstandingBalance: 18750,
      tenureMonths: 8,
      status: 'ACTIVE' as any,
      firstEmiDate: '2026-06-01',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    test('renders loan card with financial breakdown, status pill, and actions', () => {
      const html = renderToString(
        <DealerMobileLoanCard
          loan={mockLoan}
          onViewDetails={() => {}}
          onRecordPayment={() => {}}
        />
      );

      expect(html).toContain('LN-2026-9001');
      expect(html).toContain('Sunil Kumar');
      expect(html).toContain('ACTIVE');
      expect(html).toContain('dealer-loan-details-btn');
      expect(html).toContain('dealer-loan-record-emi-btn');
      expect(html).toContain('dealer-touch-btn-48');
    });

    test('LoansView maintains dual-view with desktop-only-table-view and mobile-only-card-view', () => {
      const html = renderToString(<LoansView />);

      expect(html).toContain('desktop-only-table-view');
      expect(html).toContain('mobile-only-card-view');
    });
  });

  // =========================================================================
  // 6. DEALER MOBILE DEVICE CARD & DEVICES VIEW
  // =========================================================================
  describe('6. Dealer Mobile Device Card & Devices View', () => {
    const mockDevice: IDeviceItem = {
      id: 'device-101',
      loanId: 'loan-101',
      loanAccountNo: 'LN-2026-9001',
      customerId: 'cust-101',
      customerName: 'Sunil Kumar',
      customerCode: 'CUST-SK-01',
      primaryPhone: '9876543210',
      deviceName: 'Samsung Galaxy A55 5G',
      deviceBrand: 'Samsung',
      deviceModel: 'Galaxy A55 5G',
      imei1: '867530051234421',
      imei2: '867530051234422',
      retailPrice: 32000,
      financedAmount: 25000,
      emiAmount: 3750,
      financingSource: 'DEALER',
      dealerStoreName: 'Alpha Mobile Gallery',
      dealerCode: 'DLR-ALPHA-01',
      loanStatus: 'ACTIVE',
      deviceStatus: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    test('renders device card with masked IMEI for shoulder-surfing protection', () => {
      const html = renderToString(
        <DealerMobileDeviceCard
          device={mockDevice}
          onViewDetails={() => {}}
        />
      );

      expect(html).toContain('Samsung Galaxy A55 5G');
      expect(html).toContain('Sunil Kumar');
      expect(html).toContain('LN-2026-9001');

      // Shoulder-surfing protection: IMEI must be masked
      expect(html).toContain('867530******4421');
      expect(html).not.toContain('867530051234421');

      expect(html).toContain('dealer-device-details-btn');
      expect(html).toContain('dealer-touch-btn-48');
    });

    test('DevicesView maintains dual-view with desktop-only-table-view and mobile-only-card-view', () => {
      const html = renderToString(<DevicesView />);

      expect(html).toContain('desktop-only-table-view');
      expect(html).toContain('mobile-only-card-view');
    });
  });

  // =========================================================================
  // 7. DEALER PAYABLES & SETTLEMENTS DUAL-VIEWS
  // =========================================================================
  describe('7. Dealer Payables & Settlements Views', () => {
    test('DealerPayablesView renders dual-view with desktop tables and mobile card containers', () => {
      const html = renderToString(<DealerPayablesView />);

      expect(html).toContain('desktop-only-table-view');
      expect(html).toContain('mobile-only-card-view');
    });

    test('DealerSettlementsView renders dual-view with desktop tables and mobile card containers', () => {
      const html = renderToString(<DealerSettlementsView />);

      expect(html).toContain('desktop-only-table-view');
      expect(html).toContain('mobile-only-card-view');
    });
  });

  // =========================================================================
  // 8. DESKTOP PRESERVATION ABOVE 768px
  // =========================================================================
  describe('8. Desktop Preservation Above 768px', () => {
    test('All desktop table markup and headers remain intact in DOM', () => {
      const dashboardHtml = renderToString(<DealerDashboardView onNavigateToTab={() => {}} />);
      const customersHtml = renderToString(<CustomersView />);
      const loansHtml = renderToString(<LoansView />);
      const devicesHtml = renderToString(<DevicesView />);

      // Verify desktop markup exists in all views
      expect(dashboardHtml).toContain('dealer-desktop-view');
      expect(dashboardHtml).toContain('Store Partner Dashboard');

      expect(customersHtml).toContain('desktop-only-table-view');
      expect(customersHtml).toContain('crm-table');

      expect(loansHtml).toContain('desktop-only-table-view');
      expect(loansHtml).toContain('crm-table');

      expect(devicesHtml).toContain('desktop-only-table-view');
      expect(devicesHtml).toContain('crm-table');
    });
  });
});
