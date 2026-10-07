import React, { useState } from 'react';
import { IUser, UserRole, formatDateDDMMYYYY } from '@crm/shared';
import { ApiClient } from '../services/api';
import { LogOut, Play, CheckCircle2, Shield, Plus, Calendar, Store } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface NavbarProps {
  user: IUser;
  onLogout: () => void;
  onRefreshData?: () => void;
  onOpenAddCustomer?: () => void;
}

const NavbarComponent: React.FC<NavbarProps> = ({
  user,
  onLogout,
  onRefreshData,
  onOpenAddCustomer,
}) => {
  const [runningJob, setRunningJob] = useState(false);
  const [jobNotice, setJobNotice] = useState<string | null>(null);

  const handleTriggerJobs = async () => {
    setRunningJob(true);
    setJobNotice(null);
    try {
      const res = await ApiClient.triggerBackgroundJobs();
      if (res.skipped) {
        setJobNotice(res.message || 'Execution skipped: background job is already in progress.');
      } else {
        const dueToday = res.transition?.dueTodayUpdated ?? 0;
        const overdue = res.transition?.overdueUpdated ?? 0;
        const total = res.processed ?? (dueToday + overdue);
        setJobNotice(`Jobs processed: ${total} items (${dueToday} Due Today, ${overdue} Overdue).`);
      }
      if (onRefreshData) onRefreshData();
      setTimeout(() => setJobNotice(null), 5000);
    } catch (err: any) {
      alert(err.message || 'Failed to trigger background jobs');
    } finally {
      setRunningJob(false);
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return <span className="badge badge-paid"><Shield size={10} /> Super Admin</span>;
      case UserRole.BRANCH_MANAGER:
        return <span className="badge badge-due-today">Branch Manager</span>;
      case UserRole.COLLECTION_AGENT:
        return <span className="badge badge-partial">Field Agent</span>;
      case UserRole.DEALER:
        return <span className="badge badge-upcoming"><Store size={10} /> Store Partner</span>;
      default:
        return <span className="badge badge-upcoming">{role}</span>;
    }
  };

  const todayDateStr = formatDateDDMMYYYY(new Date().toISOString());

  return (
    <header
      style={{
        background: '#ffffff',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <BrandLogo variant="horizontal" size="sm" showLegal={true} />

        <div style={{ height: 20, width: 1, background: 'var(--border-subtle)' }} />

        {/* Current Business Date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <Calendar size={13} color="var(--primary)" />
          <span>Business Date: <strong>{todayDateStr}</strong></span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {jobNotice && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: 'var(--success-bg)',
              border: '1px solid var(--success-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--success-text)',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <CheckCircle2 size={13} />
            <span>{jobNotice}</span>
          </div>
        )}

        {onOpenAddCustomer && (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN || user.role === UserRole.BRANCH_MANAGER) && (
          <button
            onClick={onOpenAddCustomer}
            className="btn btn-primary btn-sm"
          >
            <Plus size={13} />
            <span>Add Customer</span>
          </button>
        )}

        {(user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) && (
          <button
            onClick={handleTriggerJobs}
            disabled={runningJob}
            className="btn btn-secondary btn-sm"
            title="Execute daily midnight EMI state transitions and reminder queues manually"
          >
            <Play size={12} color="var(--warning)" />
            <span>{runningJob ? 'Processing...' : 'Run Midnight Engine'}</span>
          </button>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '4px 10px',
            background: 'var(--bg-surface-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--primary-subtle)',
              color: 'var(--primary)',
              border: '1px solid var(--primary-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {user.fullName.charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{user.fullName}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {getRoleBadge(user.role)}
              {user.assignedBranch && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>• {user.assignedBranch}</span>}
            </div>
          </div>
        </div>

        <button onClick={onLogout} className="btn btn-secondary btn-sm" title="Sign out of system">
          <LogOut size={13} />
          <span>Exit</span>
        </button>
      </div>
    </header>
  );
};

export const Navbar = React.memo(NavbarComponent);
