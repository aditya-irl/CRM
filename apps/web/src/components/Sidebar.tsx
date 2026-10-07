import React from 'react';
import { IUser, UserRole } from '@crm/shared';
import {
  LayoutDashboard,
  Users,
  Store,
  Clock,
  Banknote,
  Receipt,
  FileSpreadsheet,
  ShieldCheck,
  ShieldAlert,
  Landmark,
  CreditCard,
  UserCheck,
  Building2,
  Smartphone,
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'dealers'
  | 'agents'
  | 'dealer-collections'
  | 'dealer-settlements'
  | 'agent-collections'
  | 'direct-collections'
  | 'customers'
  | 'devices'
  | 'queue'
  | 'loans'
  | 'payments'
  | 'reports'
  | 'audit';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  user: IUser;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, user }) => {
  const isAgent = user.role === UserRole.COLLECTION_AGENT;
  const isDealer = user.role === UserRole.DEALER;

  const dealerAllowedTabs: NavTab[] = [
    'dashboard',
    'customers',
    'devices',
    'loans',
    'dealer-collections',
    'dealer-settlements',
  ];

  const items: Array<{ id: NavTab; label: string; icon: React.ReactNode; hiddenForAgent?: boolean }> = [
    {
      id: 'dashboard',
      label: isDealer ? 'Store Dashboard' : isAgent ? 'Recovery Dashboard' : 'Operations Dashboard',
      icon: isDealer ? <Store size={17} /> : <LayoutDashboard size={17} />,
    },
    { id: 'dealers', label: 'Dealer Stores', icon: <Store size={17} />, hiddenForAgent: true },
    { id: 'agents', label: 'Field Agents', icon: <UserCheck size={17} />, hiddenForAgent: true },
    {
      id: 'dealer-collections',
      label: isDealer ? 'Store Collections' : 'Dealer Collections',
      icon: <Landmark size={17} />,
      hiddenForAgent: true,
    },
    {
      id: 'dealer-settlements',
      label: isDealer ? 'Store Settlements' : 'Dealer Settlements',
      icon: <Banknote size={17} />,
      hiddenForAgent: true,
    },
    {
      id: 'agent-collections',
      label: isAgent ? 'My Collections' : 'Agent Collections',
      icon: <UserCheck size={17} />,
    },
    { id: 'direct-collections', label: 'Direct Collections', icon: <Building2 size={17} />, hiddenForAgent: true },
    {
      id: 'customers',
      label: isDealer ? 'Store Customers' : isAgent ? 'My Customers' : 'Customers & Profiles',
      icon: <Users size={17} />,
    },
    {
      id: 'devices',
      label: 'Financed Devices',
      icon: <Smartphone size={17} />,
    },
    {
      id: 'queue',
      label: isAgent ? 'Recovery Queue' : 'Collection Queue',
      icon: <Clock size={17} />,
    },
    {
      id: 'loans',
      label: isDealer ? 'Financed Devices' : isAgent ? 'My Loans' : 'Loans & EMI Terms',
      icon: <CreditCard size={17} />,
    },
    { id: 'payments', label: 'Payments Ledger', icon: <Receipt size={17} />, hiddenForAgent: true },
    { id: 'reports', label: 'Reports & Analytics', icon: <FileSpreadsheet size={17} />, hiddenForAgent: true },
    { id: 'audit', label: 'Audit Trail & Logs', icon: <ShieldCheck size={17} />, hiddenForAgent: true },
  ];

  return (
    <aside
      style={{
        width: 240,
        height: '100%',
        background: '#ffffff',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 12px',
        flexShrink: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          padding: '0 10px 14px',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}
      >
        {isDealer ? 'Partner Terminal' : 'Operations Menu'}
      </div>

      <nav
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: 4,
          scrollbarWidth: 'thin',
        }}
      >
        {items.map((item) => {
          if (isAgent && item.hiddenForAgent) return null;
          if (isDealer && !dealerAllowedTabs.includes(item.id)) return null;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 'var(--radius-md)',
                background: isActive ? 'var(--primary-subtle)' : 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                border: `1px solid ${isActive ? 'var(--primary-border)' : 'transparent'}`,
                cursor: 'pointer',
                textAlign: 'left',
                fontWeight: isActive ? 700 : 500,
                fontSize: 13,
                transition: 'all 0.12s ease',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'var(--bg-surface-secondary)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              <span style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Security & Ledger Status */}
      <div
        style={{
          marginTop: 12,
          flexShrink: 0,
          padding: 12,
          background: 'var(--bg-surface-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>
          <span>🔒 {isDealer ? 'Store Isolation Enforced' : 'ACID Ledger Protected'}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.3 }}>
          {isDealer ? 'Partner scoped • Row-level lock safety' : 'Decimal.js engine • Row-level lock safety'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 6, fontWeight: 600 }}>
          Alpha Mobile Gallery • Shubh Pvt Ltd
        </div>
      </div>
    </aside>
  );
};
