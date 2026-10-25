import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { DashboardView } from '../src/views/DashboardView';
import { IUser, UserRole, formatINR, formatCompactINR } from '@crm/shared';

describe('Executive Finance Dashboard KPI Responsive Layout Regression Tests', () => {
  const adminUser: IUser = {
    id: 'admin-1',
    name: 'Executive Finance Officer',
    email: 'finance@crm.test',
    role: UserRole.SUPER_ADMIN,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
  };

  // Mock production stats with long Indian currency values described in problem statement
  const productionMockStats: any = {
    period: {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      preset: 'this-month',
    },
    topKpis: {
      totalDisbursed: 420000.0, // ₹4,20,000.00
      disbursedLoanCount: 14,
      activePortfolio: 544550.68, // ₹5,44,550.68
      activeLoanCount: 22,
      totalCollections: 185450.5, // ₹1,85,450.50
      collectionCount: 45,
      totalOverdueAmount: 32500.0, // ₹32,500.00
      overdueLoanCount: 3,
      overdueCustomerCount: 3,
      collectionEfficiencyPercent: 91.5,
      totalDueAmount: 202678.0,
    },
    sourceBreakdown: {
      directCustomer: { amount: 80000, count: 20, sharePercent: 43.1 },
      dealer: { amount: 75000, count: 18, sharePercent: 40.5 },
      recoveryAgent: { amount: 30450.5, count: 7, sharePercent: 16.4 },
    },
    trends: {
      collections: [],
      disbursements: [],
    },
    portfolioSummary: {
      totalOutstandingPrincipal: 480000,
      totalOutstandingInterest: 64550.68,
      totalOverdue: 32500,
      activeLoans: 22,
      closedLoans: 8,
      overdueLoans: 3,
      totalCustomers: 38,
    },
    agingBuckets: {
      current: { count: 19, amount: 450000 },
      dpd1To30: { count: 2, amount: 20000 },
      dpd31To60: { count: 1, amount: 12500 },
      dpd61To90: { count: 0, amount: 0 },
      dpd90Plus: { count: 0, amount: 0 },
    },
    dealerReconciliation: {
      totalCollectedThroughDealers: 75000,
      totalDealerSettled: 65000,
      outstandingDealerRemittance: 10000,
      unsettledDealersCount: 2,
      dealers: [],
    },
    recoveryAgentSummary: {
      totalAgentCollections: 30450.5,
      paymentCount: 7,
      todayCollections: 0,
      monthCollections: 30450.5,
      agents: [],
    },
    directCustomerSummary: {
      totalDirectCollections: 80000,
      paymentCount: 20,
      todayCollections: 0,
      monthCollections: 80000,
      averagePayment: 4000,
    },
    overdueSummary: {
      totalOverdueAmount: 32500,
      overdueLoanCount: 3,
      overdueCustomerCount: 3,
      averageOverdueAmount: 10833.33,
      recoveryQueue: {
        totalAccounts: 3,
        dpd1To30: 2,
        dpd31To60: 1,
        dpd61To90: 0,
        dpd90Plus: 0,
        assignedCount: 2,
        unassignedCount: 1,
      },
    },
    operationalMetrics: {
      averageLoanAmount: 30000,
      averageEmiAmount: 5000,
      averagePaymentAmount: 4121.12,
      activeCustomersCount: 38,
      activeDealersCount: 4,
      activeAgentsCount: 2,
    },
    executiveMetrics: {
      averageLoanTicket: 30000,
      defaultRatePercent: 1.2,
      netCashFlow: 152950.5,
    },
    recentCollections: [],
    recentSettlements: [],
  };

  test('1. KPI Grid uses responsive class and avoids rigid fixed-column inline sizing', () => {
    const html = renderToString(
      <DashboardView user={adminUser} initialStats={productionMockStats} />
    );

    // Verifies dashboard-kpi-grid class is applied
    expect(html).toContain('dashboard-kpi-grid');
    expect(html).toContain('kpi-grid-mobile-2col');

    // Ensure the old rigid minmax(140px, 1fr) inline style is NOT present
    expect(html).not.toContain('minmax(140px, 1fr)');
  });

  test('2. Large Indian currency values (₹4,20,000.00 and ₹5,44,550.68) render compact format on cards', () => {
    const html = renderToString(
      <DashboardView user={adminUser} initialStats={productionMockStats} />
    );

    // Total Disbursed: ₹4,20,000.00 formatted compactly as ₹4.20L
    expect(html).toContain(formatCompactINR(420000));
    expect(html).toContain('₹4.20L');

    // Active Portfolio: ₹5,44,550.68 formatted compactly as ₹5.45L
    expect(html).toContain(formatCompactINR(544550.68));
    expect(html).toContain('₹5.45L');

    // Total Collections: ₹1,85,450.50 formatted compactly as ₹1.85L
    expect(html).toContain(formatCompactINR(185450.5));
    expect(html).toContain('₹1.85L');
  });

  test('3. Exact full financial amounts remain 100% accessible via title, aria-label, and data attributes', () => {
    const html = renderToString(
      <DashboardView user={adminUser} initialStats={productionMockStats} />
    );

    // Native browser tooltip title contains the exact full amount
    expect(html).toContain('Total Disbursed: ' + formatINR(420000));
    expect(html).toContain('Active Portfolio: ' + formatINR(544550.68));
    expect(html).toContain('Total Collections: ' + formatINR(185450.5));
    expect(html).toContain('Total Overdue: ' + formatINR(32500));

    // Screen reader accessible labels and sr-only exact amount containers
    expect(html).toContain('aria-label="Total Disbursed: ' + formatINR(420000) + '"');
    expect(html).toContain('aria-label="Active Portfolio: ' + formatINR(544550.68) + '"');
    expect(html).toContain('Exact Amount: <!-- -->' + formatINR(420000));
    expect(html).toContain('Exact Amount: <!-- -->' + formatINR(544550.68));

    // data-full-amount attributes preserve raw exact string
    expect(html).toContain('data-full-amount="' + formatINR(420000) + '"');
    expect(html).toContain('data-full-amount="' + formatINR(544550.68) + '"');
  });

  test('4. All six KPI cards have standard semantic classes for flexible shrink without track blowout', () => {
    const html = renderToString(
      <DashboardView user={adminUser} initialStats={productionMockStats} />
    );

    expect(html).toContain('data-testid="kpi-card-total-disbursed"');
    expect(html).toContain('data-testid="kpi-card-active-portfolio"');
    expect(html).toContain('data-testid="kpi-card-total-collections"');
    expect(html).toContain('data-testid="kpi-card-total-overdue"');
    expect(html).toContain('data-testid="kpi-card-collection-efficiency"');
    expect(html).toContain('data-testid="kpi-card-active-borrowers"');

    // Cards use .dashboard-kpi-card, .dashboard-kpi-header, .dashboard-kpi-value, .dashboard-kpi-subtext
    expect(html).toContain('dashboard-kpi-card');
    expect(html).toContain('dashboard-kpi-header');
    expect(html).toContain('dashboard-kpi-value');
    expect(html).toContain('dashboard-kpi-subtext');
  });

  test('5. index.css defines responsive grid tracks for Desktop (6 col), Tablet (3 col), Mobile (2 col), and Extra-small (1 col)', () => {
    const cssPath = path.resolve(__dirname, '../src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Desktop: 6 columns with minmax(0, 1fr)
    expect(cssContent).toContain('repeat(6, minmax(0, 1fr))');

    // Tablet: 3 columns with minmax(0, 1fr)
    expect(cssContent).toContain('repeat(3, minmax(0, 1fr))');

    // Mobile: 2 columns with minmax(0, 1fr)
    expect(cssContent).toContain('repeat(2, minmax(0, 1fr))');

    // Extra small (<= 360px): 1 column
    expect(cssContent).toContain('grid-template-columns: 1fr');

    // Value scaling uses clamp()
    expect(cssContent).toContain('font-size: clamp(');

    // Cards have min-width: 0 to allow track shrinkage without blowout
    expect(cssContent).toContain('min-width: 0;');

    // Screen reader accessible utility
    expect(cssContent).toContain('.sr-only');
  });
});
