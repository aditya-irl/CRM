import React from 'react';
import { renderToString } from 'react-dom/server';
import { MobileBottomNav } from '../src/components/mobile/MobileBottomNav';
import { MobileMoreSheet } from '../src/components/mobile/MobileMoreSheet';
import { MobileHeader } from '../src/components/mobile/MobileHeader';
import { MobileAppShell } from '../src/components/mobile/MobileAppShell';
import { MobileSettingsModal } from '../src/components/mobile/MobileSettingsModal';
import { UserRole, IUser } from '@crm/shared';

describe('CRM Mobile Transformation – Phase 1: Shared Mobile Shell & Navigation', () => {
  const adminUser: IUser = {
    id: 'user-admin-1',
    email: 'admin@financecrm.com',
    phone: '9876543210',
    fullName: 'Shubh Executive Admin',
    role: UserRole.SUPER_ADMIN,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const branchManagerUser: IUser = {
    id: 'user-bm-1',
    email: 'bm@financecrm.com',
    phone: '9876543211',
    fullName: 'Noida Branch Manager',
    role: UserRole.BRANCH_MANAGER,
    assignedBranch: 'Noida Sector 62',
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const dealerUser: IUser = {
    id: 'user-dealer-1',
    email: 'dealer@store.com',
    phone: '9123456789',
    fullName: 'Alpha Mobile Gallery Retail Store',
    role: UserRole.DEALER,
    dealerId: 'dealer-metro-01',
    assignedBranch: 'Dadri Main Market',
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const agentUser: IUser = {
    id: 'user-agent-1',
    email: 'agent@recovery.com',
    phone: '9811122233',
    fullName: 'Vikram Singh',
    role: UserRole.COLLECTION_AGENT,
    assignedBranch: 'Kasna Route Sector 12',
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // -------------------------------------------------------------
  // TEST SUITE 1: ADMIN ROLE NAVIGATION
  // -------------------------------------------------------------
  describe('1. Admin Role Bottom Navigation & More Sheet', () => {
    test('Admin bottom navigation renders 5 required tabs: Home, Loans, Collections, Reports, More', () => {
      const html = renderToString(
        <MobileBottomNav
          activeTab="dashboard"
          onSelectTab={() => {}}
          user={adminUser}
          onOpenMore={() => {}}
        />
      );

      // Verify all 5 admin tabs are present
      expect(html).toContain('Home');
      expect(html).toContain('Loans');
      expect(html).toContain('Collections');
      expect(html).toContain('Reports');
      expect(html).toContain('More');

      // Verify test-ids
      expect(html).toContain('mobile-nav-tab-dashboard');
      expect(html).toContain('mobile-nav-tab-loans');
      expect(html).toContain('mobile-nav-tab-dealer-collections');
      expect(html).toContain('mobile-nav-tab-reports');
      expect(html).toContain('mobile-nav-tab-more');
    });

    test('Super Admin and Branch Manager both receive the Executive bottom navigation tabs', () => {
      const superAdminHtml = renderToString(
        <MobileBottomNav
          activeTab="loans"
          onSelectTab={() => {}}
          user={adminUser}
          onOpenMore={() => {}}
        />
      );
      const bmHtml = renderToString(
        <MobileBottomNav
          activeTab="loans"
          onSelectTab={() => {}}
          user={branchManagerUser}
          onOpenMore={() => {}}
        />
      );

      expect(superAdminHtml).toContain('Collections');
      expect(superAdminHtml).toContain('Reports');
      expect(bmHtml).toContain('Collections');
      expect(bmHtml).toContain('Reports');
    });

    test('Admin More Sheet exposes authorized destinations: Dealers, Agents, Inventory, Audit, Settings, Logout', () => {
      const html = renderToString(
        <MobileMoreSheet
          isOpen={true}
          onClose={() => {}}
          onSelectTab={() => {}}
          user={adminUser}
          onLogout={() => {}}
          activeTab="dashboard"
        />
      );

      // Verify all admin sheet items are exposed
      expect(html).toContain('Dealer Stores');
      expect(html).toContain('Field Recovery Agents');
      expect(html).toContain('Financed Devices');
      expect(html).toContain('Payments Master Ledger');
      expect(html).toContain('Direct Collections');
      expect(html).toContain('Audit Trail &amp; Logs');
      expect(html).toContain('Account &amp; Security Settings');
      expect(html).toContain('Sign Out of Account');

      // Verify test IDs
      expect(html).toContain('more-sheet-item-dealers');
      expect(html).toContain('more-sheet-item-agents');
      expect(html).toContain('more-sheet-item-devices');
      expect(html).toContain('more-sheet-item-payments');
      expect(html).toContain('more-sheet-item-direct-collections');
      expect(html).toContain('more-sheet-item-audit');
      expect(html).toContain('more-sheet-item-settings');
      expect(html).toContain('more-sheet-logout-btn');
    });

    test('Admin More Sheet does not expose unauthorized dealer or agent items', () => {
      const html = renderToString(
        <MobileMoreSheet
          isOpen={true}
          onClose={() => {}}
          onSelectTab={() => {}}
          user={adminUser}
          onLogout={() => {}}
        />
      );

      expect(html).not.toContain('Store Settlements');
      expect(html).not.toContain('Assigned Route Information');
      expect(html).not.toContain('Field Officer Profile');
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 2: DEALER ROLE NAVIGATION
  // -------------------------------------------------------------
  describe('2. Dealer Role Bottom Navigation & More Sheet', () => {
    test('Dealer bottom navigation renders 5 required tabs: Home, Customers, Loans, Inventory, More', () => {
      const html = renderToString(
        <MobileBottomNav
          activeTab="dashboard"
          onSelectTab={() => {}}
          user={dealerUser}
          onOpenMore={() => {}}
        />
      );

      // Verify all 5 dealer tabs
      expect(html).toContain('Home');
      expect(html).toContain('Customers');
      expect(html).toContain('Loans');
      expect(html).toContain('Inventory');
      expect(html).toContain('More');

      expect(html).toContain('mobile-nav-tab-dashboard');
      expect(html).toContain('mobile-nav-tab-customers');
      expect(html).toContain('mobile-nav-tab-loans');
      expect(html).toContain('mobile-nav-tab-devices');
      expect(html).toContain('mobile-nav-tab-more');

      // Admin-only bottom tabs must not appear
      expect(html).not.toContain('Reports');
      expect(html).not.toContain('My Route');
    });

    test('Dealer More Sheet exposes store-authorized destinations: Settlements, Company Payments, Support, Profile, Logout', () => {
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

      // Verify dealer sheet items
      expect(html).toContain('Store Settlements');
      expect(html).toContain('Company Payments');
      expect(html).toContain('Store Collections Ledger');
      expect(html).toContain('WhatsApp Partner Support');
      expect(html).toContain('Store Partner Profile');
      expect(html).toContain('Sign Out of Account');

      // Admin items must not appear in Dealer More Sheet
      expect(html).not.toContain('Field Recovery Agents');
      expect(html).not.toContain('Audit Trail &amp; Logs');
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 3: COLLECTION AGENT ROLE NAVIGATION
  // -------------------------------------------------------------
  describe('3. Collection Agent Role Bottom Navigation & More Sheet', () => {
    test('Agent bottom navigation renders 5 required tabs: Home, My Route, Collections, Follow-ups, More', () => {
      const html = renderToString(
        <MobileBottomNav
          activeTab="dashboard"
          onSelectTab={() => {}}
          user={agentUser}
          onOpenMore={() => {}}
        />
      );

      // Verify all 5 agent tabs
      expect(html).toContain('Home');
      expect(html).toContain('My Route');
      expect(html).toContain('Collections');
      expect(html).toContain('Follow-ups');
      expect(html).toContain('More');

      expect(html).toContain('mobile-nav-tab-dashboard');
      expect(html).toContain('mobile-nav-tab-queue');
      expect(html).toContain('mobile-nav-tab-agent-collections');
      expect(html).toContain('mobile-nav-tab-contact-activity');
      expect(html).toContain('mobile-nav-tab-more');

      // Unrelated items must NOT appear in Agent bottom navigation
      expect(html).not.toContain('Loans');
      expect(html).not.toContain('Inventory');
      expect(html).not.toContain('Reports');
    });

    test('Agent More Sheet exposes field-authorized destinations: Profile, Route Info, Helpdesk, Logout', () => {
      const html = renderToString(
        <MobileMoreSheet
          isOpen={true}
          onClose={() => {}}
          onSelectTab={() => {}}
          user={agentUser}
          onLogout={() => {}}
          activeTab="dashboard"
        />
      );

      expect(html).toContain('Field Officer Profile');
      expect(html).toContain('Assigned Route Information');
      expect(html).toContain('WhatsApp Operations Helpdesk');
      expect(html).toContain('Sign Out of Account');

      // Sensitive Admin/Dealer items must not appear in Agent More Sheet
      expect(html).not.toContain('Dealer Stores');
      expect(html).not.toContain('Store Settlements');
      expect(html).not.toContain('Company Payments');
      expect(html).not.toContain('Audit Trail &amp; Logs');
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 4: ACTIVE TAB HIGHLIGHTING & NOTIFICATION BADGES
  // -------------------------------------------------------------
  describe('4. Active State Highlighting & Ergonomics', () => {
    test('Highlights the active bottom nav item based on activeTab', () => {
      const html = renderToString(
        <MobileBottomNav
          activeTab="loans"
          onSelectTab={() => {}}
          user={adminUser}
          onOpenMore={() => {}}
        />
      );

      // Loans tab should have active class and aria-current
      expect(html).toContain('mobile-bottom-nav-item active');
      expect(html).toContain('aria-current="page"');
    });

    test('Highlights the More tab when isMoreOpen is true', () => {
      const html = renderToString(
        <MobileBottomNav
          activeTab="dashboard"
          onSelectTab={() => {}}
          user={adminUser}
          onOpenMore={() => {}}
          isMoreOpen={true}
        />
      );

      // More tab should be active
      expect(html).toContain('mobile-bottom-nav-item active');
    });

    test('Renders unread notification badge on More tab when unreadNotificationsCount > 0', () => {
      const html = renderToString(
        <MobileBottomNav
          activeTab="dashboard"
          onSelectTab={() => {}}
          user={adminUser}
          onOpenMore={() => {}}
          unreadNotificationsCount={5}
        />
      );

      expect(html).toContain('data-testid="mobile-nav-badge"');
      expect(html).toContain('5');
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 5: MOBILE APP SHELL & SETTINGS MODAL
  // -------------------------------------------------------------
  describe('5. MobileAppShell & MobileSettingsModal Integration', () => {
    test('MobileAppShell renders both bottom navigation and more sheet cleanly', () => {
      const html = renderToString(
        <MobileAppShell
          user={adminUser}
          activeTab="dashboard"
          onSelectTab={() => {}}
          onLogout={() => {}}
          isMoreOpen={false}
          onCloseMore={() => {}}
          onOpenMore={() => {}}
        />
      );

      expect(html).toContain('data-testid="mobile-bottom-nav"');
      // When isMoreOpen is false, sheet portal is not rendered in DOM
      expect(html).not.toContain('data-testid="mobile-more-sheet-content"');
    });

    test('MobileAppShell renders MobileMoreSheet when isMoreOpen is true', () => {
      const html = renderToString(
        <MobileAppShell
          user={adminUser}
          activeTab="dashboard"
          onSelectTab={() => {}}
          onLogout={() => {}}
          isMoreOpen={true}
          onCloseMore={() => {}}
          onOpenMore={() => {}}
        />
      );

      expect(html).toContain('data-testid="mobile-bottom-nav"');
      expect(html).toContain('data-testid="mobile-more-sheet-content"');
    });

    test('MobileSettingsModal renders account profile & password update form', () => {
      const html = renderToString(
        <MobileSettingsModal
          isOpen={true}
          onClose={() => {}}
          user={adminUser}
        />
      );

      expect(html).toContain('Account Settings');
      expect(html).toContain('Current Password');
      expect(html).toContain('New Password');
      expect(html).toContain('Confirm New Password');
      expect(html).toContain('Save New Password');
      expect(html).toContain(adminUser.fullName);
    });

    test('MobileSettingsModal returns null when isOpen is false', () => {
      const html = renderToString(
        <MobileSettingsModal
          isOpen={false}
          onClose={() => {}}
          user={adminUser}
        />
      );

      expect(html).toBe('');
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 6: MOBILE HEADER COMPONENT
  // -------------------------------------------------------------
  describe('6. MobileHeader Component', () => {
    test('MobileHeader renders brand logo, role badge and user initial avatar', () => {
      const html = renderToString(
        <MobileHeader
          user={adminUser}
          onOpenAddCustomer={() => {}}
          onNavigateNotification={() => {}}
          onToggleMore={() => {}}
        />
      );

      expect(html).toContain('crm-mobile-header');
      expect(html).toContain('Super Admin');
      expect(html).toContain('data-testid="mobile-header-avatar-btn"');
      expect(html).toContain(adminUser.fullName.charAt(0));
    });

    test('MobileHeader renders "Add" button for Admin and Dealer roles', () => {
      const adminHtml = renderToString(
        <MobileHeader
          user={adminUser}
          onOpenAddCustomer={() => {}}
          onToggleMore={() => {}}
        />
      );
      const dealerHtml = renderToString(
        <MobileHeader
          user={dealerUser}
          onOpenAddCustomer={() => {}}
          onToggleMore={() => {}}
        />
      );
      const agentHtml = renderToString(
        <MobileHeader
          user={agentUser}
          onToggleMore={() => {}}
        />
      );

      expect(adminHtml).toContain('mobile-header-add-customer-btn');
      expect(dealerHtml).toContain('mobile-header-add-customer-btn');
      expect(agentHtml).not.toContain('mobile-header-add-customer-btn');
    });
  });
});

