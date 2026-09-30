import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import { ILoan, ICustomer, formatINR, InterestMethod, RepaymentFrequency, LoanStatus } from '@crm/shared';
import {
  Plus,
  Search,
  Banknote,
  Calculator,
  Calendar,
  X,
  CheckCircle2,
  AlertCircle,
  Eye,
  Receipt,
  Store,
  UserCheck,
  Building2,
  Printer,
  Link as LinkIcon,
} from 'lucide-react';
import { PortalLinkManager } from '../components/PortalLinkManager';

export const LoansView: React.FC = () => {
  const currentUser = ApiClient.getUser();
  const [loans, setLoans] = useState<ILoan[]>([]);
  const [customers, setCustomers] = useState<ICustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Origination Modal State
  const [showOriginationModal, setShowOriginationModal] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [principalAmount, setPrincipalAmount] = useState<number>(50000);
  const [downPayment, setDownPayment] = useState<number>(0);
  const [annualRate, setAnnualRate] = useState<number>(14.0);
  const [calcMethod, setCalcMethod] = useState<InterestMethod>(InterestMethod.FLAT_RATE);
  const [tenureMonths, setTenureMonths] = useState<number>(12);
  const [frequency, setFrequency] = useState<RepaymentFrequency>(RepaymentFrequency.MONTHLY);
  const [disbDate, setDisbDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [previewSchedule, setPreviewSchedule] = useState<any | null>(null);
  const [calculatingPreview, setCalculatingPreview] = useState(false);
  const [bookingLoan, setBookingLoan] = useState(false);

  // Detail Modal State
  const [selectedLoanDetail, setSelectedLoanDetail] = useState<{ loan: any; installments: any[]; payments: any[] } | null>(null);
  const [loanModalTab, setLoanModalTab] = useState<'schedule' | 'payments' | 'portal'>('schedule');
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [loansData, custData] = await Promise.all([
        ApiClient.getLoans(search || undefined),
        ApiClient.getCustomers(),
      ]);
      setLoans(loansData);
      setCustomers(custData);
      if (custData.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(custData[0].id);
      }
    } catch (err) {
      console.error('Failed to load loans', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePreviewCalculation = async () => {
    setCalculatingPreview(true);
    try {
      const res = await ApiClient.calculateLoanPreview({
        principalAmount: Number(principalAmount),
        downPayment: Number(downPayment),
        annualInterestRate: Number(annualRate),
        interestCalcMethod: calcMethod,
        tenureMonths: Number(tenureMonths),
        installmentFrequency: frequency,
        disbursementDate: disbDate,
      });
      setPreviewSchedule(res);
    } catch (err: any) {
      alert(err.message || 'Failed to calculate amortization preview');
    } finally {
      setCalculatingPreview(false);
    }
  };

  const handleBookLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) {
      alert('Please select a customer borrower');
      return;
    }
    setBookingLoan(true);
    try {
      await ApiClient.createLoan({
        customerId: selectedCustomerId,
        principalAmount: Number(principalAmount),
        downPayment: Number(downPayment),
        annualInterestRate: Number(annualRate),
        interestCalcMethod: calcMethod,
        tenureMonths: Number(tenureMonths),
        installmentFrequency: frequency,
        disbursementDate: disbDate,
      });
      setShowOriginationModal(false);
      setPreviewSchedule(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to originate loan');
    } finally {
      setBookingLoan(false);
    }
  };

  const handleViewLoan = async (loanId: string, initialTab: 'schedule' | 'payments' | 'portal' = 'schedule') => {
    setLoadingDetail(true);
    try {
      const [loanData, paymentsData] = await Promise.all([
        ApiClient.getLoanDetail(loanId),
        ApiClient.listPayments(undefined, 1, 100, undefined, loanId).catch(() => []),
      ]);
      const loanObj = (loanData as any).loan || loanData;
      const installmentsList = (loanData as any).installments || [];
      setSelectedLoanDetail({
        loan: loanObj,
        installments: installmentsList,
        payments: paymentsData || [],
      });
      setLoanModalTab(initialTab);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch loan details');
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Loans & Amortization Portfolio</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Originate loans, preview deterministic amortization schedules, and track repayments.
          </p>
        </div>

        <button onClick={() => { setShowOriginationModal(true); setPreviewSchedule(null); }} className="btn btn-primary">
          <Plus size={15} />
          <span>Originate New Loan</span>
        </button>
      </div>

      {/* Loans Table */}
      <div className="table-container">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Loan Account</th>
              <th>Borrower</th>
              <th>Principal</th>
              <th>Tenure</th>
              <th>EMI</th>
              <th>Total Payable</th>
              <th>Total Paid</th>
              <th>Outstanding</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  Loading loan accounts...
                </td>
              </tr>
            ) : loans.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  No loan accounts found.
                </td>
              </tr>
            ) : (
              loans.map((loan) => (
                <tr key={loan.id}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                    {loan.loanAccountNo || (loan as any).loan_account_no}
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {(loan as any).customer_name || loan.customer?.fullName}
                  </td>
                  <td className="mono">{formatINR(loan.principalAmount || (loan as any).principal_amount)}</td>
                  <td className="mono">{loan.tenureMonths || (loan as any).tenure_months} M</td>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--warning-text)' }}>
                    {formatINR(loan.emiAmount || (loan as any).emi_amount)}
                  </td>
                  <td className="mono">{formatINR(loan.totalPayable || (loan as any).total_payable)}</td>
                  <td className="mono" style={{ color: 'var(--success-text)', fontWeight: 600 }}>
                    {formatINR(loan.totalPaid || (loan as any).total_paid)}
                  </td>
                  <td className="mono" style={{ color: 'var(--danger-text)', fontWeight: 700 }}>
                    {formatINR(loan.outstandingBalance || (loan as any).outstanding_balance)}
                  </td>
                  <td>
                    <span className="badge badge-paid">
                      {loan.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleViewLoan(loan.id, 'schedule')}
                        className="btn btn-secondary btn-sm"
                        title="View complete EMI schedule"
                      >
                        <Eye size={13} />
                        <span>Schedule</span>
                      </button>
                      <button
                        onClick={() => handleViewLoan(loan.id, 'portal')}
                        className="btn btn-secondary btn-sm"
                        title="Manage Customer Portal Link"
                      >
                        <LinkIcon size={13} />
                        <span>Portal</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal 1: Loan Origination & Amortization Calculator */}
      {showOriginationModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 780, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Calculator size={20} color="var(--primary)" />
                <h3 style={{ fontSize: 17, fontWeight: 800 }}>Originate Loan & Preview Amortization</h3>
              </div>
              <button onClick={() => setShowOriginationModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleBookLoan} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Borrower Customer</label>
                  <select
                    className="form-select"
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    required
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} ({c.customerCode}) - {c.areaRoute}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Principal Amount (₹)</label>
                  <input
                    type="number"
                    className="form-input mono"
                    value={principalAmount}
                    onChange={(e) => setPrincipalAmount(Number(e.target.value))}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Down Payment (₹)</label>
                  <input
                    type="number"
                    className="form-input mono"
                    value={downPayment}
                    onChange={(e) => setDownPayment(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Annual Interest Rate (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input mono"
                    value={annualRate}
                    onChange={(e) => setAnnualRate(Number(e.target.value))}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Calculation Method</label>
                  <select
                    className="form-select"
                    value={calcMethod}
                    onChange={(e) => setCalcMethod(e.target.value as InterestMethod)}
                  >
                    <option value={InterestMethod.FLAT_RATE}>Flat Rate</option>
                    <option value={InterestMethod.REDUCING_BALANCE}>Reducing Balance</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Tenure (Months)</label>
                  <input
                    type="number"
                    className="form-input mono"
                    value={tenureMonths}
                    onChange={(e) => setTenureMonths(Number(e.target.value))}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Disbursement Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={disbDate}
                    onChange={(e) => setDisbDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={handlePreviewCalculation}
                  disabled={calculatingPreview}
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                >
                  <Calculator size={15} />
                  <span>{calculatingPreview ? 'Computing...' : '1. Preview Server Amortization Schedule'}</span>
                </button>
              </div>

              {/* Schedule Preview Section */}
              {previewSchedule && (
                <div style={{ background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14, textAlign: 'center' }}>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Net Disbursed</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{formatINR(previewSchedule.netDisbursedAmount)}</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total Interest</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--warning-text)' }}>{formatINR(previewSchedule.totalInterest)}</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total Payable</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{formatINR(previewSchedule.totalPayable)}</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>EMI Amount</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>{formatINR(previewSchedule.emiAmount)}</div>
                    </div>
                  </div>

                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    <table className="crm-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Due Date</th>
                          <th>Principal</th>
                          <th>Interest</th>
                          <th>Total Installment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewSchedule.schedule.map((row: any) => (
                          <tr key={row.installmentNumber}>
                            <td className="mono">{row.installmentNumber}</td>
                            <td className="mono">{row.dueDate}</td>
                            <td className="mono">{formatINR(row.principalComponent)}</td>
                            <td className="mono">{formatINR(row.interestComponent)}</td>
                            <td className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                              {formatINR(row.expectedAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setShowOriginationModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={bookingLoan || !previewSchedule} className="btn btn-primary">
                  {bookingLoan ? 'Booking Loan...' : '2. Disburse Loan & Book Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Loan Schedule & Ledger View */}
      {selectedLoanDetail && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 800, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 800 }}>Loan Account: {selectedLoanDetail.loan.loanAccountNo || (selectedLoanDetail.loan as any).loan_account_no}</h3>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Borrower: {(selectedLoanDetail.loan as any).customer_name} • {(selectedLoanDetail.loan as any).area_route}</p>
              </div>
              <button onClick={() => setSelectedLoanDetail(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Tab Switcher */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setLoanModalTab('schedule')}
                className={`btn btn-sm ${loanModalTab === 'schedule' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Amortization Schedule ({selectedLoanDetail.installments.length})
              </button>
              <button
                type="button"
                onClick={() => setLoanModalTab('payments')}
                className={`btn btn-sm ${loanModalTab === 'payments' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Payment History ({selectedLoanDetail.payments.length})
              </button>
              <button
                type="button"
                onClick={() => setLoanModalTab('portal')}
                className={`btn btn-sm ${loanModalTab === 'portal' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <LinkIcon size={13} />
                <span>Customer Portal Link</span>
              </button>
            </div>

            {loanModalTab === 'schedule' ? (
              <div className="table-container" style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Inst #</th>
                      <th>Due Date</th>
                      <th>Expected</th>
                      <th>Paid</th>
                      <th>Remaining</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLoanDetail.installments.map((inst) => (
                      <tr key={inst.id}>
                        <td className="mono">{inst.installment_number}</td>
                        <td className="mono">{inst.due_date}</td>
                        <td className="mono">{formatINR(inst.expected_amount)}</td>
                        <td className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(inst.paid_amount)}</td>
                        <td className="mono" style={{ color: inst.remaining_amount > 0 ? 'var(--danger-text)' : 'inherit', fontWeight: 600 }}>
                          {formatINR(inst.remaining_amount)}
                        </td>
                        <td>
                          <span className={`badge ${inst.status === 'PAID' ? 'badge-paid' : inst.status === 'DUE_TODAY' ? 'badge-due-today' : inst.status === 'OVERDUE' ? 'badge-overdue' : 'badge-upcoming'}`}>
                            {inst.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : loanModalTab === 'payments' ? (
              <div className="table-container" style={{ maxHeight: 340, overflowY: 'auto' }}>
                {selectedLoanDetail.payments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)', fontSize: 13 }}>
                    No payments recorded towards this loan account yet.
                  </div>
                ) : (
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Receipt No</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Source</th>
                        <th>Mode</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedLoanDetail.payments.map((p) => {
                        const isReversed = p.status === 'REVERSED' || Boolean(p.is_reversal || p.isReversal);
                        const source = p.collectionSource || p.collection_source || 'DIRECT_CUSTOMER';
                        return (
                          <tr key={p.id}>
                            <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                              {p.receiptNumber || p.receipt_number}
                            </td>
                            <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {new Date(p.paymentTimestamp || p.payment_timestamp).toLocaleDateString('en-IN')}
                            </td>
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
                              {source === 'DEALER' ? (
                                <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Store size={10} />
                                  <span>Partner Store</span>
                                </span>
                              ) : source === 'RECOVERY_AGENT' ? (
                                <span className="badge badge-due-today" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <UserCheck size={10} />
                                  <span>Recovery Agent</span>
                                </span>
                              ) : (
                                <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Building2 size={10} />
                                  <span>Direct Customer</span>
                                </span>
                              )}
                            </td>
                            <td>
                              <span className="badge badge-upcoming">{p.paymentMode || p.payment_mode}</span>
                            </td>
                            <td>
                              <span className={`badge ${isReversed ? 'badge-overdue' : 'badge-paid'}`}>
                                {isReversed ? 'REVERSED' : 'SUCCESS'}
                              </span>
                            </td>
                            <td>
                              <button
                                onClick={async () => {
                                  try {
                                    const r = await ApiClient.getReceipt(p.id);
                                    setSelectedReceipt(r);
                                  } catch (e: any) {
                                    alert(e.message || 'Failed to fetch receipt');
                                  }
                                }}
                                className="btn btn-secondary btn-sm"
                                title="View Receipt"
                              >
                                <Receipt size={12} />
                                <span>Receipt</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <PortalLinkManager
                loanId={selectedLoanDetail.loan.id}
                loanAccountNo={selectedLoanDetail.loan.loanAccountNo || (selectedLoanDetail.loan as any).loan_account_no}
                customerName={(selectedLoanDetail.loan as any).customer_name}
                primaryPhone={(selectedLoanDetail.loan as any).primary_phone || (selectedLoanDetail.loan as any).phone}
                userRole={currentUser?.role}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setSelectedLoanDetail(null)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loan Receipt Viewer Modal */}
      {selectedReceipt && (
        <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.7)', zIndex: 1100 }}>
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: 440,
              padding: 24,
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: 8,
            }}
          >
            <div style={{ textAlign: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a', letterSpacing: '0.5px' }}>ALPHA MOBILE GALLERY</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#b8532f', marginTop: 1 }}>SHUBH PVT LTD</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>OFFICIAL PAYMENT RECEIPT</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>
                {selectedReceipt.receiptNumber}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Borrower:</span>
                <strong>{selectedReceipt.customer?.name} ({selectedReceipt.customer?.code})</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Loan Account:</span>
                <strong className="mono">{selectedReceipt.loan?.accountNo}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Collection Source:</span>
                <strong style={{ color: '#9a3412' }}>{selectedReceipt.collectionSource}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Payment Mode:</span>
                <span>{selectedReceipt.paymentMode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontWeight: 800 }}>Amount Paid:</span>
                <strong className="mono" style={{ fontSize: 16, color: '#15803d' }}>
                  {formatINR(selectedReceipt.amount)}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Remaining Loan:</span>
                <span className="mono font-bold">{formatINR(selectedReceipt.loan?.remainingOutstanding || 0)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => window.print()} className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                <Printer size={13} />
                <span>Print</span>
              </button>
              <button onClick={() => setSelectedReceipt(null)} className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
