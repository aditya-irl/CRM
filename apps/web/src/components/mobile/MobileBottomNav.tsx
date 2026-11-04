import React from 'react';
import { IUser, UserRole } from '@crm/shared';
import { NavTab } from '../Sidebar';
import {
  LayoutDashboard,
  CreditCard,
  Landmark,
  FileSpreadsheet,
  Users,
  Smartphone,
  Receipt,
  PhoneCall,
  Clock,
  Menu,
  LogOut,
} from 'lucide-react';

export interface MobileBottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  user: IUser;
  onOpenMore: () => void;
  onLogout?: () => void;
  isMoreOpen?: boolean;
  unreadNotificationsCount?: number;
}

interface BottomNavItem {
  id: NavTab | 'more' | 'logout';
  label: string;
  icon: React.ReactNode;
  isActive: (activeTab: NavTab, isMoreOpen?: boolean) => boolean;
  badge?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  user,
  onOpenMore,
  onLogout,
  isMoreOpen = false,
  unreadNotificationsCount = 0,
}) => {
  const isAgent = user.role === UserRole.COLLECTION_AGENT;
  const isDealer = user.role === UserRole.DEALER;

  const logoutItem: BottomNavItem = {
    id: 'logout',
    label: 'Logout',
    icon: <LogOut size={18} strokeWidth={2.2} />,
    isActive: () => false,
  };

  // 1. ADMIN / SUPER_ADMIN / BRANCH_MANAGER TABS
  // 1. Home (dashboard) | 2. Loans (loans) | 3. Collections (dealer-collections) | 4. Reports (reports) | 5. More | 6. Logout
  const adminTabs: BottomNavItem[] = [
    {
      id: 'dashboard',
      label: 'Home',
      icon: <LayoutDashboard size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'dashboard',
    },
    {
      id: 'loans',
      label: 'Loans',
      icon: <CreditCard size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'loans',
    },
    {
      id: 'dealer-collections',
      label: 'Collections',
      icon: <Landmark size={18} strokeWidth={2.2} />,
      isActive: (tab, more) =>
        !more &&
        ['dealer-collections', 'payments', 'agent-collections', 'direct-collections'].includes(tab),
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: <FileSpreadsheet size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'reports',
    },
    {
      id: 'more',
      label: 'More',
      icon: <Menu size={18} strokeWidth={2.2} />,
      isActive: (_tab, more) => Boolean(more),
      badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : undefined,
    },
    logoutItem,
  ];

  // 2. DEALER TABS
  // 1. Home (dashboard) | 2. Customers (customers) | 3. Loans (loans) | 4. Inventory (devices) | 5. More | 6. Logout
  const dealerTabs: BottomNavItem[] = [
    {
      id: 'dashboard',
      label: 'Home',
      icon: <LayoutDashboard size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'dashboard',
    },
    {
      id: 'customers',
      label: 'Customers',
      icon: <Users size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'customers',
    },
    {
      id: 'loans',
      label: 'Loans',
      icon: <CreditCard size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'loans',
    },
    {
      id: 'devices',
      label: 'Inventory',
      icon: <Smartphone size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'devices',
    },
    {
      id: 'more',
      label: 'More',
      icon: <Menu size={18} strokeWidth={2.2} />,
      isActive: (_tab, more) => Boolean(more),
    },
    logoutItem,
  ];

  // 3. COLLECTION AGENT TABS
  // 1. Home (dashboard) | 2. My Route (queue) | 3. Collections (agent-collections) | 4. Follow-ups (contact-activity) | 5. More | 6. Logout
  const agentTabs: BottomNavItem[] = [
    {
      id: 'dashboard',
      label: 'Home',
      icon: <LayoutDashboard size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'dashboard',
    },
    {
      id: 'queue',
      label: 'My Route',
      icon: <Clock size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'queue',
    },
    {
      id: 'agent-collections',
      label: 'Collections',
      icon: <Receipt size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'agent-collections',
    },
    {
      id: 'contact-activity',
      label: 'Follow-ups',
      icon: <PhoneCall size={18} strokeWidth={2.2} />,
      isActive: (tab, more) => !more && tab === 'contact-activity',
    },
    {
      id: 'more',
      label: 'More',
      icon: <Menu size={18} strokeWidth={2.2} />,
      isActive: (_tab, more) => Boolean(more),
    },
    logoutItem,
  ];

  const currentTabs = isAgent ? agentTabs : isDealer ? dealerTabs : adminTabs;

  return (
    <nav
      className="mobile-bottom-nav"
      data-testid="mobile-bottom-nav"
      aria-label="Mobile Navigation"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'calc(var(--mobile-nav-height, 58px) + var(--sab, 0px))',
        paddingBottom: 'var(--sab, 0px)',
        background: 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-around',
        zIndex: 1000,
        boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.05)',
        boxSizing: 'border-box',
        touchAction: 'manipulation',
      }}
    >
      {currentTabs.map((item) => {
        const active = item.isActive(activeTab, isMoreOpen);

        const handleClick = () => {
          if (item.id === 'more') {
            onOpenMore();
          } else if (item.id === 'logout') {
            if (onLogout) {
              onLogout();
            }
          } else {
            onSelectTab(item.id as NavTab);
          }
        };

        return (
          <button
            key={item.id}
            type="button"
            data-testid={`mobile-nav-tab-${item.id}`}
            onClick={handleClick}
            className={`mobile-bottom-nav-item ${active ? 'active' : ''} ${item.id === 'logout' ? 'logout-tab' : ''}`}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: active
                ? 'var(--primary)'
                : item.id === 'logout'
                ? 'var(--danger, #dc2626)'
                : 'var(--text-secondary)',
              padding: '4px 1px',
              minHeight: 48,
              minWidth: 0,
              position: 'relative',
              touchAction: 'manipulation',
              userSelect: 'none',
              WebkitTapHighlightColor: 'transparent',
              transition: 'all 0.15s ease',
            }}
          >
            {/* Active Pill Accent Indicator */}
            {active && (
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  width: 24,
                  height: 3,
                  borderRadius: '0 0 3px 3px',
                  background: 'var(--primary)',
                }}
              />
            )}

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {item.icon}
              {typeof item.badge === 'number' && item.badge > 0 && (
                <span
                  data-testid="mobile-nav-badge"
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -8,
                    background: 'var(--danger)',
                    color: '#ffffff',
                    fontSize: 9,
                    fontWeight: 800,
                    minWidth: 15,
                    height: 15,
                    borderRadius: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    lineHeight: 1,
                    border: '1.5px solid #ffffff',
                  }}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </div>

            <span
              style={{
                fontSize: 9.5,
                fontWeight: active ? 700 : 500,
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
                lineHeight: 1.1,
              }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
