import React from 'react';
import { ICustomer, formatINR } from '@crm/shared';
import { Phone, MessageCircle, Eye, MapPin, CreditCard, ShieldCheck, User } from 'lucide-react';

export interface DealerMobileCustomerCardProps {
  customer: ICustomer;
  onViewProfile: (customer: ICustomer) => void;
  onCall?: (customer: ICustomer) => void;
  onWhatsApp?: (customer: ICustomer) => void;
}

export const DealerMobileCustomerCard: React.FC<DealerMobileCustomerCardProps> = ({
  customer,
  onViewProfile,
  onCall,
  onWhatsApp,
}) => {
  const phone = customer.primaryPhone || '';
  const cleanPhone = phone.replace(/\D/g, '');
  const phoneWithCode = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  const handleDefaultWhatsApp = () => {
    if (onWhatsApp) {
      onWhatsApp(customer);
      return;
    }
    const msg = `Namaste ${customer.fullName}, greetings from our retail store. Please let us know if you have any questions regarding your financed device or account. Thank you!`;
    window.open(`https://wa.me/${phoneWithCode}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleDefaultCall = () => {
    if (onCall) {
      onCall(customer);
    }
  };

  return (
    <div
      className="crm-card dealer-customer-card"
      data-testid={`dealer-customer-card-${customer.id}`}
      style={{
        padding: 14,
        marginBottom: 10,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        boxShadow: '0 2px 4px rgba(15, 23, 42, 0.05)',
      }}
    >
      {/* Top Header: Customer Name, Code, KYC badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <h4
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: '#0f172a',
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              {customer.fullName}
            </h4>
            {customer.customerCode && (
              <span
                className="mono font-bold"
                style={{
                  fontSize: 11,
                  background: '#f1f5f9',
                  color: '#2563eb',
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid #e2e8f0',
                }}
              >
                {customer.customerCode}
              </span>
            )}
          </div>

          {/* Area / Route */}
          {customer.areaRoute && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 11, color: '#64748b' }}>
              <MapPin size={11} color="#64748b" />
              <span>{customer.areaRoute}</span>
            </div>
          )}
        </div>

        {/* KYC Status Badge */}
        <div style={{ flexShrink: 0 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 7px',
              borderRadius: 6,
              background: '#dcfce7',
              color: '#15803d',
              border: '1px solid #bbf7d0',
              textTransform: 'uppercase',
            }}
          >
            <ShieldCheck size={11} />
            <span>KYC Verified</span>
          </span>
        </div>
      </div>

      {/* Metrics Row: Active Loans & Outstanding Balance */}
      <div
        style={{
          background: '#f8fafc',
          borderRadius: 8,
          padding: '8px 10px',
          marginTop: 8,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          fontSize: 12,
          border: '1px solid #e2e8f0',
        }}
      >
        <div>
          <span style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>
            Active Loans
          </span>
          <div className="mono font-bold" style={{ fontSize: 14, color: '#0f172a', marginTop: 1 }}>
            {customer.activeLoansCount || 0} Account{(customer.activeLoansCount || 0) === 1 ? '' : 's'}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>
            Total Outstanding
          </span>
          <div
            className="mono font-bold"
            style={{
              fontSize: 14,
              color: (customer.totalOutstanding || 0) > 0 ? '#d97706' : '#15803d',
              marginTop: 1,
            }}
          >
            {formatINR(customer.totalOutstanding || 0)}
          </div>
        </div>
      </div>

      {/* Action Buttons Row (>= 48px touch targets) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: phone ? '48px 48px 1fr' : '1fr',
          gap: 6,
          marginTop: 8,
          alignItems: 'center',
        }}
      >
        {phone && (
          <a
            href={`tel:${phone}`}
            data-testid="dealer-customer-call-btn"
            className="dealer-touch-btn-48"
            aria-label={`Call ${customer.fullName}`}
            title="Call borrower"
            onClick={handleDefaultCall}
            style={{
              height: 48,
              width: 48,
              borderRadius: 8,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1d4ed8',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              touchAction: 'manipulation',
            }}
          >
            <Phone size={18} />
          </a>
        )}

        {phone && (
          <button
            type="button"
            data-testid="dealer-customer-whatsapp-btn"
            className="dealer-touch-btn-48"
            aria-label={`WhatsApp ${customer.fullName}`}
            title="Message on WhatsApp"
            onClick={handleDefaultWhatsApp}
            style={{
              height: 48,
              width: 48,
              borderRadius: 8,
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#15803d',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          >
            <MessageCircle size={18} />
          </button>
        )}

        <button
          type="button"
          data-testid="dealer-customer-profile-btn"
          className="dealer-touch-btn-48"
          onClick={() => onViewProfile(customer)}
          style={{
            height: 48,
            borderRadius: 8,
            background: '#0f172a',
            border: 'none',
            color: '#ffffff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            padding: '0 12px',
            touchAction: 'manipulation',
          }}
        >
          <Eye size={16} />
          <span>View Profile 360°</span>
        </button>
      </div>
    </div>
  );
};
