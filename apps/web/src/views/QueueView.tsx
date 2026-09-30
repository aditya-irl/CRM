import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import { IAgentQueueItem, formatINR, EMIStatus, CallOutcome, PaymentMode, CollectionSource, IDealer } from '@crm/shared';
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
  Receipt as ReceiptIcon,
  Store,
  UserCheck,
} from 'lucide-react';

export const QueueView: React.FC = () => {
  const [queue, setQueue] = useState<IAgentQueueItem[]>([]);
  const [stats, setStats] = useState<{ todayTarget: number; todayCollected: number; todayPending: number; collectionEfficiency: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE_TODAY' | 'OVERDUE' | 'UPCOMING'>('ALL');
  const [routeFilter, setRouteFilter] = useState('');
  const [search, setSearch] = useState('');

  // Modals state
  const [selectedItemForCall, setSelectedItemForCall] = useState<IAgentQueueItem | null>(null);
  const [selectedItemForPayment, setSelectedItemForPayment] = useState<IAgentQueueItem | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<any | null>(null);

  // Call form state
  const [callOutcome, setCallOutcome] = useState<CallOutcome>(CallOutcome.PROMISED_TO_PAY);
  const [promisedDate, setPromisedDate] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [submittingCall, setSubmittingCall] = useState(false);

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [collectionSource, setCollectionSource] = useState<CollectionSource>(CollectionSource.DIRECT_CUSTOMER);
  const [selectedDealerId, setSelectedDealerId] = useState<string>('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [dealersList, setDealersList] = useState<IDealer[]>([]);
  const [agentsList, setAgentsList] = useState<any[]>([]);
  const [refNumber, setRefNumber] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

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
    const fullDue = item.remainingAmount + item.penaltyAmount;
    setPaymentAmount(fullDue);
    setPaymentMode(PaymentMode.CASH);
    setCollectionSource(CollectionSource.DIRECT_CUSTOMER);
    setSelectedDealerId('');
    setSelectedAgentId('');
    setRefNumber('');
    setPaymentNotes('');

    // Fetch active dealers and collection agents if not loaded
    if (dealersList.length === 0) {
      ApiClient.getDealers(undefined, 'ACTIVE').then(setDealersList).catch(console.error);
    }
    if (agentsList.length === 0) {
      ApiClient.getUsers('COLLECTION_AGENT', 'ACTIVE').then(setAgentsList).catch(console.error);
    }
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForPayment) return;
    if (collectionSource === CollectionSource.DEALER && !selectedDealerId) {
      alert('Please select a partner store');
      return;
    }
    if (collectionSource === CollectionSource.RECOVERY_AGENT && !selectedAgentId) {
      alert('Please select a recovery agent');
      return;
    }

    setSubmittingPayment(true);
    try {
      const idempotencyKey = `WEB_${selectedItemForPayment.installmentId}_${Date.now()}`;
      const res = await ApiClient.recordPayment({
        loanId: selectedItemForPayment.loanId,
        emiId: selectedItemForPayment.installmentId,
        customerId: selectedItemForPayment.customerId,
        amount: Number(paymentAmount),
        paymentMode,
        collectionSource,
        dealerId: collectionSource === CollectionSource.DEALER ? selectedDealerId : undefined,
        agentId: collectionSource === CollectionSource.RECOVERY_AGENT ? selectedAgentId : undefined,
        referenceNumber: refNumber || undefined,
        notes: paymentNotes || undefined,
        idempotencyKey,
      });
      setSelectedItemForPayment(null);
      setActiveReceipt(res);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to record payment');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const sendWhatsAppReminder = (item: IAgentQueueItem) => {
    const cleanPhone = item.primaryPhone.replace(/\D/g, '');
    const amountStr = formatINR(item.remainingAmount + item.penaltyAmount);
    const msg = `Dear ${item.customerName}, this is a gentle reminder that your EMI installment of ${amountStr} for Loan ${item.loanAccountNo} is due on ${item.dueDate}. Please keep payment ready.`;
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
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-surface-secondary)', padding: 3, borderRadius: 'var(--radius-md)' }}>
          {(['ALL', 'DUE_TODAY', 'OVERDUE', 'UPCOMING'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`crm-tab ${statusFilter === s ? 'active' : ''}`}
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
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
                    <td className="mono" style={{ fontSize: 12 }}>{item.dueDate}</td>
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

      {/* Collect Payment Modal */}
      {selectedItemForPayment && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 440, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Record Payment Collection</h3>
              <button onClick={() => setSelectedItemForPayment(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: 'var(--bg-surface-secondary)', padding: 12, borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: 12 }}>
              <div>Borrower: <strong>{selectedItemForPayment.customerName}</strong></div>
              <div>Loan Acc: <span className="mono">{selectedItemForPayment.loanAccountNo}</span></div>
              <div style={{ marginTop: 4 }}>
                Outstanding Loan: <span className="mono">{formatINR(selectedItemForPayment.totalOutstandingLoan)}</span>
              </div>
            </div>

            <form onSubmit={handleSubmitPayment} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Payment Amount (₹)
                </label>
                <input
                  type="number"
                  step="1"
                  className="form-input mono"
                  style={{ fontSize: 16, fontWeight: 700 }}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(Number(e.target.value))}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Collection Through
                </label>
                <select
                  className="form-select"
                  value={collectionSource}
                  onChange={(e) => {
                    const src = e.target.value as CollectionSource;
                    setCollectionSource(src);
                    if (src === CollectionSource.DEALER && !selectedDealerId && dealersList.length > 0) {
                      setSelectedDealerId(dealersList[0].id);
                    }
                    if (src === CollectionSource.RECOVERY_AGENT && !selectedAgentId && agentsList.length > 0) {
                      setSelectedAgentId(agentsList[0].id);
                    }
                  }}
                >
                  <option value={CollectionSource.DIRECT_CUSTOMER}>Direct Customer</option>
                  <option value={CollectionSource.DEALER}>Partner Store</option>
                  <option value={CollectionSource.RECOVERY_AGENT}>Recovery Agent</option>
                </select>
              </div>

              {collectionSource === CollectionSource.DEALER && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Partner Store (Active Stores Only)
                  </label>
                  <select
                    className="form-select"
                    value={selectedDealerId}
                    onChange={(e) => setSelectedDealerId(e.target.value)}
                    required
                  >
                    <option value="">-- Select Partner Store --</option>
                    {dealersList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.storeName} ({d.dealerCode}) - {d.areaCity}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {collectionSource === CollectionSource.RECOVERY_AGENT && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Recovery Agent
                  </label>
                  <select
                    className="form-select"
                    value={selectedAgentId}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                    required
                  >
                    <option value="">-- Select Recovery Agent --</option>
                    {agentsList.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.fullName || ag.full_name} ({ag.phone})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Payment Mode
                </label>
                <select
                  className="form-select"
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                >
                  <option value={PaymentMode.CASH}>Cash</option>
                  <option value={PaymentMode.UPI}>UPI (QR / App)</option>
                  <option value={PaymentMode.BANK_TRANSFER}>Bank Transfer (NEFT/IMPS)</option>
                </select>
              </div>

              {paymentMode !== PaymentMode.CASH && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Reference / UTR Number
                  </label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder="e.g. UPI Ref / Txn ID"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button type="button" onClick={() => setSelectedItemForPayment(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submittingPayment} className="btn btn-success">
                  {submittingPayment ? 'Processing...' : 'Settle & Generate Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Receipt Result Popup */}
      {activeReceipt && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 420, padding: 24, textAlign: 'center' }}>
            <CheckCircle2 size={36} color="var(--success)" style={{ margin: '0 auto 8px' }} />
            <h3 style={{ fontSize: 17, fontWeight: 800 }}>PAYMENT COLLECTED</h3>
            <div className="mono" style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13, marginTop: 2 }}>
              {activeReceipt.receiptNumber}
            </div>

            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                padding: 12,
                borderRadius: 'var(--radius-sm)',
                margin: '14px 0',
                fontSize: 13,
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div>Loan Acc: <span className="mono">{activeReceipt.loanAccountNo}</span></div>
              <div style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                Amount: {formatINR(activeReceipt.amountCollected)}
              </div>
              <div>
                Remaining Balance: <span className="mono">{formatINR(activeReceipt.remainingLoanOutstanding)}</span>
              </div>
            </div>

            <button onClick={() => setActiveReceipt(null)} className="btn btn-primary" style={{ width: '100%' }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
