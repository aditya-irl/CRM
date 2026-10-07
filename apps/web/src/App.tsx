import React, { useState, useEffect } from 'react';
import { IUser, UserRole } from '@crm/shared';
import { ApiClient } from './services/api';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { LoginView } from './views/LoginView';
import { DashboardView } from './views/DashboardView';
import { DealersView } from './views/DealersView';
import { DealerCollectionsView } from './views/DealerCollectionsView';
import { DealerSettlementsView } from './views/DealerSettlementsView';
import { AgentCollectionsView } from './views/AgentCollectionsView';
import { DirectCollectionsView } from './views/DirectCollectionsView';
import { QueueView } from './views/QueueView';
import { LoansView } from './views/LoansView';
import { CustomersView } from './views/CustomersView';
import { DevicesView } from './views/DevicesView';
import { PaymentsView } from './views/PaymentsView';
import { ReportsView } from './views/ReportsView';
import { AuditView } from './views/AuditView';
import { AddCustomerWizard } from './components/AddCustomerWizard';
import { CustomerPortalView } from './views/CustomerPortalView';
import { DealerDashboardView } from './views/DealerDashboardView';
import { AgentDashboardView } from './views/AgentDashboardView';
import { AgentsView } from './views/AgentsView';
import { ChangePasswordView } from './views/ChangePasswordView';

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
      !['dashboard', 'customers', 'loans', 'dealer-collections', 'dealer-settlements'].includes(activeTab)
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
          {renderView()}
        </main>
      </div>

      {/* Global Add Customer Wizard */}
      <AddCustomerWizard
        isOpen={showAddCustomerWizard}
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
