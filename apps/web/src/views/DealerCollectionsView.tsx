import React, { useState, useEffect } from 'react';
import {
  IDealer,
  IDealerCollectionSummary,
  IDealerCollectionRecord,
  formatINR,
  PaymentMode,
  PaymentStatus,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  Store,
  Calendar,
  Search,
  Receipt,
  Smartphone,
  ChevronLeft,
  ChevronRight,
  Filter,
  CheckCircle2,
  AlertCircle,
  X,
  Building,
  ArrowUpRight,
  TrendingUp,
  CreditCard,
  Hash,
} from 'lucide-react';

type DateFilterType = 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';

interface DealerCollectionsViewProps {
  initialDealerId?: string | null;
  onNavigateToDealers?: () => void;
}

export const DealerCollectionsView: React.FC<DealerCollectionsViewProps> = ({
  initialDealerId,
  onNavigateToDealers,
}) => {
  const [dealers, setDealers] = useState<IDealer[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>(initialDealerId || '');
  const [dateFilter, setDateFilter] = useState<DateFilterType>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');

  // Data states
  const [summary, setSummary] = useState<IDealerCollectionSummary | null>(null);
  const [records, setRecords] = useState<IDealerCollectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Selected Record Detail Modal
  const [selectedRecord, setSelectedRecord] = useState<IDealerCollectionRecord | null>(null);

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

  // Load Dealers List for Dropdown
  useEffect(() => {
    const loadDealers = async () => {
      try {
        const data = await ApiClient.getDealers(undefined, undefined, undefined, 1, 100);
        setDealers(data);
      } catch (err) {
        console.error('Failed to load dealers', err);
      }
    };
    loadDealers();
  }, []);

  // Update when initialDealerId prop changes
  useEffect(() => {
    if (initialDealerId !== undefined && initialDealerId !== null) {
      setSelectedDealerId(initialDealerId);
    }
  }, [initialDealerId]);

  // Fetch Ledger Data
  const fetchData = async () => {
    setLoading(true);
    try {
      const dates = getDateRange(dateFilter);
      const res = await ApiClient.getDealerCollections({
        dealerId: selectedDealerId || undefined,
        startDate: dates.start,
        endDate: dates.end,
        search: search || undefined,
        page,
        limit,
      });

      setSummary(res.summary);
      setRecords(res.records);
      setTotalCount(res.totalCount);
      setTotalPages(res.totalPages);
    } catch (err) {
      console.error('Failed to load dealer collections ledger', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedDealerId, dateFilter, startDate, endDate, page, limit]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  const handleDateFilterChange = (filter: DateFilterType) => {
    setDateFilter(filter);
    setPage(1);
  };

  const handleSelectDealerFromTable = (dealerId: string) => {
    if (selectedDealerId === dealerId) {
      setSelectedDealerId(''); // toggle off
    } else {
      setSelectedDealerId(dealerId);
    }
    setPage(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* PAGE HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Dealer Collections Ledger
          </h2>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Real-time collection audit and settlement ledger for partner retail stores
          </div>
        </div>

        {onNavigateToDealers && (
          <button onClick={onNavigateToDealers} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Store size={14} />
            <span>Manage Partner Stores</span>
          </button>
        )}
      </div>

      {/* KPI METRICS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {/* Total Collections */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Total Collections
            </span>
            <span style={{ padding: 6, borderRadius: 'var(--radius-md)', background: 'var(--primary-subtle)', color: 'var(--primary)' }}>
              <Store size={16} />
            </span>
          </div>
          <div className="mono font-bold" style={{ fontSize: 24, color: 'var(--primary)', marginTop: 6 }}>
            {formatINR(summary?.totalCollections || 0)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            From <strong>{summary?.paymentCount || 0}</strong> customer payments
          </div>
        </div>

        {/* Today's Collections */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)', textTransform: 'uppercase' }}>
              Today's Collections
            </span>
            <span style={{ padding: 6, borderRadius: 'var(--radius-md)', background: 'var(--success-subtle)', color: 'var(--success)' }}>
              <TrendingUp size={16} />
            </span>
          </div>
          <div className="mono font-bold" style={{ fontSize: 24, color: 'var(--success)', marginTop: 6 }}>
            {formatINR(summary?.todayCollections || 0)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Partner collections logged today
          </div>
        </div>

        {/* This Month's Collections */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              This Month
            </span>
            <span style={{ padding: 6, borderRadius: 'var(--radius-md)', background: 'var(--bg-surface-secondary)', color: 'var(--text-secondary)' }}>
              <Calendar size={16} />
            </span>
          </div>
          <div className="mono font-bold" style={{ fontSize: 24, color: 'var(--text-primary)', marginTop: 6 }}>
            {formatINR(summary?.monthCollections || 0)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Current calendar month volume
          </div>
        </div>

        {/* Average Collection */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Average Collection
            </span>
            <span style={{ padding: 6, borderRadius: 'var(--radius-md)', background: 'var(--bg-surface-secondary)', color: 'var(--text-secondary)' }}>
              <CreditCard size={16} />
            </span>
          </div>
          <div className="mono font-bold" style={{ fontSize: 24, color: 'var(--text-primary)', marginTop: 6 }}>
            {formatINR(summary?.averageCollection || 0)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Average amount per store collection
          </div>
        </div>
      </div>

      {/* FILTER & CONTROL BAR */}
      <div
        className="crm-card"
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          {/* Partner Store Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              Partner Store:
            </label>
            <select
              value={selectedDealerId}
              onChange={(e) => {
                setSelectedDealerId(e.target.value);
                setPage(1);
              }}
              style={{
                padding: '7px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                fontSize: 13,
                background: '#ffffff',
                fontWeight: 600,
                minWidth: 220,
              }}
            >
              <option value="">All Partner Stores ({dealers.length})</option>
              {dealers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.storeName} ({d.dealerCode}) {d.status === 'INACTIVE' ? '— [INACTIVE]' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Date Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-surface-secondary)', padding: 3, borderRadius: 'var(--radius-md)' }}>
            {(['ALL', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH', 'CUSTOM'] as DateFilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => handleDateFilterChange(f)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  fontSize: 12,
                  fontWeight: dateFilter === f ? 700 : 500,
                  background: dateFilter === f ? '#ffffff' : 'transparent',
                  color: dateFilter === f ? 'var(--primary)' : 'var(--text-secondary)',
                  boxShadow: dateFilter === f ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.1s ease',
                }}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Search Input Form */}
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 6, flex: 1, maxWidth: 300 }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="input"
                placeholder="Search borrower, receipt, store..."
                style={{ paddingLeft: 30, height: 34, fontSize: 12, width: '100%' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-secondary btn-sm" style={{ padding: '0 10px' }}>
              Find
            </button>
          </form>
        </div>

        {/* Custom Date Pickers (Shown if CUSTOM selected) */}
        {dateFilter === 'CUSTOM' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>From:</span>
              <input
                type="date"
                className="input"
                style={{ height: 32, fontSize: 12 }}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>To:</span>
              <input
                type="date"
                className="input"
                style={{ height: 32, fontSize: 12 }}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {(startDate || endDate) && (
              <button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                }}
                className="btn btn-secondary btn-sm"
                style={{ fontSize: 11 }}
              >
                Clear Dates
              </button>
            )}
          </div>
        )}
      </div>

      {/* PARTNER STORE BREAKDOWN SUMMARY TABLE */}
      {summary && summary.dealerBreakdown.length > 0 && !selectedDealerId && (
        <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>Partner Stores Summary</h3>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Click any store to isolate its collection ledger below
              </div>
            </div>
            <span className="badge badge-terracotta">{summary.dealerBreakdown.length} Stores</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Partner Retail Store</th>
                  <th>Store Code</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Total Collections</th>
                  <th style={{ textAlign: 'center' }}>Payments Count</th>
                  <th style={{ textAlign: 'right' }}>Today</th>
                  <th style={{ textAlign: 'right' }}>This Month</th>
                  <th style={{ textAlign: 'right' }}>Avg Ticket</th>
                  <th style={{ textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {summary.dealerBreakdown.map((d) => (
                  <tr
                    key={d.dealerId}
                    style={{
                      cursor: 'pointer',
                      background: selectedDealerId === d.dealerId ? 'var(--primary-subtle)' : undefined,
                    }}
                    onClick={() => handleSelectDealerFromTable(d.dealerId)}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Store size={15} color="var(--primary)" />
                        <strong style={{ color: 'var(--text-primary)' }}>{d.storeName}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="mono badge badge-terracotta">{d.dealerCode}</span>
                    </td>
                    <td>
                      <span className="badge badge-route">{d.areaCity || 'Noida/Dadri'}</span>
                    </td>
                    <td>
                      <span className={`badge ${d.status === 'ACTIVE' ? 'badge-paid' : 'badge-overdue'}`}>
                        {d.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono font-bold">
                      {formatINR(d.totalCollections)}
                    </td>
                    <td style={{ textAlign: 'center' }} className="mono">
                      {d.paymentCount}
                    </td>
                    <td style={{ textAlign: 'right', color: d.todayCollections > 0 ? 'var(--success)' : 'var(--text-muted)' }} className="mono font-bold">
                      {formatINR(d.todayCollections)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {formatINR(d.monthCollections)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {formatINR(d.averageCollection)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectDealerFromTable(d.dealerId);
                        }}
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                      >
                        {selectedDealerId === d.dealerId ? 'Clear Filter' : 'View Ledger'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DETAILED PAYMENT COLLECTION LEDGER */}
      <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-surface-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Receipt size={18} color="var(--primary)" />
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>Collection Transactions Ledger</h3>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {totalCount} collection entries found {selectedDealerId ? `for selected store` : ''}
              </div>
            </div>
          </div>

          {selectedDealerId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Store size={12} />
                <span>Filtered: {dealers.find((d) => d.id === selectedDealerId)?.storeName || 'Store'}</span>
              </span>
              <button onClick={() => setSelectedDealerId('')} className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '3px 8px' }}>
                Reset Store
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading dealer collection ledger...
          </div>
        ) : records.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Receipt size={32} color="var(--primary)" style={{ margin: '0 auto 10px', opacity: 0.5 }} />
            <div style={{ fontWeight: 700, fontSize: 14 }}>No Dealer Collections Found</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              There are no partner store collections matching the specified filter criteria.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Collection Date & Time</th>
                  <th>Receipt #</th>
                  <th>Borrower Details</th>
                  <th>Loan Acc #</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Payment Mode</th>
                  <th>Partner Retail Store</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const isReversed = r.status === 'REVERSED' || r.isReversal;

                  return (
                    <tr
                      key={r.id}
                      style={{
                        cursor: 'pointer',
                        opacity: isReversed ? 0.65 : 1,
                      }}
                      onClick={() => setSelectedRecord(r)}
                    >
                      <td style={{ fontSize: 12 }}>
                        <div>{new Date(r.paymentTimestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(r.paymentTimestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </div>
                      </td>

                      <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                        {r.receiptNumber}
                      </td>

                      <td>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{r.customerName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {r.customerPhone} • <span className="mono">{r.customerCode}</span>
                        </div>
                      </td>

                      <td className="mono">{r.loanAccountNo}</td>

                      <td
                        style={{
                          textAlign: 'right',
                          textDecoration: isReversed ? 'line-through' : 'none',
                        }}
                        className="mono font-bold"
                      >
                        <span style={{ color: isReversed ? 'var(--text-muted)' : 'var(--success-text)' }}>
                          {formatINR(r.amount)}
                        </span>
                      </td>

                      <td>
                        <span className="badge badge-upcoming">{r.paymentMode}</span>
                      </td>

                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 12 }}>{r.dealerStoreName}</span>
                          <span className="mono badge badge-terracotta" style={{ width: 'fit-content', fontSize: 10 }}>
                            {r.dealerCode}
                          </span>
                        </div>
                      </td>

                      <td>
                        <span className={`badge ${isReversed ? 'badge-overdue' : 'badge-paid'}`}>
                          {r.status}
                        </span>
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRecord(r);
                          }}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                        >
                          Receipt
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* PAGINATION CONTROLS */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            background: 'var(--bg-surface-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>Rows per page:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              style={{
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                fontSize: 12,
                background: '#ffffff',
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span style={{ color: 'var(--text-muted)' }}>
              Showing {records.length > 0 ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, totalCount)} of {totalCount}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn btn-secondary btn-sm"
              style={{ padding: '4px 8px' }}
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontWeight: 600, padding: '0 6px' }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn btn-secondary btn-sm"
              style={{ padding: '4px 8px' }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* PAYMENT / RECEIPT DETAIL MODAL */}
      {selectedRecord && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1100,
          }}
          onClick={() => setSelectedRecord(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              background: '#ffffff',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--bg-surface-secondary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} color="var(--success)" />
                <h3 style={{ fontSize: 15, fontWeight: 800 }}>Dealer Payment Receipt</h3>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Receipt & Status */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>RECEIPT NUMBER</div>
                  <div className="mono font-bold" style={{ fontSize: 15, color: 'var(--primary)' }}>
                    {selectedRecord.receiptNumber}
                  </div>
                </div>
                <span className={`badge ${selectedRecord.status === 'REVERSED' ? 'badge-overdue' : 'badge-paid'}`}>
                  {selectedRecord.status}
                </span>
              </div>

              {/* Amount Box */}
              <div
                style={{
                  background: 'var(--bg-surface-secondary)',
                  padding: 14,
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>COLLECTED AMOUNT</div>
                <div className="mono font-bold" style={{ fontSize: 26, color: 'var(--success-text)', marginTop: 2 }}>
                  {formatINR(selectedRecord.amount)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Payment Mode: <strong>{selectedRecord.paymentMode}</strong>
                </div>
              </div>

              {/* Transaction Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>Borrower Name</div>
                  <strong>{selectedRecord.customerName}</strong>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>Customer Code</div>
                  <span className="mono">{selectedRecord.customerCode}</span>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>Loan Account</div>
                  <span className="mono font-bold">{selectedRecord.loanAccountNo}</span>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>Borrower Phone</div>
                  <span className="mono">{selectedRecord.customerPhone}</span>
                </div>
                <div style={{ gridColumn: 'span 2', borderTop: '1px dashed var(--border-subtle)', paddingTop: 10 }}>
                  <div style={{ color: 'var(--text-secondary)' }}>Collection Source</div>
                  <strong style={{ color: 'var(--primary)' }}>Partner Store Collection</strong>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>Partner Store</div>
                  <strong>{selectedRecord.dealerStoreName}</strong>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>Store Code</div>
                  <span className="mono badge badge-terracotta">{selectedRecord.dealerCode}</span>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>Payment Timestamp</div>
                  <div>{new Date(selectedRecord.paymentTimestamp).toLocaleString('en-IN')}</div>
                </div>
                {selectedRecord.referenceNumber && (
                  <div>
                    <div style={{ color: 'var(--text-secondary)' }}>Txn Reference</div>
                    <span className="mono">{selectedRecord.referenceNumber}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface-secondary)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button onClick={() => setSelectedRecord(null)} className="btn btn-primary btn-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
