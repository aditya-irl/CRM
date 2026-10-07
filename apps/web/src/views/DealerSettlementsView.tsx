import React, { useState, useEffect } from 'react';
import {
  IDealer,
  IDealerSettlement,
  IDealerReconciliation,
  IDealerSettlementsSummary,
  IDealerUnsettledCollection,
  SettlementStatus,
  SettlementPaymentMethod,
  DealerStatus,
  getBusinessDate,
  formatDateDDMMYYYY,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  Banknote,
  Plus,
  Search,
  Calendar,
  Filter,
  CheckCircle,
  AlertCircle,
  Clock,
  RotateCcw,
  ArrowRight,
  ExternalLink,
  Store,
  Receipt,
  CreditCard,
  User,
  X,
  FileText,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

const formatINR = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (dateStr?: string | null) => {
  if (!dateStr) return '—';
  return formatDateDDMMYYYY(dateStr);
};

type DateRangePreset = 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';

interface DealerSettlementsViewProps {
  initialDealerId?: string | null;
  onNavigateToDealers?: () => void;
  onNavigateToCollections?: (dealerId?: string) => void;
}

export const DealerSettlementsView: React.FC<DealerSettlementsViewProps> = ({
  initialDealerId,
  onNavigateToDealers,
  onNavigateToCollections,
}) => {
  const [dealers, setDealers] = useState<IDealer[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>(initialDealerId || '');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Data states
  const [summary, setSummary] = useState<IDealerSettlementsSummary | null>(null);
  const [settlements, setSettlements] = useState<IDealerSettlement[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Settlement Detail Drawer
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [settlementDetail, setSettlementDetail] = useState<IDealerSettlement | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Record Settlement Modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [modalDealerId, setModalDealerId] = useState<string>('');
  const [modalAmount, setModalAmount] = useState<string>('');
  const [modalDate, setModalDate] = useState<string>(getBusinessDate(undefined, 'Asia/Kolkata'));
  const [modalPaymentMethod, setModalPaymentMethod] = useState<string>('BANK_TRANSFER');
  const [modalReference, setModalReference] = useState<string>('');
  const [modalNotes, setModalNotes] = useState<string>('');
  const [modalUnsettled, setModalUnsettled] = useState<IDealerUnsettledCollection[]>([]);
  const [loadingUnsettled, setLoadingUnsettled] = useState(false);
  const [submittingSettlement, setSubmittingSettlement] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Reversal Modal
  const [reversingSettlement, setReversingSettlement] = useState<IDealerSettlement | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [submittingReversal, setSubmittingReversal] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Load Dealers List
  useEffect(() => {
    const fetchDealers = async () => {
      try {
        const data = await ApiClient.getDealers();
        setDealers(data);
      } catch (err) {
        console.error('Failed to load dealers', err);
      }
    };
    fetchDealers();
  }, []);

  // Update dates based on preset
  const handleDatePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    const today = getBusinessDate(undefined, 'Asia/Kolkata');
    const todayDate = new Date();

    if (preset === 'ALL') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'TODAY') {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'YESTERDAY') {
      const y = new Date(todayDate);
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().slice(0, 10);
      setStartDate(yStr);
      setEndDate(yStr);
    } else if (preset === 'THIS_WEEK') {
      const d = new Date(todayDate);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      setStartDate(monday.toISOString().slice(0, 10));
      setEndDate(today);
    } else if (preset === 'THIS_MONTH') {
      const firstDay = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      setStartDate(firstDay);
      setEndDate(today);
    }
  };

  // Fetch Settlements & Summary Data
  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await ApiClient.getDealerSettlements({
        dealerId: selectedDealerId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        search: search || undefined,
        page,
        limit,
      });

      setSummary(response.summary);
      setSettlements(response.records);
      setTotalCount(response.totalCount);
      setTotalPages(response.totalPages);
    } catch (err) {
      console.error('Failed to load dealer settlements', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedDealerId, statusFilter, startDate, endDate, page, limit]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  // Open Settlement Detail Drawer
  const handleOpenDetail = async (id: string) => {
    setSelectedSettlementId(id);
    setLoadingDetail(true);
    try {
      const detail = await ApiClient.getDealerSettlementDetail(id);
      setSettlementDetail(detail);
    } catch (err) {
      alert('Failed to load settlement details');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Open Record Settlement Modal
  const handleOpenRecordModal = async (presetDealerId?: string) => {
    const dId = presetDealerId || selectedDealerId || (dealers.length > 0 ? dealers[0].id : '');
    setModalDealerId(dId);
    setModalAmount('');
    setModalDate(getBusinessDate(undefined, 'Asia/Kolkata'));
    setModalPaymentMethod('BANK_TRANSFER');
    setModalReference('');
    setModalNotes('');
    setModalError(null);
    setShowRecordModal(true);

    if (dId) {
      await fetchUnsettledForModal(dId);
    }
  };

  const fetchUnsettledForModal = async (dealerId: string) => {
    setLoadingUnsettled(true);
    try {
      const items = await ApiClient.getUnsettledCollectionsForDealer(dealerId);
      setModalUnsettled(items);
      const totalAvailable = items.reduce((acc, curr) => acc + curr.amountRemaining, 0);
      if (totalAvailable > 0 && !modalAmount) {
        setModalAmount(String(totalAvailable));
      }
    } catch (err) {
      console.error('Failed to fetch unsettled collections', err);
    } finally {
      setLoadingUnsettled(false);
    }
  };

  const handleModalDealerChange = (dId: string) => {
    setModalDealerId(dId);
    setModalAmount('');
    fetchUnsettledForModal(dId);
  };

  const totalAvailableForModal = modalUnsettled.reduce((acc, curr) => acc + curr.amountRemaining, 0);

  // Submit Record Settlement
  const handleSubmitRecordSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = Number(modalAmount);
    if (!amountNum || amountNum <= 0) {
      setModalError('Please enter a valid settlement amount greater than ₹0');
      return;
    }
    if (amountNum > totalAvailableForModal) {
      setModalError(`Settlement amount (₹${amountNum}) exceeds available unsettled collections (₹${totalAvailableForModal})`);
      return;
    }

    setSubmittingSettlement(true);
    setModalError(null);
    try {
      await ApiClient.createDealerSettlement({
        dealerId: modalDealerId,
        amount: amountNum,
        settlementDate: modalDate,
        paymentMethod: modalPaymentMethod,
        referenceNumber: modalReference.trim() || null,
        notes: modalNotes.trim() || null,
      });
      setShowRecordModal(false);
      await fetchData();
    } catch (err: any) {
      setModalError(err.message || 'Failed to record settlement');
    } finally {
      setSubmittingSettlement(false);
    }
  };

  // Submit Reversal
  const handleConfirmReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingSettlement) return;
    if (!reversalReason || reversalReason.trim().length < 5) {
      setReversalError('Reversal reason must be at least 5 characters');
      return;
    }

    setSubmittingReversal(true);
    setReversalError(null);
    try {
      await ApiClient.reverseDealerSettlement(reversingSettlement.id, reversalReason.trim());
      setReversingSettlement(null);
      setReversalReason('');
      if (selectedSettlementId === reversingSettlement.id) {
        await handleOpenDetail(selectedSettlementId);
      }
      await fetchData();
    } catch (err: any) {
      setReversalError(err.message || 'Failed to reverse settlement');
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
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>Dealer Settlement & Reconciliation</h2>
            <span className="badge badge-terracotta" style={{ fontSize: 11 }}>
              Remittance Ledger
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Track, reconcile, and record remitted funds from partner mobile stores to the finance company.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onNavigateToCollections && (
            <button
              onClick={() => onNavigateToCollections(selectedDealerId || undefined)}
              className="btn btn-secondary"
            >
              <Receipt size={14} />
              <span>Customer Collection Ledger</span>
            </button>
          )}
          <button onClick={() => handleOpenRecordModal()} className="btn btn-primary">
            <Plus size={15} />
            <span>Record Settlement</span>
          </button>
        </div>
      </div>

      {/* 4 Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Total Dealer Collections
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
            {formatINR(summary?.totalCollections || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Total EMI collections through stores
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)', textTransform: 'uppercase' }}>
            Total Settled Funds
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
            {formatINR(summary?.totalSettled || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Remitted to finance company
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16, borderLeft: '4px solid var(--primary)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase' }}>
            Outstanding Settlement
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
            {formatINR(summary?.outstandingSettlement || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Pending dealer remittance
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Total Settlements
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
            {summary?.settlementCount || 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Completed remittance batches
          </div>
        </div>
      </div>

      {/* Dealer Reconciliation Table */}
      <div className="crm-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Dealer Reconciliation Breakdown</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Real-time balance comparison of collections versus completed settlements for each partner store.
            </p>
          </div>
        </div>

        <div className="table-container">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Partner Retail Store</th>
                <th>Area / City</th>
                <th>Total Collections</th>
                <th>Total Settled</th>
                <th>Outstanding Remittance</th>
                <th>Last Settlement</th>
                <th>Reconciliation Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!summary?.dealerReconciliation || summary.dealerReconciliation.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No dealer reconciliation records found.
                  </td>
                </tr>
              ) : (
                summary.dealerReconciliation.map((dealer) => {
                  const isFullyReconciled = dealer.reconciliationStatus === 'FULLY_RECONCILED';
                  const isNoCollections = dealer.reconciliationStatus === 'NO_COLLECTIONS';
                  return (
                    <tr key={dealer.dealerId}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{dealer.storeName}</div>
                        <span className="mono badge badge-terracotta" style={{ fontSize: 10 }}>
                          {dealer.dealerCode}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-route">{dealer.areaCity}</span>
                      </td>
                      <td>
                        <span className="mono font-bold">{formatINR(dealer.totalCollections)}</span>
                      </td>
                      <td>
                        <span className="mono font-bold" style={{ color: 'var(--success)' }}>
                          {formatINR(dealer.totalSettled)}
                        </span>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {dealer.settlementCount} batch(es)
                        </div>
                      </td>
                      <td>
                        <span
                          className="mono font-bold"
                          style={{
                            color: dealer.outstandingSettlement > 0 ? 'var(--primary)' : 'var(--text-muted)',
                          }}
                        >
                          {formatINR(dealer.outstandingSettlement)}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12 }}>{formatDate(dealer.lastSettlementDate)}</span>
                      </td>
                      <td>
                        {isFullyReconciled ? (
                          <span className="badge badge-paid">Fully Reconciled</span>
                        ) : isNoCollections ? (
                          <span className="badge badge-secondary">No Collections</span>
                        ) : (
                          <span className="badge badge-overdue">Pending Settlement</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleOpenRecordModal(dealer.dealerId)}
                            className="btn btn-primary btn-sm"
                            disabled={dealer.outstandingSettlement <= 0}
                            title={dealer.outstandingSettlement <= 0 ? 'No outstanding collections to settle' : 'Record Settlement'}
                          >
                            <Plus size={12} />
                            <span>Settle</span>
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
      </div>

      {/* Filter Bar for Settlements Ledger */}
      <div className="crm-card" style={{ padding: 14 }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Dealer Dropdown */}
          <select
            className="form-input"
            style={{ width: 220 }}
            value={selectedDealerId}
            onChange={(e) => {
              setSelectedDealerId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Partner Stores</option>
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.storeName} ({d.dealerCode})
              </option>
            ))}
          </select>

          {/* Status Dropdown */}
          <select
            className="form-input"
            style={{ width: 160 }}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="REVERSED">Reversed</option>
          </select>

          {/* Date Range Pills */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-surface-secondary)', padding: 3, borderRadius: 'var(--radius-md)' }}>
            {(['ALL', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH', 'CUSTOM'] as DateRangePreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleDatePresetChange(p)}
                className={`btn btn-sm ${datePreset === p ? 'btn-primary' : 'btn-secondary'}`}
                style={{ border: 'none', padding: '4px 8px', fontSize: 11 }}
              >
                {p === 'ALL' ? 'All Time' : p.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Custom Date Pickers */}
          {datePreset === 'CUSTOM' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="date"
                className="form-input"
                style={{ width: 140, padding: '4px 8px', fontSize: 12 }}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
              <input
                type="date"
                className="form-input"
                style={{ width: 140, padding: '4px 8px', fontSize: 12 }}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}

          {/* Search Box */}
          <input
            type="text"
            className="form-input"
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Search settlement #, dealer, UTR reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button type="submit" className="btn btn-secondary">
            <Search size={14} />
            <span>Search</span>
          </button>
        </form>
      </div>

      {/* Settlements History Ledger Table */}
      <div className="table-container">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Settlement Number</th>
              <th>Date</th>
              <th>Partner Retail Store</th>
              <th>Settlement Amount</th>
              <th>Payment Method</th>
              <th>UTR / Reference</th>
              <th>Status</th>
              <th>Covered Receipts</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Loading settlement history...
                </td>
              </tr>
            ) : settlements.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  No dealer settlement records found.
                </td>
              </tr>
            ) : (
              settlements.map((settlement) => {
                const isCompleted = settlement.status === SettlementStatus.COMPLETED;
                const isReversed = settlement.status === SettlementStatus.REVERSED;
                return (
                  <tr key={settlement.id} style={{ opacity: isReversed ? 0.7 : 1 }}>
                    <td>
                      <span className="mono badge badge-terracotta" style={{ fontWeight: 700 }}>
                        {settlement.settlementNumber}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{formatDate(settlement.settlementDate)}</span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{settlement.dealerStoreName}</div>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {settlement.dealerCode}
                      </span>
                    </td>
                    <td>
                      <span
                        className="mono font-bold"
                        style={{
                          textDecoration: isReversed ? 'line-through' : 'none',
                          color: isReversed ? 'var(--text-muted)' : 'var(--success)',
                        }}
                      >
                        {formatINR(settlement.amount)}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-route">{settlement.paymentMethod}</span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {settlement.referenceNumber || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${isCompleted ? 'badge-paid' : 'badge-overdue'}`}>
                        {settlement.status}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-secondary" style={{ fontSize: 11 }}>
                        {settlement.allocationsCount} receipt(s)
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleOpenDetail(settlement.id)}
                          className="btn btn-secondary btn-sm"
                          title="View Settlement Details"
                        >
                          <ExternalLink size={12} />
                          <span>View</span>
                        </button>
                        {isCompleted && (
                          <button
                            onClick={() => {
                              setReversingSettlement(settlement);
                              setReversalReason('');
                              setReversalError(null);
                            }}
                            className="btn btn-secondary btn-sm"
                            style={{ color: 'var(--danger-text)' }}
                            title="Reverse Settlement"
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

      {/* Pagination Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Showing {settlements.length} of {totalCount} settlements
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ width: 110, padding: '4px 8px', fontSize: 12 }}
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn btn-secondary btn-sm"
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn btn-secondary btn-sm"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* RECORD SETTLEMENT MODAL */}
      {showRecordModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: 16,
          }}
          onClick={() => setShowRecordModal(false)}
        >
          <div
            className="crm-card"
            style={{
              width: '100%',
              maxWidth: 680,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
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
                <Banknote size={18} color="var(--primary)" />
                <h3 style={{ fontSize: 16, fontWeight: 800 }}>Record Dealer Settlement</h3>
              </div>
              <button
                onClick={() => setShowRecordModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitRecordSettlement} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {modalError && (
                <div
                  style={{
                    padding: 10,
                    background: 'var(--danger-subtle)',
                    border: '1px solid var(--danger-border)',
                    color: 'var(--danger-text)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 12,
                  }}
                >
                  {modalError}
                </div>
              )}

              {/* Dealer Selector */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Select Partner Retail Store <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <select
                  className="form-input"
                  value={modalDealerId}
                  onChange={(e) => handleModalDealerChange(e.target.value)}
                  required
                >
                  {dealers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.storeName} ({d.dealerCode}) — Area: {d.areaCity}
                    </option>
                  ))}
                </select>
              </div>

              {/* Available Balance Banner */}
              <div
                style={{
                  padding: '12px 16px',
                  background: 'var(--bg-surface-secondary)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Available Unsettled Collections</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }} className="mono">
                    {loadingUnsettled ? 'Calculating...' : formatINR(totalAvailableForModal)}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                  {modalUnsettled.length} unsettled receipt(s)
                </div>
              </div>

              {/* Amount & Settlement Date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Settlement Amount (₹) <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max={totalAvailableForModal || 99999999}
                    className="form-input mono font-bold"
                    placeholder="Enter amount in ₹"
                    value={modalAmount}
                    onChange={(e) => setModalAmount(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Settlement Date <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Payment Method & UTR */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Remittance Payment Method <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <select
                    className="form-input"
                    value={modalPaymentMethod}
                    onChange={(e) => setModalPaymentMethod(e.target.value)}
                    required
                  >
                    <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS/IMPS)</option>
                    <option value="UPI">UPI Transfer</option>
                    <option value="CHEQUE">Cheque / Demand Draft</option>
                    <option value="CASH">Cash Remittance</option>
                    <option value="OTHER">Other Settlement Mode</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    UTR / Transaction Reference
                  </label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder="e.g. UTR1234567890"
                    value={modalReference}
                    onChange={(e) => setModalReference(e.target.value)}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Settlement Notes / Remarks
                </label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Optional remittance remarks, bank branch, or cheque details..."
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                />
              </div>

              {/* Unsettled Receipts Breakdown */}
              {modalUnsettled.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Eligible Unsettled Receipts ({modalUnsettled.length})</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Automatically allocated oldest-first</span>
                  </div>
                  <div className="table-container" style={{ maxHeight: 180, overflowY: 'auto' }}>
                    <table className="crm-table" style={{ fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Receipt</th>
                          <th>Customer</th>
                          <th>Loan</th>
                          <th>Collected</th>
                          <th>Already Settled</th>
                          <th>Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modalUnsettled.map((u) => (
                          <tr key={u.paymentId}>
                            <td>{formatDate(u.paymentDate)}</td>
                            <td>
                              <span className="mono">{u.receiptNumber}</span>
                            </td>
                            <td>{u.customerName}</td>
                            <td>
                              <span className="mono">{u.loanAccountNo}</span>
                            </td>
                            <td>{formatINR(u.amountCollected)}</td>
                            <td>{formatINR(u.amountSettled)}</td>
                            <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                              {formatINR(u.amountRemaining)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowRecordModal(false)}
                  className="btn btn-secondary"
                  disabled={submittingSettlement}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingSettlement || totalAvailableForModal <= 0}
                >
                  {submittingSettlement ? 'Recording Settlement...' : 'Confirm & Record Settlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SETTLEMENT DETAIL DRAWER */}
      {selectedSettlementId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 1000,
          }}
          onClick={() => {
            setSelectedSettlementId(null);
            setSettlementDetail(null);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 640,
              height: '100%',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-8px 0 24px rgba(0,0,0,0.15)',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {loadingDetail || !settlementDetail ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading settlement details...
              </div>
            ) : (
              <div>
                {/* Header */}
                <div
                  style={{
                    padding: '18px 24px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--bg-surface-secondary)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--primary-subtle)',
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Banknote size={20} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 800 }}>{settlementDetail.settlementNumber}</h3>
                      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        <span className={`badge ${settlementDetail.status === SettlementStatus.COMPLETED ? 'badge-paid' : 'badge-overdue'}`}>
                          {settlementDetail.status}
                        </span>
                        <span className="badge badge-route">{settlementDetail.paymentMethod}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedSettlementId(null);
                      setSettlementDetail(null);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Content */}
                <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {/* Reversal Alert Banner */}
                  {settlementDetail.isReversal && (
                    <div
                      style={{
                        padding: 14,
                        background: 'var(--danger-subtle)',
                        border: '1px solid var(--danger-border)',
                        color: 'var(--danger-text)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 13,
                      }}
                    >
                      <strong>REVERSED SETTLEMENT</strong>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        Reason: {settlementDetail.reversalReason}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Reversed at: {formatDate(settlementDetail.reversedAt)}
                      </div>
                    </div>
                  )}

                  {/* Summary Metric Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="crm-card" style={{ padding: 14 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>SETTLED AMOUNT</div>
                      <div className="mono font-bold" style={{ fontSize: 22, color: settlementDetail.isReversal ? 'var(--text-muted)' : 'var(--success)', marginTop: 2 }}>
                        {formatINR(settlementDetail.amount)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Date: {formatDate(settlementDetail.settlementDate)}
                      </div>
                    </div>

                    <div className="crm-card" style={{ padding: 14 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>REMITTANCE INFO</div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                        {settlementDetail.paymentMethod}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Ref: {settlementDetail.referenceNumber || 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* Store Details */}
                  <div className="crm-card" style={{ padding: 16 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Partner Store Information</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Store Name</div>
                        <strong>{settlementDetail.dealerStoreName}</strong>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Dealer Code</div>
                        <span className="mono badge badge-terracotta">{settlementDetail.dealerCode}</span>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Owner Name</div>
                        <div>{settlementDetail.ownerName || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Phone</div>
                        <div className="mono">{settlementDetail.phone || '—'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Audit Info */}
                  <div className="crm-card" style={{ padding: 14, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Recorded By:</span>
                      <strong>{settlementDetail.createdByName || 'Admin'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Created Timestamp:</span>
                      <span>{formatDate(settlementDetail.createdAt)}</span>
                    </div>
                    {settlementDetail.notes && (
                      <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Notes: </span>
                        <span>{settlementDetail.notes}</span>
                      </div>
                    )}
                  </div>

                  {/* Covered Receipts Allocation Table */}
                  <div>
                    <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                      Covered Customer Collections ({settlementDetail.allocations?.length || 0})
                    </h4>
                    {(!settlementDetail.allocations || settlementDetail.allocations.length === 0) ? (
                      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', background: 'var(--bg-surface-secondary)', borderRadius: 'var(--radius-md)' }}>
                        No receipt allocations found.
                      </div>
                    ) : (
                      <div className="table-container" style={{ maxHeight: 240, overflowY: 'auto' }}>
                        <table className="crm-table" style={{ fontSize: 11 }}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Receipt</th>
                              <th>Borrower</th>
                              <th>Loan</th>
                              <th>Collected</th>
                              <th>Allocated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {settlementDetail.allocations.map((a) => (
                              <tr key={a.id}>
                                <td>{formatDate(a.paymentDate)}</td>
                                <td>
                                  <span className="mono">{a.receiptNumber}</span>
                                </td>
                                <td>{a.customerName}</td>
                                <td>
                                  <span className="mono">{a.loanAccountNo}</span>
                                </td>
                                <td>{formatINR(a.amountCollected)}</td>
                                <td className="mono font-bold" style={{ color: 'var(--success)' }}>
                                  {formatINR(a.amountAllocated)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Reverse Button (if completed) */}
                  {settlementDetail.status === SettlementStatus.COMPLETED && (
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => {
                          setReversingSettlement(settlementDetail);
                          setReversalReason('');
                          setReversalError(null);
                        }}
                        className="btn btn-secondary"
                        style={{ color: 'var(--danger-text)' }}
                      >
                        <RotateCcw size={14} />
                        <span>Reverse This Settlement</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* REVERSAL CONFIRMATION MODAL */}
      {reversingSettlement && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: 16,
          }}
          onClick={() => setReversingSettlement(null)}
        >
          <div
            className="crm-card"
            style={{ width: '100%', maxWidth: 480, padding: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger-text)', marginBottom: 12 }}>
              <RotateCcw size={20} />
              <h3 style={{ fontSize: 16, fontWeight: 800 }}>Reverse Settlement</h3>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Are you sure you want to reverse settlement{' '}
              <strong>{reversingSettlement.settlementNumber}</strong> ({formatINR(reversingSettlement.amount)}) for store{' '}
              <strong>{reversingSettlement.dealerStoreName}</strong>?
            </p>

            <div
              style={{
                padding: 10,
                background: 'var(--bg-surface-secondary)',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
                color: 'var(--text-muted)',
                marginBottom: 14,
              }}
            >
              Reversing this settlement will restore the remitted amount back to unsettled dealer collections. Customer loan EMI obligations and payment allocations will NOT be modified.
            </div>

            {reversalError && (
              <div
                style={{
                  padding: 10,
                  background: 'var(--danger-subtle)',
                  border: '1px solid var(--danger-border)',
                  color: 'var(--danger-text)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                {reversalError}
              </div>
            )}

            <form onSubmit={handleConfirmReversal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Reason for Reversal <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Bank remittance bounced or entry created in error..."
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setReversingSettlement(null)}
                  className="btn btn-secondary"
                  disabled={submittingReversal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: 'var(--danger-text)', borderColor: 'var(--danger-text)' }}
                  disabled={submittingReversal}
                >
                  {submittingReversal ? 'Reversing...' : 'Confirm Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
