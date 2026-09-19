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
} from 'lucide-react';

export const LoansView: React.FC = () => {
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
  const [selectedLoanDetail, setSelectedLoanDetail] = useState<{ loan: ILoan; installments: any[]; payments: any[] } | null>(null);
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

  const handleViewLoan = async (loanId: string) => {
    setLoadingDetail(true);
    try {
      const data = await ApiClient.getLoanDetail(loanId);
      setSelectedLoanDetail(data);
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
                    <button
                      onClick={() => handleViewLoan(loan.id)}
                      className="btn btn-secondary btn-sm"
                      title="View complete EMI schedule"
                    >
                      <Eye size={13} />
                      <span>Schedule</span>
                    </button>
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

            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Amortization Schedule</h4>
            <div className="table-container" style={{ maxHeight: 320, overflowY: 'auto' }}>
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setSelectedLoanDetail(null)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
