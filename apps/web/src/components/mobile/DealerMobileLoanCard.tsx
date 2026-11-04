import React from 'react';
import { ILoan, formatINR, formatDateDDMMYYYY } from '@crm/shared';
import { CreditCard, Eye, DollarSign, Calendar, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';

export interface DealerMobileLoanCardProps {
  loan: ILoan | any;
  onViewDetails: (loan: any) => void;
  onRecordPayment?: (loan: any) => void;
}

export const DealerMobileLoanCard: React.FC<DealerMobileLoanCardProps> = ({
  loan,
  onViewDetails,
  onRecordPayment,
}) => {
  const isPending = loan.status === 'PENDING_APPROVAL' || loan.status === 'PENDING';
  const isApproved = loan.status === 'APPROVED';
  const isActive = loan.status === 'ACTIVE';
  const isClosed = loan.status === 'CLOSED';
  const isRejected = loan.status === 'REJECTED';

  const principal = Number(loan.principalAmount || loan.principal_amount || loan.amount || 0);
  const emi = Number(loan.emiAmount || loan.emi_amount || 0);
  const outstanding = Number(loan.outstandingBalance || loan.outstanding_balance || 0);
  const canCollect = (isActive || outstanding > 0) && Boolean(onRecordPayment);

  const customerName = loan.customerName || loan.customer_name || 'Borrower';
  const customerCode = loan.customerCode || loan.customer_code || '';
  const loanAccountNo = loan.loanAccountNo || loan.loan_account_no || '—';

  return (
    <div
      className="crm-card dealer-loan-card"
      data-testid={`dealer-loan-card-${loan.id}`}
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
      {/* Top Row: Loan Acc & Status Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              className="mono font-bold"
              style={{
                fontSize: 14,
                color: '#0f172a',
                background: '#f1f5f9',
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid #e2e8f0',
              }}
            >
              {loanAccountNo}
            </span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginTop: 4 }}>
            {customerName}
            {customerCode && (
              <span className="mono" style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginLeft: 6 }}>
                ({customerCode})
              </span>
            )}
          </div>
        </div>

        {/* Status Pill */}
        <div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 6,
              background: isPending
                ? '#fef3c7'
                : isApproved
                ? '#e0e7ff'
                : isActive
                ? '#dcfce7'
                : isClosed
                ? '#f1f5f9'
                : '#fee2e2',
              color: isPending
                ? '#b45309'
                : isApproved
                ? '#3730a3'
                : isActive
                ? '#15803d'
                : isClosed
                ? '#475569'
                : '#b91c1c',
              border: `1px solid ${
                isPending
                  ? '#fde68a'
                  : isApproved
                  ? '#c7d2fe'
                  : isActive
                  ? '#bbf7d0'
                  : isClosed
                  ? '#cbd5e1'
                  : '#fca5a5'
              }`,
              textTransform: 'uppercase',
            }}
          >
            {isPending && <Clock size={11} />}
            {isActive && <CheckCircle2 size={11} />}
            {isRejected && <AlertTriangle size={11} />}
            <span>{loan.status}</span>
          </span>
        </div>
      </div>

      {/* Financial Details Grid */}
      <div
        style={{
          background: '#f8fafc',
          borderRadius: 8,
          padding: '8px 10px',
          marginTop: 8,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          fontSize: 11,
          border: '1px solid #e2e8f0',
        }}
      >
        <div>
          <span style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>
            Principal
          </span>
          <div className="mono font-bold" style={{ fontSize: 13, color: '#0f172a', marginTop: 1 }}>
            {formatINR(principal)}
          </div>
        </div>

        <div>
          <span style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>
            Monthly EMI
          </span>
          <div className="mono font-bold" style={{ fontSize: 13, color: '#2563eb', marginTop: 1 }}>
            {formatINR(emi)}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>
            Outstanding
          </span>
          <div
            className="mono font-bold"
            style={{
              fontSize: 13,
              color: outstanding > 0 ? '#d97706' : '#15803d',
              marginTop: 1,
            }}
          >
            {formatINR(outstanding)}
          </div>
        </div>
      </div>

      {/* Dates Footer */}
      {(loan.disbursementDate || loan.nextDueDate || loan.next_due_date) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginTop: 6, padding: '0 2px' }}>
          {loan.disbursementDate && (
            <span>Disbursed: {formatDateDDMMYYYY(loan.disbursementDate)}</span>
          )}
          {(loan.nextDueDate || loan.next_due_date) && (
            <span style={{ color: '#b45309', fontWeight: 600 }}>
              Next Due: {formatDateDDMMYYYY(loan.nextDueDate || loan.next_due_date)}
            </span>
          )}
        </div>
      )}

      {/* Action Buttons Row (>= 48px touch targets) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: canCollect ? '1fr 1fr' : '1fr',
          gap: 8,
          marginTop: 10,
        }}
      >
        <button
          type="button"
          data-testid="dealer-loan-details-btn"
          className="dealer-touch-btn-48"
          onClick={() => onViewDetails(loan)}
          style={{
            height: 48,
            borderRadius: 8,
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            color: '#1e293b',
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
          <Eye size={16} />
          <span>View Details</span>
        </button>

        {canCollect && (
          <button
            type="button"
            data-testid="dealer-loan-record-emi-btn"
            className="dealer-touch-btn-48"
            onClick={() => onRecordPayment && onRecordPayment(loan)}
            style={{
              height: 48,
              borderRadius: 8,
              background: '#16a34a',
              border: '1px solid #15803d',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 800,
              cursor: 'pointer',
              touchAction: 'manipulation',
              boxShadow: '0 2px 4px rgba(22, 163, 74, 0.2)',
            }}
          >
            <DollarSign size={16} />
            <span>Record EMI</span>
          </button>
        )}
      </div>
    </div>
  );
};
