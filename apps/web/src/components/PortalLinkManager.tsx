import React, { useEffect, useState, useCallback } from 'react';
import { ApiClient, IPortalLinkStatus } from '../services/api';
import { UserRole, formatDateDDMMYYYY } from '@crm/shared';
import {
  Link as LinkIcon,
  Copy,
  Check,
  RefreshCw,
  XCircle,
  MessageCircle,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Calendar,
} from 'lucide-react';

export interface PortalLinkManagerProps {
  loanId: string;
  loanAccountNo: string;
  customerName?: string;
  primaryPhone?: string;
  userRole?: UserRole;
  onStatusChange?: () => void;
  initialStatus?: IPortalLinkStatus | null;
  initialConfirmAction?: 'regenerate' | 'revoke' | null;
}

export const PortalLinkManager: React.FC<PortalLinkManagerProps> = ({
  loanId,
  loanAccountNo,
  customerName,
  primaryPhone,
  userRole,
  onStatusChange,
  initialStatus,
  initialConfirmAction,
}) => {
  const [status, setStatus] = useState<IPortalLinkStatus | null>(initialStatus !== undefined ? initialStatus : null);
  const [loading, setLoading] = useState(initialStatus === undefined);
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(initialStatus?.portalUrl || null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Confirmation state for destructive actions
  const [confirmAction, setConfirmAction] = useState<'regenerate' | 'revoke' | null>(initialConfirmAction || null);

  // Permissions: Super Admin, Admin, Branch Manager can manage links
  // Collection agents can only view or copy if an active link exists
  const canManage =
    userRole === UserRole.SUPER_ADMIN ||
    userRole === UserRole.ADMIN ||
    userRole === UserRole.BRANCH_MANAGER ||
    !userRole; // Default permissive if role not passed directly

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiClient.getPortalLinkStatus(loanId);
      setStatus(res);
      if (res.portalUrl) {
        setActiveUrl(res.portalUrl);
      }
    } catch (err: any) {
      // If 403 or 404, capture safely
      setNotice({
        type: 'error',
        message: err.message || 'Unable to load portal link status',
      });
    } finally {
      setLoading(false);
    }
  }, [loanId]);

  useEffect(() => {
    if (initialStatus === undefined) {
      fetchStatus();
    }
  }, [fetchStatus, initialStatus]);

  const copyToClipboard = async (text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      setNotice({ type: 'success', message: 'Portal link copied to clipboard!' });
      setTimeout(() => setNotice(null), 4000);
    } catch {
      setNotice({ type: 'error', message: 'Failed to copy to clipboard' });
    }
  };

  // Copy or Generate & Copy
  const handleCopyLink = async () => {
    setNotice(null);
    if (activeUrl) {
      await copyToClipboard(activeUrl);
      return;
    }

    if (!canManage && !status?.hasActiveLink) {
      setNotice({
        type: 'error',
        message: 'Only Administrators and Branch Managers can generate new customer portal links.',
      });
      return;
    }

    setActionLoading(true);
    try {
      const res = await ApiClient.generatePortalLink(loanId);
      setActiveUrl(res.portalUrl);
      await copyToClipboard(res.portalUrl);
      await fetchStatus();
      if (onStatusChange) onStatusChange();
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: err.message || 'Failed to generate portal link',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Regenerate action (after confirmation)
  const handleConfirmRegenerate = async () => {
    setConfirmAction(null);
    setNotice(null);
    setActionLoading(true);
    try {
      const res = await ApiClient.regeneratePortalLink(loanId);
      setActiveUrl(res.portalUrl);
      await copyToClipboard(res.portalUrl);
      setNotice({
        type: 'success',
        message: 'New portal link generated and copied to clipboard! Previous link has been invalidated.',
      });
      await fetchStatus();
      if (onStatusChange) onStatusChange();
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: err.message || 'Failed to regenerate portal link',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Revoke action (after confirmation)
  const handleConfirmRevoke = async () => {
    setConfirmAction(null);
    setNotice(null);
    setActionLoading(true);
    try {
      await ApiClient.revokePortalLink(loanId);
      setActiveUrl(null);
      setNotice({
        type: 'success',
        message: 'Customer portal access has been revoked for this loan.',
      });
      await fetchStatus();
      if (onStatusChange) onStatusChange();
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: err.message || 'Failed to revoke portal link',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Send via WhatsApp
  const handleSendWhatsApp = () => {
    if (!primaryPhone) return;
    const cleanPhone = primaryPhone.replace(/\D/g, '');
    const urlToSend = activeUrl;

    if (!urlToSend) {
      // First generate/copy, then trigger WhatsApp
      handleCopyLink();
      return;
    }

    const msg = `Dear ${customerName || 'Customer'}, here is your secure payment portal link for Loan ${loanAccountNo}: ${urlToSend}\nYou can view your installment schedule and pay conveniently.`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 20,
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* ─── Header & Status ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LinkIcon size={16} />
          </div>
          <div>
            <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Customer Payment Portal Link
            </h4>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Direct access link for customer to view EMIs and pay via WhatsApp QR
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div>
          {loading ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Checking status...</span>
          ) : status?.hasActiveLink ? (
            <span className="badge badge-paid">
              <ShieldCheck size={11} /> Active Portal Link
            </span>
          ) : (
            <span className="badge badge-upcoming">
              <AlertTriangle size={11} /> No Active Link
            </span>
          )}
        </div>
      </div>

      {/* ─── Notice / Feedback Banner ───────────────────────────────────── */}
      {notice && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: notice.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: notice.type === 'success' ? 'var(--success-text)' : 'var(--danger-text)',
            border: `1px solid ${notice.type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
          }}
        >
          {notice.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* ─── Link Status Metadata ───────────────────────────────────────── */}
      {status && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            fontSize: 12,
          }}
        >
          <div>
            <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Link Status:</span>
            <strong style={{ color: status.hasActiveLink ? 'var(--success-text)' : 'var(--text-muted)' }}>
              {status.hasActiveLink ? 'Enabled & Active' : 'Not Issued / Inactive'}
            </strong>
          </div>
          {status.createdAt && (
            <div>
              <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Created On:</span>
              <strong style={{ color: 'var(--text-primary)' }}>
                {formatDateDDMMYYYY(status.createdAt)}
              </strong>
            </div>
          )}
          <div>
            <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Customer Last Access:</span>
            <strong style={{ color: status.lastAccessedAt ? 'var(--primary)' : 'var(--text-muted)' }}>
              {status.lastAccessedAt
                ? formatDateDDMMYYYY(status.lastAccessedAt)
                : 'Not yet opened'}
            </strong>
          </div>
          {!status.hasActiveLink && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)', fontSize: 12 }}>
              No active customer portal link exists for this loan account.
            </div>
          )}
        </div>
      )}

      {/* ─── Active URL Box (shown after generation/copy) ───────────────── */}
      {activeUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
            Shareable Customer Portal URL
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              readOnly
              value={activeUrl}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-strong)',
                background: '#ffffff',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)',
              }}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              type="button"
              onClick={() => copyToClipboard(activeUrl)}
              className="btn btn-primary btn-sm"
              style={{ gap: 6 }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ─── Action Buttons ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {/* Copy / Generate Portal Link */}
        {canManage || status?.hasActiveLink ? (
          <button
            type="button"
            onClick={handleCopyLink}
            disabled={actionLoading || loading}
            className="btn btn-primary btn-sm"
            style={{ gap: 6 }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>
              {copied
                ? 'Copied to Clipboard!'
                : status?.hasActiveLink
                ? 'Copy Portal Link'
                : 'Generate Portal Link'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="btn btn-secondary btn-sm"
            style={{ gap: 6, opacity: 0.6 }}
          >
            <Copy size={13} />
            <span>No Active Link</span>
          </button>
        )}

        {/* Send via WhatsApp (Optional customer communication if phone exists) */}
        {primaryPhone && (
          <button
            type="button"
            onClick={handleSendWhatsApp}
            disabled={actionLoading || loading || (!canManage && !status?.hasActiveLink)}
            className="btn btn-secondary btn-sm"
            style={{
              gap: 6,
              color: '#1EBE5D',
              borderColor: 'rgba(37, 211, 102, 0.4)',
            }}
            title="Open WhatsApp with pre-filled customer portal link"
          >
            <MessageCircle size={14} />
            <span>Send via WhatsApp</span>
          </button>
        )}

        {/* Regenerate Link (Requires Confirmation) */}
        {canManage && (
          <button
            type="button"
            onClick={() => setConfirmAction('regenerate')}
            disabled={actionLoading || loading}
            className="btn btn-secondary btn-sm"
            style={{ gap: 6 }}
            title="Invalidate previous link and create a fresh one"
          >
            <RefreshCw size={13} />
            <span>Regenerate Portal Link</span>
          </button>
        )}

        {/* Revoke Link (Requires Confirmation) */}
        {canManage && status?.hasActiveLink && (
          <button
            type="button"
            onClick={() => setConfirmAction('revoke')}
            disabled={actionLoading || loading}
            className="btn btn-secondary btn-sm"
            style={{ gap: 6, color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
            title="Revoke access completely for this loan"
          >
            <XCircle size={13} />
            <span>Revoke Portal Link</span>
          </button>
        )}

        {/* Non-privileged role notice */}
        {!canManage && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            • View-only access. You do not have permission to manage or regenerate portal links.
          </span>
        )}
      </div>

      {/* ─── Inline Confirmation Dialogs ─────────────────────────────────── */}
      {confirmAction === 'regenerate' && (
        <div
          style={{
            padding: 14,
            background: 'var(--warning-bg)',
            border: '1px solid var(--warning-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warning-text)', fontWeight: 700, fontSize: 13 }}>
            <AlertTriangle size={16} />
            <span>Regenerate Link?</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--warning-text)', margin: 0 }}>
            The existing portal link will be immediately invalidated. The borrower will need the new link to access the portal. Are you sure you want to proceed?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleConfirmRegenerate}
              disabled={actionLoading}
              className="btn btn-primary btn-sm"
              style={{ background: 'var(--warning)', borderColor: 'var(--warning)', color: '#ffffff' }}
            >
              {actionLoading ? 'Regenerating...' : 'Confirm Regenerate'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmAction === 'revoke' && (
        <div
          style={{
            padding: 14,
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontWeight: 700, fontSize: 13 }}>
            <AlertTriangle size={16} />
            <span>Revoke Access?</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--danger-text)', margin: 0 }}>
            The customer will immediately lose access to this portal for loan <strong>{loanAccountNo}</strong>. Are you sure you want to proceed?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleConfirmRevoke}
              disabled={actionLoading}
              className="btn btn-primary btn-sm"
              style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#ffffff' }}
            >
              {actionLoading ? 'Revoking...' : 'Confirm Revoke'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalLinkManager;
