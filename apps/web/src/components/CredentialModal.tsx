import React, { useState } from 'react';
import { KeyRound, Copy, Check, Eye, EyeOff, AlertCircle, Share2, X } from 'lucide-react';

export interface CredentialModalProps {
  title?: string;
  subtitle?: string;
  accountType?: 'DEALER' | 'AGENT';
  loginId: string;
  temporaryPassword: string;
  phone?: string | null;
  identifierLabel?: string; // e.g. "Dealer ID" or "Agent ID"
  identifierValue?: string | null;
  isReset?: boolean;
  onClose: () => void;
}

export const CredentialModal: React.FC<CredentialModalProps> = ({
  title,
  subtitle,
  accountType = 'DEALER',
  loginId,
  temporaryPassword,
  phone,
  identifierLabel,
  identifierValue,
  isReset = false,
  onClose,
}) => {
  const [showPassword, setShowPassword] = useState(true);
  const [copiedLoginId, setCopiedLoginId] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  const defaultTitle = isReset
    ? `${accountType === 'AGENT' ? 'Field Agent' : 'Dealer'} Password Reset`
    : `${accountType === 'AGENT' ? 'Field Agent' : 'Dealer'} Login Credentials`;

  const loginUrl = 'https://crm-two-orcin-18.vercel.app/login';

  const fullCredentialsText = `${defaultTitle}\n\n` +
    (subtitle ? `${accountType === 'AGENT' ? 'Agent' : 'Store'}: ${subtitle}\n` : '') +
    (identifierLabel && identifierValue ? `${identifierLabel}: ${identifierValue}\n` : '') +
    `Login ID: ${loginId}\n` +
    `Temporary Password: ${temporaryPassword}\n` +
    `Login URL: ${loginUrl}\n\n` +
    `Instruction: Please sign in using the temporary password above. You will be required to change your password immediately upon first login.`;

  const handleCopyPassword = () => {
    navigator.clipboard.writeText(temporaryPassword);
    setCopiedPass(true);
    setTimeout(() => setCopiedPass(false), 2500);
  };

  const handleCopyLoginId = () => {
    navigator.clipboard.writeText(loginId);
    setCopiedLoginId(true);
    setTimeout(() => setCopiedLoginId(false), 2500);
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(fullCredentialsText);
    setCopiedCredentials(true);
    setTimeout(() => setCopiedCredentials(false), 2500);
  };

  const handleWhatsAppShare = () => {
    const rawPhone = (phone || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
    const waUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(fullCredentialsText)}`
      : `https://wa.me/?text=${encodeURIComponent(fullCredentialsText)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="crm-card"
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#ffffff',
          borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          padding: 24,
          border: '1px solid var(--border-subtle)',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-md, 8px)',
                background: 'var(--primary-subtle, #e0f2fe)',
                color: 'var(--primary, #0284c7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <KeyRound size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                {title || defaultTitle}
              </h3>
              {subtitle && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {subtitle}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close credentials modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Security Warning */}
        <div
          style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            padding: '12px 14px',
            borderRadius: 'var(--radius-md, 8px)',
            fontSize: 12.5,
            color: 'var(--warning-text, #b45309)',
            marginBottom: 18,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            lineHeight: 1.5,
          }}
        >
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Notice:</strong> This temporary password is generated securely and visible only in this one-time modal.
            Copy or share it now. The user will be required to choose a new password upon first login.
          </div>
        </div>

        {/* Credential Details Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          {identifierLabel && identifierValue && (
            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase' }}>
                  {identifierLabel}
                </div>
                <div className="mono font-bold" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                  {identifierValue}
                </div>
              </div>
            </div>
          )}

          <div
            style={{
              background: 'var(--bg-surface-secondary)',
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase' }}>
                Login ID
              </div>
              <div className="mono font-bold" style={{ fontSize: 15, color: 'var(--text-primary)' }}>
                {loginId}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyLoginId}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {copiedLoginId ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
              <span>{copiedLoginId ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <div
            style={{
              background: 'var(--bg-surface-secondary)',
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Temporary Password
              </div>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                }}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                <span>{showPassword ? 'Hide' : 'Show'}</span>
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div
                className="mono font-bold"
                style={{
                  fontSize: 15,
                  color: 'var(--primary)',
                  wordBreak: 'break-all',
                  userSelect: 'all',
                  background: 'var(--bg-canvas, #f8fafc)',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px dashed var(--border-subtle)',
                  flex: 1,
                  letterSpacing: showPassword ? 'normal' : '0.2em',
                }}
              >
                {showPassword ? temporaryPassword : '••••••••••••••••••••••'}
              </div>
              <button
                type="button"
                onClick={handleCopyPassword}
                className="btn btn-secondary btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, height: 38 }}
              >
                {copiedPass ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
                <span>{copiedPass ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <button
              type="button"
              onClick={handleCopyPassword}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}
            >
              {copiedPass ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
              <span>{copiedPass ? 'Password Copied!' : 'Copy Password'}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyLoginId}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}
            >
              {copiedLoginId ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
              <span>{copiedLoginId ? 'Login ID Copied!' : 'Copy Login ID'}</span>
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <button
              type="button"
              onClick={handleCopyAll}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}
            >
              {copiedCredentials ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
              <span>{copiedCredentials ? 'Credentials Copied!' : 'Copy Credentials'}</span>
            </button>

            <button
              type="button"
              onClick={handleWhatsAppShare}
              className="btn btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontSize: 13,
                borderColor: 'var(--success, #16a34a)',
                color: 'var(--success, #16a34a)',
              }}
            >
              <Share2 size={14} />
              <span>Share on WhatsApp</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 8 }}
          >
            Done / Close
          </button>
        </div>
      </div>
    </div>
  );
};
