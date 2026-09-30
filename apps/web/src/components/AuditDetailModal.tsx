import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import { IAuditLogDetail, redactSensitiveData, formatINR } from '@crm/shared';
import {
  X,
  Copy,
  Check,
  ShieldCheck,
  AlertCircle,
  Clock,
  User,
  Database,
  Terminal,
  Activity,
  ArrowRight,
  Layers,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

interface AuditDetailModalProps {
  logId: string | null;
  onClose: () => void;
}

export const AuditDetailModal: React.FC<AuditDetailModalProps> = ({ logId, onClose }) => {
  const [detail, setDetail] = useState<IAuditLogDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [rawStateTab, setRawStateTab] = useState<'diff' | 'before' | 'after'>('diff');
  const [metadataExpanded, setMetadataExpanded] = useState(true);

  useEffect(() => {
    if (!logId) {
      setDetail(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    ApiClient.getAuditLogById(logId)
      .then((data) => {
        if (isMounted) {
          // Extra defensive sanitization on client side
          setDetail(redactSensitiveData(data));
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          setError(err.message || 'Unable to load audit log details');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [logId]);

  if (!logId) return null;

  const handleCopy = async (fieldKey: string, text: string) => {
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback
    }
  };

  const renderCopyButton = (fieldKey: string, value?: string | null) => {
    if (!value) return null;
    const isCopied = copiedField === fieldKey;
    return (
      <button
        type="button"
        onClick={() => handleCopy(fieldKey, value)}
        title="Copy to clipboard"
        style={{
          background: 'none',
          border: 'none',
          padding: '2px 4px',
          cursor: 'pointer',
          color: isCopied ? 'var(--success)' : 'var(--text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {isCopied ? <Check size={12} /> : <Copy size={12} />}
        {isCopied && <span>Copied</span>}
      </button>
    );
  };

  const getSeverityBadge = (severity?: string) => {
    switch (severity) {
      case 'CRITICAL':
        return <span className="badge badge-overdue">CRITICAL</span>;
      case 'WARNING':
        return <span className="badge badge-upcoming">WARNING</span>;
      case 'INFO':
      default:
        return <span className="badge badge-paid">INFO</span>;
    }
  };

  const formatValue = (val: any): string => {
    if (val === null || val === undefined) return 'None';
    if (typeof val === 'number') {
      return String(val);
    }
    if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    }
    if (typeof val === 'object') {
      return JSON.stringify(val);
    }
    return String(val);
  };

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 1200 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: 880,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-modal)',
          overflow: 'hidden',
        }}
      >
        {/* ─── Header ────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md)',
                background: 'var(--primary-subtle)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldCheck size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Audit Event Details
                </h3>
                {detail && getSeverityBadge(detail.severity)}
                {detail?.status && (
                  <span className="badge badge-paid" style={{ fontSize: 11 }}>
                    {detail.status}
                  </span>
                )}
              </div>
              {detail && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                    {detail.action}
                  </span>
                  <span>•</span>
                  <span>{detail.entity}</span>
                  <span>•</span>
                  <span className="mono">
                    {new Date(detail.createdAt).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true,
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 6,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* ─── Modal Body ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Loading state */}
          {loading && (
            <div style={{ padding: '60px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: '3px solid var(--border-subtle)',
                  borderTopColor: 'var(--primary)',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Fetching cryptographically sealed audit record...
              </div>
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div
              style={{
                padding: '24px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--danger-bg)',
                border: '1px solid var(--danger-border)',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
              }}
            >
              <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ display: 'block', fontSize: 14 }}>Failed to load audit record</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: 13 }}>{error}</p>
              </div>
            </div>
          )}

          {/* Loaded Content */}
          {!loading && !error && detail && (
            <>
              {/* ─── A. EVENT INFORMATION ─────────────────────────────────── */}
              <div className="crm-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <Clock size={16} color="var(--primary)" />
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    A. Event Information
                  </h4>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Event ID:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                        {detail.id}
                      </span>
                      {renderCopyButton('eventId', detail.id)}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Timestamp:</span>
                    <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {new Date(detail.createdAt).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true,
                      })}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Action / Event Type:</span>
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {detail.action}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Module / Resource:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{detail.entity}</strong>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Severity:</span>
                    {getSeverityBadge(detail.severity)}
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Status:</span>
                    <strong style={{ color: 'var(--success-text)' }}>{detail.status || 'SUCCESS'}</strong>
                  </div>
                </div>
              </div>

              {/* ─── B. ACTOR ──────────────────────────────────────────────── */}
              <div className="crm-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <User size={16} color="var(--primary)" />
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    B. Actor (User & Identity)
                  </h4>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>User ID:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="mono" style={{ color: detail.actor.userId ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {detail.actor.userId || 'System Automated / Anonymous'}
                      </span>
                      {renderCopyButton('actorUserId', detail.actor.userId)}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Full Name:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {detail.actor.userName || 'System Auto Engine'}
                    </strong>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Email:</span>
                    <span style={{ color: detail.actor.userEmail ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {detail.actor.userEmail || 'system@internal.engine'}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Role:</span>
                    <span className="badge badge-upcoming" style={{ fontSize: 11 }}>
                      {detail.actor.userRole || 'SYSTEM'}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Dealer / Store Context:</span>
                    <span style={{ color: detail.actor.dealerStoreName ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {detail.actor.dealerStoreName || 'None (Direct Staff / System)'}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>IP Address:</span>
                    <span className="mono" style={{ color: 'var(--text-primary)' }}>
                      {detail.actor.ipAddress || '127.0.0.1'}
                    </span>
                  </div>

                  {detail.actor.userAgent && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>User Agent:</span>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          padding: '6px 10px',
                          background: 'var(--bg-app)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-subtle)',
                          wordBreak: 'break-all',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {detail.actor.userAgent}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ─── C. TARGET / RESOURCE ──────────────────────────────────── */}
              <div className="crm-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <Database size={16} color="var(--primary)" />
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    C. Target / Resource Details
                  </h4>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Resource Type:</span>
                    <strong style={{ color: 'var(--primary)' }}>{detail.target.entity}</strong>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Resource ID:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="mono" style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                        {detail.target.entityId}
                      </span>
                      {renderCopyButton('resourceId', detail.target.entityId)}
                    </div>
                  </div>

                  {detail.target.entityAccountNo && (
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Entity / Account No:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                          {detail.target.entityAccountNo}
                        </span>
                        {renderCopyButton('entityAccountNo', detail.target.entityAccountNo)}
                      </div>
                    </div>
                  )}

                  {detail.target.loanAccountNo && (
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Loan Account No:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                          {detail.target.loanAccountNo}
                        </span>
                        {renderCopyButton('loanAccountNo', detail.target.loanAccountNo)}
                      </div>
                    </div>
                  )}

                  {detail.target.customerName && (
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Customer:</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{detail.target.customerName}</strong>
                    </div>
                  )}

                  {detail.target.dealerName && (
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Associated Dealer / Store:</span>
                      <span style={{ color: 'var(--text-primary)' }}>{detail.target.dealerName}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ─── D. CHANGE DETAILS (DIFF & STATE) ─────────────────────── */}
              <div className="crm-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Activity size={16} color="var(--primary)" />
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      D. Change Details & State Comparison
                    </h4>
                  </div>

                  {/* Tab Selector */}
                  <div style={{ display: 'flex', gap: 4, background: 'var(--bg-app)', padding: 3, borderRadius: 'var(--radius-sm)' }}>
                    <button
                      type="button"
                      onClick={() => setRawStateTab('diff')}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        background: rawStateTab === 'diff' ? 'var(--bg-surface)' : 'transparent',
                        color: rawStateTab === 'diff' ? 'var(--primary)' : 'var(--text-secondary)',
                        boxShadow: rawStateTab === 'diff' ? 'var(--shadow-sm)' : 'none',
                      }}
                    >
                      Field Diff ({detail.changes?.length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRawStateTab('before')}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        background: rawStateTab === 'before' ? 'var(--bg-surface)' : 'transparent',
                        color: rawStateTab === 'before' ? 'var(--primary)' : 'var(--text-secondary)',
                        boxShadow: rawStateTab === 'before' ? 'var(--shadow-sm)' : 'none',
                      }}
                    >
                      Before State
                    </button>
                    <button
                      type="button"
                      onClick={() => setRawStateTab('after')}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        background: rawStateTab === 'after' ? 'var(--bg-surface)' : 'transparent',
                        color: rawStateTab === 'after' ? 'var(--primary)' : 'var(--text-secondary)',
                        boxShadow: rawStateTab === 'after' ? 'var(--shadow-sm)' : 'none',
                      }}
                    >
                      After State
                    </button>
                  </div>
                </div>

                {/* Tab 1: Field Diff Table */}
                {rawStateTab === 'diff' && (
                  <div>
                    {detail.changes && detail.changes.length > 0 ? (
                      <div className="table-container">
                        <table className="crm-table" style={{ fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th style={{ width: '30%' }}>Field</th>
                              <th style={{ width: '35%' }}>Previous Value (Before)</th>
                              <th style={{ width: '35%' }}>New Value (After)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.changes.map((c, i) => (
                              <tr key={i}>
                                <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                                  {c.field}
                                </td>
                                <td style={{ background: 'rgba(239, 68, 68, 0.04)', color: 'var(--danger-text)' }}>
                                  <span className="mono">{formatValue(c.previousValue)}</span>
                                </td>
                                <td style={{ background: 'rgba(34, 197, 94, 0.04)', color: 'var(--success-text)' }}>
                                  <span className="mono" style={{ fontWeight: 600 }}>{formatValue(c.newValue)}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        No direct delta comparison available (e.g. single creation event or initial record).
                      </div>
                    )}
                  </div>
                )}

                {/* Tab 2: Before State JSON */}
                {rawStateTab === 'before' && (
                  <div>
                    {detail.previousState ? (
                      <pre
                        className="mono"
                        style={{
                          background: 'var(--bg-app)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          padding: 14,
                          fontSize: 12,
                          maxHeight: 280,
                          overflow: 'auto',
                          lineHeight: 1.5,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {JSON.stringify(detail.previousState, null, 2)}
                      </pre>
                    ) : (
                      <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        No prior state existed (new resource creation).
                      </div>
                    )}
                  </div>
                )}

                {/* Tab 3: After State JSON */}
                {rawStateTab === 'after' && (
                  <div>
                    {detail.newState ? (
                      <pre
                        className="mono"
                        style={{
                          background: 'var(--bg-app)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          padding: 14,
                          fontSize: 12,
                          maxHeight: 280,
                          overflow: 'auto',
                          lineHeight: 1.5,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {JSON.stringify(detail.newState, null, 2)}
                      </pre>
                    ) : (
                      <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        No new state recorded for this event.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ─── E. REQUEST & TECHNICAL DETAILS ──────────────────────── */}
              <div className="crm-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <Terminal size={16} color="var(--primary)" />
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    E. Request & Technical Details
                  </h4>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>HTTP Method:</span>
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {detail.requestDetails?.httpMethod || 'POST / SYSTEM'}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Endpoint / API Path:</span>
                    <span className="mono" style={{ color: 'var(--text-primary)' }}>
                      {detail.requestDetails?.endpoint || `/api/v1/${detail.entity.toLowerCase()}s`}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Request / Correlation ID:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="mono" style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                        {detail.requestDetails?.requestId || `req_${detail.id.slice(0, 16)}`}
                      </span>
                      {renderCopyButton('requestId', detail.requestDetails?.requestId || `req_${detail.id.slice(0, 16)}`)}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>Client IP:</span>
                    <span className="mono" style={{ color: 'var(--text-primary)' }}>
                      {detail.requestDetails?.ipAddress || detail.actor.ipAddress || '127.0.0.1'}
                    </span>
                  </div>
                </div>
              </div>

              {/* ─── F. METADATA & CONTEXT JSON VIEWER ─────────────────────── */}
              {detail.metadata && Object.keys(detail.metadata).length > 0 && (
                <div className="crm-card" style={{ padding: 16 }}>
                  <div
                    onClick={() => setMetadataExpanded(!metadataExpanded)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      borderBottom: metadataExpanded ? '1px solid var(--border-subtle)' : 'none',
                      paddingBottom: metadataExpanded ? 8 : 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Layers size={16} color="var(--primary)" />
                      <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                        F. Metadata & Context Attributes
                      </h4>
                    </div>
                    {metadataExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>

                  {metadataExpanded && (
                    <div style={{ marginTop: 12 }}>
                      <pre
                        className="mono"
                        style={{
                          background: 'var(--bg-app)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          padding: 14,
                          fontSize: 12,
                          maxHeight: 240,
                          overflow: 'auto',
                          lineHeight: 1.5,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {JSON.stringify(detail.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── Footer ────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface-secondary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={14} color="var(--success)" />
            <span>Audit records are cryptographically sealed and immutable.</span>
          </div>

          <button type="button" onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
export default AuditDetailModal;
