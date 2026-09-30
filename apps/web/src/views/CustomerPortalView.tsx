import React, { useEffect, useState, useCallback } from 'react';
import { ApiClient, ICustomerPortalLoanData } from '../services/api';
import { formatINR } from '@crm/shared';
import {
  ShieldCheck,
  Calendar,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  ExternalLink,
  Receipt,
  FileText,
  Phone,
  MessageCircle,
  HelpCircle,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

interface CustomerPortalViewProps {
  token: string | null;
  initialData?: ICustomerPortalLoanData | null;
}

export const CustomerPortalView: React.FC<CustomerPortalViewProps> = ({ token, initialData = null }) => {
  const [data, setData] = useState<ICustomerPortalLoanData | null>(initialData);
  const [loading, setLoading] = useState<boolean>(!initialData && Boolean(token && token.trim()));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(
    !initialData && (!token || !token.trim()) ? 'A valid customer portal token is required in the link.' : null
  );
  const [activeTab, setActiveTab] = useState<'schedule' | 'history'>('schedule');

  // Fetch portal data using token only (never writes to localStorage)
  const fetchPortalData = useCallback(async (isSilent = false) => {
    if (!token || !token.trim()) {
      setError('A valid customer portal token is required in the link.');
      setLoading(false);
      return;
    }

    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const result = await ApiClient.getCustomerPortalLoan(token);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'This portal link is invalid, expired, or has been revoked.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchPortalData();

    // Auto-refresh when customer refocuses the window (e.g. after WhatsApp/UPI payment)
    const onFocus = () => {
      fetchPortalData(true);
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchPortalData]);

  // WhatsApp Pay Action
  const handlePayViaWhatsApp = () => {
    if (!data) return;

    // Use customer's real phone number from backend (fallback to masked if not provided)
    const rawPhone = data.customerPhone || data.maskedPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');

    const formattedAmount = formatINR(data.emiAmount);
    const dueDate = data.nextDueDate || 'Immediate';
    const msg = [
      'Hello, I want to make my EMI payment.',
      '',
      `Loan Account: ${data.loanAccountNo}`,
      `EMI Amount: ${formattedAmount}`,
      `Due Date: ${dueDate}`,
    ].join('\n');

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
      case 'SUCCESS':
      case 'ACTIVE':
        return <span className="badge badge-paid">{status}</span>;
      case 'DUE_TODAY':
        return <span className="badge badge-due-today">DUE TODAY</span>;
      case 'OVERDUE':
      case 'DEFAULTED':
        return <span className="badge badge-overdue">{status}</span>;
      case 'PARTIALLY_PAID':
        return <span className="badge badge-partial">PARTIAL</span>;
      case 'UPCOMING':
      default:
        return <span className="badge badge-upcoming">{status}</span>;
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column' }}>
      {/* ─── Top Trust Header ────────────────────────────────────────────── */}
      <header
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '14px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BrandLogo variant="horizontal" size="sm" showLegal={true} subtitle="Official EMI Portal" />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--success)',
              background: 'var(--success-bg)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--success-border)',
            }}
          >
            <ShieldCheck size={12} />
            <span>Verified Portal</span>
          </span>
        </div>

        {data && (
          <button
            onClick={() => fetchPortalData(true)}
            disabled={refreshing}
            className="btn btn-secondary btn-sm"
            title="Refresh latest status"
            style={{ gap: 6 }}
          >
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        )}
      </header>

      {/* ─── Main Container ──────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 900, width: '100%', margin: '0 auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Loading State */}
        {loading && (
          <div
            className="crm-card"
            style={{
              padding: '60px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: '3px solid var(--border-subtle)',
                borderTopColor: 'var(--primary)',
                animation: 'spin 1s linear infinite',
              }}
            />
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Loading Loan Details</h2>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                Please wait while we verify your secure portal link...
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div
            className="crm-card"
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              borderLeft: '4px solid var(--danger)',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'var(--danger-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--danger)',
              }}
            >
              <AlertCircle size={28} />
            </div>
            <div style={{ maxWidth: 460 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                Portal Link Unavailable
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
                {error}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                If you believe this is an error, please contact your loan officer or support team to request an updated access link.
              </p>
            </div>
          </div>
        )}

        {/* Loaded Customer Loan Content */}
        {!loading && !error && data && (
          <>
            {/* ─── Hero Overview Card ────────────────────────────────────── */}
            <div
              className="crm-card"
              style={{
                padding: 24,
                background: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
              }}
            >
              {/* Top Row: Customer & Account */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Customer Account
                    </span>
                    {getStatusBadge(data.status)}
                  </div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4, letterSpacing: '-0.02em' }}>
                    {data.customerName}
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Phone size={13} />
                      {data.maskedPhone}
                    </span>
                    <span style={{ color: 'var(--border-strong)' }}>•</span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>
                      {data.loanAccountNo}
                    </span>
                  </div>
                </div>

                {/* Outstanding Due Callout */}
                <div
                  style={{
                    background: 'var(--bg-surface-secondary)',
                    padding: '12px 18px',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-subtle)',
                    textAlign: 'right',
                    minWidth: 160,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Outstanding Balance
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
                    {formatINR(data.outstandingBalance)}
                  </div>
                </div>
              </div>

              {/* ─── Metrics Grid ────────────────────────────────────────── */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <Calendar size={14} color="var(--primary)" />
                    <span>Next Due Date</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: 'var(--text-primary)' }}>
                    {data.nextDueDate || 'Fully Paid'}
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <CreditCard size={14} color="var(--primary)" />
                    <span>Monthly EMI</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: 'var(--primary)' }}>
                    {formatINR(data.emiAmount)}
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <FileText size={14} color="var(--primary)" />
                    <span>Financed Amount</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: 'var(--text-primary)' }}>
                    {formatINR(data.financedAmount || 0)}
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <CheckCircle2 size={14} color="var(--success)" />
                    <span>Total Paid</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: 'var(--success-text)' }}>
                    {formatINR(data.totalPaid)}
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <Clock size={14} color="var(--warning)" />
                    <span>Pending EMIs</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: 'var(--text-primary)' }}>
                    {data.pendingInstallments} of {data.totalInstallments}
                  </div>
                </div>

                {data.overdueInstallments !== undefined && data.overdueInstallments > 0 && (
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--danger-bg)',
                      border: '1px solid var(--danger-border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--danger)' }}>
                      <AlertCircle size={14} color="var(--danger)" />
                      <span style={{ fontWeight: 600 }}>Overdue EMIs</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: 'var(--danger)' }}>
                      {data.overdueInstallments} Overdue
                    </div>
                  </div>
                )}
              </div>

              {/* ─── Repayment Progress Bar ───────────────────────────────── */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Repayment Progress
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                    {data.paidInstallments} / {data.totalInstallments} EMIs Cleared
                  </span>
                </div>
                <div
                  style={{
                    height: 10,
                    width: '100%',
                    background: 'var(--bg-surface-hover)',
                    borderRadius: 'var(--radius-full)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${data.totalInstallments > 0 ? Math.min(100, Math.round((data.paidInstallments / data.totalInstallments) * 100)) : 0}%`,
                      background: 'var(--primary)',
                      borderRadius: 'var(--radius-full)',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>

              {/* ─── Primary CTA: Pay Now via WhatsApp ────────────────────── */}
              <div
                style={{
                  background: 'var(--primary-subtle)',
                  border: '1px solid var(--primary-border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--primary)', margin: 0 }}>
                      Pay Your EMI via WhatsApp
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                      Click below to send a pre-filled request to our finance office and receive the official UPI QR code instantly.
                    </p>
                  </div>
                  <button
                    onClick={handlePayViaWhatsApp}
                    className="btn btn-primary"
                    style={{
                      background: '#25D366',
                      borderColor: '#1EBE5D',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: 15,
                      padding: '12px 24px',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: '0 2px 8px rgba(37, 211, 102, 0.3)',
                      cursor: 'pointer',
                      gap: 8,
                    }}
                  >
                    <MessageCircle size={18} />
                    <span>Pay Now via WhatsApp ({formatINR(data.emiAmount)})</span>
                  </button>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    borderTop: '1px solid var(--primary-border)',
                    paddingTop: 10,
                  }}
                >
                  <ShieldCheck size={14} color="var(--success)" />
                  <span>
                    <strong>100% Safe & Verified:</strong> You pay directly via official bank UPI QR. After sending the payment screenshot, Super Admin verifies and updates your ledger immediately.
                  </span>
                </div>
              </div>
            </div>

            {/* ─── Breakdown Tabs ────────────────────────────────────────── */}
            <div className="crm-card" style={{ padding: 20 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  borderBottom: '1px solid var(--border-subtle)',
                  paddingBottom: 12,
                  marginBottom: 16,
                }}
              >
                <button
                  onClick={() => setActiveTab('schedule')}
                  style={{
                    background: activeTab === 'schedule' ? 'var(--primary-subtle)' : 'transparent',
                    color: activeTab === 'schedule' ? 'var(--primary)' : 'var(--text-secondary)',
                    border: activeTab === 'schedule' ? '1px solid var(--primary-border)' : '1px solid transparent',
                    fontWeight: 700,
                    fontSize: 14,
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Calendar size={14} />
                  <span>EMI Schedule ({data.installments?.length || 0})</span>
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  style={{
                    background: activeTab === 'history' ? 'var(--primary-subtle)' : 'transparent',
                    color: activeTab === 'history' ? 'var(--primary)' : 'var(--text-secondary)',
                    border: activeTab === 'history' ? '1px solid var(--primary-border)' : '1px solid transparent',
                    fontWeight: 700,
                    fontSize: 14,
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Receipt size={14} />
                  <span>Payment History ({data.paymentHistory?.length || 0})</span>
                </button>
              </div>

              {/* Tab 1: EMI Schedule */}
              {activeTab === 'schedule' && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '10px 12px' }}>#</th>
                        <th style={{ padding: '10px 12px' }}>Due Date</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Expected</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Paid</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Remaining</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.installments && data.installments.length > 0 ? (
                        data.installments.map((inst) => (
                          <tr
                            key={inst.installmentNumber}
                            style={{
                              borderBottom: '1px solid var(--border-subtle)',
                              background: inst.status === 'PAID' ? 'transparent' : 'var(--bg-surface-secondary)',
                            }}
                          >
                            <td style={{ padding: '12px', fontWeight: 700 }}>{inst.installmentNumber}</td>
                            <td style={{ padding: '12px' }}>{inst.dueDate}</td>
                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>{formatINR(inst.expectedAmount)}</td>
                            <td style={{ padding: '12px', textAlign: 'right', color: inst.paidAmount > 0 ? 'var(--success-text)' : 'inherit' }}>
                              {formatINR(inst.paidAmount)}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>
                              {formatINR(inst.remainingAmount)}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>{getStatusBadge(inst.status)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                            No installments recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 2: Payment History */}
              {activeTab === 'history' && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '10px 12px' }}>Receipt #</th>
                        <th style={{ padding: '10px 12px' }}>Payment Date</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '10px 12px' }}>Mode</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.paymentHistory && data.paymentHistory.length > 0 ? (
                        data.paymentHistory.map((pmt) => (
                          <tr key={pmt.receiptNumber} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '12px' }}>
                              <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                                {pmt.receiptNumber}
                              </span>
                            </td>
                            <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                              {new Date(pmt.paymentDate).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: 'var(--success-text)' }}>
                              {formatINR(pmt.amount)}
                            </td>
                            <td style={{ padding: '12px' }}>
                              <span className="badge badge-upcoming">{pmt.paymentMode}</span>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>{getStatusBadge(pmt.status)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                            No verified payments yet. Click &ldquo;Pay Now via WhatsApp&rdquo; above to make a payment.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ─── Footer Assistance Note ─────────────────────────────────── */}
            <div
              style={{
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-muted)',
                padding: '12px 0 24px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div>Need help with your loan or payment? Reach out to our customer support.</div>
              <div>Alpha Mobile Gallery • Shubh Pvt Ltd • Regulated Lending & Collection CRM</div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default CustomerPortalView;
