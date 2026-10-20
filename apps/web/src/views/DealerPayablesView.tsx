import React, { useState, useEffect } from 'react';
import {
  IDealer,
  IDealerPayableSummary,
  IDealerPayableDealerBreakdown,
  IDealerPayableEligibleLoan,
  IDealerPayablePayment,
  DealerPayableStatus,
  UserRole,
  getBusinessDate,
  formatDateDDMMYYYY,
  formatINR,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  CheckCircle,
  AlertCircle,
  Clock,
  RotateCcw,
  Store,
  Receipt,
  X,
  FileText,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Building2,
  Calendar,
  Smartphone,
  Eye,
} from 'lucide-react';

interface DealerPayablesViewProps {
  initialDealerId?: string | null;
  onNavigateToDealers?: () => void;
}

export const DealerPayablesView: React.FC<DealerPayablesViewProps> = ({
  initialDealerId,
  onNavigateToDealers,
}) => {
  const currentUser = ApiClient.getUser();
  const isDealer = currentUser?.role === UserRole.DEALER;
  const canManagePayables =
    currentUser?.role === UserRole.SUPER_ADMIN ||
    currentUser?.role === UserRole.ADMIN ||
    currentUser?.role === UserRole.BRANCH_MANAGER;

  const [activeTab, setActiveTab] = useState<'stores' | 'payments'>('stores');
  const [dealers, setDealers] = useState<IDealer[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>(
    isDealer ? (currentUser?.dealerId || '') : (initialDealerId || '')
  );
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Data states
  const [summary, setSummary] = useState<IDealerPayableSummary | null>(null);
  const [payments, setPayments] = useState<IDealerPayablePayment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Eligible Loans Modal
  const [viewingLoansDealer, setViewingLoansDealer] = useState<IDealerPayableDealerBreakdown | null>(null);
  const [eligibleLoans, setEligibleLoans] = useState<IDealerPayableEligibleLoan[]>([]);
  const [loadingLoans, setLoadingLoans] = useState(false);

  // Record Payment Modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [modalDealerId, setModalDealerId] = useState<string>('');
  const [modalAmount, setModalAmount] = useState<string>('');
  const [modalDate, setModalDate] = useState<string>(getBusinessDate(undefined, 'Asia/Kolkata'));
  const [modalPaymentMethod, setModalPaymentMethod] = useState<string>('BANK_TRANSFER');
  const [modalReference, setModalReference] = useState<string>('');
  const [modalNotes, setModalNotes] = useState<string>('');
  const [modalEligibleLoans, setModalEligibleLoans] = useState<IDealerPayableEligibleLoan[]>([]);
  const [loadingModalLoans, setLoadingModalLoans] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Reversal Modal
  const [reversingPayment, setReversingPayment] = useState<IDealerPayablePayment | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [submittingReversal, setSubmittingReversal] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Payout Details Modal
  const [viewingPayoutDetail, setViewingPayoutDetail] = useState<(IDealerPayablePayment & { allocations: any[] }) | null>(null);
  const [loadingPayoutDetail, setLoadingPayoutDetail] = useState(false);

  const handleOpenPayoutDetail = async (payoutId: string) => {
    setLoadingPayoutDetail(true);
    try {
      const detail = await ApiClient.getDealerPayablePaymentDetail(payoutId);
      setViewingPayoutDetail(detail);
    } catch (err: any) {
      alert(err.message || 'Failed to load company payout details');
    } finally {
      setLoadingPayoutDetail(false);
    }
  };

  // Load Dealers
  useEffect(() => {
    if (!isDealer) {
      ApiClient.getDealers()
        .then((data) => setDealers(data))
        .catch((err) => console.error('Failed to load dealers', err));
    }
  }, [isDealer]);

  // Load Payables Summary & Payments
  const fetchData = async () => {
    setLoading(true);
    try {
      const effDealerId = isDealer ? (currentUser?.dealerId || undefined) : (selectedDealerId || undefined);

      const [summaryRes, paymentsRes] = await Promise.all([
        ApiClient.getDealerPayablesSummary({ dealerId: effDealerId }),
        ApiClient.getDealerPayablePayments({
          dealerId: effDealerId,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          search: search || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          page,
          limit,
        }),
      ]);

      setSummary(summaryRes);
      setPayments(paymentsRes.records);
      setTotalCount(paymentsRes.totalCount);
      setTotalPages(paymentsRes.totalPages);
    } catch (err) {
      console.error('Failed to load dealer payables', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedDealerId, statusFilter, startDate, endDate, page, limit, isDealer]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  // Open Eligible Loans Modal
  const handleOpenLoansModal = async (store: IDealerPayableDealerBreakdown) => {
    setViewingLoansDealer(store);
    setLoadingLoans(true);
    try {
      const loans = await ApiClient.getEligibleLoansForDealerPayable(store.dealerId);
      setEligibleLoans(loans);
    } catch (err) {
      alert('Failed to load eligible financed products for dealer');
    } finally {
      setLoadingLoans(false);
    }
  };

  // Open Record Payment Modal
  const handleOpenRecordModal = async (targetDealerId?: string) => {
    const dId = targetDealerId || selectedDealerId || (dealers.length > 0 ? dealers[0].id : '');
    setModalDealerId(dId);
    setModalAmount('');
    setModalDate(getBusinessDate(undefined, 'Asia/Kolkata'));
    setModalPaymentMethod('BANK_TRANSFER');
    setModalReference('');
    setModalNotes('');
    setModalError(null);
    setShowRecordModal(true);

    if (dId) {
      await fetchLoansForModal(dId);
    }
  };

  const fetchLoansForModal = async (dealerId: string) => {
    setLoadingModalLoans(true);
    try {
      const loans = await ApiClient.getEligibleLoansForDealerPayable(dealerId);
      setModalEligibleLoans(loans);
      const totalRemaining = loans.reduce((acc, curr) => acc + curr.remainingPayable, 0);
      if (totalRemaining > 0 && !modalAmount) {
        setModalAmount(String(totalRemaining));
      }
    } catch (err) {
      console.error('Failed to load loans for modal', err);
    } finally {
      setLoadingModalLoans(false);
    }
  };

  const handleModalDealerChange = (dealerId: string) => {
    setModalDealerId(dealerId);
    setModalAmount('');
    fetchLoansForModal(dealerId);
  };

  const totalRemainingInModal = modalEligibleLoans.reduce((acc, curr) => acc + curr.remainingPayable, 0);

  // Submit Record Payment
  const handleSubmitRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const amountNum = parseFloat(modalAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setModalError('Please enter a valid payment amount greater than zero.');
      return;
    }

    if (amountNum > totalRemainingInModal) {
      setModalError(`Payment amount cannot exceed remaining payable amount (${formatINR(totalRemainingInModal)}).`);
      return;
    }

    setSubmittingPayment(true);
    try {
      await ApiClient.recordDealerPayablePayment({
        dealerId: modalDealerId,
        amount: amountNum,
        paymentDate: modalDate,
        paymentMethod: modalPaymentMethod,
        referenceNumber: modalReference.trim() || undefined,
        notes: modalNotes.trim() || undefined,
      });

      alert('Company payment to dealer recorded successfully.');
      setShowRecordModal(false);
      await fetchData();
    } catch (err: any) {
      setModalError(err.message || 'Failed to record company payment to dealer.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Submit Reversal
  const handleSubmitReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingPayment) return;
    if (!reversalReason.trim()) {
      setReversalError('Reversal reason is required.');
      return;
    }

    setSubmittingReversal(true);
    setReversalError(null);
    try {
      await ApiClient.reverseDealerPayablePayment(reversingPayment.id, reversalReason.trim());
      alert('Company payment reversed successfully.');
      setReversingPayment(null);
      await fetchData();
    } catch (err: any) {
      setReversalError(err.message || 'Failed to reverse payment.');
    } finally {
      setSubmittingReversal(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>
              {isDealer ? 'Company Payments' : 'Company Payables'}
            </h2>
            <span className="badge badge-primary" style={{ fontSize: 11 }}>
              {isDealer ? 'Disbursements from Finance Company' : 'Company to Dealer Payouts'}
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {isDealer
              ? 'Track payments received from the finance company for your eligible financed products.'
              : 'Manage payments owed by the company to partner dealers for financed products.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isDealer && onNavigateToDealers && (
            <button onClick={onNavigateToDealers} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Store size={14} />
              <span>Manage Partner Stores</span>
            </button>
          )}
          {canManagePayables && (
            <button onClick={() => handleOpenRecordModal()} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={15} />
              <span>Record Company Payout</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            {isDealer ? 'Amount Payable to Your Store' : 'Total Payable to Dealers'}
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
            {formatINR(summary?.totalPayable || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {isDealer ? 'Total financed amount owed by the company' : 'Total amount payable for eligible products'}
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)', textTransform: 'uppercase' }}>
            {isDealer ? 'Amount Received from Company' : 'Total Paid to Dealers'}
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
            {formatINR(summary?.totalPaid || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {isDealer ? 'Total payouts received from finance company' : 'Already paid by company to dealers'}
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16, borderLeft: '4px solid var(--warning)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning-text)', textTransform: 'uppercase' }}>
            {isDealer ? 'Remaining Amount Due from Company' : 'Remaining Payable'}
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--warning-text)', marginTop: 4 }}>
            {formatINR(summary?.remainingPayable || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {isDealer ? 'Balance yet to be disbursed by company' : 'Amount remaining to pay to dealers'}
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Eligible Financed Phones
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
            {isDealer
              ? (summary?.dealers?.[0]?.eligibleLoansCount || 0)
              : (summary?.dealers?.reduce((acc, d) => acc + (d.eligibleLoansCount || 0), 0) || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {isDealer ? 'Active disbursed loans for your store' : 'Active disbursed loans across partner stores'}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
        <button
          onClick={() => setActiveTab('stores')}
          className={`btn btn-sm ${activeTab === 'stores' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Store size={14} style={{ marginRight: 6 }} />
          <span>{isDealer ? 'Store Payout Overview' : 'Dealer-wise Payables Summary'}</span>
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`btn btn-sm ${activeTab === 'payments' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Receipt size={14} style={{ marginRight: 6 }} />
          <span>Payout History ({totalCount})</span>
        </button>
      </div>

      {/* TAB 1: STORES BREAKDOWN */}
      {activeTab === 'stores' && (
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>
                {isDealer ? 'Your Store Financed Payout Breakdown' : 'Dealer Payable Breakdown & Balances'}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Calculated strictly from eligible disbursed loans (product price minus down payment collected).
              </p>
            </div>
          </div>

          <div className="table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>{isDealer ? 'Your Store' : 'Partner Retail Store'}</th>
                  <th>Area / City</th>
                  <th>Financed Devices</th>
                  <th>{isDealer ? 'Amount Payable to Your Store' : 'Total Payable to Dealers'}</th>
                  <th>{isDealer ? 'Amount Received from Company' : 'Total Paid to Dealers'}</th>
                  <th>{isDealer ? 'Remaining Amount Due from Company' : 'Remaining Payable'}</th>
                  <th>Payout Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!summary?.dealers || summary.dealers.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No dealer payables records found.
                    </td>
                  </tr>
                ) : (
                  summary.dealers.map((dealer) => {
                    const isFullyPaid = dealer.payoutStatus === DealerPayableStatus.PAID;
                    const isPartiallyPaid = dealer.payoutStatus === DealerPayableStatus.PARTIALLY_PAID;
                    return (
                      <tr key={dealer.dealerId}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{dealer.storeName}</div>
                          <span className="mono badge badge-primary" style={{ fontSize: 10 }}>
                            {dealer.dealerCode}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-route">{dealer.areaCity}</span>
                        </td>
                        <td>
                          <span className="mono font-semibold">{dealer.eligibleLoansCount} devices</span>
                        </td>
                        <td>
                          <span className="mono font-bold">{formatINR(dealer.totalPayable)}</span>
                        </td>
                        <td>
                          <span className="mono font-bold" style={{ color: 'var(--success)' }}>
                            {formatINR(dealer.alreadyPaid)}
                          </span>
                        </td>
                        <td>
                          <span
                            className="mono font-bold"
                            style={{
                              color: dealer.remainingPayable > 0 ? 'var(--warning-text)' : 'var(--text-secondary)',
                            }}
                          >
                            {formatINR(dealer.remainingPayable)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              isFullyPaid
                                ? 'badge-paid'
                                : isPartiallyPaid
                                ? 'badge-partial'
                                : 'badge-warning'
                            }`}
                          >
                            {dealer.payoutStatus === DealerPayableStatus.PAID
                              ? 'Paid'
                              : dealer.payoutStatus === DealerPayableStatus.PARTIALLY_PAID
                              ? 'Partially Paid'
                              : 'Pending'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              onClick={() => handleOpenLoansModal(dealer)}
                              className="btn btn-secondary btn-sm"
                              title={isDealer ? 'View eligible financed phones' : 'View eligible financed loans'}
                            >
                              <Eye size={12} style={{ marginRight: 4 }} />
                              <span>{isDealer ? 'View Financed Phones' : 'View Eligible Loans'}</span>
                            </button>
                            {canManagePayables && dealer.remainingPayable > 0 && (
                              <button
                                onClick={() => handleOpenRecordModal(dealer.dealerId)}
                                className="btn btn-primary btn-sm"
                                title="Record payout to this dealer"
                              >
                                <Plus size={12} style={{ marginRight: 4 }} />
                                <span>Record Payout</span>
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
        </div>
      )}

      {/* TAB 2: PAYMENTS HISTORY */}
      {activeTab === 'payments' && (
        <div className="crm-card" style={{ padding: 16 }}>
          {/* Filters Bar */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            {!isDealer && (
              <div style={{ minWidth: 200 }}>
                <select
                  value={selectedDealerId}
                  onChange={(e) => {
                    setSelectedDealerId(e.target.value);
                    setPage(1);
                  }}
                  className="input-select"
                  style={{ width: '100%', fontSize: 13 }}
                >
                  <option value="">All Retail Stores</option>
                  {dealers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.storeName} ({d.dealerCode})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="input-select"
                style={{ fontSize: 13 }}
              >
                <option value="ALL">All Statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="REVERSED">Reversed</option>
              </select>
            </div>

            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 220 }}>
              <input
                type="text"
                placeholder="Search by payout #, check/UTR number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-text"
                style={{ flex: 1, fontSize: 13 }}
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                <Search size={14} />
              </button>
            </form>
          </div>

          {/* Payments Table */}
          <div className="table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Payout Ref</th>
                  <th>{isDealer ? 'Your Store' : 'Partner Retail Store'}</th>
                  <th>Payment Date</th>
                  <th>{isDealer ? 'Amount Received' : 'Payout Amount'}</th>
                  <th>Method</th>
                  <th>UTR / Reference</th>
                  <th>Status</th>
                  <th>Recorded By</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      Loading payout history...
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No payout records found.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => {
                    const isReversed = p.status === 'REVERSED';
                    return (
                      <tr key={p.id}>
                        <td>
                          <span className="mono font-bold" style={{ color: 'var(--primary)' }}>
                            {p.payoutNumber}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.dealerStoreName || 'Dealer Store'}</div>
                          <span className="mono badge badge-primary" style={{ fontSize: 10 }}>
                            {p.dealerCode}
                          </span>
                        </td>
                        <td>{formatDateDDMMYYYY(p.paymentDate)}</td>
                        <td>
                          <span
                            className="mono font-bold"
                            style={{
                              color: isReversed ? 'var(--text-muted)' : 'var(--success)',
                              textDecoration: isReversed ? 'line-through' : 'none',
                            }}
                          >
                            {formatINR(p.amount)}
                          </span>
                        </td>
                        <td>
                          <span className="badge">{p.paymentMethod}</span>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {p.referenceNumber || '—'}
                        </td>
                        <td>
                          <span className={`badge ${isReversed ? 'badge-danger' : 'badge-paid'}`}>
                            {p.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{p.createdByName || 'System'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button
                              onClick={() => handleOpenPayoutDetail(p.id)}
                              className="btn btn-secondary btn-sm"
                              title="View Payout Allocations & Details"
                            >
                              <Eye size={12} style={{ marginRight: 4 }} />
                              <span>View</span>
                            </button>
                            {canManagePayables && !isReversed && (
                              <button
                                onClick={() => {
                                  setReversingPayment(p);
                                  setReversalReason('');
                                  setReversalError(null);
                                }}
                                className="btn btn-secondary btn-sm"
                                style={{ color: 'var(--danger-text)' }}
                                title="Reverse payout entry"
                              >
                                <RotateCcw size={12} style={{ marginRight: 4 }} />
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Page {page} of {totalPages} ({totalCount} records)
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="btn btn-secondary btn-sm"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="btn btn-secondary btn-sm"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ELIGIBLE LOANS MODAL */}
      {viewingLoansDealer && (
        <div className="crm-modal-overlay">
          <div className="crm-modal" style={{ maxWidth: 780, width: '95%' }}>
            <div className="crm-modal-header">
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>
                  Eligible Financed Products — {viewingLoansDealer.storeName}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Active & closed loans originated by this store. Payable equals net disbursed amount.
                </p>
              </div>
              <button onClick={() => setViewingLoansDealer(null)} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <div className="crm-modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
              {loadingLoans ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading eligible loans...
                </div>
              ) : eligibleLoans.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No eligible disbursed loans found for this partner store.
                </div>
              ) : (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Loan Account</th>
                      <th>Borrower</th>
                      <th>Device / Phone</th>
                      <th>Principal</th>
                      <th>Down Payment</th>
                      <th>Net Disbursed (Payable)</th>
                      <th>Paid</th>
                      <th>Remaining</th>
                      <th>Payout Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleLoans.map((l) => (
                      <tr key={l.loanId}>
                        <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                          {l.loanAccountNo}
                        </td>
                        <td>{l.customerName}</td>
                        <td>
                          {l.deviceBrand && l.deviceModel ? `${l.deviceBrand} ${l.deviceModel}` : 'Financed Device'}
                        </td>
                        <td className="mono">{formatINR(l.principalAmount)}</td>
                        <td className="mono">{formatINR(l.downPayment)}</td>
                        <td className="mono font-bold">{formatINR(l.netDisbursedAmount)}</td>
                        <td className="mono" style={{ color: 'var(--success)' }}>
                          {formatINR(l.amountAllocated)}
                        </td>
                        <td className="mono font-bold" style={{ color: l.remainingPayable > 0 ? 'var(--warning-text)' : 'var(--text-muted)' }}>
                          {formatINR(l.remainingPayable)}
                        </td>
                        <td>
                          <span className={`badge ${l.payoutStatus === DealerPayableStatus.PAID ? 'badge-paid' : l.payoutStatus === DealerPayableStatus.PARTIALLY_PAID ? 'badge-partial' : 'badge-warning'}`}>
                            {l.payoutStatus === DealerPayableStatus.PAID ? 'Paid' : l.payoutStatus === DealerPayableStatus.PARTIALLY_PAID ? 'Partially Paid' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="crm-modal-footer">
              <button onClick={() => setViewingLoansDealer(null)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECORD COMPANY PAYMENT MODAL */}
      {showRecordModal && (
        <div className="crm-modal-overlay">
          <div className="crm-modal" style={{ maxWidth: 540, width: '95%' }}>
            <div className="crm-modal-header">
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>Record Company Payout to Partner Store</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Record an authorized payout from the finance company to the partner store for eligible financed products.
                </p>
              </div>
              <button onClick={() => setShowRecordModal(false)} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmitRecordPayment}>
              <div className="crm-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {modalError && (
                  <div className="crm-alert crm-alert-danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <AlertCircle size={16} />
                    <span>{modalError}</span>
                  </div>
                )}

                <div>
                  <label className="label">Partner Retail Store *</label>
                  <select
                    value={modalDealerId}
                    onChange={(e) => handleModalDealerChange(e.target.value)}
                    className="input-select"
                    style={{ width: '100%' }}
                    required
                  >
                    <option value="">Select a retail store</option>
                    {dealers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.storeName} ({d.dealerCode})
                      </option>
                    ))}
                  </select>
                </div>

                {modalDealerId && (
                  <div
                    style={{
                      background: 'var(--bg-surface-secondary)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Total Eligible Products:</span>
                      <strong className="mono">{modalEligibleLoans.length} devices</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Maximum Amount Left to Pay:</span>
                      <strong className="mono" style={{ color: 'var(--warning-text)', fontWeight: 800 }}>
                        {formatINR(totalRemainingInModal)}
                      </strong>
                    </div>
                  </div>
                )}

                <div>
                  <label className="label">Payment Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max={totalRemainingInModal > 0 ? totalRemainingInModal : undefined}
                    placeholder="Enter payment amount"
                    value={modalAmount}
                    onChange={(e) => setModalAmount(e.target.value)}
                    className="input-text"
                    style={{ width: '100%' }}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="label">Payment Date *</label>
                    <input
                      type="date"
                      value={modalDate}
                      onChange={(e) => setModalDate(e.target.value)}
                      className="input-text"
                      style={{ width: '100%' }}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Payment Method *</label>
                    <select
                      value={modalPaymentMethod}
                      onChange={(e) => setModalPaymentMethod(e.target.value)}
                      className="input-select"
                      style={{ width: '100%' }}
                      required
                    >
                      <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="UPI">UPI</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">Reference / UTR / Cheque Number</label>
                  <input
                    type="text"
                    placeholder="e.g. UTR123456789"
                    value={modalReference}
                    onChange={(e) => setModalReference(e.target.value)}
                    className="input-text"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label className="label">Notes / Remarks</label>
                  <textarea
                    rows={2}
                    placeholder="Optional payout notes"
                    value={modalNotes}
                    onChange={(e) => setModalNotes(e.target.value)}
                    className="input-text"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div className="crm-modal-footer">
                <button
                  type="button"
                  onClick={() => setShowRecordModal(false)}
                  className="btn btn-secondary"
                  disabled={submittingPayment}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingPayment || totalRemainingInModal <= 0}
                >
                  {submittingPayment ? 'Recording...' : 'Confirm Payout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REVERSAL MODAL */}
      {reversingPayment && (
        <div className="crm-modal-overlay">
          <div className="crm-modal" style={{ maxWidth: 440, width: '95%' }}>
            <div className="crm-modal-header">
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Reverse Company Payout</h3>
              <button onClick={() => setReversingPayment(null)} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmitReversal}>
              <div className="crm-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {reversalError && (
                  <div className="crm-alert crm-alert-danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <AlertCircle size={16} />
                    <span>{reversalError}</span>
                  </div>
                )}
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Are you sure you want to reverse payment{' '}
                  <strong className="mono">{reversingPayment.payoutNumber}</strong> for{' '}
                  <strong>{formatINR(reversingPayment.amount)}</strong>? This will restore the dealer remaining payable balance.
                </p>
                <div>
                  <label className="label">Reason for Reversal *</label>
                  <textarea
                    rows={3}
                    placeholder="Provide detailed reason for reversing this payment"
                    value={reversalReason}
                    onChange={(e) => setReversalReason(e.target.value)}
                    className="input-text"
                    style={{ width: '100%' }}
                    required
                  />
                </div>
              </div>
              <div className="crm-modal-footer">
                <button
                  type="button"
                  onClick={() => setReversingPayment(null)}
                  className="btn btn-secondary"
                  disabled={submittingReversal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={submittingReversal}
                >
                  {submittingReversal ? 'Reversing...' : 'Confirm Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PAYOUT DETAILS MODAL */}
      {viewingPayoutDetail && (
        <div className="crm-modal-overlay">
          <div className="crm-modal" style={{ maxWidth: 700, width: '95%' }}>
            <div className="crm-modal-header">
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>
                  Company Payout Details — {viewingPayoutDetail.payoutNumber}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Disbursement payout to partner store for financed mobile products.
                </p>
              </div>
              <button onClick={() => setViewingPayoutDetail(null)} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <div className="crm-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Summary KPIs */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 12,
                  padding: 14,
                  background: 'var(--bg-surface-secondary, rgba(255,255,255,0.03))',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Partner Store</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{viewingPayoutDetail.dealerStoreName}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{viewingPayoutDetail.dealerCode}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Payout Amount</div>
                  <div className="mono" style={{ fontWeight: 800, fontSize: 16, color: 'var(--success)' }}>
                    {formatINR(viewingPayoutDetail.amount)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Payment Date</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{formatDateDDMMYYYY(viewingPayoutDetail.paymentDate)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Payment Mode</div>
                  <div className="badge badge-route" style={{ marginTop: 2 }}>{viewingPayoutDetail.paymentMethod}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>UTR / Reference</div>
                  <div className="mono font-semibold" style={{ fontSize: 12 }}>{viewingPayoutDetail.referenceNumber || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Status</div>
                  <div className={`badge ${viewingPayoutDetail.status === 'COMPLETED' ? 'badge-paid' : 'badge-danger'}`} style={{ marginTop: 2 }}>
                    {viewingPayoutDetail.status}
                  </div>
                </div>
              </div>

              {viewingPayoutDetail.notes && (
                <div style={{ fontSize: 12, padding: '8px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Notes: </span>
                  <span>{viewingPayoutDetail.notes}</span>
                </div>
              )}

              {viewingPayoutDetail.isReversal && (
                <div className="crm-alert crm-alert-danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <AlertCircle size={16} />
                  <span>Reversed on {formatDateDDMMYYYY(viewingPayoutDetail.reversedAt)}: {viewingPayoutDetail.reversalReason || 'No reason provided'}</span>
                </div>
              )}

              {/* Allocated Loans Breakdown */}
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  Allocated Financed Products ({viewingPayoutDetail.allocations?.length || 0})
                </h4>
                {viewingPayoutDetail.allocations?.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                    No specific product allocations recorded for this payout.
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="crm-table">
                      <thead>
                        <tr>
                          <th>Loan Account</th>
                          <th>Borrower</th>
                          <th>Device / Model</th>
                          <th style={{ textAlign: 'right' }}>Amount Allocated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewingPayoutDetail.allocations?.map((alloc) => (
                          <tr key={alloc.id}>
                            <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                              {alloc.loanAccountNo}
                            </td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{alloc.customerName}</div>
                              {alloc.customerCode && <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{alloc.customerCode}</div>}
                            </td>
                            <td>{alloc.deviceName || 'Financed Product'}</td>
                            <td className="mono font-bold" style={{ textAlign: 'right', color: 'var(--success)' }}>
                              {formatINR(alloc.amountAllocated)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            <div className="crm-modal-footer">
              <button
                type="button"
                onClick={() => setViewingPayoutDetail(null)}
                className="btn btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
