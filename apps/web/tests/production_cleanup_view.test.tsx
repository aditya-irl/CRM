import React from 'react';
import { renderToString } from 'react-dom/server';
import { ProductionCleanupView } from '../src/views/ProductionCleanupView';
import { Sidebar, NavTab } from '../src/components/Sidebar';
import { IUser, UserRole, IProductionCleanupPreview } from '@crm/shared';
import { ApiClient } from '../src/services/api';

describe('Production Cleanup Phase 1 Read-Only UI Tests', () => {
  const superAdminUser: IUser = {
    id: 'u-super-admin-1',
    email: 'admin@financecrm.com',
    phone: '+919876500001',
    fullName: 'Mr. Sparsh',
    role: UserRole.SUPER_ADMIN,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const branchManagerUser: IUser = {
    id: 'u-mgr-1',
    email: 'manager@financecrm.com',
    phone: '+919876500002',
    fullName: 'Anita Deshmukh',
    role: UserRole.BRANCH_MANAGER,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const agentUser: IUser = {
    id: 'u-agent-1',
    email: 'agent.rahul@financecrm.com',
    phone: '+919876500003',
    fullName: 'Rahul Sharma',
    role: UserRole.COLLECTION_AGENT,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const dealerUser: IUser = {
    id: 'u-dealer-1',
    email: 'dealer@store.test',
    phone: '+919876500099',
    fullName: 'Dealer Store Owner',
    role: UserRole.DEALER,
    status: 'ACTIVE' as any,
    dealerId: 'dlr-uuid-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const samplePreviewData: IProductionCleanupPreview = {
    databaseIdentity: {
      databaseName: 'crm_finance_prod',
      currentSchema: 'public',
      serverHost: 'ep-dry-pond-***.aws.neon.tech',
      serverPort: 5432,
      serverIp: '10.0.4.15',
      pgVersion: 'PostgreSQL 16.4',
      sslActive: true,
      providerGuess: 'Neon PostgreSQL',
    },
    operationalCounts: [
      { table: 'customers', category: 'CUSTOMERS', rowCount: 250, description: 'Customer profiles' },
      { table: 'loans', category: 'LOANS_EMIS', rowCount: 227, description: 'Loan agreements' },
      { table: 'payments', category: 'LOANS_EMIS', rowCount: 362, description: 'Payment records' },
      { table: 'emi_installments', category: 'LOANS_EMIS', rowCount: 1642, description: 'EMI installments' },
      { table: 'dealers', category: 'DEALERS', rowCount: 156, description: 'Dealer stores' },
      { table: 'kyc_documents', category: 'CUSTOMERS', rowCount: 10, description: 'KYC files' },
      { table: 'cashfree_orders', category: 'CASHFREE', rowCount: 4, description: 'Cashfree orders' },
      { table: 'notifications', category: 'SYSTEM', rowCount: 1584, description: 'Notifications' },
      { table: 'collection_assignments', category: 'COLLECTIONS', rowCount: 109, description: 'Collection assignments' },
      { table: 'audit_logs', category: 'SYSTEM', rowCount: 4057, description: 'Audit trail' },
    ],
    totalOperationalRows: 8401,
    preservedStaff: [
      { id: 'u1', email: 'admin@financecrm.com', fullName: 'Mr. Sparsh', role: 'SUPER_ADMIN', status: 'ACTIVE', exists: true },
      { id: 'u2', email: 'manager@financecrm.com', fullName: 'Anita Deshmukh', role: 'BRANCH_MANAGER', status: 'ACTIVE', exists: true },
      { id: 'u3', email: 'agent.rahul@financecrm.com', fullName: 'Rahul Sharma', role: 'COLLECTION_AGENT', status: 'ACTIVE', exists: true },
      { id: 'u4', email: 'agent.priya@financecrm.com', fullName: 'Priya Verma', role: 'COLLECTION_AGENT', status: 'ACTIVE', exists: true },
    ],
    allStaffPresent: true,
    systemSettings: {
      allowDealerPenalty: false,
      totalSettings: 1,
      migrationsCount: 31,
      latestMigration: '031_agent_contact_activities.sql',
      cashfreeEnv: 'production',
      cashfreeConfigured: true,
    },
    cleanupReadiness: {
      phase: 'PHASE_1_PREVIEW',
      canProceedToPhase2: true,
      deletionEnabled: false,
      lockStatus: 'DELETION_LOCKED',
      message: 'Phase 1 Read-Only Preview Active.',
      generatedAt: new Date().toISOString(),
    },
  };

  describe('Sidebar Role Protection', () => {
    test('1. Sidebar displays System Handover tab ONLY for SUPER_ADMIN', () => {
      const adminHtml = renderToString(
        <Sidebar activeTab="dashboard" onSelectTab={(_tab: NavTab) => {}} user={superAdminUser} />
      );
      expect(adminHtml).toContain('System Handover');
    });

    test('2. Sidebar hides System Handover tab from BRANCH_MANAGER', () => {
      const managerHtml = renderToString(
        <Sidebar activeTab="dashboard" onSelectTab={(_tab: NavTab) => {}} user={branchManagerUser} />
      );
      expect(managerHtml).not.toContain('System Handover');
    });

    test('3. Sidebar hides System Handover tab from COLLECTION_AGENT', () => {
      const agentHtml = renderToString(
        <Sidebar activeTab="dashboard" onSelectTab={(_tab: NavTab) => {}} user={agentUser} />
      );
      expect(agentHtml).not.toContain('System Handover');
    });

    test('4. Sidebar hides System Handover tab from DEALER', () => {
      const dealerHtml = renderToString(
        <Sidebar activeTab="dashboard" onSelectTab={(_tab: NavTab) => {}} user={dealerUser} />
      );
      expect(dealerHtml).not.toContain('System Handover');
    });
  });

  describe('ProductionCleanupView Structural & Security Invariants', () => {
    test('5. Renders header, Phase 1 badge, and read-only safety alert banner', () => {
      const html = renderToString(
        <ProductionCleanupView user={superAdminUser} />
      );

      expect(html).toContain('Production Data Cleanup &amp; Client Handover');
      expect(html).toContain('Phase 1: Read-Only Preview');
      expect(html).toContain('Phase 1 Active: Strictly Read-Only Live Inspection');
      expect(html).toContain('Re-verify Admin Session');
      expect(html).toContain('Inspecting...');
    });

    test('6. Contains database identity and operational counts sections when mounted with data', () => {
      const html = renderToString(
        <ProductionCleanupView user={superAdminUser} initialPreview={samplePreviewData} />
      );

      // Verify database identity section
      expect(html).toContain('crm_finance_prod');
      expect(html).toContain('Neon PostgreSQL');
      expect(html).toContain('ep-dry-pond-***.aws.neon.tech');

      // Verify operational counts
      expect(html).toContain('8,401');
      expect(html).toContain('customers');
      expect(html).toContain('loans');

      // Verify safety banner
      expect(html).toContain('Phase 1 Active: Strictly Read-Only Live Inspection');
      expect(html).toContain('Zero data modification');
    });

    test('7. ApiClient.executeProductionCleanup is defined and properly structured', () => {
      expect(typeof ApiClient.executeProductionCleanup).toBe('function');
    });

    test('8. Renders Phase 2 ready status and Initiate Purge action button when canProceedToPhase2 is true', () => {
      const phase2Data: IProductionCleanupPreview = {
        ...samplePreviewData,
        cleanupReadiness: {
          phase: 'PHASE_2_READY',
          canProceedToPhase2: true,
          deletionEnabled: true,
          lockStatus: 'PROTECTED_BY_PASSWORD_AND_CONFIRMATION',
          message: 'Phase 2 Ready.',
          generatedAt: new Date().toISOString(),
        },
      };

      const html = renderToString(
        <ProductionCleanupView user={superAdminUser} initialPreview={phase2Data} />
      );

      expect(html).toContain('Phase 2 Ready: Armed &amp; Protected');
      expect(html).toContain('Initiate Handover Purge');
    });
  });
});
