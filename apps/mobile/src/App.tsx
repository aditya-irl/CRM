import React, { useState } from 'react';
import { IUser } from '@crm/shared';
import { MobileApi } from './services/mobileApi';
import { MobileLogin } from './views/MobileLogin';
import { MobileQueue } from './views/MobileQueue';
import { MobileCustomersView } from './views/MobileCustomersView';
import { MobileActivityView } from './views/MobileActivityView';
import { MobileProfileView } from './views/MobileProfileView';
import { MobileBottomNav, MobileTab } from './components/MobileBottomNav';

export const App: React.FC = () => {
  const [user, setUser] = useState<IUser | null>(MobileApi.getUser());
  const [activeTab, setActiveTab] = useState<MobileTab>('HOME');

  const handleLogout = () => {
    MobileApi.logout();
    setUser(null);
  };

  const handleLoginSuccess = () => {
    setUser(MobileApi.getUser());
    setActiveTab('HOME');
  };

  React.useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
    };
    window.addEventListener('agent_auth_expired', handleAuthExpired);
    return () => {
      window.removeEventListener('agent_auth_expired', handleAuthExpired);
    };
  }, []);

  if (!user) {
    return <MobileLogin onSuccess={handleLoginSuccess} />;
  }

  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'HOME':
        return <MobileQueue user={user} onLogout={handleLogout} />;
      case 'CUSTOMERS':
        return <MobileCustomersView user={user} />;
      case 'ACTIVITY':
        return <MobileActivityView />;
      case 'PROFILE':
        return <MobileProfileView user={user} onLogout={handleLogout} />;
      default:
        return <MobileQueue user={user} onLogout={handleLogout} />;
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-mobile)', position: 'relative' }}>
      <main style={{ minHeight: '100vh' }}>
        {renderActiveScreen()}
      </main>

      {/* WhatsApp-simple Bottom Navigation */}
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
      />
    </div>
  );
};
