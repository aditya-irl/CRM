import React, { useState, useEffect, Suspense, lazy } from 'react';
import { IUser, UserRole } from '@crm/shared';
import { ApiClient } from './services/api';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { LoginView } from './views/LoginView';
import { ChangePasswordView } from './views/ChangePasswordView';
import { DealerDashboardView } from './views/DealerDashboardView';

// Route-level code splitting for optimized bundle delivery
const DashboardView = lazy(() => import('./views/DashboardView').then((m) => ({ default: m.DashboardView })));
const DealersView = lazy(() => import('./views/DealersView').then((m) => ({ default: m.DealersView })));
const DealerCollectionsView = lazy(() => import('./views/DealerCollectionsView').then((m) => ({ default: m.DealerCollectionsView })));
const DealerSettlementsView = lazy(() => import('./views/DealerSettlementsView').then((m) => ({ default: m.DealerSettlementsView })));
const AgentCollectionsView = lazy(() => import('./views/AgentCollectionsView').then((m) => ({ default: m.AgentCollectionsView })));
const DirectCollectionsView = lazy(() => import('./views/DirectCollectionsView').then((m) => ({ default: m.DirectCollectionsView })));
const QueueView = lazy(() => import('./views/QueueView').then((m) => ({ default: m.QueueView })));
const LoansView = lazy(() => import('./views/LoansView').then((m) => ({ default: m.LoansView })));
const CustomersView = lazy(() => import('./views/CustomersView').then((m) => ({ default: m.CustomersView })));
const DevicesView = lazy(() => import('./views/DevicesView').then((m) => ({ default: m.DevicesView })));
const PaymentsView = lazy(() => import('./views/PaymentsView').then((m) => ({ default: m.PaymentsView })));
const ReportsView = lazy(() => import('./views/ReportsView').then((m) => ({ default: m.ReportsView })));
const AuditView = lazy(() => import('./views/AuditView').then((m) => ({ default: m.AuditView })));
const AddCustomerWizard = lazy(() => import('./components/AddCustomerWizard').then((m) => ({ default: m.AddCustomerWizard })));
const CustomerPortalView = lazy(() => import('./views/CustomerPortalView').then((m) => ({ default: m.CustomerPortalView })));
const AgentDashboardView = lazy(() => import('./views/AgentDashboardView').then((m) => ({ default: m.AgentDashboardView })));
const AgentsView = lazy(() => import('./views/AgentsView').then((m) => ({ default: m.AgentsView })));

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
    return <CustomerPortalView token={portalToken} />;
  }

  const [user, setUser] = useState<IUser | null>(ApiClient.getUser());
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedDealerIdForCollections, setSelectedDealerIdForCollections] = useState<string | null>(null);
  const [selectedDealerIdForSettlements, setSelectedDealerIdForSettlements] = useState<string | null>(null);
  const [selectedAgentIdForCollections, setSelectedAgentIdForCollections] = useState<string | null>(null);
  const [showAddCustomerWizard, setShowAddCustomerWizard] = useState(false);
  const [customersRefreshTrigger, setCustomersRefreshTrigger] = useState(0);

  useEffect(() => {
    if (user) {
      setActiveTab('dashboard');
    }
  }, [user]);

  const handleLogout = () => {
    ApiClient.logout();
    setUser(null);
  };

  const handleLoginSuccess = () => {
    setUser(ApiClient.getUser());
  };

  const handlePasswordChangeSuccess = (updatedUser: IUser) => {
    setUser(updatedUser);
    setActiveTab('dashboard');
  };

  const handleNavigateToDealerCollections = (dealerId?: string) => {
    setSelectedDealerIdForCollections(dealerId || null);
    setActiveTab('dealer-collections');
  };

  const handleNavigateToDealerSettlements = (dealerId?: string) => {
    setSelectedDealerIdForSettlements(dealerId || null);
    setActiveTab('dealer-settlements');
  };

  const handleNavigateToAgentCollections = (agentId?: string) => {
    setSelectedAgentIdForCollections(agentId || null);
    setActiveTab('agent-collections');
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
      !['dashboard', 'customers', 'devices', 'dealer-collections', 'dealer-settlements'].includes(activeTab)
    ) {
      return <DealerDashboardView onNavigateToTab={(t) => setActiveTab(t as NavTab)} />;
    }

    // If collection agent attempts to access admin-only tabs, redirect to agent dashboard
    const agentAllowedTabs: NavTab[] = ['dashboard', 'queue', 'customers', 'devices', 'loans', 'agent-collections'];
    if (isAgent && !agentAllowedTabs.includes(activeTab)) {
      return <AgentDashboardView onNavigateToTab={(t) => setActiveTab(t as NavTab)} />;
    }

    switch (activeTab) {
      case 'dashboard':
        if (isAgent) {
          return <AgentDashboardView onNavigateToTab={(t) => setActiveTab(t as NavTab)} />;
        }
        return isDealer ? (
          <DealerDashboardView onNavigateToTab={(t) => setActiveTab(t as NavTab)} />
        ) : (
          <DashboardView
            onOpenAddCustomer={() => setShowAddCustomerWizard(true)}
            onNavigateToTab={(t) => setActiveTab(t as NavTab)}
          />
        );
      case 'dealers':
        return (
          <DealersView
            onNavigateToCollections={handleNavigateToDealerCollections}
            onNavigateToSettlements={handleNavigateToDealerSettlements}
          />
        );
      case 'agents':
        return <AgentsView />;
      case 'dealer-collections':
        return (
          <DealerCollectionsView
            initialDealerId={isDealer ? (user.dealerId || undefined) : selectedDealerIdForCollections}
            onNavigateToDealers={() => setActiveTab('dealers')}
          />
        );
      case 'dealer-settlements':
        return (
          <DealerSettlementsView
            initialDealerId={isDealer ? (user.dealerId || undefined) : selectedDealerIdForSettlements}
            onNavigateToDealers={() => setActiveTab('dealers')}
            onNavigateToCollections={handleNavigateToDealerCollections}
          />
        );
      case 'agent-collections':
        return (
          <AgentCollectionsView
            initialAgentId={selectedAgentIdForCollections}
          />
        );
      case 'direct-collections':
        return <DirectCollectionsView />;
      case 'customers':
        return <CustomersView refreshTrigger={customersRefreshTrigger} />;
      case 'devices':
        return <DevicesView onNavigateToTab={(t) => setActiveTab(t as NavTab)} />;
      case 'queue':
        return <QueueView />;
      case 'loans':
        return <LoansView />;
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
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} user={user} />
        <main style={{ flex: 1, padding: 24, overflowY: 'auto', background: 'var(--bg-app)' }}>
          <Suspense fallback={<ViewFallback />}>
            {renderView()}
          </Suspense>
        </main>
      </div>

      {/* Global Add Customer Wizard */}
      <Suspense fallback={null}>
        <AddCustomerWizard
          isOpen={showAddCustomerWizard}
          onClose={() => setShowAddCustomerWizard(false)}
          onSuccess={() => {
            setShowAddCustomerWizard(false);
            setCustomersRefreshTrigger((prev) => prev + 1);
            setActiveTab('customers');
          }}
        />
      </Suspense>
    </div>
  );
};
