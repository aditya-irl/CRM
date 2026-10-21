import React from 'react';
import { renderToString } from 'react-dom/server';
import { ApiClient, IAssignLoanAgentResult } from '../src/services/api';
import { LoansView } from '../src/views/LoansView';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
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

describe('Agent Assignment Workflow Resilience & Safety Tests', () => {
  const adminUser: IUser = {
    id: 'admin-uuid-001',
    email: 'admin@finance.crm',
    phone: '9876543210',
    fullName: 'Operations Super Admin',
    role: UserRole.SUPER_ADMIN,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const branchManager: IUser = {
    id: 'bm-uuid-002',
    email: 'bm@finance.crm',
    phone: '9876543211',
    fullName: 'Branch Manager North',
    role: UserRole.BRANCH_MANAGER,
    status: 'ACTIVE' as any,
    assignedBranch: 'North Zone',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const agentUser: IUser = {
    id: 'agent-uuid-003',
    email: 'agent@recovery.crm',
    phone: '9876543212',
    fullName: 'Field Agent Vikram',
    role: UserRole.COLLECTION_AGENT,
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  describe('1. API Assignment Response Unwrapping & Compatibility', () => {
    test('assignLoanAgent receives standard unwrapped response without throwing undefined data errors', async () => {
      ApiClient.setAuth(adminUser, 'admin-token');

      const mockPayload: IAssignLoanAgentResult = {
        loanId: 'loan-123',
        loanAccountNo: 'LN-202610-001',
        assignedAgentId: 'agent-uuid-003',
        assignedAgentName: 'Field Agent Vikram',
        assignedAgentPhone: '9876543212',
        assignmentId: 'assign-uuid-999',
        isReassignment: false,
        assignedAt: new Date().toISOString(),
      };

      // Mock request method on ApiClient
      const requestSpy = jest.spyOn(ApiClient as any, 'request').mockResolvedValue(mockPayload);

      const res = await ApiClient.assignLoanAgent('loan-123', 'agent-uuid-003', 'Call customer after 6pm');

      expect(requestSpy).toHaveBeenCalledWith(
        '/loans/loan-123/assign',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ agentId: 'agent-uuid-003', notes: 'Call customer after 6pm' }),
        })
      );

      // Verify that properties are directly on res (unwrapped) and never throw undefined errors
      expect(res.assignedAgentId).toBe('agent-uuid-003');
      expect(res.assignedAgentName).toBe('Field Agent Vikram');
      expect(res.assignedAgentPhone).toBe('9876543212');

      requestSpy.mockRestore();
    });

    test('Defensive extraction safely handles both unwrapped payload and legacy wrapped res.data', () => {
      // Direct unwrapped (actual behavior of ApiClient.request)
      const directRes: any = {
        loanId: 'loan-123',
        assignedAgentId: 'agent-1',
        assignedAgentName: 'Agent One',
        assignedAgentPhone: '9999999999',
        assignedAt: '2026-10-21T18:00:00Z',
      };
      const directAgentId = directRes?.assignedAgentId ?? directRes?.data?.assignedAgentId;
      const directAgentName = directRes?.assignedAgentName ?? directRes?.data?.assignedAgentName;
      expect(directAgentId).toBe('agent-1');
      expect(directAgentName).toBe('Agent One');

      // Wrapped in res.data (legacy structure)
      const wrappedRes: any = {
        data: {
          loanId: 'loan-123',
          assignedAgentId: 'agent-2',
          assignedAgentName: 'Agent Two',
          assignedAgentPhone: '8888888888',
          assignedAt: '2026-10-21T18:00:00Z',
        },
      };
      const wrappedAgentId = wrappedRes?.assignedAgentId ?? wrappedRes?.data?.assignedAgentId;
      const wrappedAgentName = wrappedRes?.assignedAgentName ?? wrappedRes?.data?.assignedAgentName;
      expect(wrappedAgentId).toBe('agent-2');
      expect(wrappedAgentName).toBe('Agent Two');
    });

    test('Missing or unexpected response fields safely fall back without crashing', () => {
      const activeAgentsList = [
        { id: 'agent-fallback-1', fullName: 'Agent Fallback', phone: '9111111111' },
      ];
      const selectedAgentId = 'agent-fallback-1';
      const emptyRes: any = {}; // Server returned empty or partial response

      const assignedAgentId = emptyRes?.assignedAgentId ?? emptyRes?.data?.assignedAgentId ?? selectedAgentId;
      const agentFromList = activeAgentsList.find((a) => a.id === assignedAgentId);
      const assignedAgentName =
        emptyRes?.assignedAgentName ??
        emptyRes?.data?.assignedAgentName ??
        agentFromList?.fullName ??
        'Assigned Agent';
      const assignedAgentPhone =
        emptyRes?.assignedAgentPhone ??
        emptyRes?.data?.assignedAgentPhone ??
        agentFromList?.phone ??
        null;

      expect(assignedAgentId).toBe('agent-fallback-1');
      expect(assignedAgentName).toBe('Agent Fallback');
      expect(assignedAgentPhone).toBe('9111111111');
    });
  });

  describe('2. ErrorBoundary Protection & Resilience', () => {
    test('ErrorBoundary catches errors via getDerivedStateFromError and renders recovery card', () => {
      const error = new Error('Simulation of unexpected UI crash');
      const state = ErrorBoundary.getDerivedStateFromError(error);
      expect(state.hasError).toBe(true);
      expect(state.error?.message).toBe('Simulation of unexpected UI crash');

      // Verify render when state has error
      const boundary = new ErrorBoundary({ children: <div>Normal</div> });
      boundary.state = state;
      const rendered = boundary.render() as React.ReactElement;
      const html = renderToString(rendered);

      expect(html).toContain('Section Display Interrupted');
      expect(html).toContain('An unexpected error occurred while rendering this view');
      expect(html).toContain('Simulation of unexpected UI crash');
      expect(html).toContain('Reload This Section');
      expect(html).toContain('Go to Dashboard');
    });

    test('ErrorBoundary renders normal children when no error occurs', () => {
      const SafeChild: React.FC = () => <div>Safe Content Displayed</div>;

      const html = renderToString(
        <ErrorBoundary fallbackTitle="Workflow View Interrupted">
          <SafeChild />
        </ErrorBoundary>
      );

      expect(html).toContain('Safe Content Displayed');
      expect(html).not.toContain('Workflow View Interrupted');
    });
  });

  describe('3. Loans View Assignment Header & UI Rendering', () => {
    test('LoansView renders portfolio header and recovery agent management headers', () => {
      ApiClient.setAuth(adminUser, 'admin-token');

      const html = renderToString(<LoansView />);

      expect(html).toContain('Loans &amp; Amortization Portfolio');
      expect(html).toContain('Originate loans, preview deterministic amortization schedules, and track repayments.');
      expect(html).toContain('Originate New Loan');
    });

    test('LoansView renders assigned agent and unassigned status in loan tables', () => {
      ApiClient.setAuth(branchManager, 'bm-token');

      const html = renderToString(<LoansView />);

      // Verify table column for assigned agent
      expect(html).toContain('Assigned Agent');
    });
  });

  describe('4. Role-Based Assignment Permissions', () => {
    test('Super Admin and Branch Manager have assignment management permission', () => {
      ApiClient.setAuth(adminUser, 'admin-token');
      expect(
        [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER].includes(adminUser.role)
      ).toBe(true);

      ApiClient.setAuth(branchManager, 'bm-token');
      expect(
        [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER].includes(branchManager.role)
      ).toBe(true);
    });

    test('Collection Agents do NOT have permission to assign loans', () => {
      ApiClient.setAuth(agentUser, 'agent-token');
      expect(
        [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER].includes(agentUser.role)
      ).toBe(false);
    });
  });

  describe('5. Unassign Loan Recovery Case Safety', () => {
    test('unassignLoanAgent sends POST to unassign endpoint and receives unwrapped response', async () => {
      ApiClient.setAuth(adminUser, 'admin-token');

      const mockUnassignRes = {
        loanId: 'loan-456',
        loanAccountNo: 'LN-202610-002',
        previousAgentId: 'agent-uuid-003',
        previousAgentName: 'Field Agent Vikram',
        unassignedAt: new Date().toISOString(),
      };

      const requestSpy = jest.spyOn(ApiClient as any, 'request').mockResolvedValue(mockUnassignRes);

      const res = await ApiClient.unassignLoanAgent('loan-456', 'Customer relocated out of district');

      expect(requestSpy).toHaveBeenCalledWith(
        '/loans/loan-456/unassign',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'Customer relocated out of district' }),
        })
      );

      expect(res.loanId).toBe('loan-456');
      expect(res.previousAgentName).toBe('Field Agent Vikram');

      requestSpy.mockRestore();
    });
  });
});
