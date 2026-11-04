import React from 'react';
import { IAgentQueueItem, formatINR, formatDateDDMMYYYY } from '@crm/shared';
import {
  Phone,
  MessageCircle,
  Navigation,
  PhoneCall,
  DollarSign,
  Clock,
  AlertTriangle,
  MapPin,
  Calendar,
  CreditCard,
  CheckCircle2,
} from 'lucide-react';

export interface AgentMobileQueueCardProps {
  item: IAgentQueueItem;
  onCall?: (item: IAgentQueueItem) => void;
  onWhatsApp?: (item: IAgentQueueItem) => void;
  onNavigate?: (item: IAgentQueueItem) => void;
  onLogVisit?: (item: IAgentQueueItem) => void;
  onCollect?: (item: IAgentQueueItem) => void;
  onViewDetails?: (item: IAgentQueueItem) => void;
}

export const AgentMobileQueueCard: React.FC<AgentMobileQueueCardProps> = ({
  item,
  onCall,
  onWhatsApp,
  onNavigate,
  onLogVisit,
  onCollect,
  onViewDetails,
}) => {
  const phone = item.primaryPhone || item.customerPhone || '';
  const cleanPhone = phone.replace(/\D/g, '');
  const phoneWithCode = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  const totalDue = (item.remainingAmount || item.expectedAmount || 0) + (item.penaltyAmount || 0);
  const isOverdue = item.daysOverdue > 0;
  const isDueToday = item.status === 'DUE_TODAY' || item.daysOverdue === 0;

  // WhatsApp reminder message
  const handleDefaultWhatsApp = () => {
    if (onWhatsApp) {
      onWhatsApp(item);
      return;
    }
    const dueAmtStr = formatINR(totalDue);
    const msg = `Namaste ${item.customerName}, this is an EMI collection reminder from Alpha Mobile Gallery regarding your EMI payment of ${dueAmtStr} for Loan Account ${item.loanAccountNo} (Due: ${formatDateDDMMYYYY(item.dueDate)}). Please pay on time. Thank you.`;
    window.open(`https://wa.me/${phoneWithCode}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // Google Maps navigation
  const handleDefaultNavigate = () => {
    if (onNavigate) {
      onNavigate(item);
      return;
    }
    const query = item.addressSummary || item.areaRoute || '';
    if (query) {
      window.open(`https://maps.google.com/?q=${encodeURIComponent(query)}`, '_blank');
    }
  };

  return (
    <div
      className="crm-card agent-queue-card"
      data-testid={`agent-queue-card-${item.installmentId}`}
      style={{
        padding: '14px',
        marginBottom: '10px',
        background: '#ffffff',
        border: isOverdue ? '1.5px solid #fca5a5' : isDueToday ? '1.5px solid #fde68a' : '1px solid #e2e8f0',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(15, 23, 42, 0.05)',
      }}
    >
      {/* Top Header: Customer Name & Status Badge */}
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
              {item.customerName}
            </h4>
            {item.customerCode && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  background: '#f1f5f9',
                  color: '#475569',
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid #e2e8f0',
                }}
              >
                {item.customerCode}
              </span>
            )}
          </div>

          {/* Phone & Area */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12 }}>
            <a
              href={`tel:${phone}`}
              style={{
                color: '#2563eb',
                textDecoration: 'none',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Phone size={12} />
              <span className="mono">{phone}</span>
            </a>
            {item.areaRoute && (
              <span
                style={{
                  color: '#64748b',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 11,
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.areaRoute}
              >
                <MapPin size={11} />
                <span>{item.areaRoute}</span>
              </span>
            )}
          </div>
        </div>

        {/* Status Badge */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          {isOverdue ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 11,
                fontWeight: 800,
                padding: '4px 8px',
                borderRadius: 6,
                background: '#fee2e2',
                color: '#b91c1c',
                border: '1px solid #fca5a5',
              }}
            >
              <AlertTriangle size={11} />
              <span>{item.daysOverdue}D OVERDUE</span>
            </span>
          ) : isDueToday ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 11,
                fontWeight: 800,
                padding: '4px 8px',
                borderRadius: 6,
                background: '#fef3c7',
                color: '#b45309',
                border: '1px solid #fde68a',
              }}
            >
              <Clock size={11} />
              <span>DUE TODAY</span>
            </span>
          ) : (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 8px',
                borderRadius: 6,
                background: '#e0f2fe',
                color: '#0369a1',
                border: '1px solid #bae6fd',
              }}
            >
              UPCOMING
            </span>
          )}
        </div>
      </div>

      {/* Loan & Address Info */}
      <div
        style={{
          background: '#f8fafc',
          borderRadius: 8,
          padding: '8px 10px',
          marginTop: 6,
          fontSize: 12,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          border: '1px solid #e2e8f0',
        }}
      >
        <div>
          <span style={{ color: '#64748b', fontSize: 11 }}>Loan Account: </span>
          <span className="mono font-bold" style={{ color: '#0f172a' }}>
            {item.loanAccountNo}
          </span>
          <div style={{ fontSize: 10, color: '#64748b' }}>
            Inst #{item.installmentNumber} of {item.totalInstallments}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span style={{ color: '#64748b', fontSize: 11 }}>Due Date: </span>
          <strong style={{ color: isOverdue ? '#b91c1c' : '#0f172a' }}>
            {formatDateDDMMYYYY(item.dueDate)}
          </strong>
          {item.totalOutstandingLoan > 0 && (
            <div style={{ fontSize: 10, color: '#64748b' }}>
              Loan Bal: <span className="mono font-bold">{formatINR(item.totalOutstandingLoan)}</span>
            </div>
          )}
        </div>

        {item.addressSummary && (
          <div
            style={{
              gridColumn: 'span 2',
              fontSize: 11,
              color: '#475569',
              borderTop: '1px dashed #e2e8f0',
              paddingTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            📍 {item.addressSummary}
          </div>
        )}
      </div>

      {/* Financial Obligation Amount */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 2px',
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            EMI Amount Due
          </div>
          <div
            className="mono"
            style={{
              fontSize: 20,
              fontWeight: 900,
              color: isOverdue ? '#b91c1c' : '#0f172a',
              lineHeight: 1.1,
              marginTop: 2,
            }}
          >
            {formatINR(totalDue)}
          </div>
          {item.penaltyAmount > 0 && (
            <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626' }}>
              Incl. {formatINR(item.penaltyAmount)} late penalty
            </div>
          )}
        </div>

        {item.hasPendingCollection ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: '#fef3c7',
              color: '#92400e',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              border: '1px solid #fde68a',
            }}
          >
            <Clock size={13} />
            <span>Pending Approval</span>
          </span>
        ) : null}
      </div>

      {/* 5 Field Actions Row (Min 48px Touch Targets) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '48px 48px 48px 1fr 1fr',
          gap: 6,
          marginTop: 6,
          alignItems: 'center',
        }}
      >
        {/* 1. Call Button */}
        <a
          href={`tel:${phone}`}
          data-testid="agent-card-call-btn"
          aria-label={`Call ${item.customerName}`}
          title="Call customer"
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
          onClick={(e) => {
            if (onCall) {
              e.preventDefault();
              onCall(item);
            }
          }}
        >
          <Phone size={18} />
        </a>

        {/* 2. WhatsApp Button */}
        <button
          type="button"
          data-testid="agent-card-whatsapp-btn"
          aria-label={`WhatsApp ${item.customerName}`}
          title="Send WhatsApp reminder"
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

        {/* 3. Navigate / Maps Button */}
        <button
          type="button"
          data-testid="agent-card-navigate-btn"
          aria-label={`Navigate to ${item.customerName} address`}
          title="Open Google Maps direction"
          onClick={handleDefaultNavigate}
          style={{
            height: 48,
            width: 48,
            borderRadius: 8,
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            color: '#475569',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
        >
          <Navigation size={18} />
        </button>

        {/* 4. Log Visit Button */}
        <button
          type="button"
          data-testid="agent-card-log-visit-btn"
          title="Log customer visit & contact activity"
          onClick={() => onLogVisit && onLogVisit(item)}
          style={{
            height: 48,
            borderRadius: 8,
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            color: '#1e293b',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            padding: '0 8px',
            touchAction: 'manipulation',
          }}
        >
          <PhoneCall size={14} color="#2563eb" />
          <span>Log Visit</span>
        </button>

        {/* 5. Collect EMI Button */}
        {item.hasPendingCollection ? (
          <button
            type="button"
            disabled
            style={{
              height: 48,
              borderRadius: 8,
              background: '#fef3c7',
              border: '1px solid #fde68a',
              color: '#92400e',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'not-allowed',
              padding: '0 6px',
            }}
          >
            <Clock size={13} />
            <span>Pending</span>
          </button>
        ) : (
          <button
            type="button"
            data-testid="agent-card-collect-btn"
            title="Record EMI payment"
            onClick={() => onCollect && onCollect(item)}
            style={{
              height: 48,
              borderRadius: 8,
              background: '#16a34a',
              border: '1px solid #15803d',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              padding: '0 8px',
              touchAction: 'manipulation',
              boxShadow: '0 2px 4px rgba(22, 163, 74, 0.25)',
            }}
          >
            <DollarSign size={15} />
            <span>Collect</span>
          </button>
        )}
      </div>
    </div>
  );
};

