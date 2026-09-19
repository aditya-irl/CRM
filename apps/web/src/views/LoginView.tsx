import React, { useState } from 'react';
import { ApiClient } from '../services/api';
import { ShieldCheck, UserCheck, Lock, ArrowRight, Wallet, CheckCircle2 } from 'lucide-react';

interface LoginViewProps {
  onSuccess: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('admin@financecrm.com');
  const [password, setPassword] = useState('Admin@123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await ApiClient.login(email, password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-app)',
        padding: 20,
      }}
    >
      <div
        className="crm-card"
        style={{
          width: '100%',
          maxWidth: 440,
          padding: 36,
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 'var(--radius-md)',
              background: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: 20,
            }}
          >
            ₹
          </div>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Finance & Collection CRM
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Enterprise Loan, KYC & EMI Platform</p>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger-border)',
              color: 'var(--danger-text)',
              fontSize: 13,
              marginBottom: 18,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Work Email
            </label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Password
            </label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ marginTop: 4, width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : (
              <>
                <span>Sign In to Terminal</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

        {/* Demo Quick Logins */}
        <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border-subtle)' }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: 10,
            }}
          >
            Quick Preset Logins
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ justifyContent: 'space-between', padding: '7px 10px' }}
              onClick={() => handleDemoLogin('admin@financecrm.com', 'Admin@123456')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={13} color="var(--primary)" />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Super Admin (Vikram Malhotra)</span>
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Admin@123456</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ justifyContent: 'space-between', padding: '7px 10px' }}
              onClick={() => handleDemoLogin('agent.rahul@financecrm.com', 'Agent@123456')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <UserCheck size={13} color="var(--success)" />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Field Agent (Rahul Sharma)</span>
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Agent@123456</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ justifyContent: 'space-between', padding: '7px 10px' }}
              onClick={() => handleDemoLogin('manager@financecrm.com', 'Manager@123456')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Lock size={13} color="var(--warning)" />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Branch Manager (Anita Deshmukh)</span>
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Manager@123456</span>
            </button>
          </div>
        </div>

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          🔒 ACID Ledger Protected • Zero Discrepancies
        </div>
      </div>
    </div>
  );
};
