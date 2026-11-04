import React, { useState, useEffect } from 'react';
import { IUser, UserRole, WHATSAPP_SUPPORT_CONFIG, buildWhatsAppSupportUrl } from '@crm/shared';
import { NavTab } from '../Sidebar';
import {
  X,
  Store,
  UserCheck,
  Smartphone,
  ShieldCheck,
  Settings,
  LogOut,
  Receipt,
  Building2,
  Banknote,
  CreditCard,
  MessageCircle,
  User,
  MapPin,
  ChevronRight,
  Shield,
  KeyRound,
  Info,
  CheckCircle2,
} from 'lucide-react';

export interface MobileMoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: NavTab) => void;
  user: IUser;
  onLogout: () => void;
  activeTab?: NavTab;
  onOpenSettingsModal?: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  badge?: string;
  isExternal?: boolean;
}

export const MobileMoreSheet: React.FC<MobileMoreSheetProps> = ({
  isOpen,
  onClose,
  onSelectTab,
  user,
  onLogout,
  activeTab,
  onOpenSettingsModal,
}) => {
  const [showProfileCard, setShowProfileCard] = useState(false);
  const isAgent = user.role === UserRole.COLLECTION_AGENT;
  const isDealer = user.role === UserRole.DEALER;

  // Handle ESC key to dismiss sheet
  useEffect(() => {
    if (!isOpen) {
      setShowProfileCard(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const navigateAndClose = (tab: NavTab) => {
    onSelectTab(tab);
    onClose();
  };

  const openWhatsAppSupport = () => {
    const url = buildWhatsAppSupportUrl(WHATSAPP_SUPPORT_CONFIG.defaultPortalMessage);
    window.open(url, '_blank', 'noopener,noreferrer');
    onClose();
  };

  // 1. ADMIN / SUPER_ADMIN / BRANCH_MANAGER ITEMS
  const adminMenuItems: MenuItem[] = [
    {
      id: 'dealers',
      label: 'Dealer Stores',
      description: 'Manage retail partners, approvals & stores',
      icon: <Store size={18} color="var(--primary)" />,
      action: () => navigateAndClose('dealers'),
    },
    {
      id: 'agents',
      label: 'Field Recovery Agents',
      description: 'Agent roster, login provisioning & routes',
      icon: <UserCheck size={18} color="var(--primary)" />,
      action: () => navigateAndClose('agents'),
    },
    {
      id: 'devices',
      label: 'Financed Devices',
      description: 'IMEI inventory, lock status & device records',
      icon: <Smartphone size={18} color="var(--primary)" />,
      action: () => navigateAndClose('devices'),
    },
    {
      id: 'payments',
      label: 'Payments Master Ledger',
      description: 'Unified collection records, receipts & reversals',
      icon: <Receipt size={18} color="var(--primary)" />,
      action: () => navigateAndClose('payments'),
    },
    {
      id: 'direct-collections',
      label: 'Direct Collections',
      description: 'Head-office direct walk-in collections',
      icon: <Building2 size={18} color="var(--primary)" />,
      action: () => navigateAndClose('direct-collections'),
    },
    {
      id: 'audit',
      label: 'Audit Trail & Logs',
      description: 'Tamper-evident ACID financial security logs',
      icon: <ShieldCheck size={18} color="var(--primary)" />,
      action: () => navigateAndClose('audit'),
    },
    {
      id: 'settings',
      label: 'Account & Security Settings',
      description: 'Password change & administrator profile',
      icon: <Settings size={18} color="var(--primary)" />,
      action: () => {
        if (onOpenSettingsModal) {
          onOpenSettingsModal();
          onClose();
        } else {
          setShowProfileCard(true);
        }
      },
    },
  ];

  // 2. DEALER ITEMS
  const dealerMenuItems: MenuItem[] = [
    {
      id: 'dealer-settlements',
      label: 'Store Settlements',
      description: 'Remittances transferred to Finance Company',
      icon: <Banknote size={18} color="var(--primary)" />,
      action: () => navigateAndClose('dealer-settlements'),
    },
    {
      id: 'dealer-payables',
      label: 'Company Payments',
      description: 'Funds disbursed to store for financed devices',
      icon: <CreditCard size={18} color="var(--primary)" />,
      action: () => navigateAndClose('dealer-payables'),
    },
    {
      id: 'dealer-collections',
      label: 'Store Collections Ledger',
      description: 'Customer EMI payments received at store',
      icon: <Receipt size={18} color="var(--primary)" />,
      action: () => navigateAndClose('dealer-collections'),
    },
    {
      id: 'dealer-support',
      label: 'WhatsApp Partner Support',
      description: `${WHATSAPP_SUPPORT_CONFIG.displayName} (${WHATSAPP_SUPPORT_CONFIG.formattedPhone})`,
      icon: <MessageCircle size={18} color="#16a34a" />,
      action: openWhatsAppSupport,
      badge: 'Help',
      isExternal: true,
    },
    {
      id: 'dealer-profile',
      label: 'Store Partner Profile',
      description: 'Store isolation & registered terminal details',
      icon: <Store size={18} color="var(--primary)" />,
      action: () => setShowProfileCard(true),
    },
  ];

  // 3. COLLECTION AGENT ITEMS
  const agentMenuItems: MenuItem[] = [
    {
      id: 'agent-profile',
      label: 'Field Officer Profile',
      description: 'Identity credentials & recovery authority',
      icon: <User size={18} color="var(--primary)" />,
      action: () => setShowProfileCard(true),
    },
    {
      id: 'agent-route',
      label: 'Assigned Route Information',
      description: user.assignedBranch || 'Assigned Operational Sector',
      icon: <MapPin size={18} color="var(--primary)" />,
      action: () => setShowProfileCard(true),
      badge: 'Active Route',
    },
    {
      id: 'agent-helpdesk',
      label: 'WhatsApp Operations Helpdesk',
      description: 'Instant assistance for field issues & receipts',
      icon: <MessageCircle size={18} color="#16a34a" />,
      action: openWhatsAppSupport,
      badge: 'Online',
      isExternal: true,
    },
  ];

  const currentMenuItems = isAgent ? agentMenuItems : isDealer ? dealerMenuItems : adminMenuItems;

  const getRoleLabel = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return 'Super Admin';
      case UserRole.ADMIN:
        return 'Administrator';
      case UserRole.BRANCH_MANAGER:
        return 'Branch Manager';
      case UserRole.DEALER:
        return 'Store Partner';
      case UserRole.COLLECTION_AGENT:
        return 'Field Collection Officer';
      default:
        return role;
    }
  };

  return (
    <div
      className="mobile-more-sheet-portal"
      data-testid="mobile-more-sheet-portal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1060,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <div
        className="mobile-more-sheet-backdrop"
        data-testid="mobile-more-sheet-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(28, 30, 33, 0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 1061,
          animation: 'fadeInOverlay 0.2s ease',
        }}
        aria-label="Close menu sheet"
      />

      {/* Sheet Content Card */}
      <div
        className="mobile-more-sheet-content"
        data-testid="mobile-more-sheet-content"
        role="dialog"
        aria-modal="true"
        aria-label="Application Menu & Options"
        style={{
          position: 'relative',
          zIndex: 1062,
          background: '#ffffff',
          borderRadius: 'var(--radius-xl, 16px) var(--radius-xl, 16px) 0 0',
          boxShadow: '0 -8px 32px rgba(0, 0, 0, 0.2)',
          maxHeight: 'calc(88dvh - var(--sat, 0px))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          paddingBottom: 'calc(16px + var(--sab, 0px))',
          boxSizing: 'border-box',
          animation: 'slideUpSheet 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Pull Drag Indicator */}
        <div style={{ padding: '8px 0 4px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <div
            style={{
              width: 38,
              height: 4,
              borderRadius: 2,
              background: 'var(--border-strong, #b5ac9d)',
              opacity: 0.7,
            }}
          />
        </div>

        {/* Sheet Header: User Identity Banner */}
        <div
          style={{
            padding: '10px 16px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface-secondary)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--primary-subtle)',
                color: 'var(--primary)',
                border: '1.5px solid var(--primary-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {user.fullName.charAt(0)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.fullName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                <span className="badge badge-paid" style={{ fontSize: 10, padding: '1px 6px' }}>
                  {getRoleLabel(user.role)}
                </span>
                {user.assignedBranch && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>• {user.assignedBranch}</span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="mobile-sheet-close-btn"
            data-testid="mobile-sheet-close-btn"
            aria-label="Close Menu"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: '#ffffff',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              touchAction: 'manipulation',
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Menu Items Container */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '6px 0',
          }}
        >
          {/* Profile Card Overlay if toggled */}
          {showProfileCard && (
            <div
              style={{
                margin: '10px 14px',
                padding: 14,
                borderRadius: 'var(--radius-lg, 12px)',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {isDealer ? 'Store Terminal Overview' : isAgent ? 'Agent Route Credentials' : 'Administrator Context'}
                </span>
                <button
                  onClick={() => setShowProfileCard(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  Hide
                </button>
              </div>

              <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Login Identifier: </span>
                  <strong className="mono">{user.phone || user.email}</strong>
                </div>
                {user.dealerId && (
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Store ID: </span>
                    <span className="mono">{user.dealerId}</span>
                  </div>
                )}
                {user.assignedBranch && (
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Operational Zone: </span>
                    <strong>{user.assignedBranch}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--success-text)', marginTop: 2 }}>
                  <Shield size={12} />
                  <span>{isDealer ? 'Partner Isolated • Row-level lock safety' : 'ACID Protected • Token Authenticated'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Menu Items List */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {currentMenuItems.map((item) => {
              const isItemActive = activeTab === (item.id as NavTab);

              return (
                <button
                  key={item.id}
                  data-testid={`more-sheet-item-${item.id}`}
                  onClick={item.action}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 18px',
                    minHeight: 52,
                    background: isItemActive ? 'var(--primary-subtle)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    touchAction: 'manipulation',
                    transition: 'background 0.12s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 'var(--radius-md, 8px)',
                        background: isItemActive ? '#ffffff' : 'var(--bg-surface-secondary)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: isItemActive ? 800 : 700, color: isItemActive ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {item.label}
                        </span>
                        {item.badge && (
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              background: '#dcfce7',
                              color: '#15803d',
                              padding: '1px 6px',
                              borderRadius: 10,
                            }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.description}
                        </span>
                      )}
                    </div>
                  </div>

                  <ChevronRight size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginLeft: 8 }} />
                </button>
              );
            })}
          </div>

          {/* Destructive Section: Sign Out */}
          <div style={{ padding: '12px 16px 6px' }}>
            <button
              onClick={() => {
                onClose();
                onLogout();
              }}
              data-testid="more-sheet-logout-btn"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 16px',
                minHeight: 48,
                borderRadius: 'var(--radius-md, 8px)',
                background: 'var(--danger-bg, #fee2e2)',
                color: 'var(--danger-text, #991b1b)',
                border: '1px solid var(--danger-border, #fecaca)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              <LogOut size={16} />
              <span>Sign Out of Account</span>
            </button>
          </div>

          {/* Legal / System Badge */}
          <div style={{ padding: '8px 16px', textAlign: 'center', fontSize: 10.5, color: 'var(--text-muted)' }}>
            Alpha Mobile Gallery • Shubh Pvt Ltd Enterprise FinTech
          </div>
        </div>
      </div>
    </div>
  );
};
