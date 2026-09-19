import React, { useState } from 'react';
import { MobileApi } from '../services/mobileApi';
import { ArrowRight, UserCheck } from 'lucide-react';

interface MobileLoginProps {
  onSuccess: () => void;
}

export const MobileLogin: React.FC<MobileLoginProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('agent.rahul@financecrm.com');
  const [password, setPassword] = useState('Agent@123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await MobileApi.login(email, password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoAgent = (agentEmail: string) => {
    setEmail(agentEmail);
    setPassword('Agent@123456');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 20,
        backgroundColor: 'var(--bg-mobile)',
      }}
    >
      <div className="mobile-card" style={{ padding: '28px 20px', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-md)',
              background: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 10px',
              color: '#ffffff',
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            ₹
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>Field Collection CRM</h1>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Low-bandwidth field collection terminal
          </p>
        </div>

        {error && (
          <div
            style={{
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger-border)',
              color: 'var(--danger-text)',
              padding: 10,
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>
              Agent Phone or Email
            </label>
            <input
              type="text"
              className="mobile-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>
              PIN / Password
            </label>
            <input
              type="password"
              className="mobile-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading} className="mobile-btn mobile-btn-primary" style={{ marginTop: 6, fontSize: 14 }}>
            {loading ? 'Authenticating...' : (
              <>
                <span>Open Collection Queue</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

        {/* Preset demo buttons */}
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 8, textTransform: 'uppercase', fontWeight: 700 }}>
            Quick Demo Logins
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              className="mobile-btn mobile-btn-secondary"
              style={{ fontSize: 12, minHeight: 36 }}
              onClick={() => handleDemoAgent('agent.rahul@financecrm.com')}
            >
              <UserCheck size={13} color="var(--success)" />
              <span>Rahul Sharma (North Route)</span>
            </button>
            <button
              type="button"
              className="mobile-btn mobile-btn-secondary"
              style={{ fontSize: 12, minHeight: 36 }}
              onClick={() => handleDemoAgent('agent.priya@financecrm.com')}
            >
              <UserCheck size={13} color="var(--primary)" />
              <span>Priya Verma (East Route)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
