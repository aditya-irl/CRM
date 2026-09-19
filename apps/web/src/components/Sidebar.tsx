import React from 'react';
import { IUser, UserRole } from '@crm/shared';
import {
  LayoutDashboard,
  Users,
  Clock,
  Banknote,
  Receipt,
  FileSpreadsheet,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

export type NavTab = 'dashboard' | 'customers' | 'queue' | 'loans' | 'payments' | 'reports' | 'audit';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  user: IUser;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, user }) => {
  const isAgent = user.role === UserRole.COLLECTION_AGENT;

  const items: Array<{ id: NavTab; label: string; icon: React.ReactNode; hiddenForAgent?: boolean }> = [
    { id: 'dashboard', label: 'Operations Dashboard', icon: <LayoutDashboard size={17} />, hiddenForAgent: true },
    { id: 'customers', label: 'Customers & Devices', icon: <Users size={17} /> },
    { id: 'queue', label: 'Collection Queue', icon: <Clock size={17} /> },
    { id: 'loans', label: 'Loans & EMI Terms', icon: <Banknote size={17} /> },
    { id: 'payments', label: 'Payments Ledger', icon: <Receipt size={17} /> },
    { id: 'reports', label: 'Reports & Analytics', icon: <FileSpreadsheet size={17} />, hiddenForAgent: true },
    { id: 'audit', label: 'Audit Trail & Logs', icon: <ShieldCheck size={17} />, hiddenForAgent: true },
  ];

  return (
    <aside
      style={{
        width: 240,
        background: '#ffffff',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 12px',
        flexShrink: 0,
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
        }}
      >
        Operations Menu
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map((item) => {
          if (isAgent && item.hiddenForAgent) return null;
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
          marginTop: 'auto',
          padding: 12,
          background: 'var(--bg-surface-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>
          <span>🔒 ACID Ledger Protected</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.3 }}>
          Decimal.js engine • Row-level lock safety
        </div>
      </div>
    </aside>
  );
};
