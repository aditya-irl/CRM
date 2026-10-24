import React, { useState } from 'react';
import {
  IContactActivity,
  FollowUpStatus,
  PaymentCommitmentStatus,
  formatINR,
  formatDateDDMMYYYY,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  X,
  Phone,
  MessageSquare,
  Mail,
  UserCheck,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  User,
  CreditCard,
  FileText,
  DollarSign,
  Tag,
  ShieldCheck,
} from 'lucide-react';

export interface ContactActivityDetailModalProps {
  activity: IContactActivity | null;
  onClose: () => void;
  onActivityUpdated?: (updated: IContactActivity) => void;
}

export const ContactActivityDetailModal: React.FC<ContactActivityDetailModalProps> = ({
  activity,
  onClose,
  onActivityUpdated,
}) => {
  const [currentActivity, setCurrentActivity] = useState<IContactActivity | null>(activity);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  React.useEffect(() => {
    setCurrentActivity(activity);
    setActionError(null);
    setActionSuccess(null);
  }, [activity]);

  if (!currentActivity) return null;

  const handleUpdateFollowUpStatus = async (newStatus: FollowUpStatus) => {
    setIsUpdating(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const updated = await ApiClient.updateContactActivityFollowUp(currentActivity.id, {
        followUpStatus: newStatus,
        followUpNotes:
          newStatus === FollowUpStatus.COMPLETED
            ? `Follow-up marked completed on ${new Date().toLocaleString('en-IN')}`
            : currentActivity.followUpNotes,
      });
      setCurrentActivity(updated);
      setActionSuccess(`Follow-up status changed to ${newStatus}`);
      if (onActivityUpdated) onActivityUpdated(updated);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update follow-up status');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUpdateCommitmentStatus = async (newStatus: PaymentCommitmentStatus) => {
    setIsUpdating(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const updated = await ApiClient.updateContactActivityFollowUp(currentActivity.id, {
        commitmentStatus: newStatus,
        commitmentStatusNotes: `Commitment status updated to ${newStatus}`,
      });
      setCurrentActivity(updated);
      setActionSuccess(`Commitment status updated to ${newStatus}`);
      if (onActivityUpdated) onActivityUpdated(updated);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update commitment status');
    } finally {
      setIsUpdating(false);
    }
  };

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'PHONE_CALL':
        return <Phone size={14} />;
      case 'WHATSAPP':
        return <MessageSquare size={14} />;
      case 'SMS':
        return <Mail size={14} />;
      case 'IN_PERSON_VISIT':
        return <UserCheck size={14} />;
      default:
        return <Tag size={14} />;
    }
  };

  const formattedCreatedAt = new Date(currentActivity.createdAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUpdating) onClose();
      }}
    >
      <div
        className="crm-card"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#60a5fa',
              }}
            >
              <FileText size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Contact Activity Record
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                ID: {currentActivity.id.slice(0, 13)}... • Logged on {formattedCreatedAt}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Feedback banners */}
        {actionSuccess && (
          <div
            style={{
              padding: '10px 16px',
              backgroundColor: '#f0fdf4',
              color: '#166534',
              fontSize: 12,
              borderBottom: '1px solid #bbf7d0',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={15} />
            <span>{actionSuccess}</span>
          </div>
        )}
        {actionError && (
          <div
            style={{
              padding: '10px 16px',
              backgroundColor: '#fef2f2',
              color: '#b91c1c',
              fontSize: 12,
              borderBottom: '1px solid #fecaca',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={15} />
            <span>{actionError}</span>
          </div>
        )}

        {/* Scrollable details */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Customer & Agent Card */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              padding: 14,
              borderRadius: 8,
              backgroundColor: '#f8fafc',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Customer Profile
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: '#0f172a' }}>
                {currentActivity.customerName || 'Customer ID: ' + currentActivity.customerId.slice(0, 8)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                Phone: {currentActivity.primaryPhone || 'N/A'} • Route: {currentActivity.areaRoute || 'N/A'}
              </div>
              {currentActivity.loanAccountNo && (
                <div style={{ fontSize: 12, color: 'var(--primary)', marginTop: 2, fontWeight: 600 }}>
                  Loan Acc: {currentActivity.loanAccountNo}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Recorded By Agent
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: '#0f172a' }}>
                {currentActivity.agentName || 'Agent ID: ' + currentActivity.agentId.slice(0, 8)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {currentActivity.agentEmail || 'Authorized Staff'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Timestamp: {formattedCreatedAt}
              </div>
            </div>
          </div>

          {/* Contact Channel & Outcome */}
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  className="badge badge-info"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'none', fontSize: 12 }}
                >
                  {getMethodIcon(currentActivity.contactMethod)}
                  <span>
                    {currentActivity.contactMethod === 'OTHER'
                      ? currentActivity.contactMethodOther || 'Other Method'
                      : currentActivity.contactMethod.replace(/_/g, ' ')}
                  </span>
                </span>
                {currentActivity.contactPhoneUsed && (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    via {currentActivity.contactPhoneUsed}
                  </span>
                )}
              </div>

              <span
                className="badge"
                style={{
                  backgroundColor:
                    currentActivity.contactOutcome === 'ANSWERED_CONVERSATION_COMPLETED' ||
                    currentActivity.contactOutcome === 'VISIT_COMPLETED'
                      ? '#dcfce7'
                      : '#fee2e2',
                  color:
                    currentActivity.contactOutcome === 'ANSWERED_CONVERSATION_COMPLETED' ||
                    currentActivity.contactOutcome === 'VISIT_COMPLETED'
                      ? '#15803d'
                      : '#b91c1c',
                  fontSize: 12,
                }}
              >
                {currentActivity.contactOutcome === 'OTHER'
                  ? currentActivity.contactOutcomeOther || 'Other Outcome'
                  : currentActivity.contactOutcome.replace(/_/g, ' ')}
              </span>
            </div>

            <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>
              Note: Attempt records indicate agent reporting. Telephony delivery is not verified by CRM unless integrated.
            </div>
          </div>

          {/* Customer Response & Notes */}
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Customer's Stated Response
            </div>
            {currentActivity.customerResponseCategory && (
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 8px',
                    borderRadius: 4,
                    backgroundColor: '#e0e7ff',
                    color: '#3730a3',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {currentActivity.customerResponseCategory.replace(/_/g, ' ')}
                </span>
              </div>
            )}
            <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {currentActivity.customerResponseNotes || (
                <span style={{ color: 'var(--text-muted)' }}>No verbal response summary recorded.</span>
              )}
            </div>
          </div>

          {/* Non-payment Reason */}
          {currentActivity.nonPaymentReason && (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                backgroundColor: '#fff1f2',
                border: '1px solid #fecdd3',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#9f1239' }}>
                Reason for Non-Payment: {currentActivity.nonPaymentReason.replace(/_/g, ' ')}
              </div>
              {currentActivity.nonPaymentReasonNotes && (
                <div style={{ fontSize: 12, color: '#4c0519', lineHeight: 1.4 }}>
                  {currentActivity.nonPaymentReasonNotes}
                </div>
              )}
            </div>
          )}

          {/* Payment Commitment Section */}
          {currentActivity.promisedPaymentAmount ? (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>
                    Payment Commitment
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#14532d', marginTop: 2 }}>
                    {formatINR(Number(currentActivity.promisedPaymentAmount))}
                  </div>
                </div>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    backgroundColor:
                      currentActivity.commitmentStatus === 'FULFILLED'
                        ? '#dcfce7'
                        : currentActivity.commitmentStatus === 'BROKEN'
                        ? '#fee2e2'
                        : '#fef3c7',
                    color:
                      currentActivity.commitmentStatus === 'FULFILLED'
                        ? '#15803d'
                        : currentActivity.commitmentStatus === 'BROKEN'
                        ? '#b91c1c'
                        : '#92400e',
                  }}
                >
                  {currentActivity.commitmentStatus}
                </span>
              </div>

              <div style={{ fontSize: 12, color: '#166534' }}>
                Promised Date: <strong>{currentActivity.promisedPaymentDate || 'N/A'}</strong>
                {currentActivity.paymentModePromised && ` via ${currentActivity.paymentModePromised}`}
              </div>

              {/* Status update buttons */}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {currentActivity.commitmentStatus !== PaymentCommitmentStatus.FULFILLED && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleUpdateCommitmentStatus(PaymentCommitmentStatus.FULFILLED)}
                    disabled={isUpdating}
                    style={{ fontSize: 11, padding: '4px 8px', color: '#15803d', borderColor: '#15803d' }}
                  >
                    Mark Fulfilled
                  </button>
                )}
                {currentActivity.commitmentStatus !== PaymentCommitmentStatus.BROKEN && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleUpdateCommitmentStatus(PaymentCommitmentStatus.BROKEN)}
                    disabled={isUpdating}
                    style={{ fontSize: 11, padding: '4px 8px', color: '#b91c1c', borderColor: '#b91c1c' }}
                  >
                    Mark Broken
                  </button>
                )}
                {currentActivity.commitmentStatus !== PaymentCommitmentStatus.CANCELLED && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleUpdateCommitmentStatus(PaymentCommitmentStatus.CANCELLED)}
                    disabled={isUpdating}
                    style={{ fontSize: 11, padding: '4px 8px', color: '#64748b', borderColor: '#cbd5e1' }}
                  >
                    Cancel Commitment
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* Follow-up Section */}
          {currentActivity.followUpDate ? (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                backgroundColor: '#fff7ed',
                border: '1px solid #fed7aa',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9a3412', textTransform: 'uppercase' }}>
                    Scheduled Follow-up
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#7c2d12', marginTop: 2 }}>
                    {currentActivity.followUpDate} at {currentActivity.followUpTime || '11:00'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      backgroundColor: '#ffedd5',
                      color: '#c2410c',
                    }}
                  >
                    {currentActivity.followUpPriority} PRIORITY
                  </span>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      backgroundColor:
                        currentActivity.followUpStatus === 'COMPLETED'
                          ? '#dcfce7'
                          : currentActivity.followUpStatus === 'CANCELLED'
                          ? '#f1f5f9'
                          : '#e0f2fe',
                      color:
                        currentActivity.followUpStatus === 'COMPLETED'
                          ? '#15803d'
                          : currentActivity.followUpStatus === 'CANCELLED'
                          ? '#64748b'
                          : '#0369a1',
                    }}
                  >
                    {currentActivity.followUpStatus}
                  </span>
                </div>
              </div>

              {currentActivity.followUpNotes && (
                <div style={{ fontSize: 12, color: '#7c2d12' }}>
                  Instructions: {currentActivity.followUpNotes}
                </div>
              )}

              {/* Follow-up completion actions */}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {currentActivity.followUpStatus !== FollowUpStatus.COMPLETED && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleUpdateFollowUpStatus(FollowUpStatus.COMPLETED)}
                    disabled={isUpdating}
                    style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      backgroundColor: '#15803d',
                      borderColor: '#15803d',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <CheckCircle2 size={13} />
                    <span>Mark Follow-up Completed</span>
                  </button>
                )}
                {currentActivity.followUpStatus !== FollowUpStatus.CANCELLED && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleUpdateFollowUpStatus(FollowUpStatus.CANCELLED)}
                    disabled={isUpdating}
                    style={{ fontSize: 11, padding: '4px 8px', color: '#64748b' }}
                  >
                    Cancel Follow-up
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* Internal Agent Notes */}
          {currentActivity.agentNotes && (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                backgroundColor: '#f8fafc',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Internal Agent Notes
              </div>
              <div style={{ fontSize: 12, color: '#334155', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                {currentActivity.agentNotes}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-subtle)',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
