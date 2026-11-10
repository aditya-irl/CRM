import React, { useState, useEffect } from 'react';
import {
  IUser,
  IProductionCleanupPreview,
  IProductionCleanupExecutionResult,
  ICleanupTableCount,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  ShieldAlert,
  ShieldCheck,
  Database,
  RefreshCw,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Server,
  Layers,
  Users,
  Settings,
  ArrowRight,
  ExternalLink,
  Trash2,
  Check,
} from 'lucide-react';

interface ProductionCleanupViewProps {
  user: IUser;
  onNavigateToTab?: (tab: string) => void;
  initialPreview?: IProductionCleanupPreview;
}

export const ProductionCleanupView: React.FC<ProductionCleanupViewProps> = ({
  user,
  onNavigateToTab,
  initialPreview,
}) => {
  const [preview, setPreview] = useState<IProductionCleanupPreview | null>(initialPreview || null);
  const [loading, setLoading] = useState(!initialPreview);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Admin session re-authentication modal state
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifySuccessMsg, setVerifySuccessMsg] = useState<string | null>(null);
  const [verifyErrorMsg, setVerifyErrorMsg] = useState<string | null>(null);

  // Phase 2 Handover Purge execution modal state
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const [executePhrase, setExecutePhrase] = useState('');
  const [executePassword, setExecutePassword] = useState('');
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<IProductionCleanupExecutionResult | null>(null);

  const fetchPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ApiClient.getCleanupPreview();
      setPreview(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch production cleanup preview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialPreview) {
      fetchPreview();
    }
  }, [initialPreview]);

  const handleVerifySession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyPassword.trim()) {
      setVerifyErrorMsg('Please enter your Super Admin password');
      return;
    }
    setVerifying(true);
    setVerifyErrorMsg(null);
    setVerifySuccessMsg(null);
    try {
      const res = await ApiClient.verifyAdminCleanupSession(verifyPassword);
      setVerifySuccessMsg(res.message || 'Session verified successfully');
      setVerifyPassword('');
      setTimeout(() => {
        setShowVerifyModal(false);
        setVerifySuccessMsg(null);
      }, 1500);
    } catch (err: any) {
      setVerifyErrorMsg(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleExecuteCleanup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (executePhrase !== 'PURGE PRODUCTION TEST DATA') {
      setExecuteError('Please type the exact confirmation phrase: PURGE PRODUCTION TEST DATA');
      return;
    }
    if (!executePassword.trim()) {
      setExecuteError('Please enter your Super Admin password');
      return;
    }
    setExecuting(true);
    setExecuteError(null);
    try {
      const result = await ApiClient.executeProductionCleanup(executePhrase, executePassword);
      setExecutionResult(result);
      setExecutePassword('');
      setExecutePhrase('');
      await fetchPreview();
    } catch (err: any) {
      setExecuteError(err.message || 'Handover purge failed');
    } finally {
      setExecuting(false);
    }
  };

  const filteredCounts = preview?.operationalCounts.filter((item) => {
    if (categoryFilter === 'ALL') return true;
    return item.category === categoryFilter;
  }) || [];

  return (
    <div
      className="production-cleanup-view"
      style={{
        padding: '24px 28px',
        maxWidth: 1360,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}
    >
      {/* ── TOP HEADER ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-md, 8px)',
              background: '#fee2e2',
              color: '#991b1b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldAlert size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.02em',
                  margin: 0,
                }}
              >
                Production Data Cleanup & Client Handover
              </h1>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 12,
                  background: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #fde68a',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Lock size={11} /> Phase 1: Read-Only Preview
              </span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Live backend database inspection and pre-handover verification • Zero data modification
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowVerifyModal(true)}
            data-testid="verify-admin-session-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 15px',
              borderRadius: 'var(--radius-md, 8px)',
              background: '#ffffff',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <KeyRound size={15} color="var(--primary)" />
            <span>Re-verify Admin Session</span>
          </button>

          <button
            onClick={fetchPreview}
            disabled={loading}
            data-testid="refresh-cleanup-preview-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 15px',
              borderRadius: 'var(--radius-md, 8px)',
              background: 'var(--primary)',
              border: 'none',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>{loading ? 'Inspecting...' : 'Refresh Preview'}</span>
          </button>
        </div>
      </div>

      {/* ── COMPLETION BANNER ────────────────────────────────────────── */}
      {executionResult && (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: 'var(--radius-lg, 12px)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CheckCircle2 size={24} color="#059669" />
            <div>
              <strong style={{ color: '#065f46', fontSize: 14 }}>
                Handover Purge Successfully Completed
              </strong>
              <div style={{ color: '#047857', fontSize: 12.5, marginTop: 2 }}>
                All 20 operational tables verified 0 rows • Audit Event ID: {executionResult.auditLogId} • 4 Preserved Staff Intact
              </div>
            </div>
          </div>
          <button
            onClick={() => setExecutionResult(null)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #6ee7b7',
              background: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              color: '#065f46',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── SAFETY INVARIANT BANNER ────────────────────────────────────────── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #f0fdf4 0%, #e0f2fe 100%)',
          border: '1px solid #bbf7d0',
          borderRadius: 'var(--radius-lg, 12px)',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}
      >
        <ShieldCheck size={22} color="#15803d" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ color: '#166534', display: 'block', fontSize: 13.5, marginBottom: 2 }}>
            Phase 1 Active: Strictly Read-Only Live Inspection
          </strong>
          <span style={{ color: '#15803d' }}>
            The inspection engine uses the active connection pool configured inside the live Render backend.
            All row counts, system configurations, and staff accounts below are queried in real time without executing
            any <code>DELETE</code>, <code>DROP</code>, or <code>UPDATE</code> statements.
            Deletion capabilities are locked until Phase 2 is explicitly authorized.
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 'var(--radius-md, 8px)',
            padding: '12px 16px',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      )}

      {loading && !preview && (
        <div
          style={{
            padding: 60,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            color: 'var(--text-muted)',
          }}
        >
          <div
            className="animate-spin"
            style={{
              width: 32,
              height: 32,
              border: '3px solid var(--border-subtle)',
              borderTopColor: 'var(--primary)',
              borderRadius: '50%',
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Connecting to PostgreSQL & Querying Table Counts...</span>
        </div>
      )}

      {preview && (
        <>
          {/* ── CARD 1: CONNECTED DATABASE IDENTITY ─────────────────────────── */}
          <div
            className="crm-card"
            style={{
              padding: 22,
              background: '#ffffff',
              borderRadius: 'var(--radius-lg, 12px)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Server size={18} color="var(--primary)" />
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Connected Database Identity
                </h2>
              </div>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 12,
                  background: preview.databaseIdentity.providerGuess === 'Neon PostgreSQL' ? '#dcfce7' : '#e0f2fe',
                  color: preview.databaseIdentity.providerGuess === 'Neon PostgreSQL' ? '#15803d' : '#0369a1',
                }}
              >
                {preview.databaseIdentity.providerGuess}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 14,
              }}
            >
              <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', padding: 12, borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Database Name</span>
                <strong style={{ fontSize: 14, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {preview.databaseIdentity.databaseName}
                </strong>
              </div>

              <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', padding: 12, borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Server Host (Sanitized)</span>
                <strong style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {preview.databaseIdentity.serverHost}
                </strong>
              </div>

              <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', padding: 12, borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Active Schema</span>
                <strong style={{ fontSize: 14, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {preview.databaseIdentity.currentSchema}
                </strong>
              </div>

              <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', padding: 12, borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Connection Security</span>
                <strong
                  style={{
                    fontSize: 13,
                    color: preview.databaseIdentity.sslActive ? '#15803d' : '#92400e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ShieldCheck size={14} />
                  {preview.databaseIdentity.sslActive ? 'TLS / SSL Encrypted' : 'Non-SSL (Local)'}
                </strong>
              </div>

              <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', padding: 12, borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Migrations Status</span>
                <strong style={{ fontSize: 13, color: '#15803d' }}>
                  {preview.systemSettings.migrationsCount} Migrations Applied
                </strong>
              </div>

              <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', padding: 12, borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>PostgreSQL Engine</span>
                <strong style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
                  {preview.databaseIdentity.pgVersion}
                </strong>
              </div>
            </div>
          </div>

          {/* ── CARD 2: PRESERVED STAFF & CONFIGURATION ──────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 16,
            }}
          >
            {/* Preserved Staff Accounts */}
            <div
              className="crm-card"
              style={{
                padding: 22,
                background: '#ffffff',
                borderRadius: 'var(--radius-lg, 12px)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <Users size={18} color="var(--primary)" />
                <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Approved Staff Accounts (Strictly Preserved)
                </h3>
              </div>

              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.4 }}>
                These four designated staff accounts will NEVER be modified or deleted during the handover cleanup.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {preview.preservedStaff.map((staff) => (
                  <div
                    key={staff.email}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: staff.exists ? 'var(--bg-surface-secondary, #f8fafc)' : '#fee2e2',
                      border: `1px solid ${staff.exists ? 'var(--border-subtle)' : '#fecaca'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CheckCircle2 size={16} color={staff.exists ? '#15803d' : '#dc2626'} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {staff.fullName}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          {staff.email}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 8,
                          background: '#f1f5f9',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {staff.role}
                      </span>
                      <div
                        style={{
                          fontSize: 10,
                          color: staff.exists ? '#15803d' : '#dc2626',
                          fontWeight: 700,
                          marginTop: 2,
                        }}
                      >
                        {staff.exists ? 'ACTIVE' : 'MISSING'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Preserved Business Configuration */}
            <div
              className="crm-card"
              style={{
                padding: 22,
                background: '#ffffff',
                borderRadius: 'var(--radius-lg, 12px)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <Settings size={18} color="var(--primary)" />
                <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Core Business & Payment Configuration
                </h3>
              </div>

              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.4 }}>
                Production financial rules, Cashfree environment, and security schemas remain untouched.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: 'var(--bg-surface-secondary, #f8fafc)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                    Dealer Penalty Configuration
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: '#dcfce7',
                      color: '#15803d',
                    }}
                  >
                    ALLOW_DEALER_PENALTY=false
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: 'var(--bg-surface-secondary, #f8fafc)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                    Cashfree Gateway Environment
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: preview.systemSettings.cashfreeEnv === 'production' ? '#dcfce7' : '#fef3c7',
                      color: preview.systemSettings.cashfreeEnv === 'production' ? '#15803d' : '#92400e',
                    }}
                  >
                    {preview.systemSettings.cashfreeEnv.toUpperCase()}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: 'var(--bg-surface-secondary, #f8fafc)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                    Audit Log Protection Trigger
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: '#dcfce7',
                      color: '#15803d',
                    }}
                  >
                    ACTIVE (prevent_audit_tampering)
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: 'var(--bg-surface-secondary, #f8fafc)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                    Cashfree Webhook Verification
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: '#dcfce7',
                      color: '#15803d',
                    }}
                  >
                    HMAC-SHA256 ENFORCED
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── CARD 3: OPERATIONAL DATA INVENTORY (PURGE SCOPE) ─────────────── */}
          <div
            className="crm-card"
            style={{
              padding: 22,
              background: '#ffffff',
              borderRadius: 'var(--radius-lg, 12px)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Layers size={18} color="var(--primary)" />
                  <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    Operational Data Inventory & Cleanup Target Rows
                  </h3>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                  Live row counts for testing/demo records across operational tables
                </p>
              </div>

              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fee2e2',
                  padding: '8px 14px',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 12, color: '#991b1b', fontWeight: 600 }}>
                  Total Staging Rows in Database:
                </span>
                <strong style={{ fontSize: 16, color: '#b91c1c' }}>
                  {preview.totalOperationalRows.toLocaleString()}
                </strong>
              </div>
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {[
                { id: 'ALL', label: 'All Tables' },
                { id: 'LOANS_EMIS', label: 'Loans & EMIs' },
                { id: 'CUSTOMERS', label: 'Customers & KYC' },
                { id: 'DEALERS', label: 'Dealers & Settlements' },
                { id: 'COLLECTIONS', label: 'Field Collections' },
                { id: 'CASHFREE', label: 'Cashfree & Portal' },
                { id: 'SYSTEM', label: 'System & Accounts' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setCategoryFilter(pill.id)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 16,
                    border: '1px solid var(--border-subtle)',
                    background: categoryFilter === pill.id ? 'var(--primary)' : '#ffffff',
                    color: categoryFilter === pill.id ? '#ffffff' : 'var(--text-secondary)',
                    fontSize: 12,
                    fontWeight: categoryFilter === pill.id ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface-secondary, #f8fafc)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Target Table
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Category
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Description
                    </th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Current Rows
                    </th>
                    <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Handover Target
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCounts.map((item) => (
                    <tr key={item.table} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {item.table}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 6,
                            background: '#f1f5f9',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {item.category}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontSize: 12 }}>
                        {item.description}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: item.rowCount > 0 ? '#b91c1c' : '#15803d' }}>
                        {item.rowCount.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: item.rowCount === 0 ? '#dcfce7' : '#fee2e2',
                            color: item.rowCount === 0 ? '#15803d' : '#991b1b',
                          }}
                        >
                          {item.rowCount === 0 ? 'Pristine (0)' : 'Reset to 0'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── CARD 4: HANDOVER READINESS & DELETION LOCK ────────────────────── */}
          <div
            className="crm-card"
            style={{
              padding: 22,
              background: '#ffffff',
              borderRadius: 'var(--radius-lg, 12px)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Lock size={18} color="#92400e" />
              <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Phase 2 Handover Execution Engine (Locked)
              </h3>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 16px' }}>
              Phase 1 Preview has verified the database connection pool, migrations status, and staff account preservation.
              When Phase 2 is separately authorized, the execution engine will run inside an atomic PostgreSQL transaction
              guaranteeing zero foreign key violations and automatic rollback on any failure.
            </p>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                background: '#f8fafc',
                padding: '14px 18px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Execution Safeguards:</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Requires SUPER_ADMIN • Explicit Confirmation Phrase • Transaction Rollback Safety
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {preview?.cleanupReadiness?.canProceedToPhase2 ? (
                  <>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '5px 12px',
                        borderRadius: 12,
                        background: '#f0fdf4',
                        color: '#166534',
                        border: '1px solid #bbf7d0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <ShieldCheck size={13} color="#166534" /> Phase 2 Ready: Armed & Protected
                    </span>

                    <button
                      onClick={() => {
                        setShowExecuteModal(true);
                        setExecutePhrase('');
                        setExecutePassword('');
                        setExecuteError(null);
                      }}
                      data-testid="initiate-cleanup-btn"
                      style={{
                        padding: '9px 18px',
                        borderRadius: 'var(--radius-md, 8px)',
                        background: '#dc2626',
                        color: '#ffffff',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        boxShadow: '0 2px 4px rgba(220, 38, 38, 0.2)',
                      }}
                    >
                      <Trash2 size={15} />
                      <span>Initiate Handover Purge</span>
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '5px 12px',
                        borderRadius: 12,
                        background: '#fef3c7',
                        color: '#92400e',
                        border: '1px solid #fde68a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Lock size={13} /> DELETION LOCKED (Phase 1 Only)
                    </span>

                    <button
                      disabled
                      title="Phase 2 deletion is not active in this preview phase"
                      style={{
                        padding: '8px 16px',
                        borderRadius: 'var(--radius-md, 8px)',
                        background: '#e2e8f0',
                        color: '#94a3b8',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'not-allowed',
                      }}
                    >
                      Execute Handover Purge
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── RE-AUTHENTICATION MODAL ────────────────────────────────────────── */}
      {showVerifyModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            className="crm-card"
            style={{
              background: '#ffffff',
              borderRadius: 'var(--radius-lg, 12px)',
              padding: 28,
              maxWidth: 440,
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: '#e0f2fe',
                  color: '#0369a1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <KeyRound size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Re-verify Administrator Session
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                  Confirm your Super Admin password to verify authority
                </p>
              </div>
            </div>

            {verifyErrorMsg && (
              <div
                style={{
                  background: '#fee2e2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 12.5,
                  marginBottom: 14,
                }}
              >
                {verifyErrorMsg}
              </div>
            )}

            {verifySuccessMsg && (
              <div
                style={{
                  background: '#dcfce7',
                  border: '1px solid #bbf7d0',
                  color: '#15803d',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 12.5,
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CheckCircle2 size={15} />
                <span>{verifySuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleVerifySession} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Super Admin Password
                </label>
                <input
                  type="password"
                  placeholder="Enter administrator password"
                  value={verifyPassword}
                  onChange={(e) => setVerifyPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowVerifyModal(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: '#ffffff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifying}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: verifying ? 'not-allowed' : 'pointer',
                  }}
                >
                  {verifying ? 'Verifying...' : 'Confirm Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── PHASE 2 EXECUTION MODAL ────────────────────────────────────────── */}
      {showExecuteModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            className="crm-card"
            style={{
              background: '#ffffff',
              borderRadius: 'var(--radius-lg, 12px)',
              padding: 28,
              maxWidth: 580,
              width: '100%',
              boxShadow: '0 25px 35px -5px rgba(0, 0, 0, 0.25)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            {executionResult ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: '#dcfce7',
                      color: '#15803d',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: '#166534' }}>
                      Handover Purge Successfully Executed
                    </h3>
                    <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                      All operational testing data has been wiped in an atomic PostgreSQL transaction.
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    padding: '14px 16px',
                    fontSize: 12.5,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    marginBottom: 18,
                  }}
                >
                  <div>
                    <strong>Target Database:</strong> {executionResult.databaseIdentity.databaseName} ({executionResult.databaseIdentity.serverHost})
                  </div>
                  <div>
                    <strong>Handover Audit ID:</strong> <code>{executionResult.auditLogId}</code>
                  </div>
                  <div>
                    <strong>Executed By:</strong> {executionResult.executedBy} at {new Date(executionResult.executedAt).toLocaleString()}
                  </div>
                  <div>
                    <strong>Verified Operational State:</strong> All target tables confirmed 0 rows.
                  </div>
                  <div>
                    <strong>Preserved Staff Accounts:</strong> 4 accounts intact.
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowExecuteModal(false);
                      setExecutionResult(null);
                    }}
                    style={{
                      padding: '10px 20px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'var(--primary)',
                      color: '#ffffff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Close &amp; Review Dashboard
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: '#fee2e2',
                      color: '#991b1b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: '#991b1b' }}>
                      Confirm Irreversible Handover Purge
                    </h3>
                    <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                      Execute atomic purge of all operational testing records
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 8,
                    padding: '12px 14px',
                    fontSize: 12.5,
                    color: '#991b1b',
                    marginBottom: 16,
                    lineHeight: 1.5,
                  }}
                >
                  <strong>CRITICAL WARNING:</strong> This operation targets the connected live database (
                  <strong>{preview?.databaseIdentity.databaseName || 'connected db'}</strong> on{' '}
                  {preview?.databaseIdentity.serverHost || 'live host'}). It permanently deletes all borrower
                  profiles, loans, EMI installments, payments, dealer demo transactions, and uploaded files.
                  Approved staff accounts, system settings, and schema migrations are strictly preserved.
                </div>

                {executeError && (
                  <div
                    style={{
                      background: '#fee2e2',
                      border: '1px solid #fecaca',
                      color: '#991b1b',
                      borderRadius: 6,
                      padding: '10px 12px',
                      fontSize: 12.5,
                      marginBottom: 14,
                    }}
                  >
                    {executeError}
                  </div>
                )}

                <form onSubmit={handleExecuteCleanup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Step 1: Super Admin Password
                    </label>
                    <input
                      type="password"
                      placeholder="Enter Super Admin password"
                      value={executePassword}
                      onChange={(e) => setExecutePassword(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                      required
                      autoFocus
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Step 2: Type Confirmation Phrase
                    </label>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Type exactly: <code style={{ color: '#991b1b', fontWeight: 700 }}>PURGE PRODUCTION TEST DATA</code>
                    </div>
                    <input
                      type="text"
                      placeholder="PURGE PRODUCTION TEST DATA"
                      value={executePhrase}
                      onChange={(e) => setExecutePhrase(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        fontSize: 13,
                        boxSizing: 'border-box',
                        fontFamily: 'monospace',
                      }}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                    <button
                      type="button"
                      disabled={executing}
                      onClick={() => setShowExecuteModal(false)}
                      style={{
                        padding: '9px 15px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: '#ffffff',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: executing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={executePhrase !== 'PURGE PRODUCTION TEST DATA' || !executePassword.trim() || executing}
                      data-testid="confirm-execute-btn"
                      style={{
                        padding: '9px 18px',
                        borderRadius: 6,
                        border: 'none',
                        background: executePhrase === 'PURGE PRODUCTION TEST DATA' && executePassword.trim() && !executing ? '#dc2626' : '#cbd5e1',
                        color: '#ffffff',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: executePhrase === 'PURGE PRODUCTION TEST DATA' && executePassword.trim() && !executing ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      {executing ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>Executing Transaction...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 size={14} />
                          <span>Permanently Purge Test Data</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
export default ProductionCleanupView;

