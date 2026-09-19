import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import { IPayment, formatINR, IUser, UserRole } from '@crm/shared';
import {
  Receipt,
  Search,
  RotateCcw,
  Eye,
  CheckCircle2,
  X,
  Printer,
} from 'lucide-react';

interface PaymentsViewProps {
  user: IUser;
}

export const PaymentsView: React.FC<PaymentsViewProps> = ({ user }) => {
  const [payments, setPayments] = useState<IPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Reversal Modal
  const [selectedPaymentForReversal, setSelectedPaymentForReversal] = useState<IPayment | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [submittingReversal, setSubmittingReversal] = useState(false);

  // Receipt Modal
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.listPayments(search || undefined);
      setPayments(data);
    } catch (err) {
      console.error('Failed to load payments', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  const handleOpenReceipt = async (paymentId: string) => {
    try {
      const receipt = await ApiClient.getReceipt(paymentId);
      setSelectedReceipt(receipt);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch receipt');
    }
  };

  const handleSubmitReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPaymentForReversal) return;
    setSubmittingReversal(true);
    try {
      await ApiClient.reversePayment(selectedPaymentForReversal.id, reversalReason);
      setSelectedPaymentForReversal(null);
      setReversalReason('');
      alert('Payment reversed successfully. Outstanding loan balance restored.');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to reverse payment');
    } finally {
      setSubmittingReversal(false);
    }
  };

  const isAdmin = user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Financial Payments & Receipts Ledger</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Immutable collection transaction records, receipt verification, and administrative reversals.
          </p>
        </div>
      </div>

      <div className="crm-card" style={{ padding: 14 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12 }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search by receipt number, borrower name, or loan account..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            <Search size={14} />
            <span>Search</span>
          </button>
        </form>
      </div>

      <div className="table-container">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Receipt No</th>
              <th>Loan Acc</th>
              <th>Borrower</th>
              <th>Amount</th>
              <th>Mode</th>
              <th>Collected By</th>
              <th>Date & Time</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  Loading payment ledger...
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  No payment transactions found.
                </td>
              </tr>
            ) : (
              payments.map((p) => {
                const isReversed = p.status === 'REVERSED' || Boolean((p as any).is_reversal);
                return (
                  <tr key={p.id}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {p.receiptNumber || (p as any).receipt_number}
                    </td>
                    <td className="mono">{(p as any).loan_account_no}</td>
                    <td style={{ fontWeight: 600 }}>{(p as any).customer_name}</td>
                    <td
                      className="mono"
                      style={{
                        fontWeight: 700,
                        color: isReversed ? 'var(--text-muted)' : 'var(--success-text)',
                        textDecoration: isReversed ? 'line-through' : 'none',
                      }}
                    >
                      {formatINR(p.amount)}
                    </td>
                    <td>
                      <span className="badge badge-upcoming">{p.paymentMode || (p as any).payment_mode}</span>
                    </td>
                    <td>{(p as any).collected_by_name}</td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(p.paymentTimestamp || (p as any).payment_timestamp).toLocaleString('en-IN', { hour12: true })}
                    </td>
                    <td>
                      <span className={`badge ${isReversed ? 'badge-overdue' : 'badge-paid'}`}>
                        {isReversed ? 'REVERSED' : 'SUCCESS'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleOpenReceipt(p.id)}
                          className="btn btn-secondary btn-sm"
                          title="View printable receipt"
                        >
                          <Eye size={12} />
                          <span>Receipt</span>
                        </button>

                        {isAdmin && !isReversed && (
                          <button
                            onClick={() => { setSelectedPaymentForReversal(p); setReversalReason(''); }}
                            className="btn btn-danger btn-sm"
                            title="Reverse transaction"
                          >
                            <RotateCcw size={12} />
                            <span>Reverse</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal 1: Reversal Reason */}
      {selectedPaymentForReversal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 460, padding: 24, border: '1px solid var(--danger-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger)' }}>Confirm Payment Reversal</h3>
              <button onClick={() => setSelectedPaymentForReversal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Reversing receipt <strong>{selectedPaymentForReversal.receiptNumber || (selectedPaymentForReversal as any).receipt_number}</strong> of <strong>{formatINR(selectedPaymentForReversal.amount)}</strong> will restore the borrower's debt balance and create an immutable audit record.
            </p>

            <form onSubmit={handleSubmitReversal} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Mandatory Reversal Justification</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder="e.g. Erroneous cash entry by field staff; customer paid via bank transfer directly..."
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button type="button" onClick={() => setSelectedPaymentForReversal(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submittingReversal} className="btn btn-danger">
                  {submittingReversal ? 'Reversing...' : 'Authorize Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Receipt Viewer */}
      {selectedReceipt && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 420, padding: 24 }}>
            <div style={{ textAlign: 'center', borderBottom: '1px dashed var(--border-subtle)', paddingBottom: 16, marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800 }}>OFFICIAL PAYMENT RECEIPT</h3>
              <div className="mono" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 700, marginTop: 4 }}>
                {selectedReceipt.receiptNumber}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {new Date(selectedReceipt.paymentTimestamp).toLocaleString('en-IN', { hour12: true })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Borrower:</span>
                <strong>{selectedReceipt.customer?.name} ({selectedReceipt.customer?.code})</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Loan Account:</span>
                <span className="mono">{selectedReceipt.loan?.accountNo}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Mode:</span>
                <span>{selectedReceipt.paymentMode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontWeight: 700 }}>Amount Paid:</span>
                <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--success-text)' }}>
                  {formatINR(selectedReceipt.amount)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Remaining Balance:</span>
                <span className="mono">{formatINR(selectedReceipt.loan?.remainingOutstanding)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Collected By:</span>
                <span>{selectedReceipt.collectedBy?.name}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => window.print()} className="btn btn-secondary" style={{ flex: 1 }}>
                <Printer size={13} />
                <span>Print</span>
              </button>
              <button onClick={() => setSelectedReceipt(null)} className="btn btn-primary" style={{ flex: 1 }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
