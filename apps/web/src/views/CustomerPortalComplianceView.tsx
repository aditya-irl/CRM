import React, { useState, useEffect } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { PortalFooter } from '../components/portal/PortalFooter';
import { WHATSAPP_SUPPORT_CONFIG, buildWhatsAppSupportUrl, formatINR } from '@crm/shared';
import {
  ShieldCheck,
  Mail,
  Phone,
  MessageCircle,
  Clock,
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Lock,
  CreditCard,
  DollarSign,
  HelpCircle,
  ExternalLink,
  Info,
} from 'lucide-react';

export type CompliancePageTab = 'contact' | 'terms' | 'refunds' | 'privacy' | 'services';

export interface CustomerPortalComplianceViewProps {
  initialPage?: CompliancePageTab;
  onNavigateHome?: () => void;
}

const TAB_CONFIG: { id: CompliancePageTab; label: string; path: string }[] = [
  { id: 'contact', label: 'Contact Us', path: '/customer-portal/contact' },
  { id: 'terms', label: 'Terms & Conditions', path: '/customer-portal/terms' },
  { id: 'refunds', label: 'Refunds & Cancellations', path: '/customer-portal/refunds' },
  { id: 'privacy', label: 'Privacy Policy', path: '/customer-portal/privacy' },
  { id: 'services', label: 'Products & Pricing', path: '/customer-portal/services' },
];

export const CustomerPortalComplianceView: React.FC<CustomerPortalComplianceViewProps> = ({
  initialPage = 'contact',
  onNavigateHome,
}) => {
  const [activeTab, setActiveTab] = useState<CompliancePageTab>(initialPage);

  // Sync tab with URL / updates
  useEffect(() => {
    setActiveTab(initialPage);
  }, [initialPage]);

  // Update document title dynamically based on active tab
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const titles: Record<CompliancePageTab, string> = {
      contact: 'Contact Us & Grievance Redressal | Alpha Mobile Gallery • Shubh Pvt Ltd',
      terms: 'Terms & Conditions | Customer Payment Portal — Alpha Mobile Gallery',
      refunds: 'Refunds & Cancellations Policy | Customer Payment Portal — Alpha Mobile Gallery',
      privacy: 'Privacy Policy | Customer Payment Portal — Alpha Mobile Gallery',
      services: 'Products, Services & Pricing (INR) | Alpha Mobile Gallery • Shubh Pvt Ltd',
    };
    document.title = titles[activeTab] || 'Customer Payment Portal Legal & Compliance';
  }, [activeTab]);

  const switchTab = (tab: CompliancePageTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const targetPath = `/customer-portal/${tab}`;
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ complianceTab: tab }, '', targetPath);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const tokenParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : null;
  const portalHomeUrl = tokenParam ? `/portal?token=${encodeURIComponent(tokenParam)}` : '/portal';

  const handleReturnToPortal = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onNavigateHome) {
      e.preventDefault();
      onNavigateHome();
    }
  };

  return (
    <div
      className="customer-portal-compliance-container"
      data-testid="customer-portal-compliance-view"
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-app, #f7f4ee)',
        color: 'var(--text-primary, #1c1e21)',
        fontFamily: 'var(--font-main, sans-serif)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ─── Top Header Bar ─── */}
      <header
        style={{
          background: 'var(--bg-surface, #ffffff)',
          borderBottom: '1px solid var(--border-subtle, #d6cfc4)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.04))',
        }}
      >
        <div
          style={{
            maxWidth: 1040,
            margin: '0 auto',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          {/* Brand & Return Link */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <a
              href={portalHomeUrl}
              onClick={handleReturnToPortal}
              className="btn btn-secondary btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                padding: '6px 12px',
                textDecoration: 'none',
              }}
              title="Return to Customer Payment Portal"
            >
              <ArrowLeft size={14} />
              <span>Payment Portal</span>
            </a>
            <BrandLogo variant="horizontal" size="sm" showLegal={true} subtitle="Customer Portal Policies" />
          </div>

          {/* Direct WhatsApp Callout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a
              href={buildWhatsAppSupportUrl('Hello Sparsh Aggrawal, I have an inquiry regarding portal policies and customer support.')}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#15803d',
                borderColor: '#16a34a',
                textDecoration: 'none',
              }}
              title="Chat with Customer Support on WhatsApp"
            >
              <MessageCircle size={14} color="#16a34a" />
              <span>WhatsApp Help</span>
            </a>
          </div>
        </div>

        {/* ─── Navigation Tabs ─── */}
        <div
          style={{
            maxWidth: 1040,
            margin: '0 auto',
            padding: '0 16px',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}
        >
          <nav
            aria-label="Compliance Pages"
            style={{
              display: 'flex',
              gap: 4,
              borderTop: '1px solid var(--border-subtle, #d6cfc4)',
              minWidth: 'max-content',
            }}
          >
            {TAB_CONFIG.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchTab(tab.id)}
                  data-testid={`compliance-tab-${tab.id}`}
                  style={{
                    padding: '12px 14px',
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    color: active ? 'var(--primary, #b8532f)' : 'var(--text-secondary, #5c646c)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--primary, #b8532f)' : '2px solid transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                    marginBottom: -1,
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ─── Main Content Area ─── */}
      <main
        style={{
          flex: 1,
          maxWidth: 1040,
          width: '100%',
          margin: '0 auto',
          padding: '24px 16px',
          boxSizing: 'border-box',
        }}
      >
        {/* ========================================================================= */}
        {/* TAB 1: CONTACT US & GRIEVANCE REDRESSAL                                   */}
        {/* ========================================================================= */}
        {activeTab === 'contact' && (
          <section data-testid="compliance-page-contact" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header Banner */}
            <div
              className="crm-card"
              style={{
                padding: '24px 20px',
                background: 'linear-gradient(135deg, #ffffff 0%, var(--bg-surface-secondary, #f0ece3) 100%)',
                borderLeft: '4px solid var(--primary, #b8532f)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary, #b8532f)', marginBottom: 6 }}>
                <Phone size={18} />
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Official Customer Helpdesk & Grievance Cell
                </span>
              </div>
              <h1 style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 800, margin: '0 0 8px 0' }}>
                Contact Customer Support
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-secondary, #5c646c)', margin: 0, lineHeight: 1.5, maxWidth: 760 }}>
                For payment-related inquiries, EMI confirmation, transaction reconciliations, or portal assistance,
                please contact our designated support officer below. All customer requests are acknowledged within standard operational hours.
              </p>
            </div>

            {/* Key Contact Information Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {/* Card 1: Official Business Entity */}
              <div className="crm-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-md, 8px)',
                      background: 'var(--primary-subtle, #faede8)',
                      color: 'var(--primary, #b8532f)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Business & Entity Details</h3>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #8c939c)' }}>Service Provider Identification</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Trade / Brand Name:</strong>{' '}
                    <span>Alpha Mobile Gallery</span>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Corporate Legal Entity:</strong>{' '}
                    <span>Shubh Pvt Ltd</span>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Nature of Business:</strong>{' '}
                    <span>Retail Consumer Electronics & Financed Device Repayment Services</span>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Payment Aggregator:</strong>{' '}
                    <span>Cashfree Payments India Private Limited</span>
                  </div>
                </div>
              </div>

              {/* Card 2: Contact Officers & Channels */}
              <div className="crm-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-md, 8px)',
                      background: '#ecfdf5',
                      color: '#15803d',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Mail size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Direct Support Channels</h3>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #8c939c)' }}>Verified Phone, Email & WhatsApp</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Designated Support Officer:</strong>{' '}
                    <span>{WHATSAPP_SUPPORT_CONFIG.displayName}</span>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Helpline Phone:</strong>{' '}
                    <a href={`tel:${WHATSAPP_SUPPORT_CONFIG.destination}`} style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                      {WHATSAPP_SUPPORT_CONFIG.formattedPhone}
                    </a>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Official Email:</strong>{' '}
                    <a href={`mailto:${WHATSAPP_SUPPORT_CONFIG.email}`} style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                      {WHATSAPP_SUPPORT_CONFIG.email}
                    </a>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>WhatsApp Support:</strong>{' '}
                    <a
                      href={buildWhatsAppSupportUrl('Hello Sparsh Aggrawal, I need assistance regarding my CRM portal account.')}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#16a34a', fontWeight: 600, textDecoration: 'none' }}
                    >
                      Chat on WhatsApp (+91 72520 40782)
                    </a>
                  </div>
                </div>
              </div>

              {/* Card 3: Support Availability & Location */}
              <div className="crm-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-md, 8px)',
                      background: '#fef3c7',
                      color: '#b45309',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Clock size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Operational Availability</h3>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #8c939c)' }}>Working Hours & Response Timelines</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Support Hours:</strong>{' '}
                    <span>Monday to Saturday, 10:00 AM – 7:00 PM IST</span>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Weekly Off:</strong>{' '}
                    <span>Sunday & Gazetted National / Bank Holidays</span>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Offline Messages:</strong>{' '}
                    <span>Emails and WhatsApp messages received outside hours are queued for next-business-day response.</span>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Corporate Registered Office:</strong>{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Pending Final Corporate Registry Records Update (Shubh Pvt Ltd) / Available upon official request.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Practical Instructions Section */}
            <div className="crm-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Instructions for Payment Inquiries & Dispute Resolution
              </h2>

              {/* Instructions 1: Standard Payment Queries */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, lineHeight: 1.6 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary)' }}>
                  1. Payment-Related Queries & Receipt Verification
                </h3>
                <p style={{ margin: 0 }}>
                  To ensure rapid verification and credit allocation to your loan account, please provide the following details when contacting customer support:
                </p>
                <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                  <li><strong>Borrower Name & Customer Code:</strong> (e.g., CUST-2026-XXXX)</li>
                  <li><strong>Loan Account Number:</strong> (e.g., LN-2026-XXXX)</li>
                  <li><strong>Payment Date & Time:</strong> The exact timestamp when payment was initiated</li>
                  <li><strong>Cashfree Order ID:</strong> Provided on the payment confirmation screen (e.g., order_...)</li>
                  <li><strong>Bank Transaction Reference / UTR Number:</strong> 12-digit reference number from your bank or UPI app</li>
                </ul>
              </div>

              {/* Instructions 2: Failed Transactions & Debits */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, lineHeight: 1.6, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--danger-text, #b91c1c)' }}>
                  2. Money Debited but Transaction Shows 'Failed' or 'Pending'
                </h3>
                <p style={{ margin: 0 }}>
                  If money has been deducted from your bank account or UPI app, but the payment portal indicates a <strong>Pending</strong> or <strong>Failed</strong> status:
                </p>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, margin: '6px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#991b1b', fontSize: 13 }}>
                    <AlertTriangle size={15} />
                    <span>Important Financial Safety Notice</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#7f1d1d', marginTop: 4 }}>
                    <strong>Do not initiate an immediate duplicate payment.</strong> In many interbank UPI transactions, funds temporarily held in bank clearing switches either automatically reverse to your source account or settle to the aggregator within a few hours.
                  </div>
                </div>
                <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                  <li>
                    <strong>Banking Switch Auto-Reversal:</strong> If the transaction was rejected by your bank or Cashfree, the banking network (NPCI / issuing bank) will automatically credit the amount back to your source account within <strong>3 to 5 banking business days</strong>.
                  </li>
                  <li>
                    <strong>Escalation with Support:</strong> If the money is not returned within 5 banking days, forward the debit SMS or bank statement showing the 12-digit UTR number to <strong>alphamobilegallery92@gmail.com</strong> or WhatsApp <strong>+91 72520 40782</strong>. Our accounts team will manually audit Cashfree merchant settlement logs and update your loan ledger or facilitate a formal gateway reversal.
                  </li>
                </ul>
              </div>

              {/* Instructions 3: Grievance Escalation */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, lineHeight: 1.6, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  3. Grievance Redressal Mechanism & Timelines
                </h3>
                <p style={{ margin: 0 }}>
                  If your issue remains unresolved after contacting first-line support, you may escalate directly to the designated Grievance Officer:
                </p>
                <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
                  <div><strong>Grievance Officer:</strong> Sparsh Aggrawal</div>
                  <div><strong>Email:</strong> alphamobilegallery92@gmail.com (Subject: <em>Grievance Escalation — Loan Account No</em>)</div>
                  <div><strong>Standard Resolution Window:</strong> Acknowledgement within 24 business hours; formal resolution within 48 to 72 business hours.</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: TERMS & CONDITIONS                                                 */}
        {/* ========================================================================= */}
        {activeTab === 'terms' && (
          <section data-testid="compliance-page-terms" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header Banner */}
            <div
              className="crm-card"
              style={{
                padding: '24px 20px',
                background: 'linear-gradient(135deg, #ffffff 0%, var(--bg-surface-secondary, #f0ece3) 100%)',
                borderLeft: '4px solid var(--primary, #b8532f)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary, #b8532f)', marginBottom: 6 }}>
                <FileText size={18} />
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Legal & User Agreement
                </span>
              </div>
              <h1 style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 800, margin: '0 0 8px 0' }}>
                Customer Payment Portal Terms & Conditions
              </h1>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #8c939c)' }}>
                Last Updated & Effective Date: November 2024 • Version 2.4
              </div>
            </div>

            {/* Document Body */}
            <div className="crm-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13.5, lineHeight: 1.65 }}>
              {/* Critical Legal Banner */}
              <div style={{ background: 'var(--primary-subtle)', border: '1px solid var(--primary-border)', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--primary)', fontSize: 14 }}>
                  <Info size={16} />
                  <span>Governing Loan Agreement Notice</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginTop: 4 }}>
                  These Terms & Conditions govern the access and use of this online customer repayment portal.
                  <strong> The executed physical or digital Loan Agreement, Sanction Letter, and Hypothecation Terms signed by the borrower govern the underlying loan facility, interest calculation, tenure, and repayment liabilities.</strong> Nothing contained on this portal modifies or supersedes the contractual obligations stipulated in the borrower's signed loan agreement.
                </div>
              </div>

              {/* 1. Nature of Portal */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  1. Nature of the Customer Payment Portal
                </h3>
                <p style={{ margin: 0 }}>
                  This Customer Payment Portal is an authorized self-service digital repayment facility provided by <strong>Alpha Mobile Gallery</strong>, an enterprise trade brand operated by <strong>Shubh Pvt Ltd</strong> (hereinafter referred to as "the Company").
                  The portal enables registered borrowers to review their active loan amortization schedule, inspect past payments, verify customer KYC profiles, and submit authorized EMI installment repayments electronically.
                </p>
              </div>

              {/* 2. Loan & EMI Payment Process */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  2. Loan & EMI Repayment Process
                </h3>
                <p style={{ margin: 0 }}>
                  Repayments must correspond to scheduled monthly installments as agreed upon origination. Customers may pay individual monthly installments or clear total outstanding loan balances. Payment amounts submitted are matched directly against the specific loan account number (e.g., <code>LN-...</code>) associated with the borrower's unique portal access link.
                </p>
              </div>

              {/* 3. Payment Gateway Processing through Cashfree */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  3. Payment Gateway Processing through Cashfree
                </h3>
                <p style={{ margin: 0 }}>
                  All online payments initiated via this portal are securely aggregated and processed by <strong>Cashfree Payments India Private Limited</strong> ("Cashfree"), an RBI-authorized Payment Aggregator. Supported payment instruments include Unified Payments Interface (UPI via Google Pay, PhonePe, Paytm, BHIM), RuPay/Visa/MasterCard Debit and Credit Cards, and Netbanking. The Company does not collect, handle, or store customer payment card numbers, CVVs, or bank account authentication credentials on its internal servers.
                </p>
              </div>

              {/* 4. Payment Confirmations & Processing Delays */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  4. Payment Confirmations and Processing Delays
                </h3>
                <p style={{ margin: 0 }}>
                  While the majority of UPI and card transactions are confirmed in real time, occasional delays may arise due to interbank clearing switch delays, bank server maintenance, or payment gateway webhook synchronization latency. In such instances, a transaction may temporarily reflect a <em>Pending Verification</em> status. The Company updates loan ledgers immediately upon receipt of cryptographic payment confirmation from Cashfree.
                </p>
              </div>

              {/* 5. Customer Responsibilities */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  5. Customer Responsibilities
                </h3>
                <p style={{ margin: 0 }}>
                  The customer is strictly responsible for:
                </p>
                <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                  <li>Ensuring that the loan account and installment selected for payment correspond accurately to their intended loan facility.</li>
                  <li>Maintaining the confidentiality of OTPs, UPI PINs, and secure customer portal links.</li>
                  <li>Ensuring sufficient available bank balance or credit limit prior to initiating electronic payment orders.</li>
                  <li>Refraining from sharing customer portal links with unauthorized third parties.</li>
                </ul>
              </div>

              {/* 6. Payment Receipts & Transaction References */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  6. Payment Receipts and Transaction References
                </h3>
                <p style={{ margin: 0 }}>
                  Upon successful payment settlement, an official CRM Payment Receipt is generated bearing a unique <strong>Receipt Number</strong> (e.g., <code>RCP-YYYYMM-XXXX</code>), Cashfree Order ID, payment mode, and remaining loan balance. This receipt is permanently archived in the customer's portal under the <em>Payment History</em> tab and serves as valid proof of payment.
                </p>
              </div>

              {/* 7. Failed, Pending, and Successful Transactions */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  7. Status of Transactions (Failed, Pending, and Successful)
                </h3>
                <p style={{ margin: 0 }}>
                  Transactions on this portal fall into three definitive categories:
                </p>
                <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                  <li><strong>Successful:</strong> Funds successfully debited and confirmed settled by Cashfree. The installment status is updated to PAID, and principal/interest amortization is credited to the ledger.</li>
                  <li><strong>Pending:</strong> Transaction initiated but bank clearing confirmation is awaited. Customers are advised to wait 15–30 minutes before re-attempting payment.</li>
                  <li><strong>Failed / Cancelled:</strong> Transaction abandoned or rejected by issuing bank/network. <em>A failed transaction does not constitute an EMI repayment under any circumstances.</em></li>
                </ul>
              </div>

              {/* 8. Late Payment Charges & Penalties */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  8. Late Payment Charges and Penalties
                </h3>
                <p style={{ margin: 0 }}>
                  Late payment charges, default penalties, and overdue interest are levied strictly and exclusively in accordance with the terms of the signed loan agreement. The Company does not invent or impose unauthorized platform surcharges or hidden portal convenience fees.
                </p>
              </div>

              {/* 9. Security & Acceptable Usage */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  9. Security and Acceptable Usage
                </h3>
                <p style={{ margin: 0 }}>
                  Users agree not to: (a) attempt unauthorized access, reverse-engineer, decompile, or tamper with portal source code or APIs; (b) deploy automated scraping bots, crawlers, or load-injection tools; (c) forge or manipulate URL tokens or transaction parameters. Any fraudulent or malicious activities will be reported to law enforcement agencies under the Information Technology Act, 2000.
                </p>
              </div>

              {/* 10. Limitation of Liability */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  10. Limitation of Liability
                </h3>
                <p style={{ margin: 0 }}>
                  To the maximum extent permitted by applicable Indian law, Alpha Mobile Gallery, Shubh Pvt Ltd, and its directors shall not be liable for any indirect, punitive, or consequential damages resulting from third-party banking downtime, telecommunication disruptions, or incorrect payment details entered by the user.
                </p>
              </div>

              {/* 11. Customer Support & Dispute Resolution */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  11. Customer Support and Dispute Resolution
                </h3>
                <p style={{ margin: 0 }}>
                  All disputes, claims, or discrepancies shall first be submitted to our customer support desk at <strong>alphamobilegallery92@gmail.com</strong> or <strong>+91 72520 40782</strong> for mutual amicable resolution. Unresolved disputes shall be subject to the exclusive jurisdiction of the competent courts of law in India.
                </p>
              </div>

              {/* 12. Updates to Terms */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  12. Updates to Terms
                </h3>
                <p style={{ margin: 0 }}>
                  The Company reserves the right to modify these Terms & Conditions from time to time to reflect operational updates or regulatory guidelines from the Reserve Bank of India (RBI) or Cashfree. Continued use of this portal indicates acceptance of the amended terms.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: REFUNDS & CANCELLATIONS POLICY                                     */}
        {/* ========================================================================= */}
        {activeTab === 'refunds' && (
          <section data-testid="compliance-page-refunds" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header Banner */}
            <div
              className="crm-card"
              style={{
                padding: '24px 20px',
                background: 'linear-gradient(135deg, #ffffff 0%, var(--bg-surface-secondary, #f0ece3) 100%)',
                borderLeft: '4px solid var(--primary, #b8532f)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary, #b8532f)', marginBottom: 6 }}>
                <DollarSign size={18} />
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Financial Reversal & Cancellation Standards
                </span>
              </div>
              <h1 style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 800, margin: '0 0 8px 0' }}>
                Refunds & Cancellations Policy
              </h1>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #8c939c)' }}>
                Governing Cashfree Online Gateway Transactions & Loan Reconciliations
              </div>
            </div>

            {/* Document Body */}
            <div className="crm-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13.5, lineHeight: 1.65 }}>
              {/* Critical Financial Rules Notice */}
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#991b1b', fontSize: 14 }}>
                  <AlertTriangle size={16} />
                  <span>Strict Financial Governance Rules</span>
                </div>
                <ul style={{ margin: '6px 0 0 20px', padding: 0, color: '#7f1d1d', fontSize: 12.5 }}>
                  <li>A failed transaction is <strong>never</strong> treated as a successful EMI payment.</li>
                  <li>A refund or reversal does not automatically alter loan ledger balances unless authorized through our administrative dual-custody audit workflow.</li>
                  <li>No instant cash refunds are provided for electronic payment transactions; standard interbank clearing turnaround times apply.</li>
                  <li>Repayments correctly allocated to legal loan obligations cannot be arbitrarily refunded or cancelled.</li>
                </ul>
              </div>

              {/* 1. Nature of Loan Repayments & Cancellations */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  1. Nature of Loan Repayments
                </h3>
                <p style={{ margin: 0 }}>
                  Payments made through this portal represent partial or full repayment of pre-existing, legally enforceable loan facilities and financed device contracts entered into between the borrower and Shubh Pvt Ltd.
                  Because payments immediately discharge outstanding debt, <strong>standard commercial order cancellations or "change of mind" refund requests do not apply once a legitimate repayment is settled.</strong>
                </p>
              </div>

              {/* 2. Duplicate Payment Handling */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  2. Duplicate Payments for the Same Installment
                </h3>
                <p style={{ margin: 0 }}>
                  If a customer accidentally submits multiple payments for the same installment due to connection interruptions or repeated button clicks:
                </p>
                <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                  <li>The Company reconciles duplicate entries with Cashfree gateway transaction logs.</li>
                  <li>Upon verification, the duplicate excess amount can be:
                    <ol style={{ margin: '4px 0 0 20px', padding: 0 }}>
                      <li><strong>Adjusted toward upcoming installments:</strong> Credited with zero penalty toward the customer's next scheduled monthly EMI; OR</li>
                      <li><strong>Refunded to the originating source:</strong> Returned to the customer's original bank account/UPI handle via Cashfree Payouts.</li>
                    </ol>
                  </li>
                </ul>
              </div>

              {/* 3. Failed Transactions (Money Debited from Bank) */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  3. Failed Transactions Where Money was Debited
                </h3>
                <p style={{ margin: 0 }}>
                  In the event money is deducted from your bank account or UPI application but the payment portal indicates a <code>FAILED</code> or <code>EXPIRED</code> status:
                </p>
                <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                  <li>
                    <strong>Automated Banking Reversal:</strong> Under Reserve Bank of India (RBI) Harmonisation of Turn Around Time (TAT) guidelines, funds held in interbank transit without gateway capture are automatically reversed by the customer's issuing bank within <strong>3 to 5 banking business days</strong>.
                  </li>
                  <li>
                    <strong>Merchant Reconciliation:</strong> If the funds settle to the Company's merchant account without automatic CRM ledger allocation, the customer may submit the 12-digit Bank UTR number to customer support. Upon verification with Cashfree, the Company will either credit the loan installment or issue a full refund back to the originating payment source within <strong>5 to 7 business banking days</strong>.
                  </li>
                </ul>
              </div>

              {/* 4. Pending Payment Status */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  4. Pending Payment Status Handling
                </h3>
                <p style={{ margin: 0 }}>
                  Transactions marked <code>PENDING</code> are undergoing interbank clearing. Customers must not attempt a second payment for at least 30 minutes. If the payment confirms successfully, an official CRM receipt is generated. If the payment eventually fails, the funds auto-reverse to the originating account per bank clearing rules.
                </p>
              </div>

              {/* 5. Incorrect or Excess Payments */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  5. Incorrect or Excess Payments Beyond Total Loan Balance
                </h3>
                <p style={{ margin: 0 }}>
                  In the rare event a customer makes a payment in excess of the final loan closure balance, the excess surplus amount will be verified against total ledger dues and refunded directly to the verified source bank account within <strong>7 business banking days</strong> following loan closure audit.
                </p>
              </div>

              {/* 6. Refund Request Process & Timelines */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  6. Step-by-Step Refund Request Process
                </h3>
                <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 14 }}>
                  <ol style={{ margin: '0 0 0 20px', padding: 0 }}>
                    <li>
                      <strong>Submit Request:</strong> Send an email to <code>alphamobilegallery92@gmail.com</code> or WhatsApp <code>+91 72520 40782</code> with your Customer Code, Loan Account Number, and Bank Debit Screenshot containing the 12-digit UTR/RRN.
                    </li>
                    <li>
                      <strong>Audit & Gateway Reconciliation:</strong> Our finance team reviews transaction logs with Cashfree within <strong>2 business days</strong>.
                    </li>
                    <li>
                      <strong>Administrative Dual-Custody Approval:</strong> The reversal is reviewed and approved in the backend accounting ledger by an authorized administrator.
                    </li>
                    <li>
                      <strong>Payment Gateway Refund Execution:</strong> The refund is executed through Cashfree Payments back to the original payment instrument (bank account, debit card, or UPI VPA). Funds typically reflect in your account within <strong>5 to 7 business banking days</strong> depending on your bank's processing cycles.
                    </li>
                  </ol>
                </div>
              </div>

              {/* 7. Contact for Payment Disputes */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  7. Contact Information for Payment Disputes
                </h3>
                <p style={{ margin: 0 }}>
                  For any questions or dispute escalation regarding refunds or reversals:
                </p>
                <div style={{ marginTop: 6 }}>
                  <div><strong>Nodal Support Officer:</strong> {WHATSAPP_SUPPORT_CONFIG.displayName}</div>
                  <div><strong>Email:</strong> {WHATSAPP_SUPPORT_CONFIG.email}</div>
                  <div><strong>Helpline:</strong> {WHATSAPP_SUPPORT_CONFIG.formattedPhone}</div>
                  <div><strong>Hours:</strong> Monday – Saturday, 10:00 AM – 7:00 PM IST</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: PRIVACY POLICY                                                     */}
        {/* ========================================================================= */}
        {activeTab === 'privacy' && (
          <section data-testid="compliance-page-privacy" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header Banner */}
            <div
              className="crm-card"
              style={{
                padding: '24px 20px',
                background: 'linear-gradient(135deg, #ffffff 0%, var(--bg-surface-secondary, #f0ece3) 100%)',
                borderLeft: '4px solid var(--primary, #b8532f)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary, #b8532f)', marginBottom: 6 }}>
                <Lock size={18} />
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Data Protection & Information Security
                </span>
              </div>
              <h1 style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 800, margin: '0 0 8px 0' }}>
                Customer Payment Portal Privacy Policy
              </h1>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #8c939c)' }}>
                Committed to Safeguarding Customer Data & Financial Privacy
              </div>
            </div>

            {/* Document Body */}
            <div className="crm-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13.5, lineHeight: 1.65 }}>
              {/* Introduction */}
              <div>
                <p style={{ margin: 0 }}>
                  <strong>Alpha Mobile Gallery</strong> (Shubh Pvt Ltd) ("Company", "we", "us", or "our") values the privacy of its borrowers and portal users.
                  This Privacy Policy describes how we collect, store, process, and protect your personal, financial, and technical information when you access our customer payment portal.
                </p>
              </div>

              {/* 1. Customer Information Collected */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  1. Information We Collect
                </h3>
                <p style={{ margin: '0 0 6px 0' }}>We collect the following categories of information to provide loan repayment services:</p>
                <ul style={{ margin: '0 0 0 20px', padding: 0 }}>
                  <li><strong>Personal Identification Data:</strong> Full legal name, registered mobile phone number, secondary contact number, residential address, route/area, and customer borrower code.</li>
                  <li><strong>KYC Documents & Photographs:</strong> Government identity proofs (such as Aadhaar card, PAN card, or Voter ID as submitted upon loan origination) and customer verification photographs.</li>
                  <li><strong>Loan & Financed Product Data:</strong> Loan account numbers, financed device brand, model, IMEI numbers, loan principal, monthly EMI installment amounts, due dates, outstanding balance, and transaction history.</li>
                  <li><strong>Payment Transaction Data:</strong> Cashfree payment session identifiers, transaction timestamps, payment modes (UPI, debit card, netbanking), masked card numbers or VPA handles, and official CRM receipt numbers.</li>
                  <li><strong>Technical & Usage Data:</strong> Client IP addresses, browser user agent, device operating system, access timestamps, and error logs collected for session authentication, security audit trails, and fraud prevention.</li>
                </ul>
              </div>

              {/* 2. Payment Card Security / No Storage of Sensitive Data */}
              <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#065f46', fontSize: 13.5 }}>
                  <ShieldCheck size={16} />
                  <span>Zero Payment Card Data Storage Guarantee</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#047857', marginTop: 4 }}>
                  <strong>We do not collect, view, or store customer credit/debit card numbers, CVV security codes, card expiration dates, netbanking passwords, or UPI PINs on our servers.</strong>
                  All payment card and banking authentications are processed directly through Cashfree's PCI-DSS Level 1 compliant secure payment checkout infrastructure.
                </div>
              </div>

              {/* 3. Purpose of Data Collection */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  2. How We Use Your Information
                </h3>
                <p style={{ margin: 0 }}>We use the collected information exclusively to:</p>
                <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                  <li>Authenticate your access to your individual loan repayment portal link.</li>
                  <li>Process digital EMI installments and loan closures via Cashfree.</li>
                  <li>Issue legal payment receipts and maintain regulatory accounting ledgers.</li>
                  <li>Communicate scheduled payment reminders, receipt notifications, and account updates.</li>
                  <li>Investigate and resolve payment discrepancies, failed debits, or customer grievances.</li>
                  <li>Comply with applicable Indian statutory, tax, and anti-money laundering (PMLA) requirements.</li>
                </ul>
              </div>

              {/* 4. Third-Party Payment Gateway Sharing (Cashfree) */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  3. Information Sharing with Payment Gateway (Cashfree)
                </h3>
                <p style={{ margin: 0 }}>
                  To execute electronic payment orders, transaction metadata (such as customer name, customer phone, loan account number, order amount, and currency) is transmitted via encrypted API connections to <strong>Cashfree Payments India Private Limited</strong>.
                  Cashfree processes this information under its own certified security framework and RBI regulations. We do not sell, rent, or commercialize borrower information to any third-party marketing companies.
                </p>
              </div>

              {/* 5. Data Security Practices */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  4. Data Security Practices
                </h3>
                <p style={{ margin: 0 }}>
                  We implement robust technical and operational measures to protect customer data:
                </p>
                <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                  <li><strong>TLS 1.3 Encryption:</strong> All data transmitted between the customer browser and our servers is protected with high-grade transport layer encryption.</li>
                  <li><strong>Access-Controlled Storage:</strong> Sensitive customer KYC documents are stored in private cloud object storage and accessed solely via temporary, cryptographically signed 5-minute view tokens.</li>
                  <li><strong>Role-Based Access Controls:</strong> CRM administrative access is strictly segregated with role-based permissions (Super Admin, Branch Manager, Recovery Agent).</li>
                  <li><strong>Rate Limiting & Token Protection:</strong> Automated rate-limiting algorithms protect against unauthorized brute-force attempts.</li>
                </ul>
              </div>

              {/* 6. Data Retention & Deletion */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  5. Data Retention & Deletion Requests
                </h3>
                <p style={{ margin: 0 }}>
                  Customer loan records, repayment ledgers, and transaction proofs are retained for the active lifetime of the loan facility and for the mandatory retention periods prescribed by Indian financial, taxation, and lending regulations.
                  Customers seeking clarification regarding their archived data may contact our Grievance Officer.
                </p>
              </div>

              {/* 7. Customer Privacy Rights & Grievance Contact */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  6. Customer Privacy Rights and Grievance Contact
                </h3>
                <p style={{ margin: 0 }}>
                  Under applicable Indian data protection laws, customers have the right to inspect their stored account information, report inaccuracies through our portal discrepancy tool, and request clarification.
                  For privacy concerns or data grievances:
                </p>
                <div style={{ marginTop: 6 }}>
                  <div><strong>Privacy & Grievance Officer:</strong> {WHATSAPP_SUPPORT_CONFIG.displayName}</div>
                  <div><strong>Entity:</strong> Shubh Pvt Ltd (Alpha Mobile Gallery)</div>
                  <div><strong>Email:</strong> {WHATSAPP_SUPPORT_CONFIG.email}</div>
                  <div><strong>Helpline:</strong> {WHATSAPP_SUPPORT_CONFIG.formattedPhone}</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: PRODUCTS, SERVICES & PRICING                                       */}
        {/* ========================================================================= */}
        {activeTab === 'services' && (
          <section data-testid="compliance-page-services" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header Banner */}
            <div
              className="crm-card"
              style={{
                padding: '24px 20px',
                background: 'linear-gradient(135deg, #ffffff 0%, var(--bg-surface-secondary, #f0ece3) 100%)',
                borderLeft: '4px solid var(--primary, #b8532f)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary, #b8532f)', marginBottom: 6 }}>
                <CreditCard size={18} />
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Business Services & Pricing Disclosure
                </span>
              </div>
              <h1 style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 800, margin: '0 0 8px 0' }}>
                Products, Services & Pricing Information
              </h1>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #8c939c)' }}>
                Official Pricing Policy Denominated in Indian Rupees (INR / ₹)
              </div>
            </div>

            {/* Document Body */}
            <div className="crm-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13.5, lineHeight: 1.65 }}>
              {/* Currency Callout Banner */}
              <div style={{ background: 'var(--primary-subtle)', border: '1px solid var(--primary-border)', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--primary)', fontSize: 14 }}>
                  <DollarSign size={16} />
                  <span>Currency Disclosure: Indian Rupees (INR / ₹)</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginTop: 4 }}>
                  All pricing, financed device valuations, loan amounts, installments, penalties, and payment transactions on this portal are calculated, billed, and processed strictly in <strong>Indian Rupees (INR / ₹)</strong>.
                </div>
              </div>

              {/* 1. Overview of Products & Services */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  1. Overview of Products & Business Services
                </h3>
                <p style={{ margin: 0 }}>
                  <strong>Alpha Mobile Gallery</strong> (Shubh Pvt Ltd) operates in retail consumer smartphone distribution and structured consumer device financing. Our services comprise:
                </p>
                <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                  <li>
                    <strong>Consumer Device Financing:</strong> Point-of-sale financing enabling retail consumers to purchase mobile phones and consumer electronics through structured monthly installment plans.
                  </li>
                  <li>
                    <strong>Customer Self-Service Payment Portal:</strong> A dedicated, secure digital web portal enabling borrowers to view loan amortization schedules, inspect past payment receipts, and make authorized EMI repayments online.
                  </li>
                  <li>
                    <strong>Field & Direct Collection Reconciliation:</strong> Facilitating verified in-person and digital repayments via authorized dealer counters, collection agents, and online payment gateways.
                  </li>
                </ul>
              </div>

              {/* 2. Customer Portal Platform Fee: ₹0 */}
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#166534', fontSize: 14 }}>
                  <CheckCircle2 size={16} />
                  <span>Portal Platform Usage Fee: ₹0 (Zero / Nil)</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#15803d', marginTop: 4 }}>
                  <strong>There is NO separate platform usage fee, registration surcharge, or monthly subscription fee charged to borrowers for accessing or utilizing this customer repayment portal.</strong>
                  Borrowers are charged solely for their verified loan principal, agreed interest, and contractual late penalties as defined in their executed loan contract.
                </div>
              </div>

              {/* 3. Structure of Loan Charges */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  2. Structure of Financial Charges
                </h3>
                <p style={{ margin: '0 0 8px 0' }}>
                  Borrower financial liabilities are governed strictly by the executed loan agreement. Charges are categorized as follows:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                  <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--primary)' }}>Down Payment (Upfront)</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      The upfront initial amount paid at the dealer counter at the time of device origination (e.g., ₹2,000 to ₹15,000 depending on model).
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--primary)' }}>Principal & Interest EMI</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Fixed monthly installments calculated over a defined tenure (e.g., 3, 6, 9, or 12 months) as stated on the loan sanction letter.
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--warning-text)' }}>Overdue Late Penalty</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Applied strictly if an installment is unpaid past its agreed due date, in exact accordance with the signed loan schedule (e.g., ₹50–₹100 per overdue cycle).
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--success-text)' }}>Foreclosure & Pre-Closure</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Borrowers can settle their entire remaining principal balance at any time without arbitrary hidden prepayment charges.
                    </div>
                  </div>
                </div>
              </div>

              {/* 4. Payment Gateway Charges */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  3. Payment Gateway Convenience Charges
                </h3>
                <p style={{ margin: 0 }}>
                  Online electronic repayments made through Cashfree via UPI (Unified Payments Interface) are offered with <strong>zero additional gateway surcharge</strong> to the customer.
                  If third-party commercial credit cards or specialized banking channels incur interchange fees, such charges are clearly itemized on Cashfree's checkout screen prior to final PIN authorization.
                </p>
              </div>

              {/* 5. Pricing Transparency Statement */}
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  4. Commitment to Transparent Pricing
                </h3>
                <p style={{ margin: 0 }}>
                  Alpha Mobile Gallery and Shubh Pvt Ltd do not levy undisclosed, hidden, or recurring unauthorized fees. Every rupee paid by a customer is accounted for in the CRM double-entry ledger and acknowledged with an official receipt.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ─── Global Footer ─── */}
      <PortalFooter currentPath={`/customer-portal/${activeTab}`} onNavigate={(path) => {
        const tabMatch = TAB_CONFIG.find((t) => t.path === path || path.endsWith(t.id));
        if (tabMatch) {
          switchTab(tabMatch.id);
        }
      }} />
    </div>
  );
};

export default CustomerPortalComplianceView;
