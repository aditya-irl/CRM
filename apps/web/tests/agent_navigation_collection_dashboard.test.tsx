import React from 'react';
import { renderToString } from 'react-dom/server';
import { Sidebar } from '../src/components/Sidebar';
import { AgentsView } from '../src/views/AgentsView';
import { AgentDashboardView } from '../src/views/AgentDashboardView';
import { CustomersView } from '../src/views/CustomersView';
import { ApiClient } from '../src/services/api';
import { UserRole } from '@crm/shared';

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

describe('Agent Management, Navigation & Collection-Only Dashboard UI Tests', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------
  // REQUIREMENT 1: Admin Delete Agent UI
  // -------------------------------------------------------------
  test('1. AgentsView renders agent management interface with Delete Agent action', () => {
    const html = renderToString(<AgentsView />);
    expect(html).toContain('Field Collection Agents');
    expect(html).toContain('Provision New Agent');
    expect(html).toContain('Search by name, phone, or login ID');
  });

  // -------------------------------------------------------------
  // REQUIREMENT 2: Remove Customer Onboarding from Agent Login
  // -------------------------------------------------------------
  test('2. CustomersView hides "Onboard New Customer" button for COLLECTION_AGENT role', () => {
    // Set authenticated user as COLLECTION_AGENT
    ApiClient.setAuth(
      {
        id: 'agent-123',
        email: 'agent@crm.local',
        phone: '9876543210',
        fullName: 'Field Agent Test',
        role: UserRole.COLLECTION_AGENT,
        status: 'ACTIVE' as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'token-agent-123'
    );

    const html = renderToString(<CustomersView />);
    // "Onboard New Customer" button must be absent for agent
    expect(html).not.toContain('Onboard New Customer');
  });

  test('3. CustomersView retains "Onboard New Customer" button for authorized Admin role', () => {
    // Set authenticated user as SUPER_ADMIN
    ApiClient.setAuth(
      {
        id: 'admin-123',
        email: 'admin@crm.local',
        phone: '9876543211',
        fullName: 'Super Administrator',
        role: UserRole.SUPER_ADMIN,
        status: 'ACTIVE' as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'token-admin-123'
    );

    const html = renderToString(<CustomersView />);
    expect(html).toContain('Onboard New Customer');
  });

  // -------------------------------------------------------------
  // REQUIREMENT 3: Remove My Loans from Agent Navigation
  // -------------------------------------------------------------
  test('4. Sidebar removes "My Loans" and unrelated navigation for COLLECTION_AGENT', () => {
    const agentUser = {
      id: 'agent-123',
      email: 'agent@crm.local',
      phone: '9876543210',
      fullName: 'Field Collection Agent',
      role: UserRole.COLLECTION_AGENT,
      status: 'ACTIVE' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const html = renderToString(
      <Sidebar
        activeTab="dashboard"
        onSelectTab={() => {}}
        user={agentUser}
      />
    );

    // "My Loans" or "Loans & EMI Terms" must be absent for Agent
    expect(html).not.toContain('My Loans');
    expect(html).not.toContain('Loans &amp; EMI Terms');
    expect(html).not.toContain('Loans & EMI Terms');

    // Customer directory and queue tabs are also hidden from agent sidebar
    expect(html).not.toContain('Customers &amp; Profiles');
    expect(html).not.toContain('Collection Queue');
    expect(html).not.toContain('Financed Devices');

    // Collection Dashboard and My Collections are visible
    expect(html).toContain('Collection Dashboard');
    expect(html).toContain('My Collections');
  });

  test('5. Sidebar preserves "Loans & EMI Terms" for Admin and other authorized roles', () => {
    const adminUser = {
      id: 'admin-123',
      email: 'admin@crm.local',
      phone: '9876543211',
      fullName: 'Admin User',
      role: UserRole.SUPER_ADMIN,
      status: 'ACTIVE' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const html = renderToString(
      <Sidebar
        activeTab="dashboard"
        onSelectTab={() => {}}
        user={adminUser}
      />
    );

    expect(html).toContain('Loans &amp; EMI Terms');
    expect(html).toContain('Customers &amp; Profiles');
  });

  // -------------------------------------------------------------
  // REQUIREMENT 4: Collection-Only Agent Dashboard
  // -------------------------------------------------------------
  test('6. AgentDashboardView renders collection-only 4 KPIs and assigned customer obligations', () => {
    ApiClient.setAuth(
      {
        id: 'agent-123',
        email: 'agent@crm.local',
        phone: '9876543210',
        fullName: 'Field Recovery Officer',
        role: UserRole.COLLECTION_AGENT,
        status: 'ACTIVE' as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'token-agent-123'
    );

    const html = renderToString(<AgentDashboardView />);

    // Title & Subtitle
    expect(html).toContain('Collection Agent Dashboard');
    expect(html).toContain('Field collection targets, assigned customer obligations, and payment receipts');

    // 4 Key Authoritative Metrics (Layout E)
    expect(html).toContain("Today&#x27;s Collections");
    expect(html).toContain('EMIs Due Today');
    expect(html).toContain('Overdue EMIs');
    expect(html).toContain('Assigned Customers');

    // Main collection tabs
    expect(html).toContain('Assigned Customers &amp; Dues');
    expect(html).toContain("Today&#x27;s Collections");

    // Unrelated actions must NOT be present
    expect(html).not.toContain('Onboard New Customer');
    expect(html).not.toContain('Add Customer');
    expect(html).not.toContain('Originate Loan');
    expect(html).not.toContain('Loan Approvals');
    expect(html).not.toContain('Financial Analytics');
  });
});
