import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import {
  IAgentQueueItem,
  formatINR,
  formatDateDDMMYYYY,
  normalizeNumericLeadingZeros,
  EMIStatus,
  CallOutcome,
  PaymentMode,
  CollectionSource,
  IDealer,
} from '@crm/shared';
import {
  Phone,
  MessageCircle,
  Clock,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
  Search,
  Filter,
  FileText,
  X,
  Share2,
} from 'lucide-react';
import { RecordPaymentModal } from '../components/RecordPaymentModal';

export const QueueView: React.FC = () => {
  const [queue, setQueue] = useState<IAgentQueueItem[]>([]);
  const [stats, setStats] = useState<{ todayTarget: number; todayCollected: number; todayPending: number; collectionEfficiency: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE_TODAY' | 'OVERDUE' | 'UPCOMING' | 'TODAY' | 'TOMORROW' | 'NEXT_7_DAYS'>('ALL');
  const [routeFilter, setRouteFilter] = useState('');
  const [search, setSearch] = useState('');

  // Modals state
  const [selectedItemForCall, setSelectedItemForCall] = useState<IAgentQueueItem | null>(null);
  const [selectedItemForPayment, setSelectedItemForPayment] = useState<IAgentQueueItem | null>(null);

  // Call form state
  const [callOutcome, setCallOutcome] = useState<CallOutcome>(CallOutcome.PROMISED_TO_PAY);
  const [promisedDate, setPromisedDate] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [submittingCall, setSubmittingCall] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [queueData, statsData] = await Promise.all([
        ApiClient.getAgentQueue(statusFilter === 'ALL' ? undefined : statusFilter, routeFilter || undefined, search || undefined),
        ApiClient.getAgentStats(),
      ]);
      setQueue(queueData);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to load queue', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter, routeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  const handleOpenCallModal = (item: IAgentQueueItem) => {
    setSelectedItemForCall(item);
    setCallOutcome(CallOutcome.PROMISED_TO_PAY);
    setPromisedDate(new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0]);
    setCallNotes('');
  };

  const handleSubmitCallLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForCall) return;
    setSubmittingCall(true);
    try {
      await ApiClient.logCall({
        customerId: selectedItemForCall.customerId,
        loanId: selectedItemForCall.loanId,
        emiId: selectedItemForCall.installmentId,
        outcome: callOutcome,
        promisedPaymentDate: promisedDate || undefined,
        notes: callNotes,
        contactPhoneUsed: selectedItemForCall.primaryPhone,
      });
      setSelectedItemForCall(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to log call outcome');
    } finally {
      setSubmittingCall(false);
    }
  };

  const handleOpenPaymentModal = (item: IAgentQueueItem) => {
    setSelectedItemForPayment(item);
  };

  const sendWhatsAppReminder = (item: IAgentQueueItem) => {
    const cleanPhone = item.primaryPhone.replace(/\D/g, '');
    const amountStr = formatINR(item.remainingAmount + item.penaltyAmount);
    const msg = `Dear ${item.customerName}, this is a gentle reminder that your EMI installment of ${amountStr} for Loan ${item.loanAccountNo} is due on ${formatDateDDMMYYYY(item.dueDate)}. Please keep payment ready.`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Banner & Progress */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Field Collection Queue</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Priority recovery queue scoped by collection route and overdue severity.
          </p>
        </div>

        {stats && (
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="crm-card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Target</div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--warning-text)' }}>
                  {formatINR(stats.todayTarget)}
                </div>
              </div>
            </div>
            <div className="crm-card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Collected</div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--success-text)' }}>
                  {formatINR(stats.todayCollected)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="crm-card" style={{ padding: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-surface-secondary)', padding: 3, borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
          {(['ALL', 'TODAY', 'TOMORROW', 'NEXT_7_DAYS', 'OVERDUE'] as const).map((s) => {
            const labels: Record<string, string> = {
              ALL: 'All Active',
              TODAY: "Today's Due",
              TOMORROW: 'Tomorrow',
              NEXT_7_DAYS: 'Next 7 Days',
              OVERDUE: 'Overdue Queue',
            };
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`crm-tab ${statusFilter === s ? 'active' : ''}`}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                {labels[s]}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 10, flex: 1, minWidth: 260 }}>
          <input
            type="text"
            className="form-input"
            style={{ width: 180 }}
            placeholder="Area / Route (e.g. Pari Chowk)..."
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
          />

          <input
            type="text"
            className="form-input"
            placeholder="Search customer, phone, or loan acc..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button type="submit" className="btn btn-secondary btn-sm">
            <Search size={13} />
            <span>Search</span>
          </button>
        </form>
      </div>

      {/* Queue Table */}
      <div className="table-container">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Borrower</th>
              <th>Loan Acc</th>
              <th>Route & Address</th>
              <th>Due Date</th>
              <th>Inst #</th>
              <th>Amount Due</th>
              <th>Total Balance</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  Loading collection tasks...
                </td>
              </tr>
            ) : queue.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  <CheckCircle2 size={32} color="var(--success)" style={{ margin: '0 auto 8px' }} />
                  <div style={{ fontWeight: 700 }}>Zero Pending Collections</div>
                  <div style={{ fontSize: 12 }}>No customers in this queue filter.</div>
                </td>
              </tr>
            ) : (
              queue.map((item) => {
                const totalDue = item.remainingAmount + item.penaltyAmount;
                return (
                  <tr key={item.installmentId}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{item.customerName}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {item.customerCode} • {item.primaryPhone}
                      </div>
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>{item.loanAccountNo}</td>
                    <td style={{ fontSize: 12 }}>
                      <div>{item.areaRoute}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.addressSummary}</div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{formatDateDDMMYYYY(item.dueDate)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      #{item.installmentNumber} / {item.totalInstallments}
                    </td>
                    <td className="mono" style={{ fontWeight: 800, color: item.daysOverdue > 0 ? 'var(--danger-text)' : 'var(--warning-text)' }}>
                      {formatINR(totalDue)}
                      {item.penaltyAmount > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--danger-text)' }}>+{formatINR(item.penaltyAmount)} late fee</div>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {formatINR(item.totalOutstandingLoan)}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          item.status === 'PAID'
                            ? 'badge-paid'
                            : item.status === 'DUE_TODAY'
                            ? 'badge-due-today'
                            : item.daysOverdue > 0
                            ? 'badge-overdue'
                            : 'badge-upcoming'
                        }`}
                      >
                        {item.daysOverdue > 0 ? `${item.daysOverdue}D OVERDUE` : item.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <a
                          href={`tel:${item.primaryPhone}`}
                          className="btn btn-secondary btn-sm"
                          title="Call customer"
                          style={{ textDecoration: 'none' }}
                        >
                          <Phone size={12} />
                        </a>
                        <button
                          onClick={() => sendWhatsAppReminder(item)}
                          className="btn btn-secondary btn-sm"
                          style={{ color: '#16a34a' }}
                          title="Send WhatsApp message"
                        >
                          <MessageCircle size={12} />
                        </button>
                        <button
                          onClick={() => handleOpenCallModal(item)}
                          className="btn btn-secondary btn-sm"
                          title="Log call outcome"
                        >
                          <FileText size={12} />
                        </button>
                        <button
                          onClick={() => handleOpenPaymentModal(item)}
                          className="btn btn-success btn-sm"
                          title="Record collected payment"
                        >
                          <DollarSign size={12} />
                          <span>Collect</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Call Log Modal */}
      {selectedItemForCall && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 440, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Log Recovery Call</h3>
              <button onClick={() => setSelectedItemForCall(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: 'var(--bg-surface-secondary)', padding: 10, borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: 12 }}>
              <div>Borrower: <strong>{selectedItemForCall.customerName}</strong></div>
              <div>Phone: <span className="mono">{selectedItemForCall.primaryPhone}</span></div>
            </div>

            <form onSubmit={handleSubmitCallLog} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Call Outcome
                </label>
                <select
                  className="form-select"
                  value={callOutcome}
                  onChange={(e) => setCallOutcome(e.target.value as CallOutcome)}
                >
                  <option value={CallOutcome.PROMISED_TO_PAY}>Promised to Pay</option>
                  <option value={CallOutcome.RINGING}>Ringing / No Answer</option>
                  <option value={CallOutcome.UNREACHABLE}>Unreachable</option>
                  <option value={CallOutcome.SWITCHED_OFF}>Switched Off</option>
                  <option value={CallOutcome.PAID}>Already Paid</option>
                  <option value={CallOutcome.REFUSED_TO_PAY}>Refused to Pay / Dispute</option>
                </select>
              </div>

              {callOutcome === CallOutcome.PROMISED_TO_PAY && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Promised Payment Date
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={promisedDate}
                    onChange={(e) => setPromisedDate(e.target.value)}
                    required
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Conversation Notes
                </label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder="Record customer remarks..."
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button type="button" onClick={() => setSelectedItemForCall(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submittingCall} className="btn btn-primary">
                  {submittingCall ? 'Saving...' : 'Save Call Log'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal for Collection Queue */}
      {selectedItemForPayment && (
        <RecordPaymentModal
          isOpen={!!selectedItemForPayment}
          onClose={() => setSelectedItemForPayment(null)}
          onSuccess={(_receipt) => {
            setSelectedItemForPayment(null);
            loadData();
          }}
          user={ApiClient.getUser() || undefined}
          preselectedLoan={{
            id: selectedItemForPayment.loanId,
            loanAccountNo: selectedItemForPayment.loanAccountNo,
            customerId: selectedItemForPayment.customerId,
            customerName: selectedItemForPayment.customerName,
            customerCode: selectedItemForPayment.customerCode,
            outstandingBalance: selectedItemForPayment.totalOutstandingLoan,
          }}
          preselectedInstallment={{
            id: selectedItemForPayment.installmentId,
            loanId: selectedItemForPayment.loanId,
            installmentNumber: selectedItemForPayment.installmentNumber,
            dueDate: selectedItemForPayment.dueDate,
            expectedAmount: selectedItemForPayment.expectedAmount,
            remainingAmount: selectedItemForPayment.remainingAmount,
            penaltyAmount: selectedItemForPayment.penaltyAmount,
            status: selectedItemForPayment.status,
          }}
        />
      )}
    </div>
  );
};
