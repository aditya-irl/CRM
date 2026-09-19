import React, { useEffect, useState } from 'react';
import { MobileApi } from '../services/mobileApi';
import { IAgentQueueItem, formatINR, EMIStatus, CallOutcome, PaymentMode, IUser } from '@crm/shared';
import {
  Phone,
  MessageCircle,
  Clock,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
  LogOut,
  WifiOff,
  Search,
  FileText,
  X,
  Share2,
} from 'lucide-react';

interface MobileQueueProps {
  user: IUser;
  onLogout: () => void;
}

export const MobileQueue: React.FC<MobileQueueProps> = ({ user, onLogout }) => {
  const [queue, setQueue] = useState<IAgentQueueItem[]>([]);
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);

  const [tab, setTab] = useState<'DUE_TODAY' | 'OVERDUE' | 'ALL'>('DUE_TODAY');
  const [search, setSearch] = useState('');

  // Modals
  const [selectedCallItem, setSelectedCallItem] = useState<IAgentQueueItem | null>(null);
  const [callOutcome, setCallOutcome] = useState<CallOutcome>(CallOutcome.PROMISED_TO_PAY);
  const [promisedDate, setPromisedDate] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [savingCall, setSavingCall] = useState(false);

  const [selectedPayItem, setSelectedPayItem] = useState<IAgentQueueItem | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMode, setPayMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [refNo, setRefNo] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [receiptResult, setReceiptResult] = useState<any | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const statusParam = tab === 'ALL' ? undefined : tab;
      const res = await MobileApi.getQueue(statusParam, undefined, search || undefined);
      setQueue(res.items);
      setFromCache(res.fromCache);

      const statsRes = await MobileApi.getStats();
      setStats(statsRes);
    } catch (err) {
      console.error('Queue load failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [tab]);

  const handleOpenCall = (item: IAgentQueueItem) => {
    setSelectedCallItem(item);
    setCallOutcome(CallOutcome.PROMISED_TO_PAY);
    setPromisedDate(new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0]);
    setCallNotes('');
  };

  const handleSaveCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCallItem) return;
    setSavingCall(true);
    try {
      await MobileApi.logCall({
        customerId: selectedCallItem.customerId,
        loanId: selectedCallItem.loanId,
        emiId: selectedCallItem.installmentId,
        outcome: callOutcome,
        promisedPaymentDate: promisedDate || undefined,
        notes: callNotes,
        contactPhoneUsed: selectedCallItem.primaryPhone,
      });
      setSelectedCallItem(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Error saving call log');
    } finally {
      setSavingCall(false);
    }
  };

  const handleOpenPay = (item: IAgentQueueItem) => {
    setSelectedPayItem(item);
    setPayAmount(item.remainingAmount + item.penaltyAmount);
    setPayMode(PaymentMode.CASH);
    setRefNo('');
  };

  const handleSavePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPayItem) return;
    setSavingPayment(true);
    try {
      const res = await MobileApi.recordPayment({
        loanId: selectedPayItem.loanId,
        emiId: selectedPayItem.installmentId,
        customerId: selectedPayItem.customerId,
        amount: Number(payAmount),
        paymentMode: payMode,
        referenceNumber: refNo || undefined,
        idempotencyKey: `MOB_${selectedPayItem.installmentId}_${Date.now()}`,
      });
      setSelectedPayItem(null);
      setReceiptResult(res);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Error recording payment');
    } finally {
      setSavingPayment(false);
    }
  };

  const sendWhatsApp = (item: IAgentQueueItem) => {
    const clean = item.primaryPhone.replace(/\D/g, '');
    const amount = formatINR(item.remainingAmount + item.penaltyAmount);
    const msg = `Dear ${item.customerName}, your loan EMI of ${amount} for account ${item.loanAccountNo} is due on ${item.dueDate}. Please keep payment ready.`;
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div style={{ paddingBottom: 70, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Header */}
      <header
        style={{
          background: '#ffffff',
          padding: '12px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--primary-subtle)',
              color: 'var(--primary)',
              border: '1px solid var(--primary-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            {user.fullName.charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>FIELD AGENT</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{user.fullName}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {fromCache && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', padding: '3px 6px', borderRadius: 4, fontSize: 10, color: 'var(--warning-text)', fontWeight: 600 }}>
              <WifiOff size={11} />
              <span>Offline Cache</span>
            </div>
          )}
        </div>
      </header>

      {/* Progress Strip */}
      {stats && (
        <div
          style={{
            background: 'var(--bg-surface-secondary)',
            padding: '10px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>TODAY TARGET</div>
            <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--warning-text)' }}>
              {formatINR(stats.todayTarget)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>COLLECTED</div>
            <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--success-text)' }}>
              {formatINR(stats.todayCollected)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>EFFICIENCY</div>
            <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--primary)' }}>
              {stats.collectionEfficiency}%
            </div>
          </div>
        </div>
      )}

      {/* Quick Filter Tabs */}
      <div style={{ padding: '10px 16px', display: 'flex', gap: 6, background: '#ffffff', borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setTab('DUE_TODAY')}
          className={`mobile-btn ${tab === 'DUE_TODAY' ? 'mobile-btn-primary' : 'mobile-btn-secondary'}`}
          style={{ flex: 1, minHeight: 34, fontSize: 12, padding: '6px 8px' }}
        >
          Due Today
        </button>
        <button
          onClick={() => setTab('OVERDUE')}
          className={`mobile-btn ${tab === 'OVERDUE' ? 'mobile-btn-danger' : 'mobile-btn-secondary'}`}
          style={{ flex: 1, minHeight: 34, fontSize: 12, padding: '6px 8px' }}
        >
          Overdue
        </button>
        <button
          onClick={() => setTab('ALL')}
          className={`mobile-btn ${tab === 'ALL' ? 'mobile-btn-primary' : 'mobile-btn-secondary'}`}
          style={{ flex: 1, minHeight: 34, fontSize: 12, padding: '6px 8px' }}
        >
          All Queue
        </button>
      </div>

      {/* Queue Cards */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading queue...</div>
        ) : queue.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <CheckCircle2 size={36} color="var(--success)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 700, fontSize: 15 }}>Zero Pending Tasks</div>
            <div style={{ fontSize: 12, marginTop: 2 }}>No collection tasks pending for this route.</div>
          </div>
        ) : (
          queue.map((item) => {
            const dueAmt = item.remainingAmount + item.penaltyAmount;
            return (
              <div key={item.installmentId} className="mobile-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700 }}>{item.customerName}</h3>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {item.customerCode} • {item.loanAccountNo}
                    </div>
                  </div>
                  <span
                    className={`mobile-badge ${
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
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-secondary)',
                    padding: 10,
                    borderRadius: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>AMOUNT DUE</div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 17,
                        fontWeight: 800,
                        color: item.daysOverdue > 0 ? 'var(--danger-text)' : 'var(--warning-text)',
                      }}
                    >
                      {formatINR(dueAmt)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 11 }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Due: {item.dueDate}</div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      Inst #{item.installmentNumber} of {item.totalInstallments}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  📍 {item.areaRoute}: {item.addressSummary}
                </div>

                {/* 4 Quick Action Buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr', gap: 6, paddingTop: 4 }}>
                  <a
                    href={`tel:${item.primaryPhone}`}
                    className="mobile-btn mobile-btn-secondary"
                    style={{ textDecoration: 'none', color: 'var(--text-primary)', minHeight: 36 }}
                  >
                    <Phone size={13} color="var(--primary)" />
                    <span>Call</span>
                  </a>

                  <button
                    onClick={() => sendWhatsApp(item)}
                    className="mobile-btn mobile-btn-secondary"
                    style={{ color: '#16a34a', minHeight: 36 }}
                  >
                    <MessageCircle size={13} />
                    <span>Chat</span>
                  </button>

                  <button
                    onClick={() => handleOpenCall(item)}
                    className="mobile-btn mobile-btn-secondary"
                    style={{ minHeight: 36 }}
                  >
                    <FileText size={13} />
                    <span>Log</span>
                  </button>

                  <button
                    onClick={() => handleOpenPay(item)}
                    className="mobile-btn mobile-btn-success"
                    style={{ minHeight: 36 }}
                  >
                    <DollarSign size={13} />
                    <span>Collect</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Call Modal */}
      {selectedCallItem && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 400, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>Log Call Outcome</h3>
              <button onClick={() => setSelectedCallItem(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCall} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Outcome
                </label>
                <select className="mobile-select" value={callOutcome} onChange={(e) => setCallOutcome(e.target.value as CallOutcome)}>
                  <option value={CallOutcome.PROMISED_TO_PAY}>Promised to Pay</option>
                  <option value={CallOutcome.RINGING}>Ringing / No Answer</option>
                  <option value={CallOutcome.UNREACHABLE}>Unreachable</option>
                  <option value={CallOutcome.SWITCHED_OFF}>Switched Off</option>
                  <option value={CallOutcome.PAID}>Already Paid</option>
                  <option value={CallOutcome.REFUSED_TO_PAY}>Refused / Dispute</option>
                </select>
              </div>

              {callOutcome === CallOutcome.PROMISED_TO_PAY && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Promised Date
                  </label>
                  <input type="date" className="mobile-input" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} required />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Notes
                </label>
                <textarea className="mobile-textarea" rows={3} placeholder="Customer remarks..." value={callNotes} onChange={(e) => setCallNotes(e.target.value)} required />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setSelectedCallItem(null)} className="mobile-btn mobile-btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" disabled={savingCall} className="mobile-btn mobile-btn-primary" style={{ flex: 1 }}>
                  {savingCall ? 'Saving...' : 'Save Log'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {selectedPayItem && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 400, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>Collect Payment</h3>
              <button onClick={() => setSelectedPayItem(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: 'var(--bg-surface-secondary)', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
              <div>Borrower: <strong>{selectedPayItem.customerName}</strong></div>
              <div>Loan Acc: <span className="mono">{selectedPayItem.loanAccountNo}</span></div>
            </div>

            <form onSubmit={handleSavePay} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Amount (₹)
                </label>
                <input
                  type="number"
                  className="mobile-input mono"
                  style={{ fontSize: 18, fontWeight: 700 }}
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Payment Mode
                </label>
                <select className="mobile-select" value={payMode} onChange={(e) => setPayMode(e.target.value as PaymentMode)}>
                  <option value={PaymentMode.CASH}>Cash</option>
                  <option value={PaymentMode.UPI}>UPI</option>
                  <option value={PaymentMode.BANK_TRANSFER}>Bank Transfer</option>
                </select>
              </div>

              {payMode !== PaymentMode.CASH && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Txn Ref No / UPI ID
                  </label>
                  <input type="text" className="mobile-input mono" placeholder="UPI Reference..." value={refNo} onChange={(e) => setRefNo(e.target.value)} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setSelectedPayItem(null)} className="mobile-btn mobile-btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" disabled={savingPayment} className="mobile-btn mobile-btn-success" style={{ flex: 1 }}>
                  {savingPayment ? 'Saving...' : 'Settle & Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {receiptResult && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 360, textAlign: 'center', padding: 24 }}>
            <CheckCircle2 size={36} color="var(--success)" style={{ margin: '0 auto 6px' }} />
            <h3 style={{ fontSize: 16, fontWeight: 800 }}>PAYMENT COLLECTED</h3>
            <div className="mono" style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13 }}>
              {receiptResult.receiptNumber}
            </div>

            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                padding: 12,
                borderRadius: 8,
                margin: '14px 0',
                fontSize: 13,
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div>Loan Acc: <span className="mono">{receiptResult.loanAccountNo}</span></div>
              <div style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                Amount: {formatINR(receiptResult.amountCollected)}
              </div>
              <div>
                Remaining Loan: <span className="mono">{formatINR(receiptResult.remainingLoanOutstanding)}</span>
              </div>
            </div>

            <button onClick={() => setReceiptResult(null)} className="mobile-btn mobile-btn-primary" style={{ width: '100%' }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
