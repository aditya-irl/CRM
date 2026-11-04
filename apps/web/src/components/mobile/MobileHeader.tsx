import React from 'react';
import { IUser, UserRole } from '@crm/shared';
import { BrandLogo } from '../BrandLogo';
import { NotificationBell } from '../NotificationBell';
import { Plus, Shield, Store, UserCheck, Menu } from 'lucide-react';

export interface MobileHeaderProps {
  user: IUser;
  onOpenAddCustomer?: () => void;
  onNavigateNotification?: (tab: string, params?: any) => void;
  onToggleMore: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  user,
  onOpenAddCustomer,
  onNavigateNotification,
  onToggleMore,
}) => {
  const isAdmin =
    user.role === UserRole.SUPER_ADMIN ||
    user.role === UserRole.ADMIN ||
    user.role === UserRole.BRANCH_MANAGER;
  const isDealer = user.role === UserRole.DEALER;

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return (
          <span className="badge badge-paid" style={{ fontSize: 9.5, padding: '2px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Shield size={9} /> Super Admin
          </span>
        );
      case UserRole.BRANCH_MANAGER:
        return (
          <span className="badge badge-due-today" style={{ fontSize: 9.5, padding: '2px 5px' }}>
            Branch Mgr
          </span>
        );
      case UserRole.DEALER:
        return (
          <span className="badge badge-upcoming" style={{ fontSize: 9.5, padding: '2px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Store size={9} /> Store
          </span>
        );
      case UserRole.COLLECTION_AGENT:
        return (
          <span className="badge badge-partial" style={{ fontSize: 9.5, padding: '2px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <UserCheck size={9} /> Field
          </span>
        );
      default:
        return <span className="badge badge-upcoming" style={{ fontSize: 9.5, padding: '2px 5px' }}>{role}</span>;
    }
  };

  return (
    <header
      className="crm-mobile-header"
      data-testid="crm-mobile-header"
      style={{
        display: 'none', // Controlled by responsive CSS media query
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'calc(8px + var(--sat, 0px)) 12px 8px',
        background: '#ffffff',
        borderBottom: '1px solid var(--border-subtle)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100vw',
      }}
    >
      {/* Left: Brand Logo & Role Pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <BrandLogo variant="horizontal" size="sm" showLegal={false} />
        {getRoleBadge(user.role)}
      </div>

      {/* Right: Quick Action Buttons, Notifications, and Profile Avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {/* Quick Add Customer Trigger for Admin or Dealer */}
        {onOpenAddCustomer && (isAdmin || isDealer) && (
          <button
            onClick={onOpenAddCustomer}
            className="btn btn-primary btn-sm"
            data-testid="mobile-header-add-customer-btn"
            title="Onboard Customer"
            aria-label="Add Customer"
            style={{
              padding: '6px 9px',
              minHeight: 36,
              minWidth: 36,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <Plus size={14} />
            <span style={{ fontSize: 11 }}>Add</span>
          </button>
        )}

        {/* Notifications Bell for Admin */}
        {isAdmin && (
          <NotificationBell user={user} onNavigate={onNavigateNotification} />
        )}

        {/* Tap Avatar / Menu Trigger to open More Sheet */}
        <button
          onClick={onToggleMore}
          data-testid="mobile-header-avatar-btn"
          aria-label="Open User Menu & Options"
          title={`${user.fullName} (${user.role})`}
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'var(--primary-subtle)',
            color: 'var(--primary)',
            border: '1.5px solid var(--primary-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 800,
            cursor: 'pointer',
            padding: 0,
            touchAction: 'manipulation',
            flexShrink: 0,
          }}
        >
          {user.fullName.charAt(0)}
        </button>
      </div>
    </header>
  );
};

