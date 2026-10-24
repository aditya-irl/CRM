import React, { useEffect, useState, useCallback } from 'react';
import { ApiClient, ICustomerPortalLoanData, ICashfreeOrderData, ICashfreeVerifyData } from '../services/api';
import { launchCashfreeRedirectCheckout } from '../utils/cashfree';
import {
  formatINR,
  formatDateDDMMYYYY,
  CustomerVerificationStatus,
  VerificationSection,
  ICustomerPortalProfile,
  ICustomerCorrectionRequest,
  WHATSAPP_SUPPORT_CONFIG,
  buildWhatsAppSupportUrl,
} from '@crm/shared';
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
  User,
  MapPin,
  Mail,
  Camera,
  AlertTriangle,
  CheckCheck,
  Info,
  Send,
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
  const [activeTab, setActiveTab] = useState<'schedule' | 'history' | 'kyc' | 'profile'>('schedule');
  const [kycDocs, setKycDocs] = useState<any[]>([]);
  const [loadingKyc, setLoadingKyc] = useState<boolean>(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [viewingKycDoc, setViewingKycDoc] = useState<{
    id: string;
    title: string;
    docType: string;
    fileMimeType?: string;
  } | null>(null);

  // Profile & Verification state
  const [profileData, setProfileData] = useState<ICustomerPortalProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [confirmingProfile, setConfirmingProfile] = useState<boolean>(false);
  const [confirmSuccessMsg, setConfirmSuccessMsg] = useState<string | null>(null);
  const [showIssueModal, setShowIssueModal] = useState<boolean>(false);
  const [issueSection, setIssueSection] = useState<VerificationSection>(VerificationSection.PERSONAL_DETAILS);
  const [issueExplanation, setIssueExplanation] = useState<string>('');
  const [submittingIssue, setSubmittingIssue] = useState<boolean>(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueSuccessMsg, setIssueSuccessMsg] = useState<string | null>(null);

  // Cashfree Payments & Redirect Checkout state
  const [payingInstallmentNumber, setPayingInstallmentNumber] = useState<number | 'hero' | null>(null);
  const [paymentPhase, setPaymentPhase] = useState<'idle' | 'initiating' | 'redirecting' | 'verifying'>('idle');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentResultModal, setPaymentResultModal] = useState<ICashfreeVerifyData | null>(null);


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
      contactBtn: 'Contact on WhatsApp',
      whatsappBtn: 'Pay via WhatsApp',
    },
    hi: {
      title: 'EMI भुगतान रिमाइंडर',
      body: 'आपकी EMI बकाया है? कृपया पेनल्टी से बचने के लिए अपनी बाकी EMI का भुगतान जल्द करें। लगातार भुगतान न करने पर कानून के अनुसार कानूनी कार्रवाई हो सकती है और आपके क्रेडिट स्कोर पर बुरा असर पड़ सकता है। सहायता के लिए अभी संपर्क करें।',
      overdueDueLabel: 'बकाया राशि',
      penaltyLabel: 'लागू पेनल्टी',
      totalDueLabel: 'कुल देय राशि',
      contactBtn: 'व्हाट्सएप पर संपर्क करें',
      whatsappBtn: 'व्हाट्सएप से भुगतान करें',
    },
  };

  const handleContactNow = () => {
    const defaultMsg = lang === 'hi'
      ? `नमस्ते ${WHATSAPP_SUPPORT_CONFIG.displayName}, मुझे अपने CRM खाते/ऋण के संबंध में सहायता चाहिए। मेरा प्रश्न है: `
      : WHATSAPP_SUPPORT_CONFIG.defaultCustomerMessage;
    const waUrl = buildWhatsAppSupportUrl(defaultMsg);
    try {
      const opened = window.open(waUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        setShowContactModal(true);
      }
    } catch {
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

  const fetchProfile = useCallback(async () => {
    if (!token || !token.trim()) return;
    setLoadingProfile(true);
    setProfileError(null);
    try {
      const profile = await ApiClient.getCustomerPortalProfile(token);
      setProfileData(profile);
    } catch (err: any) {
      console.error('Failed to load portal profile:', err);
      setProfileError(err.message || 'Unable to load profile details.');
    } finally {
      setLoadingProfile(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchKycDocuments();
      fetchProfile();
    }
  }, [token, fetchKycDocuments, fetchProfile]);

  const handleConfirmProfile = async (section: VerificationSection = VerificationSection.ALL) => {
    if (!token || confirmingProfile) return;
    setConfirmingProfile(true);
    setConfirmSuccessMsg(null);
    try {
      const res = await ApiClient.confirmCustomerPortalProfile(token, section);
      setConfirmSuccessMsg(
        lang === 'hi'
          ? 'आपके विवरण की पुष्टि सफलतापूर्वक दर्ज कर ली गई है।'
          : res.message || 'Thank you! Your confirmation has been recorded successfully.'
      );
      await fetchProfile();
    } catch (err: any) {
      alert(err.message || 'Failed to confirm details. Please try again.');
    } finally {
      setConfirmingProfile(false);
    }
  };

  const handleOpenReportIssue = (section: VerificationSection = VerificationSection.PERSONAL_DETAILS) => {
    setIssueSection(section);
    setIssueExplanation('');
    setIssueError(null);
    setIssueSuccessMsg(null);
    setShowIssueModal(true);
  };

  const handleSubmitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || submittingIssue) return;
    if (!issueExplanation.trim() || issueExplanation.trim().length < 5) {
      setIssueError(
        lang === 'hi'
          ? 'कृपया समस्या का संक्षिप्त विवरण दें (कम से कम 5 अक्षर)।'
          : 'Please provide a short explanation (minimum 5 characters).'
      );
      return;
    }

    setSubmittingIssue(true);
    setIssueError(null);
    try {
      const res = await ApiClient.reportCustomerPortalIssue(token, issueSection, issueExplanation.trim());
      setIssueSuccessMsg(
        lang === 'hi'
          ? 'आपकी समस्या रिपोर्ट सफलतापूर्वक सबमिट हो गई है। हमारी टीम इसकी समीक्षा करेगी।'
          : res.message || 'Issue reported successfully. Our operations team will review your report.'
      );
      setIssueExplanation('');
      await fetchProfile();
      setTimeout(() => {
        setShowIssueModal(false);
      }, 1800);
    } catch (err: any) {
      setIssueError(err.message || 'Failed to submit issue report.');
    } finally {
      setSubmittingIssue(false);
    }
  };

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

  // Check URL on load for returned checkout redirect: ?order_id=...
  useEffect(() => {
    if (!token || !token.trim()) return;
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const returnedOrderId = params.get('order_id');
    if (!returnedOrderId) return;

    let isCancelled = false;
    const verifyReturnedOrder = async () => {
      setPaymentPhase('verifying');
      try {
        const verifyResult = await ApiClient.verifyCustomerPortalPaymentOrder(token, returnedOrderId);
        if (!isCancelled) {
          setPaymentResultModal(verifyResult);
          // If payment was verified successful, refresh portal data immediately
          if (verifyResult.status === 'SUCCESS') {
            fetchPortalData(true);
          }
          // Clean the query string without losing the token
          const cleanParams = new URLSearchParams(window.location.search);
          cleanParams.delete('order_id');
          cleanParams.delete('payment_status');
          const newUrl = `${window.location.pathname}?${cleanParams.toString()}${window.location.hash}`;
          window.history.replaceState({}, '', newUrl);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setPaymentError(err.message || 'Unable to verify payment status.');
        }
      } finally {
        if (!isCancelled) {
          setPaymentPhase('idle');
        }
      }
    };

    verifyReturnedOrder();
    return () => {
      isCancelled = true;
    };
  }, [token, fetchPortalData]);

  // Handler to initiate Cashfree Redirect Checkout
  const handleCashfreePay = async (installmentNumber?: number, targetName: number | 'hero' = 'hero') => {
    if (!token || !token.trim()) return;
    setPayingInstallmentNumber(targetName);
    setPaymentPhase('initiating');
    setPaymentError(null);

    try {
      // 1. Create secure server-side order with authoritative amount
      const orderData = await ApiClient.createCustomerPortalPaymentOrder(token, installmentNumber);

      // 2. Launch Cashfree Redirect Checkout
      setPaymentPhase('redirecting');
      await launchCashfreeRedirectCheckout({
        paymentSessionId: orderData.paymentSessionId,
        environment: orderData.environment,
        redirectTarget: '_self',
      });
    } catch (err: any) {
      console.error('Cashfree checkout initiation failed:', err);
      setPaymentError(err.message || 'Unable to start checkout. Please try again or contact support.');
      setPaymentPhase('idle');
      setPayingInstallmentNumber(null);
    }
  };

  // WhatsApp Pay Action - Centralized Support Contact (Sparsh Aggrawal)
  const handlePayViaWhatsApp = (_customAmount?: number, _instNumber?: number) => {
    const payMsg = lang === 'hi'
      ? `नमस्ते ${WHATSAPP_SUPPORT_CONFIG.displayName}, मुझे अपने EMI भुगतान के संबंध में सहायता चाहिए। मेरा प्रश्न है: `
      : WHATSAPP_SUPPORT_CONFIG.defaultPaymentMessage;
    const waUrl = buildWhatsAppSupportUrl(payMsg);
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

          <a
            href={buildWhatsAppSupportUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm"
            style={{
              background: '#25D366',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: 12,
              gap: 6,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm, 6px)',
              cursor: 'pointer',
            }}
            title={`Contact ${WHATSAPP_SUPPORT_CONFIG.displayName} on WhatsApp (${WHATSAPP_SUPPORT_CONFIG.formattedPhone})`}
          >
            <MessageCircle size={14} />
            <span>{lang === 'hi' ? 'व्हाट्सएप सहायता' : 'WhatsApp Support'}</span>
          </a>

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
              <div style={{ marginTop: 16 }}>
                <a
                  href={buildWhatsAppSupportUrl(`Hello ${WHATSAPP_SUPPORT_CONFIG.displayName}, I need assistance accessing my CRM customer portal link. My query is: `)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                  style={{
                    background: '#25D366',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    borderRadius: 6,
                    textDecoration: 'none',
                    boxShadow: '0 2px 4px rgba(37, 211, 102, 0.2)',
                  }}
                  id="error-contact-whatsapp-btn"
                >
                  <MessageCircle size={15} />
                  <span>Contact Support on WhatsApp</span>
                </a>
              </div>
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
                        background: '#25D366',
                        borderColor: '#16a34a',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: 14,
                        padding: '10px 20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        boxShadow: '0 2px 4px rgba(37, 211, 102, 0.25)',
                      }}
                      title={`Contact ${WHATSAPP_SUPPORT_CONFIG.displayName} on WhatsApp`}
                    >
                      <MessageCircle size={16} />
                      <span>{overdueCopy[lang].contactBtn}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Payment Verification Processing Banner */}
              {paymentPhase === 'verifying' && (
                <div
                  style={{
                    background: 'var(--primary-subtle)',
                    border: '1px solid var(--primary-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    color: 'var(--primary)',
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  <RefreshCw size={18} className="animate-spin" />
                  <span>Verifying your payment status with Cashfree and your bank... Please do not close this window.</span>
                </div>
              )}

              {/* Payment Error Alert Banner */}
              {paymentError && (
                <div
                  style={{
                    background: 'var(--danger-bg)',
                    border: '1px solid var(--danger-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 18px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    color: 'var(--danger)',
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={18} />
                    <span>{paymentError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPaymentError(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
                  >
                    <X size={16} />
                  </button>
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
                className="kpi-grid-mobile-2col"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
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
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  disabled={paymentPhase !== 'idle'}
                                  onClick={() => handleCashfreePay(inst.installmentNumber, inst.installmentNumber)}
                                  className="btn btn-sm btn-primary"
                                  style={{
                                    fontWeight: 700,
                                    fontSize: 13,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    cursor: paymentPhase !== 'idle' ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {payingInstallmentNumber === inst.installmentNumber ? (
                                    <>
                                      <RefreshCw size={14} className="animate-spin" />
                                      <span>{paymentPhase === 'redirecting' ? 'Redirecting...' : 'Processing...'}</span>
                                    </>
                                  ) : (
                                    <>
                                      <CreditCard size={14} />
                                      <span>Pay Now ({formatINR(totalInstDue)})</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePayViaWhatsApp(totalInstDue, inst.installmentNumber)}
                                  className="btn btn-sm btn-outline"
                                  style={{
                                    fontSize: 13,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                >
                                  <MessageCircle size={14} />
                                  <span>WhatsApp</span>
                                </button>
                              </div>
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

              {/* ─── Primary CTA: Secure Cashfree Online Payment ────────────────────── */}
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--primary-border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className="badge badge-primary" style={{ fontSize: 11, fontWeight: 700 }}>
                        SECURE CHECKOUT
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cashfree Payments</span>
                    </div>
                    <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                      Pay Outstanding EMI Online
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                      Instant secure payment with UPI, Debit/Credit Card, or Netbanking via Cashfree Redirect Checkout.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      disabled={paymentPhase !== 'idle' || data.outstandingBalance <= 0}
                      onClick={() => handleCashfreePay(undefined, 'hero')}
                      className="btn btn-primary"
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        padding: '12px 24px',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: '0 2px 8px rgba(105, 48, 202, 0.3)',
                        cursor: paymentPhase !== 'idle' || data.outstandingBalance <= 0 ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      {payingInstallmentNumber === 'hero' ? (
                        <>
                          <RefreshCw size={18} className="animate-spin" />
                          <span>{paymentPhase === 'redirecting' ? 'Redirecting to Checkout...' : 'Connecting to Gateway...'}</span>
                        </>
                      ) : (() => {
                        const nextUnpaidInst = data.installments?.find(
                          (i) => i.status !== 'PAID' && ((i.remainingAmount ?? 0) > 0 || (i.penaltyAmount ?? 0) > 0)
                        );
                        const heroPayableAmount = nextUnpaidInst
                          ? (nextUnpaidInst.totalDue !== undefined ? nextUnpaidInst.totalDue : (nextUnpaidInst.remainingAmount + (nextUnpaidInst.penaltyAmount || 0)))
                          : data.emiAmount;
                        return (
                          <>
                            <CreditCard size={18} />
                            <span>
                              Pay EMI ({formatINR(heroPayableAmount)})
                              {nextUnpaidInst && (nextUnpaidInst.penaltyAmount || 0) > 0 && (
                                <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.9 }}>
                                  (incl. {formatINR(nextUnpaidInst.penaltyAmount || 0)} penalty)
                                </span>
                              )}
                            </span>
                          </>
                        );
                      })()}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePayViaWhatsApp()}
                      className="btn btn-outline"
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '12px 18px',
                        borderRadius: 'var(--radius-md)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <MessageCircle size={16} />
                      <span>Pay Now via WhatsApp</span>
                    </button>
                  </div>
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
                className="portal-tabs-scroll"
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
                <button
                  onClick={() => setActiveTab('profile')}
                  style={{
                    background: activeTab === 'profile' ? 'var(--primary-subtle)' : 'transparent',
                    color: activeTab === 'profile' ? 'var(--primary)' : 'var(--text-secondary)',
                    border: activeTab === 'profile' ? '1px solid var(--primary-border)' : '1px solid transparent',
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
                  <User size={14} />
                  <span>{lang === 'hi' ? 'मेरी जानकारी व सत्यापन' : 'Verify My Details'}</span>
                  {profileData && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 10,
                        background:
                          profileData.verificationStatus === CustomerVerificationStatus.CONFIRMED
                            ? '#ecfdf5'
                            : '#fef3c7',
                        color:
                          profileData.verificationStatus === CustomerVerificationStatus.CONFIRMED
                            ? '#065f46'
                            : '#92400e',
                      }}
                    >
                      {profileData.verificationStatus === CustomerVerificationStatus.CONFIRMED ? '✓' : '!'}
                    </span>
                  )}
                </button>
              </div>

              {/* Tab 1: EMI Schedule */}
              {activeTab === 'schedule' && (
                <div>
                  {/* Mobile Installment Cards (Displayed on <= 768px, including iPhone 17) */}
                  <div className="mobile-only-card-view">
                    {data.installments && data.installments.length > 0 ? (
                      data.installments.map((inst) => {
                        const totalRemaining = inst.totalDue !== undefined ? inst.totalDue : (inst.remainingAmount + (inst.penaltyAmount || 0));
                        const isFullyPaid = inst.status === 'PAID' || totalRemaining <= 0;
                        return (
                          <div
                            key={`mob-inst-${inst.installmentNumber}`}
                            className="crm-card"
                            style={{
                              padding: '14px 16px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                              background: isFullyPaid ? '#ffffff' : 'var(--bg-surface-secondary)',
                              borderLeft: isFullyPaid ? '4px solid var(--success)' : (inst.penaltyAmount || 0) > 0 ? '4px solid var(--danger)' : '4px solid var(--primary)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>
                                  EMI #{inst.installmentNumber}
                                </span>
                                {getStatusBadge(inst.status)}
                              </div>
                              {inst.daysOverdue !== undefined && inst.daysOverdue > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '2px 8px', borderRadius: 4 }}>
                                  {inst.daysOverdue}d overdue
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 12 }}>
                              <div>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Due Date</span>
                                <div style={{ fontWeight: 700, marginTop: 1 }}>{formatDateDDMMYYYY(inst.dueDate)}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Original EMI</span>
                                <div style={{ fontWeight: 700, marginTop: 1 }}>{formatINR(inst.expectedAmount)}</div>
                              </div>
                              {(inst.penaltyAmount || 0) > 0 && (
                                <div>
                                  <span style={{ color: 'var(--danger)', fontSize: 11 }}>Late Penalty</span>
                                  <div style={{ fontWeight: 800, color: 'var(--danger)', marginTop: 1 }}>{formatINR(inst.penaltyAmount || 0)}</div>
                                </div>
                              )}
                              <div style={{ textAlign: (inst.penaltyAmount || 0) > 0 ? 'right' : 'left' }}>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Total Remaining</span>
                                <div style={{ fontWeight: 800, fontSize: 14, color: totalRemaining > 0 ? 'var(--danger-text)' : 'var(--success-text)', marginTop: 1 }}>
                                  {formatINR(totalRemaining)}
                                </div>
                              </div>
                            </div>

                            {/* Mobile Installment Action Button */}
                            <div style={{ marginTop: 4 }}>
                              {isFullyPaid ? (
                                <div style={{ fontSize: 12, color: 'var(--success-text)', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, padding: '6px 0' }}>
                                  <CheckCircle2 size={16} />
                                  <span>Paid in Full</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={paymentPhase !== 'idle'}
                                  onClick={() => handleCashfreePay(inst.installmentNumber, inst.installmentNumber)}
                                  className="btn btn-primary"
                                  style={{
                                    width: '100%',
                                    minHeight: 44,
                                    fontSize: 14,
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    cursor: paymentPhase !== 'idle' ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {payingInstallmentNumber === inst.installmentNumber ? (
                                    <>
                                      <RefreshCw size={14} className="animate-spin" />
                                      <span>{paymentPhase === 'redirecting' ? 'Redirecting to Checkout...' : 'Connecting to Gateway...'}</span>
                                    </>
                                  ) : (
                                    <>
                                      <CreditCard size={15} />
                                      <span>Pay EMI Online ({formatINR(totalRemaining)})</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No installments recorded.
                      </div>
                    )}
                  </div>

                  {/* Desktop Installments Table (Displayed on > 768px) */}
                  <div className="desktop-only-table-view" style={{ overflowX: 'auto' }}>
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
                          <th style={{ padding: '10px 12px', textAlign: 'center' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.installments && data.installments.length > 0 ? (
                          data.installments.map((inst) => {
                            const totalRemaining = inst.totalDue !== undefined ? inst.totalDue : (inst.remainingAmount + (inst.penaltyAmount || 0));
                            const isFullyPaid = inst.status === 'PAID' || totalRemaining <= 0;
                            return (
                              <tr
                                key={inst.installmentNumber}
                                style={{
                                  borderBottom: '1px solid var(--border-subtle)',
                                  background: isFullyPaid ? 'transparent' : 'var(--bg-surface-secondary)',
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
                                <td style={{ padding: '12px', textAlign: 'center' }}>
                                  {isFullyPaid ? (
                                    <span style={{ fontSize: 12, color: 'var(--success-text)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                                      <CheckCircle2 size={14} /> Paid
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={paymentPhase !== 'idle'}
                                      onClick={() => handleCashfreePay(inst.installmentNumber, inst.installmentNumber)}
                                      className="btn btn-sm btn-primary"
                                      style={{
                                        padding: '5px 12px',
                                        fontSize: 12,
                                        fontWeight: 700,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: paymentPhase !== 'idle' ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      {payingInstallmentNumber === inst.installmentNumber ? (
                                        <>
                                          <RefreshCw size={12} className="animate-spin" />
                                          <span>{paymentPhase === 'redirecting' ? 'Redirecting...' : 'Initiating...'}</span>
                                        </>
                                      ) : (
                                        <>
                                          <CreditCard size={12} />
                                          <span>Pay Now</span>
                                        </>
                                      )}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                              No installments recorded.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 2: Payment History */}
              {activeTab === 'history' && (
                <div>
                  {/* Mobile Payment History Cards (Displayed on <= 768px, including iPhone 17) */}
                  <div className="mobile-only-card-view">
                    {data.paymentHistory && data.paymentHistory.length > 0 ? (
                      data.paymentHistory.map((pmt) => (
                        <div
                          key={`mob-pmt-${pmt.receiptNumber}`}
                          className="crm-card"
                          style={{
                            padding: '12px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            borderLeft: '4px solid var(--success)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Receipt size={14} color="var(--primary)" />
                              <span className="mono" style={{ fontWeight: 800, color: 'var(--primary)', fontSize: 13 }}>
                                {pmt.receiptNumber}
                              </span>
                            </div>
                            <div>{getStatusBadge(pmt.status)}</div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Payment Date: </span>
                              <span style={{ fontSize: 12, fontWeight: 600 }}>{formatDateDDMMYYYY(pmt.paymentDate)}</span>
                            </div>
                            <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--success-text)' }}>
                              {formatINR(pmt.amount)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-start', borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
                            <span className="badge badge-upcoming">{pmt.paymentMode}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No verified payments yet. Click &ldquo;Pay EMI&rdquo; above to make a payment.
                      </div>
                    )}
                  </div>

                  {/* Desktop Payment History Table (Displayed on > 768px) */}
                  <div className="desktop-only-table-view" style={{ overflowX: 'auto' }}>
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

              {/* Tab 4: Verify My Details / My Profile */}
              {activeTab === 'profile' && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 16,
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {lang === 'hi' ? 'मेरी पंजीकृत जानकारी और सत्यापन' : 'My Registered Information & Self-Verification'}
                      </h4>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {lang === 'hi'
                          ? 'कृपया जांचें कि CRM में आपके पंजीकृत नाम, संपर्क, पता, फोटो और पहचान विवरण सही हैं।'
                          : 'Review your registered identity, contact, address, photograph, and document details.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={fetchProfile}
                      disabled={loadingProfile}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <RefreshCw size={12} className={loadingProfile ? 'spin' : ''} />
                      <span>{lang === 'hi' ? 'ताज़ा करें' : 'Refresh'}</span>
                    </button>
                  </div>

                  {loadingProfile && !profileData && (
                    <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                      <RefreshCw size={24} className="spin" color="var(--primary)" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {lang === 'hi' ? 'प्रोफ़ाइल लोड हो रही है...' : 'Loading profile details...'}
                      </div>
                    </div>
                  )}

                  {profileError && !loadingProfile && (
                    <div
                      style={{
                        padding: 16,
                        background: 'var(--danger-bg)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--danger)',
                        fontSize: 13,
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {lang === 'hi' ? 'प्रोफ़ाइल विवरण लोड करने में असमर्थ' : 'Unable to load profile'}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>{profileError}</div>
                    </div>
                  )}

                  {confirmSuccessMsg && (
                    <div
                      style={{
                        padding: '12px 16px',
                        background: '#ecfdf5',
                        border: '1px solid #a7f3d0',
                        borderRadius: 'var(--radius-md)',
                        color: '#065f46',
                        fontSize: 13,
                        fontWeight: 600,
                        marginBottom: 16,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <CheckCircle2 size={16} />
                      <span>{confirmSuccessMsg}</span>
                    </div>
                  )}

                  {profileData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      {/* ─── Verification Status & Overall Actions Card ─── */}
                      <div
                        style={{
                          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.03) 0%, rgba(30, 41, 59, 0.08) 100%)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-lg, 12px)',
                          padding: 18,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 14,
                        }}
                      >
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
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                              {lang === 'hi' ? 'सत्यापन स्थिति' : 'Verification Status'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              {(() => {
                                switch (profileData.verificationStatus) {
                                  case CustomerVerificationStatus.CONFIRMED:
                                    return (
                                      <span
                                        style={{
                                          background: '#ecfdf5',
                                          color: '#065f46',
                                          border: '1px solid #a7f3d0',
                                          borderRadius: 20,
                                          padding: '4px 12px',
                                          fontSize: 13,
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}
                                      >
                                        <CheckCheck size={14} />
                                        {lang === 'hi' ? 'ग्राहक द्वारा पुष्टीकृत' : 'Confirmed by Customer'}
                                      </span>
                                    );
                                  case CustomerVerificationStatus.CORRECTION_REQUESTED:
                                    return (
                                      <span
                                        style={{
                                          background: '#fffbeb',
                                          color: '#92400e',
                                          border: '1px solid #fde68a',
                                          borderRadius: 20,
                                          padding: '4px 12px',
                                          fontSize: 13,
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}
                                      >
                                        <AlertTriangle size={14} />
                                        {lang === 'hi' ? 'सुधार का अनुरोध किया गया' : 'Correction Requested'}
                                      </span>
                                    );
                                  case CustomerVerificationStatus.UNDER_REVIEW:
                                    return (
                                      <span
                                        style={{
                                          background: '#eff6ff',
                                          color: '#1e40af',
                                          border: '1px solid #bfdbfe',
                                          borderRadius: 20,
                                          padding: '4px 12px',
                                          fontSize: 13,
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}
                                      >
                                        <Clock size={14} />
                                        {lang === 'hi' ? 'समीक्षाधीन' : 'Under Review'}
                                      </span>
                                    );
                                  case CustomerVerificationStatus.RESOLVED:
                                    return (
                                      <span
                                        style={{
                                          background: '#f0fdf4',
                                          color: '#166534',
                                          border: '1px solid #bbf7d0',
                                          borderRadius: 20,
                                          padding: '4px 12px',
                                          fontSize: 13,
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}
                                      >
                                        <CheckCircle2 size={14} />
                                        {lang === 'hi' ? 'समाधान हुआ' : 'Resolved'}
                                      </span>
                                    );
                                  case CustomerVerificationStatus.REJECTED:
                                    return (
                                      <span
                                        style={{
                                          background: '#fef2f2',
                                          color: '#991b1b',
                                          border: '1px solid #fecaca',
                                          borderRadius: 20,
                                          padding: '4px 12px',
                                          fontSize: 13,
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}
                                      >
                                        <X size={14} />
                                        {lang === 'hi' ? 'सुधार अनुरोध अस्वीकृत' : 'Correction Rejected'}
                                      </span>
                                    );
                                  default:
                                    return (
                                      <span
                                        style={{
                                          background: '#f1f5f9',
                                          color: '#475569',
                                          border: '1px solid #cbd5e1',
                                          borderRadius: 20,
                                          padding: '4px 12px',
                                          fontSize: 13,
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}
                                      >
                                        <Info size={14} />
                                        {lang === 'hi' ? 'समीक्षा नहीं की गई' : 'Not Reviewed'}
                                      </span>
                                    );
                                }
                              })()}

                              {profileData.confirmedAt && (
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                  ({lang === 'hi' ? 'पुष्टि तिथि: ' : 'Confirmed: '}
                                  {formatDateDDMMYYYY(profileData.confirmedAt)})
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => handleConfirmProfile(VerificationSection.ALL)}
                              disabled={confirmingProfile}
                              className="btn btn-primary btn-sm"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                background: '#059669',
                                borderColor: '#059669',
                                color: '#ffffff',
                                padding: '8px 16px',
                                fontWeight: 700,
                              }}
                            >
                              <CheckCircle2 size={15} />
                              <span>
                                {confirmingProfile
                                  ? lang === 'hi' ? 'पुष्टि हो रही है...' : 'Confirming...'
                                  : lang === 'hi' ? 'विवरण सही हैं' : 'Details Are Correct'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenReportIssue(VerificationSection.ALL)}
                              className="btn btn-secondary btn-sm"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '8px 16px',
                                fontWeight: 700,
                              }}
                            >
                              <AlertCircle size={15} />
                              <span>{lang === 'hi' ? 'समस्या रिपोर्ट करें' : 'Report an Issue'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Statutory / Regulatory Distinction Notice */}
                        <div
                          style={{
                            background: '#ffffff',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-md, 8px)',
                            padding: '10px 14px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            fontSize: 12,
                            color: 'var(--text-secondary)',
                            lineHeight: 1.5,
                          }}
                        >
                          <Info size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                          <div>
                            <strong>
                              {lang === 'hi' ? 'महत्वपूर्ण नियामक सूचना: ' : 'Important Notice: '}
                            </strong>
                            {lang === 'hi'
                              ? 'ग्राहक पुष्टि यह सुनिश्चित करती है कि CRM में आपके पंजीकृत नाम, संपर्क, पता और दस्तावेज़ सही दर्ज हैं। यह पुष्टि केवल रिकॉर्ड सटीकता और ग्राहक अभिपुष्टि के लिए है, और यह आधिकारिक विनियामक KYC अनुमोदन या अनुपालन का गठन नहीं करती है।'
                              : 'Customer confirmation verifies that our CRM contains your accurate identity, contact, address, and document details. Customer confirmation is for record accuracy only and does not constitute or imply official regulatory KYC approval.'}
                          </div>
                        </div>
                      </div>

                      {/* ─── Cards Grid ─── */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                          gap: 16,
                        }}
                      >
                        {/* 1. Personal Details */}
                        <div
                          className="crm-card"
                          style={{
                            padding: 16,
                            background: 'var(--bg-primary, #ffffff)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-lg, 12px)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: '1px solid var(--border-subtle)',
                                paddingBottom: 10,
                                marginBottom: 12,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                                <User size={16} color="var(--primary)" />
                                <span>{lang === 'hi' ? 'व्यक्तिगत विवरण' : 'Personal Details'}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenReportIssue(VerificationSection.PERSONAL_DETAILS)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--primary)',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                              >
                                {lang === 'hi' ? 'समस्या रिपोर्ट करें' : 'Report Issue'}
                              </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                  {lang === 'hi' ? 'पूरा नाम' : 'FULL NAME'}
                                </span>
                                <strong style={{ color: 'var(--text-primary)' }}>{profileData.fullName}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                  {lang === 'hi' ? 'जन्म तिथि' : 'DATE OF BIRTH'}
                                </span>
                                {profileData.dob ? (
                                  <strong>{profileData.dob}</strong>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                    {lang === 'hi' ? 'उपलब्ध नहीं' : 'Not Provided'}
                                  </span>
                                )}
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                  {lang === 'hi' ? 'लिंग' : 'GENDER'}
                                </span>
                                {profileData.gender ? (
                                  <strong>{profileData.gender}</strong>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                    {lang === 'hi' ? 'उपलब्ध नहीं' : 'Not Provided'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 2. Contact Details */}
                        <div
                          className="crm-card"
                          style={{
                            padding: 16,
                            background: 'var(--bg-primary, #ffffff)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-lg, 12px)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: '1px solid var(--border-subtle)',
                                paddingBottom: 10,
                                marginBottom: 12,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                                <Phone size={16} color="var(--primary)" />
                                <span>{lang === 'hi' ? 'संपर्क विवरण' : 'Contact Details'}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenReportIssue(VerificationSection.CONTACT_DETAILS)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--primary)',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                              >
                                {lang === 'hi' ? 'समस्या रिपोर्ट करें' : 'Report Issue'}
                              </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                  {lang === 'hi' ? 'पंजीकृत मोबाइल' : 'REGISTERED MOBILE'}
                                </span>
                                <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                                  {profileData.primaryPhone}
                                </strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                  {lang === 'hi' ? 'वैकल्पिक मोबाइल' : 'ALTERNATE MOBILE'}
                                </span>
                                {profileData.alternatePhone ? (
                                  <strong style={{ fontFamily: 'monospace' }}>{profileData.alternatePhone}</strong>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                    {lang === 'hi' ? 'उपलब्ध नहीं' : 'Not Provided'}
                                  </span>
                                )}
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                  {lang === 'hi' ? 'ईमेल' : 'EMAIL ADDRESS'}
                                </span>
                                {profileData.email ? (
                                  <strong>{profileData.email}</strong>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                    {lang === 'hi' ? 'उपलब्ध नहीं' : 'Not Provided'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 3. Registered Address */}
                        <div
                          className="crm-card"
                          style={{
                            padding: 16,
                            background: 'var(--bg-primary, #ffffff)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-lg, 12px)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: '1px solid var(--border-subtle)',
                                paddingBottom: 10,
                                marginBottom: 12,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                                <MapPin size={16} color="var(--primary)" />
                                <span>{lang === 'hi' ? 'पंजीकृत पता' : 'Registered Address'}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenReportIssue(VerificationSection.ADDRESS)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--primary)',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                              >
                                {lang === 'hi' ? 'समस्या रिपोर्ट करें' : 'Report Issue'}
                              </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                  {lang === 'hi' ? 'सड़क / मकान' : 'STREET / ADDRESS'}
                                </span>
                                <strong style={{ color: 'var(--text-primary)' }}>{profileData.addressLine1}</strong>
                                {profileData.addressLine2 && <div>{profileData.addressLine2}</div>}
                                {profileData.landmark && (
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Landmark: {profileData.landmark}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                <div>
                                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                    {lang === 'hi' ? 'शहर और राज्य' : 'CITY & STATE'}
                                  </span>
                                  <strong>{profileData.city}, {profileData.state}</strong>
                                </div>
                                <div>
                                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                    {lang === 'hi' ? 'पिन कोड' : 'PIN CODE'}
                                  </span>
                                  <strong style={{ fontFamily: 'monospace' }}>{profileData.pincode}</strong>
                                </div>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11, fontWeight: 600 }}>
                                  {lang === 'hi' ? 'रूट / क्षेत्र' : 'COLLECTION ROUTE / AREA'}
                                </span>
                                <span style={{ color: 'var(--text-secondary)' }}>{profileData.areaRoute}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 4. Customer Photograph */}
                        <div
                          className="crm-card"
                          style={{
                            padding: 16,
                            background: 'var(--bg-primary, #ffffff)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-lg, 12px)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: '1px solid var(--border-subtle)',
                                paddingBottom: 10,
                                marginBottom: 12,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                                <Camera size={16} color="var(--primary)" />
                                <span>{lang === 'hi' ? 'ग्राहक का फोटो' : 'Customer Photograph'}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenReportIssue(VerificationSection.PHOTOGRAPH)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--primary)',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                              >
                                {lang === 'hi' ? 'समस्या रिपोर्ट करें' : 'Report Issue'}
                              </button>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                              {profileData.hasPhoto && profileData.photoUrl ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                  <img
                                    src={ApiClient.getAuthorizedPhotoUrl(profileData.photoUrl)}
                                    alt="Registered Customer"
                                    style={{
                                      width: 90,
                                      height: 90,
                                      borderRadius: 'var(--radius-md, 8px)',
                                      objectFit: 'cover',
                                      border: '2px solid var(--primary-border)',
                                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                                    }}
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                    }}
                                  />
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                                      {lang === 'hi' ? 'पंजीकृत फ़ोटो उपलब्ध' : 'Official Photograph on File'}
                                    </div>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                      {lang === 'hi'
                                        ? 'सुरक्षित भंडारण से प्रदर्शित'
                                        : 'Securely retrieved via CRM storage'}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    width: '100%',
                                    padding: '24px 16px',
                                    borderRadius: 'var(--radius-md, 8px)',
                                    border: '1px dashed var(--border-subtle)',
                                    background: 'var(--bg-subtle, #f8fafc)',
                                    textAlign: 'center',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  <Camera size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                                    {lang === 'hi' ? 'फोटो उपलब्ध नहीं है' : 'Photograph Not Provided'}
                                  </div>
                                  <div style={{ fontSize: 11, marginTop: 2 }}>
                                    {lang === 'hi'
                                      ? 'CRM में कोई तस्वीर पंजीकृत नहीं है।'
                                      : 'No official photograph is currently stored in CRM records.'}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 5. Registered Identity & KYC Documents Card */}
                      <div
                        className="crm-card"
                        style={{
                          padding: 16,
                          background: 'var(--bg-primary, #ffffff)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-lg, 12px)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            borderBottom: '1px solid var(--border-subtle)',
                            paddingBottom: 10,
                            marginBottom: 12,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                            <ShieldCheck size={16} color="var(--primary)" />
                            <span>{lang === 'hi' ? 'पहचान दस्तावेज (KYC)' : 'Identity & KYC Documents'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenReportIssue(VerificationSection.IDENTITY_DOCUMENTS)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--primary)',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                              padding: 0,
                            }}
                          >
                            {lang === 'hi' ? 'समस्या रिपोर्ट करें' : 'Report Issue'}
                          </button>
                        </div>

                        {profileData.kycDocuments && profileData.kycDocuments.length > 0 ? (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                                  <th style={{ padding: '8px 10px' }}>{lang === 'hi' ? 'दस्तावेज़ का प्रकार' : 'Document Type'}</th>
                                  <th style={{ padding: '8px 10px' }}>{lang === 'hi' ? 'मास्क्ड पहचान संख्या' : 'Masked Identifier'}</th>
                                  <th style={{ padding: '8px 10px' }}>{lang === 'hi' ? 'सत्यापन स्थिति' : 'Status'}</th>
                                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>{lang === 'hi' ? 'देखें' : 'Action'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {profileData.kycDocuments.map((doc) => (
                                  <tr key={doc.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                    <td style={{ padding: '10px', fontWeight: 600 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <FileText size={14} color="var(--primary)" />
                                        <span>{doc.docType}</span>
                                      </div>
                                    </td>
                                    <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: 12 }}>
                                      {doc.docNumberMasked || 'Verified Customer File'}
                                    </td>
                                    <td style={{ padding: '10px' }}>
                                      <span className="badge badge-paid">{doc.status || 'VERIFIED'}</span>
                                    </td>
                                    <td style={{ padding: '10px', textAlign: 'center' }}>
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
                                        <span>{lang === 'hi' ? 'दस्तावेज़ देखें' : 'View'}</span>
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                            {lang === 'hi' ? 'कोई पहचान दस्तावेज़ पंजीकृत नहीं है।' : 'No identity documents registered.'}
                          </div>
                        )}
                      </div>

                      {/* 6. Account & Loan Reference Card */}
                      <div
                        style={{
                          padding: '12px 16px',
                          background: 'var(--bg-subtle, #f8fafc)',
                          borderRadius: 'var(--radius-md, 8px)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 12,
                          fontSize: 12,
                        }}
                      >
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>{lang === 'hi' ? 'ऋण खाता: ' : 'Loan Account: '}</span>
                          <strong>{profileData.loanAccountNo}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>{lang === 'hi' ? 'ग्राहक कोड: ' : 'Customer Code: '}</span>
                          <strong style={{ fontFamily: 'monospace' }}>{profileData.customerCode}</strong>
                        </div>
                      </div>

                      {/* 7. Previous Correction Requests History */}
                      {profileData.correctionRequests && profileData.correctionRequests.length > 0 && (
                        <div
                          className="crm-card"
                          style={{
                            padding: 16,
                            background: 'var(--bg-primary, #ffffff)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-lg, 12px)',
                          }}
                        >
                          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {lang === 'hi' ? 'हाल की समस्या और सुधार अनुरोध' : 'Your Past Correction Requests'}
                          </h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {profileData.correctionRequests
                              .filter((r) => r.requestType === 'CORRECTION_REQUEST')
                              .map((req) => (
                                <div
                                  key={req.id}
                                  style={{
                                    padding: '10px 14px',
                                    borderRadius: 'var(--radius-md, 8px)',
                                    border: '1px solid var(--border-subtle)',
                                    background: 'var(--bg-subtle, #f8fafc)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 6,
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                                      {req.section.replace(/_/g, ' ')}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          padding: '2px 8px',
                                          borderRadius: 12,
                                          background:
                                            req.status === 'RESOLVED'
                                              ? '#ecfdf5'
                                              : req.status === 'UNDER_REVIEW'
                                              ? '#eff6ff'
                                              : req.status === 'REJECTED'
                                              ? '#fef2f2'
                                              : '#fffbeb',
                                          color:
                                            req.status === 'RESOLVED'
                                              ? '#065f46'
                                              : req.status === 'UNDER_REVIEW'
                                              ? '#1e40af'
                                              : req.status === 'REJECTED'
                                              ? '#991b1b'
                                              : '#92400e',
                                        }}
                                      >
                                        {req.status}
                                      </span>
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        {formatDateDDMMYYYY(req.createdAt)}
                                      </span>
                                    </div>
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    {req.explanation}
                                  </div>
                                  {req.resolutionNotes && (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        color: '#1e40af',
                                        background: '#eff6ff',
                                        padding: '6px 10px',
                                        borderRadius: 6,
                                        marginTop: 4,
                                      }}
                                    >
                                      <strong>CRM Note:</strong> {req.resolutionNotes}
                                    </div>
                                  )}
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
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
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div>Need help with your loan or payment? Reach out to our customer support on WhatsApp.</div>
              <a
                href={buildWhatsAppSupportUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm"
                style={{
                  background: '#25D366',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  boxShadow: '0 2px 4px rgba(37, 211, 102, 0.2)',
                }}
                id="customer-portal-footer-whatsapp-btn"
              >
                <MessageCircle size={14} />
                <span>Contact on WhatsApp: {WHATSAPP_SUPPORT_CONFIG.displayName} ({WHATSAPP_SUPPORT_CONFIG.formattedPhone})</span>
              </a>
              <div style={{ marginTop: 4 }}>Alpha Mobile Gallery • Shubh Pvt Ltd • Regulated Lending & Collection CRM</div>
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
                    background: '#f0fdf4',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#16a34a',
                  }}
                >
                  <MessageCircle size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    {lang === 'hi' ? 'व्हाट्सएप सहायता संपर्क' : 'WhatsApp Support Contact'}
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
              <div
                style={{
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: 14,
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  {lang === 'hi' ? 'सहायता प्रतिनिधि' : 'Dedicated Support Officer'}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                  {WHATSAPP_SUPPORT_CONFIG.displayName}
                </div>
                <div style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, marginTop: 2 }}>
                  {WHATSAPP_SUPPORT_CONFIG.formattedPhone} • {WHATSAPP_SUPPORT_CONFIG.email}
                </div>
              </div>

              {lang === 'hi' ? (
                <p style={{ margin: 0 }}>
                  अपने खाते, बकाया EMI भुगतान अथवा रसीद सत्यापन में सहायता के लिए आप सीधे व्हाट्सएप पर संपर्क कर सकते हैं।
                </p>
              ) : (
                <p style={{ margin: 0 }}>
                  For real-time assistance regarding your loan account, EMI payments, or receipt confirmation, reach out directly on WhatsApp.
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="btn btn-secondary btn-sm"
              >
                {lang === 'hi' ? 'बंद करें' : 'Close'}
              </button>
              <a
                href={buildWhatsAppSupportUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                style={{
                  background: '#25D366',
                  borderColor: '#16a34a',
                  color: '#ffffff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  textDecoration: 'none',
                }}
                id="modal-contact-whatsapp-btn"
              >
                <MessageCircle size={15} />
                <span>{lang === 'hi' ? 'व्हाट्सएप पर संपर्क करें' : 'Contact on WhatsApp'}</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ─── Report an Issue / Request Correction Modal ─── */}
      {showIssueModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="crm-card"
            style={{
              width: '100%',
              maxWidth: 520,
              background: '#ffffff',
              borderRadius: 'var(--radius-lg, 12px)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: '#fef3c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#d97706',
                  }}
                >
                  <AlertCircle size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    {lang === 'hi' ? 'समस्या या सुधार की रिपोर्ट करें' : 'Report an Issue / Correction Request'}
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {data?.loanAccountNo} • Alpha Mobile Gallery
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIssueModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            {issueSuccessMsg ? (
              <div
                style={{
                  padding: 16,
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: 'var(--radius-md)',
                  color: '#065f46',
                  fontSize: 14,
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                <CheckCircle2 size={24} style={{ margin: '0 auto 8px auto', display: 'block' }} />
                <div>{issueSuccessMsg}</div>
              </div>
            ) : (
              <form onSubmit={handleSubmitIssue} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {issueError && (
                  <div
                    style={{
                      padding: 12,
                      background: 'var(--danger-bg)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--danger)',
                      fontSize: 13,
                    }}
                  >
                    {issueError}
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    {lang === 'hi' ? 'संबंधित अनुभाग चुनें *' : 'Affected Section *'}
                  </label>
                  <select
                    value={issueSection}
                    onChange={(e) => setIssueSection(e.target.value as VerificationSection)}
                    className="crm-input"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 14,
                    }}
                  >
                    <option value={VerificationSection.PERSONAL_DETAILS}>
                      {lang === 'hi' ? 'व्यक्तिगत विवरण (नाम / जन्म तिथि / लिंग)' : 'Personal Details (Name / DOB / Gender)'}
                    </option>
                    <option value={VerificationSection.CONTACT_DETAILS}>
                      {lang === 'hi' ? 'संपर्क विवरण (मोबाइल नंबर / ईमेल)' : 'Contact Details (Phone / Email)'}
                    </option>
                    <option value={VerificationSection.ADDRESS}>
                      {lang === 'hi' ? 'पंजीकृत पता (सड़क / शहर / पिन कोड)' : 'Registered Address (Street / City / Pincode)'}
                    </option>
                    <option value={VerificationSection.IDENTITY_DOCUMENTS}>
                      {lang === 'hi' ? 'पहचान दस्तावेज (आधार / पैन / वोटर आईडी)' : 'Identity Documents (Aadhaar / PAN / etc.)'}
                    </option>
                    <option value={VerificationSection.PHOTOGRAPH}>
                      {lang === 'hi' ? 'ग्राहक का फोटो' : 'Customer Photograph'}
                    </option>
                    <option value={VerificationSection.OTHER}>
                      {lang === 'hi' ? 'अन्य कोई विसंगति' : 'Other / General Discrepancy'}
                    </option>
                  </select>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {lang === 'hi' ? 'समस्या का स्पष्टीकरण दें *' : 'Explanation of Discrepancy *'}
                    </label>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {issueExplanation.length}/1000
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    value={issueExplanation}
                    onChange={(e) => setIssueExplanation(e.target.value)}
                    placeholder={
                      lang === 'hi'
                        ? 'कृपया विस्तार से बताएं कि कौन सा विवरण गलत है और क्या सही होना चाहिए...'
                        : 'Explain the discrepancy and what should be corrected (e.g. spelling mistake in address, new contact number)...'
                    }
                    maxLength={1000}
                    className="crm-input"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    background: 'var(--bg-subtle, #f8fafc)',
                    padding: '8px 12px',
                    borderRadius: 6,
                  }}
                >
                  {lang === 'hi'
                    ? 'कृपया पासवर्ड, ओटीपी या पूर्ण संवेदनशील पिन दर्ज न करें। प्रस्तुत अनुरोध की समीक्षा अधिकृत स्टाफ द्वारा की जाएगी।'
                    : 'Do not enter passwords, OTPs, or confidential pins. Submission creates a reviewable request for authorized CRM operations staff.'}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setShowIssueModal(false)}
                    className="btn btn-secondary btn-sm"
                    disabled={submittingIssue}
                  >
                    {lang === 'hi' ? 'रद्द करें' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={submittingIssue || !issueExplanation.trim() || issueExplanation.trim().length < 5}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Send size={13} />
                    <span>
                      {submittingIssue
                        ? lang === 'hi' ? 'सबमिट हो रहा है...' : 'Submitting...'
                        : lang === 'hi' ? 'अनुरोध भेजें' : 'Submit Report'}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ─── Cashfree Payment Result Dialog ─────────────────────────── */}
      {paymentResultModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: 16,
          }}
        >
          <div
            className="crm-card"
            style={{
              width: '100%',
              maxWidth: 480,
              background: '#ffffff',
              borderRadius: 'var(--radius-lg)',
              padding: 24,
              boxShadow: 'var(--shadow-xl)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              textAlign: 'center',
            }}
          >
            {paymentResultModal.status === 'SUCCESS' && (
              <>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    background: 'var(--success-bg)',
                    color: 'var(--success-text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto',
                  }}
                >
                  <CheckCircle2 size={32} />
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Payment Successful!
                </h3>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
                  Your EMI payment of <strong>{formatINR(paymentResultModal.orderAmount)}</strong> has been verified and recorded in the loan ledger.
                </p>
                {paymentResultModal.receiptNumber && (
                  <div
                    style={{
                      background: 'var(--bg-surface-secondary)',
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px dashed var(--border-strong)',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>Official Receipt Number: </span>
                    <strong className="mono" style={{ color: 'var(--primary)', fontSize: 14 }}>
                      {paymentResultModal.receiptNumber}
                    </strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentResultModal(null);
                      fetchPortalData(true);
                    }}
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '10px 18px', fontWeight: 700 }}
                  >
                    View Updated Schedule
                  </button>
                </div>
              </>
            )}

            {paymentResultModal.status === 'PENDING' && (
              <>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    background: '#fef3c7',
                    color: '#92400e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto',
                  }}
                >
                  <Clock size={32} />
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Payment In Progress
                </h3>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
                  Your bank is processing the transaction. As soon as confirmation is received, your EMI schedule and balance will update automatically.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentResultModal(null);
                    fetchPortalData(true);
                  }}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '10px 18px', fontWeight: 700 }}
                >
                  Close & Refresh Later
                </button>
              </>
            )}

            {(paymentResultModal.status === 'FAILED' || paymentResultModal.status === 'USER_DROPPED' || paymentResultModal.status === 'CANCELLED') && (
              <>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    background: paymentResultModal.status === 'FAILED' ? 'var(--danger-bg)' : 'var(--bg-surface-secondary)',
                    color: paymentResultModal.status === 'FAILED' ? 'var(--danger)' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto',
                  }}
                >
                  {paymentResultModal.status === 'FAILED' ? <AlertCircle size={32} /> : <AlertTriangle size={32} />}
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  {paymentResultModal.status === 'FAILED' ? 'Payment Unsuccessful' : 'Checkout Cancelled'}
                </h3>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
                  {paymentResultModal.message || (paymentResultModal.status === 'FAILED'
                    ? 'Your payment could not be processed by your bank. No money was deducted.'
                    : 'The checkout session was cancelled. You can retry whenever you are ready.')}
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setPaymentResultModal(null)}
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '10px 18px' }}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const inst = paymentResultModal.installmentNumber;
                      setPaymentResultModal(null);
                      handleCashfreePay(inst, inst || 'hero');
                    }}
                    className="btn btn-primary"
                    style={{ flex: 1, padding: '10px 18px', fontWeight: 700 }}
                  >
                    Retry Payment
                  </button>
                </div>
              </>
            )}
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
