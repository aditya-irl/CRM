import React, { useState, useEffect, Suspense, lazy } from 'react';
import { IUser, UserRole } from '@crm/shared';
import { ApiClient } from './services/api';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { LoginView } from './views/LoginView';
import { ChangePasswordView } from './views/ChangePasswordView';
import { DealerDashboardView } from './views/DealerDashboardView';
import { AddCustomerWizard } from './components/AddCustomerWizard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazyWithRetry } from './utils/lazyWithRetry';

// Route-level code splitting with resilient auto-retry and deployment update recovery
const DashboardView = lazyWithRetry(() => import('./views/DashboardView').then((m) => ({ default: m.DashboardView })));
const DealersView = lazyWithRetry(() => import('./views/DealersView').then((m) => ({ default: m.DealersView })));
const DealerCollectionsView = lazyWithRetry(() => import('./views/DealerCollectionsView').then((m) => ({ default: m.DealerCollectionsView })));
const DealerSettlementsView = lazyWithRetry(() => import('./views/DealerSettlementsView').then((m) => ({ default: m.DealerSettlementsView })));
const AgentCollectionsView = lazyWithRetry(() => import('./views/AgentCollectionsView').then((m) => ({ default: m.AgentCollectionsView })));
const DirectCollectionsView = lazyWithRetry(() => import('./views/DirectCollectionsView').then((m) => ({ default: m.DirectCollectionsView })));
const QueueView = lazyWithRetry(() => import('./views/QueueView').then((m) => ({ default: m.QueueView })));
const LoansView = lazyWithRetry(() => import('./views/LoansView').then((m) => ({ default: m.LoansView })));
const CustomersView = lazyWithRetry(() => import('./views/CustomersView').then((m) => ({ default: m.CustomersView })));
const DevicesView = lazyWithRetry(() => import('./views/DevicesView').then((m) => ({ default: m.DevicesView })));
const PaymentsView = lazyWithRetry(() => import('./views/PaymentsView').then((m) => ({ default: m.PaymentsView })));
const ReportsView = lazyWithRetry(() => import('./views/ReportsView').then((m) => ({ default: m.ReportsView })));
const AuditView = lazyWithRetry(() => import('./views/AuditView').then((m) => ({ default: m.AuditView })));
const CustomerPortalView = lazyWithRetry(() => import('./views/CustomerPortalView').then((m) => ({ default: m.CustomerPortalView })));
const AgentDashboardView = lazyWithRetry(() => import('./views/AgentDashboardView').then((m) => ({ default: m.AgentDashboardView })));
const AgentsView = lazyWithRetry(() => import('./views/AgentsView').then((m) => ({ default: m.AgentsView })));
const DealerPayablesView = lazyWithRetry(() => import('./views/DealerPayablesView').then((m) => ({ default: m.DealerPayablesView })));
const ContactActivityView = lazyWithRetry(() => import('./views/ContactActivityView').then((m) => ({ default: m.ContactActivityView })));

const getTabFromHash = (): NavTab | null => {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '').trim();
  const validTabs: NavTab[] = [
    'dashboard', 'dealers', 'agents', 'dealer-collections', 'dealer-settlements',
    'dealer-payables', 'agent-collections', 'contact-activity', 'direct-collections', 'customers',
    'devices', 'queue', 'loans', 'payments', 'reports', 'audit',
  ];
  return validTabs.includes(hash as NavTab) ? (hash as NavTab) : null;
};

const ViewFallback: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, color: 'var(--text-muted)' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div className="animate-spin" style={{ width: 22, height: 22, border: '2px solid var(--border-subtle)', borderTopColor: 'var(--primary)', borderRadius: '50%' }} />
      <span style={{ fontSize: 12, fontWeight: 500 }}>Loading section...</span>
    </div>
  </div>
);

export const App: React.FC = () => {
  // Public Customer Payment Portal Routing Check
  // Operates independently of admin authentication and never touches localStorage/sessionStorage
  const isPortalRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/portal') ||
      Boolean(new URLSearchParams(window.location.search).get('token')));

  if (isPortalRoute) {
    const portalToken = new URLSearchParams(window.location.search).get('token');
    return (
      <ErrorBoundary fallbackTitle="Portal View Interrupted">
        <Suspense fallback={<ViewFallback />}>
          <CustomerPortalView token={portalToken} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  const [user, setUser] = useState<IUser | null>(ApiClient.getUser());
  const [activeTab, setActiveTab] = useState<NavTab>(() => getTabFromHash() || 'dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedDealerIdForCollections, setSelectedDealerIdForCollections] = useState<string | null>(null);
  const [selectedDealerIdForSettlements, setSelectedDealerIdForSettlements] = useState<string | null>(null);
  const [selectedDealerIdForPayables, setSelectedDealerIdForPayables] = useState<string | null>(null);
  const [selectedAgentIdForCollections, setSelectedAgentIdForCollections] = useState<string | null>(null);
  const [showAddCustomerWizard, setShowAddCustomerWizard] = useState(false);
  const [customersRefreshTrigger, setCustomersRefreshTrigger] = useState(0);
  const [focusedLoanParams, setFocusedLoanParams] = useState<{ statusTab?: any; loanId?: string; search?: string } | null>(null);
  const [focusedDealerId, setFocusedDealerId] = useState<string | null>(null);

  const selectTab = (tab: NavTab, pushHistory = true) => {
    setActiveTab(tab);
    if (pushHistory && typeof window !== 'undefined') {
      if (window.location.hash !== `#${tab}`) {
        window.history.pushState({ tab }, '', `#${tab}`);
      }
    }
  };

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const targetTab = (e.state?.tab as NavTab) || getTabFromHash();
      if (targetTab) {
        setActiveTab(targetTab);
      }
    };
    const handleHashChange = () => {
      const targetTab = getTabFromHash();
      if (targetTab) {
        setActiveTab(targetTab);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handlePopState);
      window.addEventListener('hashchange', handleHashChange);
      if (!window.location.hash && activeTab) {
        window.history.replaceState({ tab: activeTab }, '', `#${activeTab}`);
      }
      return () => {
        window.removeEventListener('popstate', handlePopState);
        window.removeEventListener('hashchange', handleHashChange);
      };
    }
  }, [activeTab]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('crm_auth_expired', handleAuthExpired);
      return () => window.removeEventListener('crm_auth_expired', handleAuthExpired);
    }
  }, []);

  const handleLogout = () => {
    ApiClient.logout();
    setUser(null);
  };

  const handleLoginSuccess = () => {
    setUser(ApiClient.getUser());
  };

  const handlePasswordChangeSuccess = (updatedUser: IUser) => {
    setUser(updatedUser);
    selectTab('dashboard');
  };

  const handleNotificationNavigate = (
    tab: string,
    params?: { statusTab?: string; loanId?: string; dealerId?: string; search?: string }
  ) => {
    if (tab === 'loans') {
      setFocusedLoanParams({
        statusTab: params?.statusTab || 'PENDING_APPROVAL',
        loanId: params?.loanId,
        search: params?.search,
      });
      selectTab('loans');
    } else if (tab === 'dealers') {
      setFocusedDealerId(params?.dealerId || null);
      selectTab('dealers');
    } else {
      selectTab(tab as NavTab);
    }
  };

  const handleNavigateToDealerCollections = (dealerId?: string) => {
    setSelectedDealerIdForCollections(dealerId || null);
    selectTab('dealer-collections');
  };

  const handleNavigateToDealerSettlements = (dealerId?: string) => {
    setSelectedDealerIdForSettlements(dealerId || null);
    selectTab('dealer-settlements');
  };

  const handleNavigateToDealerPayables = (dealerId?: string) => {
    setSelectedDealerIdForPayables(dealerId || null);
    selectTab('dealer-payables');
  };

  const handleNavigateToAgentCollections = (agentId?: string) => {
    setSelectedAgentIdForCollections(agentId || null);
    selectTab('agent-collections');
  };

  if (!user) {
    return <LoginView onSuccess={handleLoginSuccess} />;
  }

  const isDealer = user.role === UserRole.DEALER;
  const isAgent = user.role === UserRole.COLLECTION_AGENT;
  const isForcedPasswordChange = Boolean(user.mustChangePassword);

  // Mandatory route guard: block all protected app functionality if user must change password
  if (isForcedPasswordChange) {
    return (
      <ChangePasswordView
        user={user}
        onSuccess={handlePasswordChangeSuccess}
        onLogout={handleLogout}
      />
    );
  }

  const renderView = () => {
    // Secondary defense: prevent any view rendering if password change required
    if (isForcedPasswordChange) {
      return (
        <ChangePasswordView
          user={user}
          onSuccess={handlePasswordChangeSuccess}
          onLogout={handleLogout}
        />
      );
    }

    // If dealer attempts to access unauthorized admin view, redirect to store dashboard
    if (
      isDealer &&
      !['dashboard', 'customers', 'devices', 'dealer-payables', 'dealer-collections', 'dealer-settlements'].includes(activeTab)
    ) {
      return <DealerDashboardView onNavigateToTab={(t) => selectTab(t as NavTab)} userRole={user.role} />;
    }

    // If collection agent attempts to access loans, customer onboarding, or admin-only tabs, redirect to collection dashboard
    const agentAllowedTabs: NavTab[] = ['dashboard', 'agent-collections'];
    if (isAgent && !agentAllowedTabs.includes(activeTab)) {
      return <AgentDashboardView onNavigateToTab={(t) => selectTab(t as NavTab)} />;
    }

    switch (activeTab) {
      case 'dashboard':
        if (isAgent) {
          return <AgentDashboardView onNavigateToTab={(t) => selectTab(t as NavTab)} />;
        }
        return isDealer ? (
          <DealerDashboardView onNavigateToTab={(t) => selectTab(t as NavTab)} userRole={user.role} />
        ) : (
          <DashboardView
            onOpenAddCustomer={() => setShowAddCustomerWizard(true)}
            onNavigateToTab={(t) => selectTab(t as NavTab)}
          />
        );
      case 'dealers':
        return (
          <DealersView
            onNavigateToCollections={handleNavigateToDealerCollections}
            onNavigateToSettlements={handleNavigateToDealerSettlements}
            onNavigateToPayables={handleNavigateToDealerPayables}
          />
        );
      case 'agents':
        return <AgentsView />;
      case 'dealer-payables':
        return (
          <DealerPayablesView
            initialDealerId={isDealer ? (user.dealerId || undefined) : selectedDealerIdForPayables}
            onNavigateToDealers={!isDealer ? () => selectTab('dealers') : undefined}
          />
        );
      case 'dealer-collections':
        return (
          <DealerCollectionsView
            initialDealerId={isDealer ? (user.dealerId || undefined) : selectedDealerIdForCollections}
            onNavigateToDealers={!isDealer ? () => selectTab('dealers') : undefined}
          />
        );
      case 'dealer-settlements':
        return (
          <DealerSettlementsView
            initialDealerId={isDealer ? (user.dealerId || undefined) : selectedDealerIdForSettlements}
            onNavigateToDealers={!isDealer ? () => selectTab('dealers') : undefined}
            onNavigateToCollections={handleNavigateToDealerCollections}
          />
        );
      case 'agent-collections':
        return (
          <AgentCollectionsView
            initialAgentId={selectedAgentIdForCollections}
          />
        );
      case 'contact-activity':
        return <ContactActivityView />;
      case 'direct-collections':
        return <DirectCollectionsView />;
      case 'customers':
        return <CustomersView refreshTrigger={customersRefreshTrigger} />;
      case 'devices':
        return <DevicesView onNavigateToTab={(t) => selectTab(t as NavTab)} />;
      case 'queue':
        return <QueueView />;
      case 'loans':
        return (
          <LoansView
            initialStatusTab={focusedLoanParams?.statusTab}
            initialSearch={focusedLoanParams?.search}
            focusLoanId={focusedLoanParams?.loanId}
          />
        );
      case 'payments':
        return <PaymentsView user={user} />;
      case 'reports':
        return <ReportsView />;
      case 'audit':
        return <AuditView />;
      default:
        return <QueueView />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Navbar
        user={user}
        onLogout={handleLogout}
        onOpenAddCustomer={() => setShowAddCustomerWizard(true)}
        onNavigate={handleNotificationNavigate}
        onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <Sidebar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            selectTab(tab);
            setMobileMenuOpen(false);
          }}
          user={user}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />
        <main className="main-content-container" style={{ flex: 1, padding: 24, overflowY: 'auto', background: 'var(--bg-app)' }}>
          <ErrorBoundary fallbackTitle="Workflow View Interrupted" onReset={() => selectTab('dashboard')}>
            <Suspense fallback={<ViewFallback />}>
              {renderView()}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Global Add Customer Wizard */}
      <AddCustomerWizard
        isOpen={showAddCustomerWizard && !isAgent}
        onClose={() => setShowAddCustomerWizard(false)}
        onSuccess={() => {
          setShowAddCustomerWizard(false);
          setCustomersRefreshTrigger((prev) => prev + 1);
          setActiveTab('customers');
        }}
      />
    </div>
  );
};
