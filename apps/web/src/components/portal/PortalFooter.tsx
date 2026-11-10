import React from 'react';
import { BrandLogo } from '../BrandLogo';
import { WHATSAPP_SUPPORT_CONFIG, buildWhatsAppSupportUrl } from '@crm/shared';
import {
  ShieldCheck,
  Mail,
  Phone,
  MessageCircle,
  ExternalLink,
  CreditCard,
  Lock,
  CheckCircle2,
} from 'lucide-react';

export interface PortalFooterProps {
  currentPath?: string;
  onNavigate?: (path: string) => void;
  token?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

interface FooterLinkItem {
  id: string;
  label: string;
  path: string;
}

const POLICY_LINKS: FooterLinkItem[] = [
  { id: 'contact', label: 'Contact Us', path: '/customer-portal/contact' },
  { id: 'terms', label: 'Terms & Conditions', path: '/customer-portal/terms' },
  { id: 'refunds', label: 'Refunds & Cancellations', path: '/customer-portal/refunds' },
  { id: 'privacy', label: 'Privacy Policy', path: '/customer-portal/privacy' },
  { id: 'services', label: 'Products & Pricing', path: '/customer-portal/services' },
];

export const PortalFooter: React.FC<PortalFooterProps> = ({
  currentPath = '',
  onNavigate,
  token,
  className = '',
  style = {},
}) => {
  const currentYear = new Date().getFullYear();

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(path);
    }
  };

  return (
    <footer
      className={`portal-global-footer ${className}`}
      data-testid="customer-portal-footer"
      style={{
        width: '100%',
        maxWidth: 1040,
        margin: '32px auto 0 auto',
        padding: '24px 20px',
        backgroundColor: 'var(--bg-surface, #ffffff)',
        border: '1px solid var(--border-subtle, #d6cfc4)',
        borderRadius: 'var(--radius-lg, 12px)',
        boxShadow: 'var(--shadow-card, 0 1px 3px rgba(0, 0, 0, 0.05))',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {/* ─── Top Grid Section ─── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 24,
          paddingBottom: 20,
          borderBottom: '1px solid var(--border-subtle, #d6cfc4)',
        }}
      >
        {/* Column 1: Brand & Entity Information */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <BrandLogo variant="horizontal" size="sm" showLegal={true} subtitle="Customer Payment Portal" />
          <p
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--text-secondary, #5c646c)',
              margin: '2px 0 0 0',
            }}
          >
            Official online loan repayment and EMI self-service portal for <strong>Alpha Mobile Gallery</strong> (Shubh Pvt Ltd).
            Enabling verified, secure digital repayments powered by Cashfree Payments.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, fontSize: 12 }}>
            <a
              href={`mailto:${WHATSAPP_SUPPORT_CONFIG.email}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--text-primary, #1c1e21)',
                textDecoration: 'none',
              }}
              title="Official Support Email"
            >
              <Mail size={13} color="var(--primary, #b8532f)" />
              <span>{WHATSAPP_SUPPORT_CONFIG.email}</span>
            </a>
            <a
              href={`tel:${WHATSAPP_SUPPORT_CONFIG.destination}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--text-primary, #1c1e21)',
                textDecoration: 'none',
              }}
              title="Support Helpline"
            >
              <Phone size={13} color="var(--primary, #b8532f)" />
              <span>{WHATSAPP_SUPPORT_CONFIG.formattedPhone}</span>
            </a>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--text-muted, #8c939c)',
                fontSize: 11,
              }}
            >
              <span>Support Hours: Mon–Sat 10:00 AM – 7:00 PM IST</span>
            </div>
          </div>
        </div>

        {/* Column 2: Legal & Compliance Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--text-primary, #1c1e21)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              margin: '0 0 4px 0',
            }}
          >
            Legal & Compliance
          </h4>
          <nav aria-label="Portal Policy Navigation" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {POLICY_LINKS.map((link) => {
              const isActive = currentPath === link.path || currentPath.endsWith(link.id);
              return (
                <a
                  key={link.id}
                  href={link.path}
                  onClick={(e) => handleLinkClick(e, link.path)}
                  data-testid={`portal-footer-link-${link.id}`}
                  style={{
                    fontSize: 12.5,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? 'var(--primary, #b8532f)' : 'var(--text-secondary, #5c646c)',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 0',
                    transition: 'color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--primary, #b8532f)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = isActive ? 'var(--primary, #b8532f)' : 'var(--text-secondary, #5c646c)';
                  }}
                >
                  <span style={{ color: 'var(--primary, #b8532f)' }}>•</span>
                  <span>{link.label}</span>
                </a>
              );
            })}
          </nav>
        </div>

        {/* Column 3: Payment Gateway & Trust Badges */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--text-primary, #1c1e21)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              margin: '0 0 4px 0',
            }}
          >
            Payment Gateway & Trust
          </h4>
          <div
            style={{
              background: 'var(--bg-app, #f7f4ee)',
              border: '1px solid var(--border-subtle, #d6cfc4)',
              borderRadius: 'var(--radius-md, 8px)',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--primary-subtle, #faede8)',
                  color: 'var(--primary, #b8532f)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CreditCard size={15} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary, #1c1e21)' }}>
                  Cashfree Payments
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted, #8c939c)' }}>
                  RBI-Authorized Payment Aggregator
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--success, #2e7d32)', fontWeight: 600 }}>
              <Lock size={12} />
              <span>256-Bit Bank-Grade TLS Encryption</span>
            </div>

            <div style={{ fontSize: 10.5, color: 'var(--text-secondary, #5c646c)', lineHeight: 1.4 }}>
              Accepted modes: UPI (Google Pay, PhonePe, Paytm, BHIM), Debit/Credit Cards & Netbanking.
            </div>
          </div>

          <a
            href={buildWhatsAppSupportUrl('Hello Sparsh Aggrawal, I need assistance regarding my payment on the CRM portal.')}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              fontSize: 12,
              marginTop: 4,
              textDecoration: 'none',
              borderColor: '#16a34a',
              color: '#15803d',
            }}
            title="Chat directly on WhatsApp"
          >
            <MessageCircle size={14} color="#16a34a" />
            <span>Support on WhatsApp</span>
          </a>
        </div>
      </div>

      {/* ─── Bottom Copyright & Regulatory Statement ─── */}
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 11,
          color: 'var(--text-muted, #8c939c)',
          lineHeight: 1.45,
          textAlign: 'center',
        }}
      >
        <div>
          © {currentYear} <strong>Alpha Mobile Gallery</strong> • <strong>Shubh Pvt Ltd</strong>. All rights reserved.
        </div>
        <div>
          Alpha Mobile Gallery is an enterprise trade brand of Shubh Pvt Ltd. Online digital payments are securely processed through Cashfree Payments India Private Limited.
          Underlying loan terms, interest calculations, and repayment schedules are strictly governed by the executed borrower loan agreement.
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-secondary, #5c646c)' }}>
          All transaction amounts and loan repayments are denominated strictly in <strong>Indian Rupees (INR / ₹)</strong>.
        </div>
      </div>
    </footer>
  );
};

export default PortalFooter;
