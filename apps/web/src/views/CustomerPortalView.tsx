import React, { useEffect, useState, useCallback } from 'react';
import { ApiClient, ICustomerPortalLoanData } from '../services/api';
import { formatINR, formatDateDDMMYYYY } from '@crm/shared';
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
  Eye,
  PhoneCall,
  X,
  Languages,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { DocumentViewerModal } from '../components/DocumentViewerModal';

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
  const [activeTab, setActiveTab] = useState<'schedule' | 'history' | 'kyc'>('schedule');
  const [kycDocs, setKycDocs] = useState<any[]>([]);
  const [loadingKyc, setLoadingKyc] = useState<boolean>(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [viewingKycDoc, setViewingKycDoc] = useState<{
    id: string;
    title: string;
    docType: string;
    fileMimeType?: string;
  } | null>(null);

  // Language selection (English / Hindi)
  const [lang, setLang] = useState<'en' | 'hi'>(() => {
    try {
      const saved = localStorage.getItem('crm_portal_lang');
      return saved === 'hi' ? 'hi' : 'en';
    } catch {
      return 'en';
    }
  });

  const handleSetLang = (newLang: 'en' | 'hi') => {
    setLang(newLang);
    try {
      localStorage.setItem('crm_portal_lang', newLang);
    } catch {}
  };

  const [showContactModal, setShowContactModal] = useState<boolean>(false);

  const overdueCopy = {
    en: {
      title: 'EMI Payment Reminder',
      body: 'Your EMI appears to be overdue. Please review your outstanding amount and pay any due EMI and applicable penalty promptly. Continued non-payment may lead to legal action as permitted by applicable law and may adversely affect your credit score, subject to applicable credit reporting rules. If you need assistance, please contact us.',
      overdueDueLabel: 'Overdue Amount',
      penaltyLabel: 'Applicable Late Penalty',
      totalDueLabel: 'Total Overdue Balance',
      contactBtn: 'Contact Now',
      whatsappBtn: 'Pay via WhatsApp',
    },
    hi: {
      title: 'EMI भुगतान रिमाइंडर',
      body: 'आपकी EMI बकाया है? कृपया पेनल्टी से बचने के लिए अपनी बाकी EMI का भुगतान जल्द करें। लगातार भुगतान न करने पर कानून के अनुसार कानूनी कार्रवाई हो सकती है और आपके क्रेडिट स्कोर पर बुरा असर पड़ सकता है। सहायता के लिए अभी संपर्क करें।',
      overdueDueLabel: 'बकाया राशि',
      penaltyLabel: 'लागू पेनल्टी',
      totalDueLabel: 'कुल देय राशि',
      contactBtn: 'अभी संपर्क करें',
      whatsappBtn: 'व्हाट्सएप से भुगतान करें',
    },
  };

  const handleContactNow = () => {
    if (!data) return;
    const supportPhone = ((import.meta as any).env?.VITE_FINANCE_WHATSAPP_NUMBER as string | undefined) || '';
    if (supportPhone && supportPhone.trim().length >= 10) {
      const cleanPhone = supportPhone.replace(/\D/g, '');
      const msg = lang === 'hi'
        ? `नमस्ते, मैं अपने ऋण खाता संख्या ${data.loanAccountNo} के संबंध में संपर्क कर रहा हूँ। कृपया बकाया भुगतान में सहायता करें।`
        : `Hello Shubh Pvt Ltd Finance Support, I am contacting regarding my loan account ${data.loanAccountNo}. Please provide payment assistance.`;
      const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    } else {
      setShowContactModal(true);
    }
  };

  const fetchKycDocuments = useCallback(async () => {
    if (!token || !token.trim()) return;
    setLoadingKyc(true);
    setKycError(null);
    try {
      const docs = await ApiClient.getCustomerPortalKYCDocuments(token);
      setKycDocs(docs);
    } catch (err: any) {
      console.error('Failed to load portal KYC documents:', err);
      setKycError(err.message || 'Unable to load KYC documents for this account.');
    } finally {
      setLoadingKyc(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchKycDocuments();
    }
  }, [token, fetchKycDocuments]);

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
  const handlePayViaWhatsApp = (customAmount?: number, instNumber?: number) => {
    if (!data) return;

    // Use customer's real phone number from backend (fallback to masked if not provided)
    const rawPhone = data.customerPhone || data.maskedPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');

    const payAmount = customAmount !== undefined ? customAmount : data.emiAmount;
    const formattedAmount = formatINR(payAmount);
    const dueDate = data.nextDueDate ? formatDateDDMMYYYY(data.nextDueDate) : 'Immediate';
    const lines = [
      'Hello, I want to make my EMI payment.',
      '',
      `Loan Account: ${data.loanAccountNo}`,
    ];
    if (instNumber) {
      lines.push(`EMI Installment: #${instNumber}`);
    }
    lines.push(`Amount: ${formattedAmount}`);
    lines.push(`Due Date: ${dueDate}`);

    const msg = lines.join('\n');
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-app)',
              padding: '2px 4px',
              borderRadius: 20,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => handleSetLang('en')}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 14,
                border: 'none',
                background: lang === 'en' ? 'var(--primary)' : 'transparent',
                color: lang === 'en' ? '#ffffff' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => handleSetLang('hi')}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 14,
                border: 'none',
                background: lang === 'hi' ? 'var(--primary)' : 'transparent',
                color: lang === 'hi' ? '#ffffff' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              हिंदी
            </button>
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
              <span>{lang === 'hi' ? 'ताज़ा करें' : 'Refresh'}</span>
            </button>
          )}
        </div>
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
        {!loading && !error && data && (() => {
          const overdueList = data.installments?.filter((i) => i.status === 'OVERDUE' || (i.daysOverdue !== undefined && i.daysOverdue > 0)) || [];
          const hasOverdue = Boolean(
            (data.overdueInstallments !== undefined && data.overdueInstallments > 0) ||
            overdueList.length > 0
          );
          const totalOverdueEmiAmount = overdueList.reduce(
            (sum, i) => sum + (i.remainingAmount !== undefined ? i.remainingAmount : i.expectedAmount),
            0
          );
          const totalPenaltyAmount = data.totalPenaltyAmount || 0;

          return (
            <>
              {/* ─── Bilingual Overdue Payment Warning Banner (Requirement F) ─── */}
              {hasOverdue && (
                <div
                  role="alert"
                  aria-live="polite"
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 'var(--radius-lg, 12px)',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    boxShadow: '0 4px 14px rgba(217, 119, 6, 0.08)',
                    borderLeft: '5px solid #d97706',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          background: '#fef3c7',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#d97706',
                          flexShrink: 0,
                        }}
                      >
                        <AlertCircle size={24} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#92400e', margin: 0 }}>
                          {overdueCopy[lang].title}
                        </h3>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#b45309' }}>
                          {data.loanAccountNo} • Alpha Mobile Gallery (Shubh Pvt Ltd)
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: '#ffffff',
                        padding: '3px 6px',
                        borderRadius: 20,
                        border: '1px solid #fde68a',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleSetLang('en')}
                        style={{
                          padding: '3px 10px',
                          fontSize: 12,
                          fontWeight: 700,
                          borderRadius: 14,
                          border: 'none',
                          background: lang === 'en' ? '#d97706' : 'transparent',
                          color: lang === 'en' ? '#ffffff' : '#78350f',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        English
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetLang('hi')}
                        style={{
                          padding: '3px 10px',
                          fontSize: 12,
                          fontWeight: 700,
                          borderRadius: 14,
                          border: 'none',
                          background: lang === 'hi' ? '#d97706' : 'transparent',
                          color: lang === 'hi' ? '#ffffff' : '#78350f',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        हिंदी
                      </button>
                    </div>
                  </div>

                  <p
                    style={{
                      fontSize: 14,
                      color: '#78350f',
                      lineHeight: 1.6,
                      margin: 0,
                      fontWeight: 500,
                    }}
                  >
                    {overdueCopy[lang].body}
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: '#ffffff',
                      padding: '14px 18px',
                      borderRadius: 'var(--radius-md, 8px)',
                      border: '1px solid #fef3c7',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', textTransform: 'uppercase' }}>
                          {overdueCopy[lang].overdueDueLabel}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#b45309' }}>
                          {formatINR(totalOverdueEmiAmount)}
                        </div>
                      </div>

                      {totalPenaltyAmount > 0 && (
                        <div style={{ borderLeft: '1px solid #fde68a', paddingLeft: 16 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#b91c1c', textTransform: 'uppercase' }}>
                            {overdueCopy[lang].penaltyLabel}
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#dc2626' }}>
                            {formatINR(totalPenaltyAmount)}
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleContactNow}
                      className="btn btn-primary"
                      style={{
                        background: '#d97706',
                        borderColor: '#b45309',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: 14,
                        padding: '10px 20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        boxShadow: '0 2px 4px rgba(217, 119, 6, 0.2)',
                      }}
                    >
                      <PhoneCall size={16} />
                      <span>{overdueCopy[lang].contactBtn}</span>
                    </button>
                  </div>
                </div>
              )}

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
                    {data.nextDueDate ? formatDateDDMMYYYY(data.nextDueDate) : 'Fully Paid'}
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

                {data.totalPenaltyAmount !== undefined && data.totalPenaltyAmount > 0 && (
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-md)',
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--danger)' }}>
                      <AlertCircle size={14} color="var(--danger)" />
                      <span style={{ fontWeight: 600 }}>Penalty Total</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: 'var(--danger-text)' }}>
                      {formatINR(data.totalPenaltyAmount)}
                    </div>
                  </div>
                )}
              </div>

              {/* ─── Overdue EMIs & Late Payment Penalty Breakdown ──────────── */}
              {data.installments && data.installments.some((i) => i.status === 'OVERDUE' || (i.penaltyAmount && i.penaltyAmount > 0)) && (
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--danger-border, #fca5a5)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertCircle size={18} color="var(--danger)" />
                        <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--danger)', margin: 0 }}>
                          Overdue Installment & Late Penalty Notice
                        </h3>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                        Late payment penalties have been assessed according to financing terms. Please clear outstanding amounts promptly.
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: 16, background: 'var(--bg-app)', padding: '10px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Total Outstanding</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{formatINR(data.outstandingBalance)}</div>
                      </div>
                      {data.totalPenaltyAmount !== undefined && data.totalPenaltyAmount > 0 && (
                        <div style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: 16 }}>
                          <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>Penalty Total</div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--danger)' }}>{formatINR(data.totalPenaltyAmount)}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {data.installments
                      .filter((i) => i.status === 'OVERDUE' || (i.penaltyAmount && i.penaltyAmount > 0))
                      .map((inst) => {
                        const totalInstDue = inst.totalDue !== undefined ? inst.totalDue : (inst.remainingAmount + (inst.penaltyAmount || 0));
                        return (
                          <div
                            key={inst.installmentNumber}
                            style={{
                              background: 'var(--bg-app)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-md)',
                              padding: '16px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 12,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>
                                  EMI #{inst.installmentNumber}
                                </span>
                                {getStatusBadge(inst.status)}
                                {inst.daysOverdue !== undefined && inst.daysOverdue > 0 && (
                                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '2px 8px', borderRadius: 4 }}>
                                    {inst.daysOverdue} days overdue
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handlePayViaWhatsApp(totalInstDue, inst.installmentNumber)}
                                className="btn btn-sm btn-primary"
                                style={{
                                  background: '#25D366',
                                  borderColor: '#1EBE5D',
                                  color: '#fff',
                                  fontWeight: 700,
                                  fontSize: 13,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <MessageCircle size={14} />
                                <span>Pay Now ({formatINR(totalInstDue)})</span>
                              </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, fontSize: 13 }}>
                              <div>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 11, display: 'block' }}>Due Date</span>
                                <span style={{ fontWeight: 600 }}>{formatDateDDMMYYYY(inst.dueDate)}</span>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 11, display: 'block' }}>Original EMI</span>
                                <span style={{ fontWeight: 600 }}>{formatINR(inst.expectedAmount)}</span>
                              </div>
                              <div>
                                <span style={{ color: 'var(--danger)', fontSize: 11, display: 'block' }}>Late Payment Penalty</span>
                                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{formatINR(inst.penaltyAmount || 0)}</span>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 11, display: 'block' }}>Total Due</span>
                                <span style={{ fontWeight: 800, color: 'var(--danger)' }}>{formatINR(totalInstDue)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

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
                    onClick={() => handlePayViaWhatsApp()}
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
                <button
                  onClick={() => setActiveTab('kyc')}
                  style={{
                    background: activeTab === 'kyc' ? 'var(--primary-subtle)' : 'transparent',
                    color: activeTab === 'kyc' ? 'var(--primary)' : 'var(--text-secondary)',
                    border: activeTab === 'kyc' ? '1px solid var(--primary-border)' : '1px solid transparent',
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
                  <ShieldCheck size={14} />
                  <span>KYC Documents ({kycDocs.length})</span>
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
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Original EMI</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Penalty</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Paid</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Remaining</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.installments && data.installments.length > 0 ? (
                        data.installments.map((inst) => {
                          const totalRemaining = inst.totalDue !== undefined ? inst.totalDue : (inst.remainingAmount + (inst.penaltyAmount || 0));
                          return (
                            <tr
                              key={inst.installmentNumber}
                              style={{
                                borderBottom: '1px solid var(--border-subtle)',
                                background: inst.status === 'PAID' ? 'transparent' : 'var(--bg-surface-secondary)',
                              }}
                            >
                              <td style={{ padding: '12px', fontWeight: 700 }}>{inst.installmentNumber}</td>
                              <td style={{ padding: '12px' }}>{formatDateDDMMYYYY(inst.dueDate)}</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>{formatINR(inst.expectedAmount)}</td>
                              <td style={{ padding: '12px', textAlign: 'right', color: (inst.penaltyAmount || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: (inst.penaltyAmount || 0) > 0 ? 700 : 400 }}>
                                {formatINR(inst.penaltyAmount || 0)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', color: inst.paidAmount > 0 ? 'var(--success-text)' : 'inherit' }}>
                                {formatINR(inst.paidAmount)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600, color: totalRemaining > 0 ? 'var(--danger-text)' : 'inherit' }}>
                                {formatINR(totalRemaining)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'center' }}>{getStatusBadge(inst.status)}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
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
                              {formatDateDDMMYYYY(pmt.paymentDate)}
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

              {/* Tab 3: KYC Documents */}
              {activeTab === 'kyc' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                        Borrower Identity & KYC Documents
                      </h4>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Official identification and agreement documents registered to your account
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={fetchKycDocuments}
                      disabled={loadingKyc}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <RefreshCw size={12} className={loadingKyc ? 'spin' : ''} />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {loadingKyc && (
                    <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
                      <RefreshCw size={24} className="spin" color="var(--primary)" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Loading borrower documents...</div>
                    </div>
                  )}

                  {kycError && !loadingKyc && (
                    <div style={{ padding: 16, background: 'var(--danger-bg)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>
                      <div style={{ fontWeight: 600 }}>Unable to load KYC documents</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>{kycError}</div>
                    </div>
                  )}

                  {!loadingKyc && !kycError && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                            <th style={{ padding: '10px 12px' }}>Document Type</th>
                            <th style={{ padding: '10px 12px' }}>Document Number</th>
                            <th style={{ padding: '10px 12px' }}>Status</th>
                            <th style={{ padding: '10px 12px' }}>Format</th>
                            <th style={{ padding: '10px 12px' }}>Date</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kycDocs && kycDocs.length > 0 ? (
                            kycDocs.map((doc: any) => (
                              <tr key={doc.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <FileText size={14} color="var(--primary)" />
                                    <span>{doc.docType}</span>
                                  </div>
                                </td>
                                <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: 12 }}>
                                  {doc.docNumberMasked || 'Verified Customer File'}
                                </td>
                                <td style={{ padding: '12px' }}>
                                  <span className="badge badge-paid">{doc.status || 'VERIFIED'}</span>
                                </td>
                                <td style={{ padding: '12px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                  {doc.fileMimeType ? doc.fileMimeType.split('/')[1] || doc.fileMimeType : 'DOCUMENT'}
                                </td>
                                <td style={{ padding: '12px', fontSize: 12, color: 'var(--text-secondary)' }}>
                                  {doc.createdAt ? formatDateDDMMYYYY(doc.createdAt) : '—'}
                                </td>
                                <td style={{ padding: '12px', textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setViewingKycDoc({
                                        id: doc.id,
                                        title: `${doc.docType} (${doc.docNumberMasked || 'Borrower KYC'})`,
                                        docType: doc.docType,
                                        fileMimeType: doc.fileMimeType,
                                      })
                                    }
                                    className="btn btn-secondary btn-sm"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  >
                                    <Eye size={12} />
                                    <span>View</span>
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
                                <ShieldCheck size={28} color="var(--text-muted)" style={{ marginBottom: 6 }} />
                                <div>No KYC documents are currently available for this loan account.</div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
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
        );
      })()}
      </main>

      {/* Contact Support Modal */}
      {showContactModal && (
        <div
          className="modal-overlay"
          style={{ zIndex: 3000, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)' }}
          onClick={() => setShowContactModal(false)}
        >
          <div
            className="modal-content"
            style={{
              maxWidth: 480,
              padding: 24,
              borderRadius: 12,
              background: '#ffffff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: '#eff6ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--primary)',
                  }}
                >
                  <HelpCircle size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    {lang === 'hi' ? 'सहायता संपर्क जानकारी' : 'Support Contact Information'}
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Alpha Mobile Gallery • Shubh Pvt Ltd
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 20 }}>
              {lang === 'hi' ? (
                <>
                  <p style={{ margin: '0 0 10px 0' }}>
                    समर्थन संपर्क विवरण वर्तमान में प्रशासन द्वारा अद्यतन किए जा रहे हैं।
                  </p>
                  <p style={{ margin: 0 }}>
                    बकाया EMI भुगतान अथवा रसीद सहायता के लिए कृपया अपनी निकटतम <strong>अल्फा मोबाइल गैलरी</strong> शाखा पर संपर्क करें अथवा अपने ऋण अनुबंध दस्तावेज में दिए गए शाखा पते पर संपर्क करें।
                  </p>
                </>
              ) : (
                <>
                  <p style={{ margin: '0 0 10px 0' }}>
                    Support contact details are currently being updated by the administration.
                  </p>
                  <p style={{ margin: 0 }}>
                    For immediate assistance regarding your overdue EMI payment or receipt confirmation, please visit your nearest <strong>Alpha Mobile Gallery</strong> store or refer to the branch contact information in your physical loan agreement.
                  </p>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="btn btn-primary btn-sm"
              >
                {lang === 'hi' ? 'समझ गया' : 'Understood'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Portal Secure KYC Document Viewer Modal */}
      {viewingKycDoc && (
        <DocumentViewerModal
          documentId={viewingKycDoc.id}
          portalToken={token || undefined}
          title={viewingKycDoc.title}
          docType={viewingKycDoc.docType}
          fileMimeType={viewingKycDoc.fileMimeType}
          onClose={() => setViewingKycDoc(null)}
        />
      )}
    </div>
  );
};

export default CustomerPortalView;
