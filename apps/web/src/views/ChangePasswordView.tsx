import React, { useState } from 'react';
import { IUser } from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  KeyRound,
  Eye,
  EyeOff,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  LogOut,
  Store,
} from 'lucide-react';

interface ChangePasswordViewProps {
  user: IUser;
  onSuccess: (updatedUser: IUser) => void;
  onLogout: () => void;
}

export const ChangePasswordView: React.FC<ChangePasswordViewProps> = ({
  user,
  onSuccess,
  onLogout,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Client-side validations
    if (!currentPassword.trim()) {
      setError('Please enter your current temporary password.');
      return;
    }

    if (!newPassword) {
      setError('Please enter a new permanent password.');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setError('New password cannot be identical to your temporary password.');
      return;
    }

    setLoading(true);

    try {
      const res = await ApiClient.changePassword(currentPassword, newPassword);
      setSuccess(res.message || 'Password changed successfully! Redirecting...');

      const updatedUser = ApiClient.getUser() || {
        ...user,
        mustChangePassword: false,
      };

      // Allow brief moment for user to see success state before proceeding to dashboard
      setTimeout(() => {
        onSuccess(updatedUser);
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Failed to change password. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-testid="forced-change-password-screen"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-app)',
        padding: 24,
      }}
    >
      <div
        className="crm-card"
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '36px 32px',
          boxShadow: 'var(--shadow-modal)',
          position: 'relative',
        }}
      >
        {/* Security Alert Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 'var(--radius-md)',
              background: 'var(--primary-subtle)',
              border: '1px solid var(--primary-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
              flexShrink: 0,
            }}
          >
            <KeyRound size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--warning-bg)',
                  border: '1px solid var(--warning-border)',
                  color: 'var(--warning-text)',
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <ShieldAlert size={12} />
                Security Requirement
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <Store size={12} />
                {user.fullName}
              </span>
            </div>
            <h2
              style={{
                fontSize: 19,
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                lineHeight: 1.25,
              }}
            >
              Temporary Password Reset
            </h2>
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                marginTop: 4,
                lineHeight: 1.4,
              }}
            >
              For security compliance, you must set a permanent password before accessing store
              operations, loan accounts, and settlement ledgers.
            </p>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div
            data-testid="change-password-error"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger-border)',
              color: 'var(--danger-text)',
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 20,
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>{error}</div>
          </div>
        )}

        {/* Success Banner */}
        {success && (
          <div
            data-testid="change-password-success"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--success-bg)',
              border: '1px solid var(--success-border)',
              color: 'var(--success-text)',
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 20,
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>{success}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Current Password */}
          <div>
            <label
              htmlFor="current-password"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-secondary)',
                marginBottom: 5,
              }}
            >
              Current Temporary Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="current-password"
                data-testid="current-password-input"
                type={showCurrentPassword ? 'text' : 'password'}
                className="form-input"
                style={{ paddingRight: 40, width: '100%' }}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your temporary password"
                disabled={loading || Boolean(success)}
                required
              />
              <button
                type="button"
                data-testid="toggle-current-password"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                tabIndex={-1}
                aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
              >
                {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              The temporary password provided by system administration.
            </p>
          </div>

          {/* New Password */}
          <div>
            <label
              htmlFor="new-password"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-secondary)',
                marginBottom: 5,
              }}
            >
              New Permanent Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="new-password"
                data-testid="new-password-input"
                type={showNewPassword ? 'text' : 'password'}
                className="form-input"
                style={{ paddingRight: 40, width: '100%' }}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                disabled={loading || Boolean(success)}
                required
              />
              <button
                type="button"
                data-testid="toggle-new-password"
                onClick={() => setShowNewPassword(!showNewPassword)}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                tabIndex={-1}
                aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Must be at least 6 characters. Use letters, numbers & symbols.
            </p>
          </div>

          {/* Confirm New Password */}
          <div>
            <label
              htmlFor="confirm-password"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-secondary)',
                marginBottom: 5,
              }}
            >
              Confirm New Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="confirm-password"
                data-testid="confirm-password-input"
                type={showConfirmPassword ? 'text' : 'password'}
                className="form-input"
                style={{ paddingRight: 40, width: '100%' }}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type your new password"
                disabled={loading || Boolean(success)}
                required
              />
              <button
                type="button"
                data-testid="toggle-confirm-password"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                tabIndex={-1}
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Submit Action Button */}
          <button
            type="submit"
            data-testid="submit-change-password"
            className="btn btn-primary btn-lg"
            style={{
              marginTop: 8,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
            disabled={loading || Boolean(success)}
          >
            {loading ? (
              <span>Updating Password...</span>
            ) : success ? (
              <>
                <CheckCircle2 size={16} />
                <span>Redirecting to Dashboard...</span>
              </>
            ) : (
              <>
                <span>Set Permanent Password & Enter</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Safe Sign Out / Exit */}
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Need to complete this later?
          </span>
          <button
            type="button"
            data-testid="logout-button"
            onClick={onLogout}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <LogOut size={13} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
