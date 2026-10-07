import React from 'react';
import { renderToString } from 'react-dom/server';
import { Sidebar, NavTab } from '../src/components/Sidebar';
import { IUser, UserRole } from '@crm/shared';

describe('TASK 2 — Scrollable Operational Menu Regression Tests', () => {
  const adminUser: IUser = {
    id: 'user-admin-1',
    email: 'admin@financecrm.com',
    phone: '9999999999',
    fullName: 'Admin User',
    role: UserRole.SUPER_ADMIN,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const dealerUser: IUser = {
    id: 'user-dealer-1',
    email: 'dealer@store.com',
    phone: '8888888888',
    fullName: 'Store Partner',
    role: UserRole.DEALER,
    status: 'ACTIVE' as any,
    dealerId: 'dealer-001',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  test('1. Sidebar renders Operations Menu with flex container and scrollable nav', () => {
    const html = renderToString(
      <Sidebar activeTab="dashboard" onSelectTab={(_tab: NavTab) => {}} user={adminUser} />
    );

    // Header check
    expect(html).toContain('Operations Menu');
    // Security footer check
    expect(html).toContain('ACID Ledger Protected');
    expect(html).toContain('Alpha Mobile Gallery • Shubh Pvt Ltd');

    // Flex layout and scrollable styles
    expect(html).toContain('overflow-y:auto');
    expect(html).toContain('min-height:0');
    expect(html).toContain('flex:1');
    expect(html).toContain('overflow-x:hidden');
  });

  test('2. Sidebar preserves active item highlighting and all navigation items for Admin', () => {
    const html = renderToString(
      <Sidebar activeTab="loans" onSelectTab={(_tab: NavTab) => {}} user={adminUser} />
    );

    expect(html).toContain('Loans &amp; EMI Terms');
    expect(html).toContain('var(--primary-subtle)');
    expect(html).toContain('Customers &amp; Profiles');
    expect(html).toContain('Dealer Stores');
    expect(html).toContain('Reports &amp; Analytics');
    expect(html).toContain('Audit Trail &amp; Logs');
  });

  test('3. Dealer Partner Terminal displays partner-scoped navigation with exactly ONE Financed Devices entry', () => {
    const html = renderToString(
      <Sidebar activeTab="dashboard" onSelectTab={(_tab: NavTab) => {}} user={dealerUser} />
    );

    expect(html).toContain('Partner Terminal');
    expect(html).toContain('Store Isolation Enforced');
    expect(html).toContain('Store Customers');
    expect(html).toContain('Store Collections');
    expect(html).toContain('Store Settlements');

    // Exactly ONE Financed Devices item in Dealer sidebar (regression check for duplicate entry)
    const financedDevicesMatches = html.match(/Financed Devices/g) || [];
    expect(financedDevicesMatches.length).toBe(1);

    expect(html).not.toContain('Loans &amp; EMI Terms');
    expect(html).not.toContain('My Loans');
    expect(html).not.toContain('Audit Trail &amp; Logs');
    expect(html).not.toContain('Field Agents');
  });

  test('4. Dealer sidebar highlights Financed Devices when active', () => {
    const html = renderToString(
      <Sidebar activeTab="devices" onSelectTab={(_tab: NavTab) => {}} user={dealerUser} />
    );

    expect(html).toContain('Financed Devices');
    expect(html).toContain('var(--primary-subtle)');
    expect(html).toContain('var(--primary-border)');
  });
});
