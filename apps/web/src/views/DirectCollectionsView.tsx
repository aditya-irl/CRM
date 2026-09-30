import React, { useState, useEffect } from 'react';
import {
  IDirectCollectionSummary,
  IDirectCollectionRecord,
  IDirectCollectionDetail,
  formatINR,
  PaymentMode,
  PaymentStatus,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  Building2,
  Calendar,
  Search,
  Receipt,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  CreditCard,
  Hash,
  Eye,
  X,
  User,
  CheckCircle2,
  ArrowDownRight,
} from 'lucide-react';

type DateFilterType = 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';

export const DirectCollectionsView: React.FC = () => {
  const [dateFilter, setDateFilter] = useState<DateFilterType>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentMode, setPaymentMode] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');

  // Data states
  const [summary, setSummary] = useState<IDirectCollectionSummary | null>(null);
  const [records, setRecords] = useState<IDirectCollectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Selected Record Detail Drawer
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<IDirectCollectionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Receipt Modal
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);

  // Calculate Date bounds helper
  const getDateRange = (type: DateFilterType) => {
    const now = new Date();
    const toDateString = (d: Date) => d.toISOString().split('T')[0];

    switch (type) {
      case 'TODAY': {
        const todayStr = toDateString(now);
        return { start: todayStr, end: todayStr };
      }
      case 'YESTERDAY': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        const yStr = toDateString(y);
        return { start: yStr, end: yStr };
      }
      case 'THIS_WEEK': {
        const start = new Date(now);
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday start
        start.setDate(diff);
        return { start: toDateString(start), end: toDateString(now) };
      }
      case 'THIS_MONTH': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: toDateString(start), end: toDateString(now) };
      }
      case 'CUSTOM':
        return { start: startDate || undefined, end: endDate || undefined };
      case 'ALL':
      default:
        return { start: undefined, end: undefined };
    }
  };

  // Fetch Ledger Data
  const fetchData = async () => {
    setLoading(true);
    try {
      const dates = getDateRange(dateFilter);
      const res = await ApiClient.getDirectCollections({
        startDate: dates.start,
        endDate: dates.end,
        paymentMode: paymentMode || undefined,
        status: status || undefined,
        search: search || undefined,
        page,
        limit,
      });

      setSummary(res.summary);
      setRecords(res.records);
      setTotalCount(res.totalCount);
      setTotalPages(res.totalPages);
    } catch (err) {
      console.error('Failed to load direct collections ledger', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateFilter, startDate, endDate, paymentMode, status, page, limit]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  const handleOpenDetail = async (id: string) => {
    setSelectedRecordId(id);
    setLoadingDetail(true);
    try {
      const data = await ApiClient.getDirectPaymentDetail(id);
      setDetailData(data);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch payment details');
      setSelectedRecordId(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleOpenReceipt = async (paymentId: string) => {
    try {
      const receipt = await ApiClient.getReceipt(paymentId);
      setSelectedReceipt(receipt);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch receipt');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'var(--primary-subtle)',
                color: 'var(--primary)',
              }}
            >
              <Building2 size={18} />
            </span>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>Direct Customer Collections Ledger</h2>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Direct borrower remittances made directly to the finance company through bank transfer, UPI, or branch counter.
          </p>
        </div>
      </div>

      {/* 1. KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {/* Total Collections */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Total Direct Collections
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
                {summary ? formatINR(summary.totalCollections) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md)',
                background: 'var(--primary-subtle)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={20} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Direct customer remittances without intermediary fees
          </div>
        </div>

        {/* Today's Collections */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Today's Direct Collections
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--success-text)', marginTop: 6 }}>
                {summary ? formatINR(summary.todayCollections) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md)',
                background: 'var(--success-subtle)',
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Calendar size={20} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            {summary ? `${summary.todayCount} payments recorded today` : '0 payments'}
          </div>
        </div>

        {/* This Month */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                This Month's Collections
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
                {summary ? formatINR(summary.monthCollections) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md)',
                background: 'var(--info-subtle)',
                color: 'var(--info)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CreditCard size={20} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            {summary ? `${summary.monthCount} monthly receipts cleared` : '0 receipts'}
          </div>
        </div>

        {/* Total Payments & Average */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Total Direct Payments
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
                {summary ? summary.paymentCount : '—'}
              </div>
            </div>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md)',
                background: 'var(--warning-subtle)',
                color: 'var(--warning)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Hash size={20} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Avg Ticket: <strong className="mono">{summary ? formatINR(summary.averageCollection) : '₹0'}</strong>
          </div>
        </div>
      </div>

      {/* 2. Filter Bar */}
      <div className="crm-card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Date Range Presets */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-surface-secondary)', padding: 3, borderRadius: 'var(--radius-md)' }}>
              {(['ALL', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH', 'CUSTOM'] as DateFilterType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setDateFilter(type);
                    setPage(1);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: dateFilter === type ? 700 : 500,
                    border: 'none',
                    cursor: 'pointer',
                    background: dateFilter === type ? 'var(--primary)' : 'transparent',
                    color: dateFilter === type ? '#ffffff' : 'var(--text-secondary)',
                    transition: 'all 0.12s ease',
                  }}
                >
                  {type === 'ALL'
                    ? 'All Dates'
                    : type === 'TODAY'
                    ? 'Today'
                    : type === 'YESTERDAY'
                    ? 'Yesterday'
                    : type === 'THIS_WEEK'
                    ? 'This Week'
                    : type === 'THIS_MONTH'
                    ? 'This Month'
                    : 'Custom Range'}
                </button>
              ))}
            </div>

            {/* Payment Mode Filter */}
            <div style={{ minWidth: 150 }}>
              <select
                className="form-select"
                value={paymentMode}
                onChange={(e) => {
                  setPaymentMode(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All Payment Modes</option>
                <option value="UPI">UPI</option>
                <option value="CASH">Cash at Counter</option>
                <option value="BANK_TRANSFER">Bank Transfer (IMPS/NEFT)</option>
                <option value="CHEQUE">Cheque</option>
                <option value="NET_BANKING">Net Banking</option>
                <option value="DEBIT_CARD">Debit Card</option>
              </select>
            </div>

            {/* Status Filter */}
            <div style={{ minWidth: 140 }}>
              <select
                className="form-select"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All Statuses</option>
                <option value="SUCCESS">Completed (Success)</option>
                <option value="REVERSED">Reversed</option>
              </select>
            </div>

            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} style={{ flex: 1, minWidth: 260, display: 'flex', gap: 8 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search
                  size={15}
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search receipt, borrower, phone, loan account, UTR..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ paddingLeft: 32 }}
                />
              </div>
              <button type="submit" className="btn btn-secondary">
                Search
              </button>
            </form>
          </div>

          {/* Custom Date Pickers (visible if CUSTOM selected) */}
          {dateFilter === 'CUSTOM' && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Custom Date Range:</span>
              <input
                type="date"
                className="form-input"
                style={{ width: 160 }}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
              />
              <span style={{ color: 'var(--text-muted)' }}>to</span>
              <input
                type="date"
                className="form-input"
                style={{ width: 160 }}
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 3. Direct Collection Ledger Table */}
      <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800 }}>Direct Payment Transactions</h3>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Showing {records.length} of {totalCount} total direct collection records
            </div>
          </div>

          {/* Rows per page selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span>Rows:</span>
            <select
              className="form-select"
              style={{ width: 70, padding: '4px 8px' }}
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading direct customer collections ledger...
          </div>
        ) : records.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Receipt size={32} color="var(--primary)" style={{ margin: '0 auto 10px' }} />
            <div style={{ fontWeight: 700, fontSize: 14 }}>No Direct Customer Collections Found</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Try clearing the filters or selecting a different date range.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Payment Date</th>
                  <th>Receipt Number</th>
                  <th>Borrower</th>
                  <th>Loan Account</th>
                  <th>Amount</th>
                  <th>Payment Mode</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      <div>{new Date(r.paymentTimestamp).toLocaleDateString('en-IN')}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {new Date(r.paymentTimestamp).toLocaleTimeString('en-IN', { hour12: true })}
                      </div>
                    </td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {r.receiptNumber}
                    </td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{r.customerName}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {r.customerCode} • {r.customerPhone || '—'}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.loanAccountNo}
                    </td>
                    <td
                      className="mono"
                      style={{
                        fontWeight: 800,
                        color: r.isReversal ? 'var(--text-muted)' : 'var(--success-text)',
                        textDecoration: r.isReversal ? 'line-through' : 'none',
                      }}
                    >
                      {formatINR(r.amount)}
                    </td>
                    <td>
                      <span className="badge badge-upcoming">{r.paymentMode}</span>
                    </td>
                    <td>
                      <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Building2 size={11} />
                        <span>Direct Customer</span>
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${r.isReversal ? 'badge-overdue' : 'badge-paid'}`}>
                        {r.isReversal ? 'REVERSED' : 'PAID'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleOpenDetail(r.id)}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          title="View Details Drawer"
                        >
                          <Eye size={12} />
                          <span>Details</span>
                        </button>
                        <button
                          onClick={() => handleOpenReceipt(r.id)}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          title="View Official Receipt"
                        >
                          <Receipt size={12} />
                          <span>Receipt</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-surface-secondary)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Page <strong>{page}</strong> of <strong>{totalPages || 1}</strong>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="btn btn-secondary btn-sm"
            >
              <ChevronLeft size={14} />
              <span>Previous</span>
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="btn btn-secondary btn-sm"
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* 4. Detail Drawer Modal */}
      {selectedRecordId && (
        <div className="modal-overlay" onClick={() => setSelectedRecordId(null)}>
          <div
            className="modal-content"
            style={{ width: '100%', maxWidth: 560, padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Receipt size={20} color="var(--primary)" />
                <h3 style={{ fontSize: 16, fontWeight: 800 }}>Direct Payment Transaction Details</h3>
              </div>
              <button
                onClick={() => setSelectedRecordId(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {loadingDetail ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading payment details & allocation waterfall...
              </div>
            ) : detailData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Status Header Banner */}
                <div
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: detailData.isReversal ? 'var(--danger-subtle)' : 'var(--success-subtle)',
                    border: `1px solid ${detailData.isReversal ? 'var(--danger-border)' : 'var(--success-border)'}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: detailData.isReversal ? 'var(--danger)' : 'var(--success)' }}>
                      {detailData.isReversal ? 'PAYMENT REVERSED' : 'PAYMENT SUCCESSFUL'}
                    </div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: detailData.isReversal ? 'var(--danger)' : 'var(--success-text)', marginTop: 2 }}>
                      {formatINR(detailData.amount)}
                    </div>
                  </div>
                  <span className={`badge ${detailData.isReversal ? 'badge-overdue' : 'badge-paid'}`}>
                    {detailData.status}
                  </span>
                </div>

                {/* Reversal Reason if Applicable */}
                {detailData.isReversal && detailData.reversalReason && (
                  <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca', fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: '#991b1b' }}>Reversal Reason: </span>
                    <span style={{ color: '#7f1d1d' }}>{detailData.reversalReason}</span>
                  </div>
                )}

                {/* Borrower & Financed Loan */}
                <div style={{ background: 'var(--bg-surface-secondary)', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Borrower & Loan Account
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Customer:</span>
                      <strong>{detailData.customerName} ({detailData.customerCode})</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Phone:</span>
                      <span className="mono">{detailData.customerPhone || '—'}</span>
                    </div>
                    {detailData.customer?.address && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Address:</span>
                        <span>{detailData.customer.address}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Loan Account:</span>
                      <strong className="mono">{detailData.loanAccountNo}</strong>
                    </div>
                  </div>
                </div>

                {/* Payment & Channel Details */}
                <div style={{ background: 'var(--bg-surface-secondary)', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Payment & Channel Info
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Receipt Number:</span>
                      <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {detailData.receiptNumber}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Payment Mode:</span>
                      <span>{detailData.paymentMode}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Collection Source:</span>
                      <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Building2 size={11} />
                        <span>Direct Customer</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Date & Time:</span>
                      <span className="mono">{new Date(detailData.paymentTimestamp).toLocaleString('en-IN', { hour12: true })}</span>
                    </div>
                    {detailData.referenceNumber && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Reference / UTR:</span>
                        <span className="mono">{detailData.referenceNumber}</span>
                      </div>
                    )}
                    {detailData.notes && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Notes:</span>
                        <span>{detailData.notes}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Waterfall Allocations Breakdown */}
                {detailData.allocations && detailData.allocations.length > 0 && (
                  <div style={{ background: 'var(--bg-surface-secondary)', padding: 12, borderRadius: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                      EMI Waterfall Allocations
                    </div>
                    <table className="crm-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>EMI No</th>
                          <th>Principal</th>
                          <th>Interest</th>
                          <th>Penalty</th>
                          <th>Total Allocated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailData.allocations.map((a) => (
                          <tr key={a.id}>
                            <td className="mono" style={{ fontWeight: 700 }}>EMI #{a.installmentNumber}</td>
                            <td className="mono">{formatINR(a.principalComponent)}</td>
                            <td className="mono">{formatINR(a.interestComponent)}</td>
                            <td className="mono">{formatINR(a.penaltyComponent)}</td>
                            <td className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                              {formatINR(a.totalAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const pid = detailData.id;
                      setSelectedRecordId(null);
                      handleOpenReceipt(pid);
                    }}
                    className="btn btn-secondary"
                  >
                    <Receipt size={14} />
                    <span>View Official Receipt</span>
                  </button>
                  <button type="button" onClick={() => setSelectedRecordId(null)} className="btn btn-primary">
                    Close
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 5. Official Receipt Modal */}
      {selectedReceipt && (
        <div className="modal-overlay" onClick={() => setSelectedReceipt(null)}>
          <div className="modal-content" style={{ width: '100%', maxWidth: 420, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: 'center', borderBottom: '1px dashed var(--border-subtle)', paddingBottom: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
                ALPHA MOBILE GALLERY
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', marginTop: 1 }}>
                SHUBH PVT LTD
              </div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4 }}>OFFICIAL PAYMENT RECEIPT</h3>
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
                <span style={{ color: 'var(--text-secondary)' }}>Payment Source:</span>
                <strong style={{ color: 'var(--primary)' }}>Direct Customer</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Payment Mode:</span>
                <span>{selectedReceipt.paymentMode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontWeight: 700 }}>Amount Paid:</span>
                <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: 'var(--success-text)' }}>
                  {formatINR(selectedReceipt.amount)}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" onClick={() => setSelectedReceipt(null)} className="btn btn-primary" style={{ width: '100%' }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
