import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import {
  IPaymentDetail,
  IPaymentsSummary,
  formatINR,
  formatDateDDMMYYYY,
  IUser,
  UserRole,
  CollectionSource,
  PaymentMode,
  PaymentStatus,
  getBusinessDate,
} from '@crm/shared';
import {
  Receipt,
  Search,
  RotateCcw,
  Eye,
  CheckCircle2,
  X,
  Printer,
  Store,
  UserCheck,
  Building2,
  Calendar,
  Filter,
  DollarSign,
  TrendingUp,
  ArrowRight,
  Info,
  Clock,
  ShieldCheck,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { RecordPaymentModal } from '../components/RecordPaymentModal';

interface PaymentsViewProps {
  user: IUser;
}

type DatePreset = 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';

export const PaymentsView: React.FC<PaymentsViewProps> = ({ user }) => {
  const [payments, setPayments] = useState<IPaymentDetail[]>([]);
  const [summary, setSummary] = useState<IPaymentsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Filters State
  const [search, setSearch] = useState('');
  const [selectedSource, setSelectedSource] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedMode, setSelectedMode] = useState<string>('ALL');
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Pagination State
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Detail Drawer State
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<IPaymentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Receipt Modal State
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);

  // Reversal Modal State
  const [selectedPaymentForReversal, setSelectedPaymentForReversal] = useState<IPaymentDetail | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [submittingReversal, setSubmittingReversal] = useState(false);

  // Record Payment Modal State
  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false);

  // Helper to compute date range strings in Asia/Kolkata
  const computeDateRange = (preset: DatePreset): { start?: string; end?: string } => {
    const today = getBusinessDate(undefined, 'Asia/Kolkata');
    const todayDate = new Date(today + 'T00:00:00+05:30');

    if (preset === 'TODAY') {
      return { start: today, end: today };
    }
    if (preset === 'YESTERDAY') {
      const y = new Date(todayDate);
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      return { start: yStr, end: yStr };
    }
    if (preset === 'THIS_WEEK') {
      const day = todayDate.getDay();
      const diff = todayDate.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(todayDate.setDate(diff));
      return { start: monday.toISOString().split('T')[0], end: today };
    }
    if (preset === 'THIS_MONTH') {
      const startOfMonth = today.slice(0, 7) + '-01';
      return { start: startOfMonth, end: today };
    }
    if (preset === 'CUSTOM') {
      return { start: startDate || undefined, end: endDate || undefined };
    }
    return {};
  };

  const loadData = async (targetPage = page) => {
    setLoading(true);
    try {
      const { start, end } = computeDateRange(datePreset);
      const filterPayload: any = {
        page: targetPage,
        limit,
        search: search.trim() || undefined,
        collectionSource: selectedSource !== 'ALL' ? selectedSource : undefined,
        status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
        paymentMode: selectedMode !== 'ALL' ? selectedMode : undefined,
        startDate: start,
        endDate: end,
      };

      const res = await ApiClient.getPaymentsLedger(filterPayload);
      if (res && res.payments) {
        setPayments(res.payments);
        setTotalCount(res.total || 0);
        setTotalPages(res.totalPages || 1);
        setPage(res.page || targetPage);
      } else if (Array.isArray(res)) {
        setPayments(res);
        setTotalCount(res.length);
        setTotalPages(1);
      }
    } catch (err) {
      console.error('Failed to load payment history', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    setLoadingSummary(true);
    try {
      const { start, end } = computeDateRange(datePreset);
      const filterPayload: any = {
        search: search.trim() || undefined,
        collectionSource: selectedSource !== 'ALL' ? selectedSource : undefined,
        status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
        paymentMode: selectedMode !== 'ALL' ? selectedMode : undefined,
        startDate: start,
        endDate: end,
      };
      const res = await ApiClient.getPaymentsSummary(filterPayload);
      setSummary(res);
    } catch (err) {
      console.error('Failed to load payments summary', err);
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    loadData(1);
    loadSummary();
  }, [selectedSource, selectedStatus, selectedMode, datePreset, startDate, endDate, limit]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadData(1);
    loadSummary();
  };

  const handleOpenDetail = async (paymentId: string) => {
    setSelectedPaymentId(paymentId);
    setLoadingDetail(true);
    try {
      const data = await ApiClient.getPaymentDetail(paymentId);
      setDetailData(data);
    } catch (err: any) {
      alert(err.message || 'Failed to load payment details');
      setSelectedPaymentId(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleOpenReceipt = async (paymentId: string) => {
    setLoadingReceipt(true);
    try {
      const receipt = await ApiClient.getReceipt(paymentId);
      setSelectedReceipt(receipt);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch official receipt');
    } finally {
      setLoadingReceipt(false);
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
      loadData(page);
      loadSummary();
      if (selectedPaymentId === selectedPaymentForReversal.id) {
        handleOpenDetail(selectedPaymentForReversal.id);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to reverse payment');
    } finally {
      setSubmittingReversal(false);
    }
  };

  const isAdmin = user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Financial Payments & Receipts History</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Centralized collection ledger across Direct Customer, Partner Store, and Field Recovery Agent channels.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isAdmin && (
            <button
              onClick={() => setShowRecordPaymentModal(true)}
              className="btn btn-primary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <CreditCard size={14} />
              <span>Record Payment</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div className="crm-card" style={{ padding: 18, borderLeft: '4px solid var(--primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>TOTAL COLLECTIONS</span>
            <DollarSign size={18} color="var(--primary)" />
          </div>
          <div className="mono font-bold" style={{ fontSize: 22, color: 'var(--text-primary)', marginTop: 8 }}>
            {loadingSummary ? '...' : formatINR(summary?.totalCollections || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {summary?.paymentCount || 0} active payments (excl. reversals)
          </div>
        </div>

        <div className="crm-card" style={{ padding: 18, borderLeft: '4px solid #38bdf8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>TODAY'S COLLECTIONS</span>
            <TrendingUp size={18} color="#38bdf8" />
          </div>
          <div className="mono font-bold" style={{ fontSize: 22, color: '#38bdf8', marginTop: 8 }}>
            {loadingSummary ? '...' : formatINR(summary?.todayCollections || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {summary?.todayCount || 0} receipts today
          </div>
        </div>

        <div className="crm-card" style={{ padding: 18, borderLeft: '4px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>THIS MONTH</span>
            <Calendar size={18} color="#10b981" />
          </div>
          <div className="mono font-bold" style={{ fontSize: 22, color: '#10b981', marginTop: 8 }}>
            {loadingSummary ? '...' : formatINR(summary?.monthCollections || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {summary?.monthCount || 0} receipts this month
          </div>
        </div>

        <div className="crm-card" style={{ padding: 18, borderLeft: '4px solid #f59e0b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>AVERAGE TICKET</span>
            <CreditCard size={18} color="#f59e0b" />
          </div>
          <div className="mono font-bold" style={{ fontSize: 22, color: '#f59e0b', marginTop: 8 }}>
            {loadingSummary ? '...' : formatINR(summary?.averageCollection || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Avg value per customer receipt
          </div>
        </div>
      </div>

      {/* Channel Breakdown Banner */}
      {summary?.sourceBreakdown && (
        <div
          className="crm-card"
          style={{
            padding: '14px 18px',
            background: 'var(--bg-surface-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
            <ShieldCheck size={16} color="var(--primary)" />
            <span>Channel Distribution:</span>
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Building2 size={11} />
                <span>DIRECT</span>
              </span>
              <strong className="mono">{formatINR(summary.sourceBreakdown.directCustomer.amount)}</strong>
              <span style={{ color: 'var(--text-muted)' }}>({summary.sourceBreakdown.directCustomer.count})</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Store size={11} />
                <span>DEALER</span>
              </span>
              <strong className="mono">{formatINR(summary.sourceBreakdown.dealer.amount)}</strong>
              <span style={{ color: 'var(--text-muted)' }}>({summary.sourceBreakdown.dealer.count})</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-due-today" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <UserCheck size={11} />
                <span>RECOVERY AGENT</span>
              </span>
              <strong className="mono">{formatINR(summary.sourceBreakdown.recoveryAgent.amount)}</strong>
              <span style={{ color: 'var(--text-muted)' }}>({summary.sourceBreakdown.recoveryAgent.count})</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="crm-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {/* Date Presets */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['ALL', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH', 'CUSTOM'] as DatePreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => setDatePreset(preset)}
                className={`btn btn-sm ${datePreset === preset ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                {preset === 'ALL'
                  ? 'All Time'
                  : preset === 'TODAY'
                  ? 'Today'
                  : preset === 'YESTERDAY'
                  ? 'Yesterday'
                  : preset === 'THIS_WEEK'
                  ? 'This Week'
                  : preset === 'THIS_MONTH'
                  ? 'This Month'
                  : 'Custom'}
              </button>
            ))}
          </div>

          {/* Custom Date Inputs */}
          {datePreset === 'CUSTOM' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="date"
                className="form-input"
                style={{ fontSize: 12, padding: '4px 8px' }}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
              <input
                type="date"
                className="form-input"
                style={{ fontSize: 12, padding: '4px 8px' }}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {/* Collection Source Filter */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              COLLECTION SOURCE
            </label>
            <select
              className="form-select"
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              style={{ width: '100%', fontSize: 12 }}
            >
              <option value="ALL">All Collection Sources</option>
              <option value={CollectionSource.DIRECT_CUSTOMER}>Direct Customer</option>
              <option value={CollectionSource.DEALER}>Partner Store (Dealer)</option>
              <option value={CollectionSource.RECOVERY_AGENT}>Recovery Agent</option>
            </select>
          </div>

          {/* Payment Status Filter */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              PAYMENT STATUS
            </label>
            <select
              className="form-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              style={{ width: '100%', fontSize: 12 }}
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">Completed (Success)</option>
              <option value="REVERSED">Reversed</option>
            </select>
          </div>

          {/* Payment Mode Filter */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              PAYMENT METHOD
            </label>
            <select
              className="form-select"
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value)}
              style={{ width: '100%', fontSize: 12 }}
            >
              <option value="ALL">All Methods</option>
              <option value={PaymentMode.UPI}>UPI</option>
              <option value={PaymentMode.CASH}>Cash</option>
              <option value={PaymentMode.BANK_TRANSFER}>Bank Transfer (NEFT/IMPS)</option>
              <option value={PaymentMode.CHEQUE}>Cheque</option>
            </select>
          </div>

          {/* Search Box */}
          <div style={{ gridColumn: 'span 1' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              SEARCH RECORDS
            </label>
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Receipt, borrower, phone, loan acc..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: 12 }}
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                <Search size={13} />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Main Payment History Ledger */}
      <div className="table-container">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Receipt No</th>
              <th>Date & Time</th>
              <th>Borrower</th>
              <th>Loan Acc</th>
              <th>Amount</th>
              <th>Collection Source</th>
              <th>Collected Through</th>
              <th>Method</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 36, color: 'var(--text-secondary)' }}>
                  Loading payment history ledger...
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                  No payment records found matching the applied filters.
                </td>
              </tr>
            ) : (
              payments.map((p) => {
                const isReversed = p.status === 'REVERSED' || Boolean(p.isReversal);
                const source = p.collectionSource || 'DIRECT_CUSTOMER';
                const storeName = p.dealerStoreName || (p as any).dealer_store_name;
                const dealerCode = p.dealerCode || (p as any).dealer_code;
                const agentName = p.agentName || (p as any).source_agent_name || (p as any).collected_by_name;

                return (
                  <tr key={p.id}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {p.receiptNumber}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {formatDateDDMMYYYY(p.paymentTimestamp)}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.customerName || (p as any).customer_name}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {p.customerCode || (p as any).customer_code}
                      </div>
                    </td>
                    <td className="mono font-bold">{p.loanAccountNo || (p as any).loan_account_no}</td>
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
                      {source === 'DIRECT_CUSTOMER' ? (
                        <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Building2 size={11} />
                          <span>DIRECT</span>
                        </span>
                      ) : source === 'DEALER' ? (
                        <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Store size={11} />
                          <span>DEALER</span>
                        </span>
                      ) : (
                        <span className="badge badge-due-today" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <UserCheck size={11} />
                          <span>RECOVERY AGENT</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {source === 'DEALER' ? (
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {storeName || 'Store'} {dealerCode ? `(${dealerCode})` : ''}
                        </div>
                      ) : source === 'RECOVERY_AGENT' ? (
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {agentName || 'Field Agent'}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Direct Payment</div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-upcoming">{p.paymentMode}</span>
                    </td>
                    <td>
                      <span className={`badge ${isReversed ? 'badge-overdue' : 'badge-paid'}`}>
                        {isReversed ? 'REVERSED' : 'COMPLETED'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleOpenReceipt(p.id)}
                          className="btn btn-secondary btn-sm"
                          title="View Official Receipt"
                        >
                          <Receipt size={12} />
                          <span>Receipt</span>
                        </button>
                        <button
                          onClick={() => handleOpenDetail(p.id)}
                          className="btn btn-secondary btn-sm"
                          title="View Payment Details & Waterfall"
                        >
                          <Eye size={12} />
                          <span>Details</span>
                        </button>
                        {isAdmin && !isReversed && (
                          <button
                            onClick={() => {
                              setSelectedPaymentForReversal(p);
                              setReversalReason('');
                            }}
                            className="btn btn-danger btn-sm"
                            title="Reverse Payment"
                          >
                            <RotateCcw size={12} />
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

      {/* Pagination Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Showing <strong>{payments.length}</strong> of <strong>{totalCount}</strong> transactions (Page {page} of {totalPages})
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span>Per page:</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="form-select"
              style={{ fontSize: 12, padding: '2px 8px' }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => loadData(page - 1)}
              disabled={page <= 1 || loading}
              className="btn btn-secondary btn-sm"
            >
              <ChevronLeft size={14} />
              <span>Prev</span>
            </button>
            <button
              onClick={() => loadData(page + 1)}
              disabled={page >= totalPages || loading}
              className="btn btn-secondary btn-sm"
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Drawer: Payment Detail, Waterfall Allocation & Timeline */}
      {selectedPaymentId && (
        <div className="modal-overlay" style={{ justifyContent: 'flex-end', padding: 0 }}>
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: 580,
              height: '100vh',
              borderRadius: 0,
              padding: 24,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 800 }}>Payment Transaction Details</h3>
                  {detailData && (
                    <span className={`badge ${detailData.isReversal ? 'badge-overdue' : 'badge-paid'}`}>
                      {detailData.isReversal ? 'REVERSED' : 'COMPLETED'}
                    </span>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 700, marginTop: 2 }}>
                  {detailData?.receiptNumber || 'Loading...'}
                </div>
              </div>
              <button
                onClick={() => setSelectedPaymentId(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {loadingDetail || !detailData ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                Loading transaction details & waterfall allocations...
              </div>
            ) : (
              <>
                {/* Reversal Banner if Applicable */}
                {detailData.isReversal && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid var(--danger-border)',
                      borderRadius: 'var(--radius-md)',
                      padding: 12,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--danger)' }}>
                      <AlertTriangle size={15} />
                      <span>This payment was reversed</span>
                    </div>
                    <div style={{ color: 'var(--text-primary)', marginTop: 4 }}>
                      <strong>Reason:</strong> {detailData.reversalReason || 'Administrative reversal'}
                    </div>
                    {detailData.reversalAudit?.reversedAt && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                        Reversed at: {new Date(detailData.reversalAudit.reversedAt).toLocaleString('en-IN', { hour12: true })}
                      </div>
                    )}
                  </div>
                )}

                {/* Amount & Source Summary */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    background: 'var(--bg-surface-secondary)',
                    padding: 14,
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>AMOUNT PAID</div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 20,
                        fontWeight: 800,
                        color: detailData.isReversal ? 'var(--text-muted)' : 'var(--success-text)',
                        textDecoration: detailData.isReversal ? 'line-through' : 'none',
                        marginTop: 2,
                      }}
                    >
                      {formatINR(detailData.amount)}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>PAYMENT METHOD</div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{detailData.paymentMode}</div>
                    {detailData.referenceNumber && (
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        Ref: {detailData.referenceNumber}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>COLLECTION CHANNEL</div>
                    <div style={{ marginTop: 4 }}>
                      {detailData.collectionSource === 'DIRECT_CUSTOMER' ? (
                        <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Building2 size={11} />
                          <span>Direct Customer</span>
                        </span>
                      ) : detailData.collectionSource === 'DEALER' ? (
                        <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Store size={11} />
                          <span>Partner Store</span>
                        </span>
                      ) : (
                        <span className="badge badge-due-today" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <UserCheck size={11} />
                          <span>Recovery Agent</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>COLLECTED THROUGH</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
                      {detailData.dealer
                        ? `${detailData.dealer.storeName} (${detailData.dealer.code})`
                        : detailData.agent
                        ? detailData.agent.name
                        : 'Direct Customer Payment'}
                    </div>
                  </div>
                </div>

                {/* Borrower & Financed Loan Snapshot */}
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ShieldCheck size={14} color="var(--primary)" />
                    <span>Borrower & Financed Loan Details</span>
                  </h4>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 10,
                      fontSize: 12,
                      padding: 12,
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Borrower:</span>{' '}
                      <strong>{detailData.customer?.name || detailData.customerName}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Customer Code:</span>{' '}
                      <span className="mono font-bold">{detailData.customer?.code || detailData.customerCode}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Phone:</span>{' '}
                      <span className="mono">{detailData.customer?.phone || detailData.customerPhone}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Area Route:</span>{' '}
                      <span>{detailData.customer?.route || detailData.areaRoute || 'N/A'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Loan Account:</span>{' '}
                      <strong className="mono">{detailData.loan?.accountNo || detailData.loanAccountNo}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Outstanding Balance:</span>{' '}
                      <strong className="mono" style={{ color: 'var(--warning-text)' }}>
                        {formatINR(detailData.loan?.outstandingBalance || detailData.loanOutstanding || 0)}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Waterfall Allocation Breakdown */}
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <TrendingUp size={14} color="var(--success)" />
                    <span>Payment Waterfall Allocation Breakdown</span>
                  </h4>

                  {detailData.allocations && detailData.allocations.length > 0 ? (
                    <div className="table-container">
                      <table className="crm-table">
                        <thead>
                          <tr>
                            <th>Inst #</th>
                            <th>Principal</th>
                            <th>Interest</th>
                            <th>Penalty</th>
                            <th>Total Allocated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.allocations.map((alloc) => (
                            <tr key={alloc.id}>
                              <td className="mono">Installment #{alloc.installmentNumber}</td>
                              <td className="mono">{formatINR(alloc.principalComponent)}</td>
                              <td className="mono">{formatINR(alloc.interestComponent)}</td>
                              <td className="mono" style={{ color: alloc.penaltyComponent > 0 ? 'var(--danger-text)' : 'inherit' }}>
                                {formatINR(alloc.penaltyComponent)}
                              </td>
                              <td className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                                {formatINR(alloc.totalAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                      Payment credited directly to customer loan obligation balance.
                    </div>
                  )}
                </div>

                {/* Lifecycle Event Timeline */}
                {detailData.timeline && detailData.timeline.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={14} color="var(--primary)" />
                      <span>Payment Lifecycle Timeline</span>
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {detailData.timeline.map((event, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            gap: 10,
                            padding: 10,
                            background: 'var(--bg-surface-secondary)',
                            borderRadius: 'var(--radius-md)',
                            borderLeft: event.event === 'PAYMENT_REVERSED' ? '3px solid var(--danger)' : '3px solid var(--success)',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, color: event.event === 'PAYMENT_REVERSED' ? 'var(--danger)' : 'var(--text-primary)' }}>
                              {event.event.replace(/_/g, ' ')}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{event.description}</div>
                          </div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {formatDateDDMMYYYY(event.timestamp)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Drawer Footer Actions */}
                <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    onClick={() => handleOpenReceipt(detailData.id)}
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                  >
                    <Receipt size={14} />
                    <span>Official Receipt</span>
                  </button>

                  {isAdmin && !detailData.isReversal && (
                    <button
                      onClick={() => {
                        setSelectedPaymentForReversal(detailData);
                        setReversalReason('');
                      }}
                      className="btn btn-danger"
                    >
                      <RotateCcw size={14} />
                      <span>Reverse</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal 1: Payment Reversal Confirmation */}
      {selectedPaymentForReversal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 460, padding: 24, border: '1px solid var(--danger-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger)' }}>Confirm Payment Reversal</h3>
              <button
                onClick={() => setSelectedPaymentForReversal(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Reversing receipt <strong>{selectedPaymentForReversal.receiptNumber}</strong> of{' '}
              <strong>{formatINR(selectedPaymentForReversal.amount)}</strong> will restore the borrower's debt balance and create an immutable audit record.
            </p>

            <form onSubmit={handleSubmitReversal} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Mandatory Reversal Justification
                </label>
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

      {/* Modal 2: Official Printable Payment Receipt */}
      {selectedReceipt && (
        <div className="modal-overlay" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
          <div
            className="modal-content receipt-print-container"
            style={{
              width: '100%',
              maxWidth: 480,
              padding: 28,
              background: '#ffffff',
              color: '#1e293b',
              borderRadius: 8,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* Header / Brand & Company Details */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                <BrandLogo variant="receipt" size="sm" showLegal={false} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', letterSpacing: '0.5px' }}>
                ALPHA MOBILE GALLERY
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b8532f', marginTop: 1 }}>
                SHUBH PVT LTD
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                Helpline: {selectedReceipt.financeCompany?.supportPhone || '+91 80000 12345'} • Official Payment Receipt
              </div>

              <div
                style={{
                  display: 'inline-block',
                  marginTop: 12,
                  padding: '4px 14px',
                  background: selectedReceipt.status === 'REVERSED' || selectedReceipt.isReversal ? '#fee2e2' : '#f0fdf4',
                  border: `1px solid ${selectedReceipt.status === 'REVERSED' || selectedReceipt.isReversal ? '#ef4444' : '#22c55e'}`,
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 800,
                  color: selectedReceipt.status === 'REVERSED' || selectedReceipt.isReversal ? '#b91c1c' : '#15803d',
                }}
              >
                {selectedReceipt.status === 'REVERSED' || selectedReceipt.isReversal
                  ? 'OFFICIAL PAYMENT RECEIPT — REVERSED'
                  : 'OFFICIAL PAYMENT RECEIPT'}
              </div>

              <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 8 }}>
                Receipt No: {selectedReceipt.receiptNumber}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Date: {formatDateDDMMYYYY(selectedReceipt.paymentTimestamp)}
              </div>
            </div>

            {/* Receipt Body */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Borrower Name:</span>
                <strong style={{ color: '#0f172a' }}>
                  {selectedReceipt.customer?.name} ({selectedReceipt.customer?.code})
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Phone Number:</span>
                <span className="mono" style={{ color: '#0f172a' }}>{selectedReceipt.customer?.phone}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Loan Account No:</span>
                <strong className="mono" style={{ color: '#0f172a' }}>{selectedReceipt.loan?.accountNo}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Financed Item:</span>
                <span style={{ color: '#0f172a' }}>Smart Device / Handset</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Collection Source:</span>
                <strong style={{ color: '#9a3412' }}>
                  {selectedReceipt.collectionSource === 'DIRECT_CUSTOMER'
                    ? 'Direct Customer'
                    : selectedReceipt.collectionSource === 'DEALER'
                    ? 'Partner Store'
                    : 'Recovery Agent'}
                </strong>
              </div>

              {selectedReceipt.dealer && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Partner Store:</span>
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>
                    {selectedReceipt.dealer.storeName} ({selectedReceipt.dealer.code})
                  </span>
                </div>
              )}

              {selectedReceipt.agent && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Recovery Agent:</span>
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>{selectedReceipt.agent.name}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Payment Mode:</span>
                <span style={{ color: '#0f172a', fontWeight: 600 }}>{selectedReceipt.paymentMode}</span>
              </div>

              {selectedReceipt.referenceNumber && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Reference / UTR:</span>
                  <span className="mono" style={{ color: '#0f172a' }}>{selectedReceipt.referenceNumber}</span>
                </div>
              )}

              {/* Watermark Amount Paid */}
              <div
                style={{
                  borderTop: '2px dashed #cbd5e1',
                  borderBottom: '2px dashed #cbd5e1',
                  padding: '12px 0',
                  margin: '6px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>TOTAL AMOUNT PAID:</span>
                <span className="mono" style={{ fontSize: 20, fontWeight: 900, color: selectedReceipt.status === 'REVERSED' || selectedReceipt.isReversal ? '#b91c1c' : '#15803d' }}>
                  {formatINR(selectedReceipt.amount)}
                </span>
              </div>

              {/* Allocation Breakdown Table if Available */}
              {selectedReceipt.allocations && selectedReceipt.allocations.length > 0 && (
                <div style={{ background: '#f8fafc', padding: 8, borderRadius: 4, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', marginBottom: 4 }}>
                    WATERFALL ALLOCATION SUMMARY
                  </div>
                  {selectedReceipt.allocations.map((a: any) => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                      <span>Inst #{a.installmentNumber} (P: {formatINR(a.principalComponent)}, I: {formatINR(a.interestComponent)}):</span>
                      <span className="mono font-bold">{formatINR(a.totalAmount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Remaining Loan Balance:</span>
                <strong className="mono" style={{ color: '#0f172a' }}>
                  {formatINR(selectedReceipt.loan?.remainingOutstanding || 0)}
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Cashier / System Operator:</span>
                <span style={{ color: '#0f172a' }}>{selectedReceipt.collectedBy?.name || 'System Admin'}</span>
              </div>
            </div>

            {/* Print & Action Buttons (Hidden during @media print) */}
            <div className="no-print" style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button
                onClick={() => window.print()}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                <Printer size={14} />
                <span>Print Official Receipt</span>
              </button>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecordPaymentModal && (
        <RecordPaymentModal
          isOpen={showRecordPaymentModal}
          onClose={() => setShowRecordPaymentModal(false)}
          onSuccess={() => {
            loadData(1);
            loadSummary();
          }}
          user={user}
        />
      )}
    </div>
  );
};
