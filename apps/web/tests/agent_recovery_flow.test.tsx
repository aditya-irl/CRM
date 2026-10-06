import React from 'react';
import { renderToString } from 'react-dom/server';
import { CredentialModal } from '../src/components/CredentialModal';
import { AgentsView } from '../src/views/AgentsView';
import { AgentDashboardView } from '../src/views/AgentDashboardView';
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

describe('Collection Agent Credential & Field Recovery Flow Web Tests', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
  });

  test('1. CredentialModal renders high z-index modal, temporary password, copy actions, and WhatsApp share', () => {
    const html = renderToString(
      <CredentialModal
        accountType="AGENT"
        title="Agent Login Credentials"
        subtitle="Rahul Sharma"
        loginId="AGT_RAHUL_01"
        temporaryPassword="TempSecurePass@2026"
        phone="9876543210"
        onClose={() => {}}
      />
    );

    expect(html).toContain('Agent Login Credentials');
    expect(html).toContain('AGT_RAHUL_01');
    expect(html).toContain('TempSecurePass@2026');
    expect(html).toContain('Rahul Sharma');
    expect(html).toContain('Copy Login ID');
    expect(html).toContain('Copy Password');
    expect(html).toContain('Share on WhatsApp');
    expect(html).toContain('z-index:3000');
  });

  test('2. AgentsView renders agent management interface and provision action', () => {
    const html = renderToString(<AgentsView />);
    expect(html).toContain('Field Collection Agents');
    expect(html).toContain('Provision New Agent');
    expect(html).toContain('Search by name, phone, or login ID');
  });

  test('3. AgentDashboardView renders agent recovery metrics, upcoming dues, and queue tabs', () => {
    // Set agent context
    ApiClient.setAuth(
      {
        id: 'agent-123',
        email: 'agent123@crm.local',
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
    expect(html).toContain('Recovery Agent Dashboard');
    expect(html).toContain('Assigned Customers');
    expect(html).toContain("Today&#x27;s Due");
    expect(html).toContain("Today&#x27;s Collection");
    expect(html).toContain('Overdue Portfolio');
    expect(html).toContain('Upcoming EMI Dues');
    expect(html).toContain('Recovery Queue');
    expect(html).toContain('Recent Collections');
  });

  test('4. Security: Temporary password is never persisted into browser storage', () => {
    ApiClient.setAuth(
      {
        id: 'agent-456',
        email: 'agent456@crm.local',
        phone: '9876543211',
        fullName: 'Agent Test Security',
        role: UserRole.COLLECTION_AGENT,
        status: 'ACTIVE' as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'agent-token-xyz'
    );

    const rawUser = mockLocalStorage.getItem('crm_user');
    expect(rawUser).not.toBeNull();
    const parsedUser = JSON.parse(rawUser!);
    expect(parsedUser.password).toBeUndefined();
    expect(parsedUser.temporaryPassword).toBeUndefined();
    expect(parsedUser.password_hash).toBeUndefined();
    expect(mockLocalStorage.getItem('temporaryPassword')).toBeNull();
  });
});
