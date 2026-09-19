import React from 'react';
import { Home, Users, Activity, User } from 'lucide-react';

export type MobileTab = 'HOME' | 'CUSTOMERS' | 'ACTIVITY' | 'PROFILE';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onSelectTab: (tab: MobileTab) => void;
  pendingCount?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  pendingCount = 0,
}) => {
  const tabs: Array<{ id: MobileTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'HOME', label: 'Home', icon: <Home size={20} />, badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'CUSTOMERS', label: 'Customers', icon: <Users size={20} /> },
    { id: 'ACTIVITY', label: 'Activity', icon: <Activity size={20} /> },
    { id: 'PROFILE', label: 'Profile', icon: <User size={20} /> },
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map((t) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onSelectTab(t.id)}
            className={`bottom-nav-item ${isActive ? 'active' : ''}`}
            style={{ position: 'relative' }}
          >
            <div style={{ position: 'relative' }}>
              {t.icon}
              {t.badge && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -8,
                    background: 'var(--danger)',
                    color: '#ffffff',
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '1px 4px',
                    borderRadius: 8,
                    minWidth: 14,
                    textAlign: 'center',
                  }}
                >
                  {t.badge}
                </span>
              )}
            </div>
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
