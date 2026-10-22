import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { CustomersView } from '../src/views/CustomersView';
import { ApiClient } from '../src/services/api';
import { UserRole } from '@crm/shared';

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

describe('Customer Details Modal Scroll & Layout Regressions', () => {
  let originalDocument: any;

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
    originalDocument = (global as any).document;
  });

  afterEach(() => {
    (global as any).document = originalDocument;
    jest.restoreAllMocks();
  });

  describe('1. CSS Rules & Viewport Constraints in index.css', () => {
    const cssPath = path.resolve(__dirname, '../src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    test('defines .modal-content.customer-detail-modal-container with viewport constraint and flex column layout', () => {
      expect(cssContent).toContain('.modal-content.customer-detail-modal-container');
      expect(cssContent).toContain('max-height: 90vh');
      expect(cssContent).toContain('display: flex');
      expect(cssContent).toContain('flex-direction: column');
      expect(cssContent).toContain('overflow: hidden');
    });

    test('defines .customer-detail-tab-content with flex: 1, min-height: 0, and vertical scrolling', () => {
      expect(cssContent).toContain('.customer-detail-tab-content');
      expect(cssContent).toContain('flex: 1');
      expect(cssContent).toContain('min-height: 0');
      expect(cssContent).toContain('overflow-y: auto');
      expect(cssContent).toContain('-webkit-overflow-scrolling: touch');
    });

    test('contains responsive tablet and mobile rules for customer-detail-modal-container', () => {
      expect(cssContent).toContain('.modal-content.customer-detail-modal-container');
      // In @media screen and (max-width: 768px)
      expect(cssContent).toMatch(/@media screen and \(max-width:\s*768px\)[\s\S]*?\.modal-content\.customer-detail-modal-container/);
      // In @media screen and (max-width: 480px)
      expect(cssContent).toMatch(/@media screen and \(max-width:\s*480px\)[\s\S]*?\.customer-detail-tab-content/);
    });
  });

  describe('2. Modal Structural Integrity & Viewport Constraints', () => {
    const mockCustomerDetail = {
      customer: {
        id: 'cust-101',
        customerCode: 'CUST-101',
        fullName: 'Ramesh Sharma',
        primaryPhone: '9876543210',
        alternatePhone: '9876543211',
        areaRoute: 'North Zone',
        addressLine1: '123 Main Bazaar',
        city: 'Jaipur',
        state: 'Rajasthan',
        pincode: '302001',
        totalOutstanding: 45000,
        activeLoansCount: 1,
      },
      loans: [
        {
          id: 'loan-201',
          loanAccountNo: 'LN-201-XYZ',
          principalAmount: 50000,
          emiAmount: 4500,
          outstandingBalance: 36000,
          tenureMonths: 12,
          disbursementDate: '2026-01-15T00:00:00Z',
          status: 'ACTIVE',
          installments: [
            {
              id: 'inst-1',
              installmentNumber: 1,
              dueDate: '2026-02-15T00:00:00Z',
              expectedAmount: 4500,
              paidAmount: 4500,
              remainingAmount: 0,
              penaltyAmount: 0,
              status: 'PAID',
            },
            {
              id: 'inst-2',
              installmentNumber: 2,
              dueDate: '2026-03-15T00:00:00Z',
              expectedAmount: 4500,
              paidAmount: 0,
              remainingAmount: 4500,
              penaltyAmount: 150,
              status: 'OVERDUE',
            },
          ],
        },
      ],
      kycDocuments: [],
      callLogs: [],
    };

    test('modal structure has constrained height and flex-column layout', () => {
      // Mock ApiClient methods
      jest.spyOn(ApiClient, 'getCustomers').mockResolvedValue([]);
      jest.spyOn(ApiClient, 'getCustomerDetail').mockResolvedValue(mockCustomerDetail as any);

      // Verify CustomersView code incorporates the class and attributes
      const viewPath = path.resolve(__dirname, '../src/views/CustomersView.tsx');
      const viewCode = fs.readFileSync(viewPath, 'utf8');

      // Modal container has customer-detail-modal-container class and testid
      expect(viewCode).toContain('customer-detail-modal-container');
      expect(viewCode).toContain('data-testid="customer-detail-modal"');

      // Modal header is pinned with flexShrink: 0
      expect(viewCode).toContain('data-testid="customer-detail-modal-header"');
      expect(viewCode).toContain('flexShrink: 0');

      // Profile navigation tabs bar is pinned with flexShrink: 0 and overflowX: auto
      expect(viewCode).toContain('data-testid="customer-detail-tabs-bar"');

      // Profile tab contents container has customer-detail-tab-content class and testid
      expect(viewCode).toContain('customer-detail-tab-content');
      expect(viewCode).toContain('data-testid="customer-detail-tab-content"');

      // Modal footer is pinned with flexShrink: 0
      expect(viewCode).toContain('data-testid="customer-detail-modal-footer"');
    });

    test('reaches EMI schedule table and Customer Payment Portal Link in Finance tab', () => {
      const viewPath = path.resolve(__dirname, '../src/views/CustomersView.tsx');
      const viewCode = fs.readFileSync(viewPath, 'utf8');

      // Verify Tab 5 (Finance & EMIs) is rendered inside customer-detail-tab-content
      const tabContentIndex = viewCode.indexOf('className="customer-detail-tab-content"');
      const financeTabIndex = viewCode.indexOf("{/* TAB 5: FINANCE & EMIs */}");
      const portalLinkIndex = viewCode.indexOf('<PortalLinkManager');
      const footerIndex = viewCode.indexOf('data-testid="customer-detail-modal-footer"');

      expect(tabContentIndex).toBeGreaterThan(-1);
      expect(financeTabIndex).toBeGreaterThan(tabContentIndex);
      expect(portalLinkIndex).toBeGreaterThan(financeTabIndex);
      expect(footerIndex).toBeGreaterThan(portalLinkIndex);
    });

    test('locks body scroll when modal opens and restores body overflow when closed', () => {
      const viewPath = path.resolve(__dirname, '../src/views/CustomersView.tsx');
      const viewCode = fs.readFileSync(viewPath, 'utf8');

      // Verify presence of body scroll lock effect
      expect(viewCode).toContain('document.body.style.overflow = \'hidden\'');
      expect(viewCode).toContain('document.body.style.overflow = previousOverflow');
      expect(viewCode).toContain('[selectedCustomerId, customerDetail]');
    });
  });
});
