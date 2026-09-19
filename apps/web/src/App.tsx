import React, { useState, useEffect } from 'react';
import { IUser, UserRole } from '@crm/shared';
import { ApiClient } from './services/api';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { LoginView } from './views/LoginView';
import { DashboardView } from './views/DashboardView';
import { QueueView } from './views/QueueView';
import { LoansView } from './views/LoansView';
import { CustomersView } from './views/CustomersView';
import { PaymentsView } from './views/PaymentsView';
import { ReportsView } from './views/ReportsView';
import { AuditView } from './views/AuditView';
import { AddCustomerWizard } from './components/AddCustomerWizard';

export const App: React.FC = () => {
  const [user, setUser] = useState<IUser | null>(ApiClient.getUser());
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [showAddCustomerWizard, setShowAddCustomerWizard] = useState(false);

  useEffect(() => {
    if (user) {
      if (user.role === UserRole.COLLECTION_AGENT) {
        setActiveTab('queue');
      } else {
        setActiveTab('dashboard');
      }
    }
  }, [user]);

  const handleLogout = () => {
    ApiClient.logout();
    setUser(null);
  };

  const handleLoginSuccess = () => {
    setUser(ApiClient.getUser());
  };

  if (!user) {
    return <LoginView onSuccess={handleLoginSuccess} />;
  }

  const renderView = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardView
            onOpenAddCustomer={() => setShowAddCustomerWizard(true)}
            onNavigateToTab={(t) => setActiveTab(t as NavTab)}
          />
        );
      case 'customers':
        return <CustomersView />;
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
          setActiveTab('customers');
        }}
      />
    </div>
  );
};
