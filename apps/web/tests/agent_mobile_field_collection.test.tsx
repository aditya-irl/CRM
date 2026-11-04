import React from 'react';
import { renderToString } from 'react-dom/server';
import { AgentDashboardView } from '../src/views/AgentDashboardView';
import { QueueView } from '../src/views/QueueView';
import { AgentCollectionsView } from '../src/views/AgentCollectionsView';
import { ContactActivityView } from '../src/views/ContactActivityView';
import {
  AgentMobileQueueCard,
  AgentMobileCollectionsCard,
  AgentMobileFilterSheet,
} from '../src/components/mobile';
import { RecordPaymentModal } from '../src/components/RecordPaymentModal';
import { LogContactModal } from '../src/components/LogContactModal';
import { ApiClient } from '../src/services/api';
import { UserRole, IUser, IAgentQueueItem } from '@crm/shared';

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

describe('Agent Field Collection Mobile Experience Tests (Phase 2)', () => {
  const agentUser: IUser = {
    id: 'agent-vikram-01',
    email: 'vikram.singh@shubhfinance.com',
    phone: '9876543210',
    fullName: 'Vikram Singh',
    role: UserRole.COLLECTION_AGENT,
    assignedBranch: 'Kasna Industrial Corridor',
    status: 'ACTIVE' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    jest.restoreAllMocks();
    ApiClient.setAuth(agentUser, 'mock-agent-token-xyz');
  });

  // =========================================================================
  // 1. AGENT MOBILE DASHBOARD
  // =========================================================================
  describe('1. Agent Mobile Dashboard View', () => {
    test('renders mobile header with greeting, agent name, assigned route, and network status badge', () => {
      const html = renderToString(<AgentDashboardView onNavigateToTab={() => {}} />);

      // Must render agent mobile header container
      expect(html).toContain('agent-mobile-header');
      expect(html).toContain('Vikram Singh');
      expect(html).toContain('Kasna Industrial Corridor');

      // Online status indicator
      expect(html).toContain('Online');

      // Quick action tiles
      expect(html).toContain('My Route');
      expect(html).toContain('Collect');
      expect(html).toContain('Log Visit');
      expect(html).toContain('Follow-ups');
    });

    test('renders all 6 mobile KPI performance cards', () => {
      const html = renderToString(<AgentDashboardView onNavigateToTab={() => {}} />);

      // 6 Performance KPI Cards
      expect(html).toContain('kpi-today-collection');
      expect(html).toContain('kpi-daily-target');
      expect(html).toContain('kpi-remaining-target');
      expect(html).toContain('kpi-emis-due-today');
      expect(html).toContain('kpi-overdue-customers');
      expect(html).toContain('kpi-pending-visits');
    });

    test('maintains dual-view architecture: both agent-mobile-view and agent-desktop-view exist', () => {
      const html = renderToString(<AgentDashboardView onNavigateToTab={() => {}} />);

      // Both classes must exist to allow CSS media queries to switch between them
      expect(html).toContain('agent-mobile-view');
      expect(html).toContain('agent-desktop-view');
      expect(html).toContain('Recovery Agent Dashboard'); // Desktop title
    });
  });

  // =========================================================================
  // 2. CUSTOMER QUEUE & ACTION CARDS
  // =========================================================================
  describe('2. Agent Mobile Queue Card & Actions', () => {
    const mockQueueItem: IAgentQueueItem = {
      installmentId: 'inst-101',
      loanId: 'loan-xyz-1',
      loanAccountNo: 'LN-2026-0042',
      customerId: 'cust-101',
      customerName: 'Ramesh Verma',
      customerCode: 'CUST-RV-99',
      primaryPhone: '9812345678',
      addressSummary: 'Shop 14, Main Market, Kasna',
      areaRoute: 'Kasna Industrial Corridor',
      installmentNumber: 2,
      dueDate: '2026-11-05',
      expectedAmount: 3500,
      remainingAmount: 3500,
      daysOverdue: 4,
      status: 'OVERDUE' as any,
      dealerStoreName: 'Alpha Mobile Gallery',
      penaltyAmount: 0,
      hasPendingCollection: false,
    };

    test('renders customer card with borrower information, overdue badge, and loan account', () => {
      const html = renderToString(
        <AgentMobileQueueCard
          item={mockQueueItem}
          onCall={() => {}}
          onWhatsApp={() => {}}
          onNavigate={() => {}}
          onLogVisit={() => {}}
          onCollect={() => {}}
        />
      );

      expect(html).toContain('Ramesh Verma');
      expect(html).toContain('CUST-RV-99');
      expect(html).toContain('LN-2026-0042');
      expect(html).toContain('D OVERDUE');
      expect(html).toContain('Kasna Industrial Corridor');
    });

    test('renders all 5 quick action buttons with >= 48px touch targets', () => {
      const html = renderToString(
        <AgentMobileQueueCard
          item={mockQueueItem}
          onCall={() => {}}
          onWhatsApp={() => {}}
          onNavigate={() => {}}
          onLogVisit={() => {}}
          onCollect={() => {}}
        />
      );

      // Verify action buttons exist with testids
      expect(html).toContain('agent-card-call-btn');
      expect(html).toContain('agent-card-whatsapp-btn');
      expect(html).toContain('agent-card-navigate-btn');
      expect(html).toContain('agent-card-log-visit-btn');
      expect(html).toContain('agent-card-collect-btn');

      // Verify touch target height (48px)
      expect(html).toContain('height:48px');
    });

    test('QueueView renders mobile-only card view and desktop table view', () => {
      const html = renderToString(<QueueView onNavigateToTab={() => {}} />);

      expect(html).toContain('desktop-only-table-view');
      expect(html).toContain('mobile-only-card-view');
    });
  });

  // =========================================================================
  // 3. AGENT MOBILE FILTER SHEET
  // =========================================================================
  describe('3. Agent Mobile Filter Sheet', () => {
    test('renders filter drawer with routes, statuses, reset and apply buttons', () => {
      const html = renderToString(
        <AgentMobileFilterSheet
          isOpen={true}
          onClose={() => {}}
          statusFilter="OVERDUE"
          onSelectStatus={() => {}}
          routeFilter="Kasna Corridor"
          onChangeRoute={() => {}}
          statusOptions={[
            { id: 'ALL', label: 'All Collections' },
            { id: 'OVERDUE', label: 'Overdue Only', count: 5 },
          ]}
        />
      );

      expect(html).toContain('Filter Collection Queue');
      expect(html).toContain('Kasna Corridor');
      expect(html).toContain('Overdue Only');
      expect(html).toContain('Apply &amp; View Results');
    });

    test('returns null when isOpen is false', () => {
      const html = renderToString(
        <AgentMobileFilterSheet
          isOpen={false}
          onClose={() => {}}
          statusFilter="ALL"
          onSelectStatus={() => {}}
          statusOptions={[{ id: 'ALL', label: 'All Collections' }]}
        />
      );

      expect(html).toBe('');
    });
  });

  // =========================================================================
  // 4. AGENT MOBILE COLLECTIONS & RECEIPTS
  // =========================================================================
  describe('4. Agent Mobile Collections Card & Receipt Sharing', () => {
    const mockRecord = {
      id: 'coll-rec-001',
      receiptNumber: 'RCP-2026-0881',
      loanAccountNo: 'LN-2026-0042',
      customerName: 'Suresh Kumar',
      customerPhone: '9876543210',
      amountCollected: 3500,
      paymentMode: 'CASH',
      paymentTimestamp: '2026-11-04T12:00:00Z',
      status: 'SUCCESS',
      isReversal: false,
    };

    test('renders collection card with receipt number, customer, amount, and approved status', () => {
      const html = renderToString(
        <AgentMobileCollectionsCard
          record={mockRecord}
          onViewReceipt={() => {}}
        />
      );

      expect(html).toContain('RCP-2026-0881');
      expect(html).toContain('Suresh Kumar');
      expect(html).toContain('LN-2026-0042');
      expect(html).toContain('APPROVED');
      expect(html).toContain('View Receipt');
      expect(html).toContain('agent-collection-share-btn');
      expect(html).toContain('Share receipt on WhatsApp');
    });

    test('AgentCollectionsView provides collection management interface with filters', () => {
      const html = renderToString(<AgentCollectionsView />);

      expect(html).toContain('Field Collection Transactions');
      expect(html).toContain('All Recovery Agents');
      expect(html).toContain('Approval Filter:');
    });
  });

  // =========================================================================
  // 5. PAYMENT COLLECTION UX & VALIDATION
  // =========================================================================
  describe('5. Record Payment Modal Mobile UX', () => {
    test('renders numeric inputMode and mode selectors with touch-friendly 48px targets', () => {
      const mockLoan = {
        id: 'loan-test-1',
        loanAccountNo: 'LN-2026-0042',
        customerName: 'Ramesh Verma',
        customerCode: 'CUST-RV-99',
        status: 'ACTIVE',
        outstandingBalance: 5000,
      };

      const html = renderToString(
        <RecordPaymentModal
          isOpen={true}
          preselectedLoan={mockLoan}
          onClose={() => {}}
          onSuccess={() => {}}
        />
      );

      // Verify numeric inputMode for numeric soft keyboard on mobile devices
      expect(html).toContain('inputMode="decimal"');

      // Verify touch targets for payment modes
      expect(html).toContain('payment-mode-btn-cash');
      expect(html).toContain('payment-mode-btn-upi');
      expect(html).toContain('payment-mode-btn-bank_transfer');
      expect(html).toContain('record-payment-review-btn');
      expect(html).toContain('height:48px');
    });
  });

  // =========================================================================
  // 6. CONTACT ACTIVITY & LOGGING FORM
  // =========================================================================
  describe('6. Streamlined Mobile Contact Activity Logging', () => {
    test('LogContactModal renders mobile single-page form with quick contact methods and outcomes', () => {
      const mockCustomer = {
        id: 'cust-test-1',
        fullName: 'Anil Sharma',
        customerCode: 'CUST-AS-01',
        primaryPhone: '9811122233',
        areaRoute: 'Kasna Sector 12',
      };

      const html = renderToString(
        <LogContactModal
          isOpen={true}
          forceMobileView={true}
          preselectedCustomer={mockCustomer}
          onClose={() => {}}
          onSuccess={() => {}}
        />
      );

      // Verify touch contact method selector tiles
      expect(html).toContain('mobile-contact-method-phone_call');
      expect(html).toContain('mobile-contact-method-in_person_visit');
      expect(html).toContain('mobile-contact-method-whatsapp');

      // Verify touch outcome options
      expect(html).toContain('mobile-outcome-answered_conversation_completed');
      expect(html).toContain('mobile-outcome-visit_completed');

      // Verify progressive commitment section
      expect(html).toContain('Customer Promised Payment');
      expect(html).toContain('mobile-has-commitment-checkbox');
    });

    test('ContactActivityView renders activity timeline and logging actions', () => {
      const html = renderToString(<ContactActivityView />);

      expect(html).toContain('Contact Timeline');
      expect(html).toContain('Log Contact');
      expect(html).toContain('All Contact Methods');
    });
  });
});
