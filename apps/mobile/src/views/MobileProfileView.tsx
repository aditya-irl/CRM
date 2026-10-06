import React, { useEffect, useState } from 'react';
import { MobileApi } from '../services/mobileApi';
import { IUser, formatINR } from '@crm/shared';
import { User, ShieldCheck, MapPin, TrendingUp, LogOut, Wifi, CheckCircle2 } from 'lucide-react';

interface MobileProfileViewProps {
  user: IUser;
  onLogout: () => void;
}

export const MobileProfileView: React.FC<MobileProfileViewProps> = ({ user, onLogout }) => {
  const [stats, setStats] = useState<any | null>(null);

  useEffect(() => {
    MobileApi.getStats().then(setStats).catch(() => {});
  }, []);

  return (
    <div style={{ paddingBottom: 70, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          background: '#ffffff',
          padding: '16px 18px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>Field Agent Profile</h2>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        {/* Agent Info Card */}
        <div className="mobile-card" style={{ alignItems: 'center', textAlign: 'center', padding: '24px 16px' }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: 'var(--primary-subtle)',
              color: 'var(--primary)',
              border: '2px solid var(--primary-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 800,
              marginBottom: 8,
            }}
          >
            {user.fullName.charAt(0)}
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 800 }}>{user.fullName}</h3>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user.email}</div>
          <div style={{ marginTop: 6 }}>
            <span className="mobile-badge badge-paid">FIELD COLLECTION AGENT</span>
          </div>
        </div>

        {/* Assigned Branch / Route */}
        <div className="mobile-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
            <MapPin size={16} color="var(--primary)" />
            <span>Assigned Operational Route</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 24 }}>
            {user.assignedBranch || 'Sector-12 Market Route'}
          </div>
        </div>

        {/* Daily Recovery Target */}
        {stats && (
          <div className="mobile-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
              <TrendingUp size={16} color="var(--success)" />
              <span>Today's Recovery Target</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'center' }}>
              <div style={{ background: 'var(--bg-surface-secondary)', padding: 10, borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>TARGET</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--warning-text)' }}>
                  {formatINR(stats.todayTarget)}
                </div>
              </div>
              <div style={{ background: 'var(--bg-surface-secondary)', padding: 10, borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>COLLECTED</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--success-text)' }}>
                  {formatINR(stats.todayCollected)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Connection & Security */}
        <div className="mobile-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wifi size={14} color="var(--success)" />
              <span>Server Connection: Online</span>
            </div>
            <span className="mobile-badge badge-paid">ACID SAFE</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 6, textAlign: 'center' }}>
            Alpha Mobile Gallery • Shubh Pvt Ltd
          </div>
        </div>

        {/* Logout Button */}
        <div style={{ marginTop: 'auto', paddingTop: 10 }}>
          <button
            onClick={onLogout}
            className="mobile-btn mobile-btn-secondary"
            style={{ width: '100%', color: 'var(--danger-text)' }}
          >
            <LogOut size={16} />
            <span>Sign Out from Device</span>
          </button>
        </div>
      </div>
    </div>
  );
};
