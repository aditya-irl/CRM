import React from 'react';
import { IAgentCollectionRecord, formatINR, formatDateDDMMYYYY, PaymentMode } from '@crm/shared';
import { Receipt, CheckCircle2, Clock, XCircle, Share2, Eye, UserCheck } from 'lucide-react';

export interface AgentMobileCollectionsCardProps {
  record: IAgentCollectionRecord | any;
  onViewReceipt: (record: any) => void;
  onViewDetails?: (record: any) => void;
  onApprove?: (record: any) => void;
  onReject?: (record: any) => void;
  isAdmin?: boolean;
}

export const AgentMobileCollectionsCard: React.FC<AgentMobileCollectionsCardProps> = ({
  record,
  onViewReceipt,
  onViewDetails,
  onApprove,
  onReject,
  isAdmin = false,
}) => {
  const isPending =
    record.status === 'PENDING_APPROVAL' || record.status === 'PENDING_VERIFICATION';
  const isApproved = record.status === 'SUCCESS';
  const isRejected = record.status === 'REJECTED';

  const amount = Number(record.amountCollected ?? record.amount ?? 0);
  const penalty = Number(record.penaltyAmount ?? 0);

  const handleShareWhatsApp = () => {
    const rawPhone = record.customerPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const phoneWithCode = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const dateStr = formatDateDDMMYYYY(record.paymentTimestamp || record.createdAt || new Date().toISOString());
    const amtStr = formatINR(amount);
    const msg = `Official Payment Receipt from Alpha Mobile Gallery / Shubh CRM:\nReceipt No: ${record.receiptNumber}\nCustomer: ${record.customerName}\nLoan: ${record.loanAccountNo}\nAmount: ${amtStr}\nPayment Mode: ${record.paymentMode}\nDate: ${dateStr}\nStatus: ${isPending ? 'Pending Verification' : isApproved ? 'Approved & Posted' : record.status}\nThank you!`;
    window.open(`https://wa.me/${phoneWithCode}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div
      className="crm-card"
      data-testid={`agent-collection-card-${record.id || record.receiptNumber}`}
      style={{
        padding: 14,
        marginBottom: 10,
        background: '#ffffff',
        border: isPending
          ? '1.5px solid #fde68a'
          : isRejected
          ? '1.5px solid #fca5a5'
          : '1px solid #e2e8f0',
        borderRadius: 12,
        boxShadow: '0 2px 4px rgba(15, 23, 42, 0.05)',
      }}
    >
      {/* Top Row: Receipt # & Status Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              className="mono font-bold"
              style={{
                fontSize: 14,
                color: '#0f172a',
                background: '#f1f5f9',
                padding: '2px 6px',
                borderRadius: 4,
              }}
            >
              {record.receiptNumber}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: '#e2e8f0',
                color: '#334155',
                textTransform: 'uppercase',
              }}
            >
              {record.paymentMode}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
            {formatDateDDMMYYYY(record.paymentTimestamp || record.createdAt)}
            {record.paymentTimestamp && (
              <span> • {new Date(record.paymentTimestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
            )}
          </div>
        </div>

        {/* Approval Status Pill */}
        <div>
          {isApproved ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#dcfce7',
                color: '#15803d',
                border: '1px solid #bbf7d0',
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              <CheckCircle2 size={12} />
              <span>APPROVED</span>
            </span>
          ) : isPending ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#fef3c7',
                color: '#b45309',
                border: '1px solid #fde68a',
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              <Clock size={12} />
              <span>PENDING APPROVAL</span>
            </span>
          ) : isRejected ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#fee2e2',
                color: '#b91c1c',
                border: '1px solid #fca5a5',
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              <XCircle size={12} />
              <span>REJECTED</span>
            </span>
          ) : (
            <span className="badge badge-neutral" style={{ fontSize: 11 }}>
              {record.status}
            </span>
          )}
        </div>
      </div>

      {/* Customer & Loan Overview */}
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
          <span style={{ color: '#64748b', fontSize: 10 }}>Customer: </span>
          <div style={{ fontWeight: 800, color: '#0f172a' }}>{record.customerName}</div>
          {record.customerPhone && (
            <div className="mono" style={{ fontSize: 11, color: '#475569' }}>
              {record.customerPhone}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'right' }}>
          <span style={{ color: '#64748b', fontSize: 10 }}>Loan Account: </span>
          <div className="mono font-bold" style={{ color: '#0f172a' }}>
            {record.loanAccountNo}
          </div>
          {record.installmentNumber && (
            <div style={{ fontSize: 11, color: '#64748b' }}>
              EMI #{record.installmentNumber}
            </div>
          )}
        </div>

        {record.agentName && (
          <div
            style={{
              gridColumn: 'span 2',
              fontSize: 11,
              color: '#475569',
              borderTop: '1px dashed #e2e8f0',
              paddingTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <UserCheck size={12} color="#2563eb" />
            <span>Agent: <strong>{record.agentName}</strong></span>
          </div>
        )}
      </div>

      {/* Amount Collected & Rejection Reason (if any) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          padding: '4px 2px',
        }}
      >
        <div>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            Amount Collected
          </span>
          <div
            className="mono"
            style={{
              fontSize: 19,
              fontWeight: 900,
              color: isRejected ? '#b91c1c' : '#15803d',
              lineHeight: 1.1,
              marginTop: 2,
            }}
          >
            {formatINR(amount)}
          </div>
          {penalty > 0 && (
            <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }}>
              Incl. {formatINR(penalty)} penalty
            </div>
          )}
        </div>

        {record.referenceNumber && (
          <div style={{ textAlign: 'right', fontSize: 11, color: '#64748b' }}>
            <span>Ref: </span>
            <span className="mono font-bold" style={{ color: '#0f172a' }}>{record.referenceNumber}</span>
          </div>
        )}
      </div>

      {isRejected && record.rejectionReason && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            marginTop: 6,
          }}
        >
          <strong>Reason for Rejection:</strong> {record.rejectionReason}
        </div>
      )}

      {/* Action Buttons Row (Min 48px Touch Targets) */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 8,
          alignItems: 'center',
        }}
      >
        {/* View Receipt Button */}
        <button
          type="button"
          data-testid="agent-collection-receipt-btn"
          onClick={() => onViewReceipt(record)}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 8,
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1d4ed8',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
        >
          <Receipt size={16} />
          <span>View Receipt</span>
        </button>

        {/* Share Receipt on WhatsApp */}
        <button
          type="button"
          data-testid="agent-collection-share-btn"
          aria-label="Share receipt on WhatsApp"
          title="Share receipt via WhatsApp"
          onClick={handleShareWhatsApp}
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
          <Share2 size={18} />
        </button>

        {/* View Detail Drawer if provided */}
        {onViewDetails && (
          <button
            type="button"
            data-testid="agent-collection-details-btn"
            aria-label="View transaction details"
            title="View transaction details"
            onClick={() => onViewDetails(record)}
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
            <Eye size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

