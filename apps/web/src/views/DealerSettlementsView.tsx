import React, { useState, useEffect } from 'react';
import {
  IDealer,
  IDealerSettlement,
  IDealerReconciliation,
  IDealerSettlementsSummary,
  IDealerUnsettledCollection,
  IDealerSettlementCollectionItem,
  SettlementStatus,
  SettlementPaymentMethod,
  DealerStatus,
  UserRole,
  getBusinessDate,
  formatDateDDMMYYYY,
  formatINR,
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
  Check,
  XCircle,
} from 'lucide-react';

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
  const currentUser = ApiClient.getUser();
  const isDealer = currentUser?.role === UserRole.DEALER;
  const canManageSettlements =
    currentUser?.role === UserRole.SUPER_ADMIN ||
    currentUser?.role === UserRole.ADMIN ||
    currentUser?.role === UserRole.BRANCH_MANAGER;

  const [activeTab, setActiveTab] = useState<'collections' | 'batches'>('collections');
  const [dealers, setDealers] = useState<IDealer[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>(
    isDealer ? (currentUser?.dealerId || '') : (initialDealerId || '')
  );
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [approvalFilter, setApprovalFilter] = useState<string>('ALL');
  const [settlementFilter, setSettlementFilter] = useState<string>('ALL');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Data states - Batches
  const [summary, setSummary] = useState<IDealerSettlementsSummary | null>(null);
  const [settlements, setSettlements] = useState<IDealerSettlement[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Data states - Collections
  const [collections, setCollections] = useState<IDealerSettlementCollectionItem[]>([]);
  const [collectionsSummary, setCollectionsSummary] = useState<{
    pendingApprovalCount: number;
    pendingApprovalAmount: number;
    approvedCount: number;
    approvedAmount: number;
    unsettledAmount: number;
    settledAmount: number;
    totalCollectedAmount: number;
  } | null>(null);
  const [collectionsTotalCount, setCollectionsTotalCount] = useState(0);
  const [collectionsTotalPages, setCollectionsTotalPages] = useState(1);
  const [processingCollectionId, setProcessingCollectionId] = useState<string | null>(null);

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

  // Rejection Modal
  const [rejectingSettlement, setRejectingSettlement] = useState<IDealerSettlement | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingReject, setSubmittingReject] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [approvingSettlementId, setApprovingSettlementId] = useState<string | null>(null);

  // Load Dealers List
  useEffect(() => {
    if (!isDealer) {
      ApiClient.getDealers()
        .then((data) => setDealers(data))
        .catch((err) => console.error('Failed to load dealers', err));
    }
  }, [isDealer]);

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

  // Fetch Settlements & Collections Data
  const fetchData = async () => {
    setLoading(true);
    try {
      const effDealerId = isDealer ? (currentUser?.dealerId || undefined) : (selectedDealerId || undefined);

      const [settlementsRes, collectionsRes] = await Promise.all([
        ApiClient.getDealerSettlements({
          dealerId: effDealerId,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          search: search || undefined,
          page,
          limit,
        }),
        ApiClient.getDealerSettlementCollections({
          dealerId: effDealerId,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          approvalStatus: approvalFilter === 'ALL' ? undefined : approvalFilter,
          settlementStatus: settlementFilter === 'ALL' ? undefined : settlementFilter,
          search: search || undefined,
          page,
          limit,
        }).catch(() => null),
      ]);

      setSummary(settlementsRes.summary);
      setSettlements(settlementsRes.records);
      setTotalCount(settlementsRes.totalCount);
      setTotalPages(settlementsRes.totalPages);

      if (collectionsRes) {
        setCollections(collectionsRes.records);
        setCollectionsSummary(collectionsRes.summary);
        setCollectionsTotalCount(collectionsRes.totalCount);
        setCollectionsTotalPages(collectionsRes.totalPages);
      }
    } catch (err) {
      console.error('Failed to load dealer settlements data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedDealerId, statusFilter, approvalFilter, settlementFilter, startDate, endDate, page, limit, isDealer]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  // Inline Approve Dealer Collection
  const handleApproveCollection = async (paymentId: string) => {
    if (!window.confirm('Are you sure you want to approve this dealer-collected customer EMI? This will allocate the payment to customer installments.')) return;
    setProcessingCollectionId(paymentId);
    try {
      await ApiClient.approvePayment(paymentId);
      alert('Dealer EMI collection approved and allocated successfully.');
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to approve payment');
    } finally {
      setProcessingCollectionId(null);
    }
  };

  // Inline Reject Dealer Collection
  const handleRejectCollection = async (paymentId: string) => {
    const reason = window.prompt('Enter reason for rejecting this dealer collection:');
    if (!reason || !reason.trim()) return;
    setProcessingCollectionId(paymentId);
    try {
      await ApiClient.rejectPayment(paymentId, reason.trim());
      alert('Dealer EMI collection rejected.');
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to reject payment');
    } finally {
      setProcessingCollectionId(null);
    }
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
    setModalError(null);

    const amountNum = parseFloat(modalAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setModalError('Please enter a valid settlement amount greater than 0.');
      return;
    }

    if (amountNum > totalAvailableForModal) {
      setModalError(`Settlement amount cannot exceed total available unsettled collections (${formatINR(totalAvailableForModal)}).`);
      return;
    }

    setSubmittingSettlement(true);
    try {
      if (isDealer) {
        await ApiClient.requestDealerSettlement({
          dealerId: modalDealerId,
          amount: amountNum,
          settlementDate: modalDate,
          paymentMethod: modalPaymentMethod,
          referenceNumber: modalReference.trim() || undefined,
          notes: modalNotes.trim() || undefined,
        });
        alert('Settlement request submitted successfully and is awaiting administrator approval.');
      } else {
        await ApiClient.createDealerSettlement({
          dealerId: modalDealerId,
          amount: amountNum,
          settlementDate: modalDate,
          paymentMethod: modalPaymentMethod,
          referenceNumber: modalReference.trim() || undefined,
          notes: modalNotes.trim() || undefined,
        });
        alert('Settlement successfully recorded and reconciled.');
      }

      setShowRecordModal(false);
      await fetchData();
    } catch (err: any) {
      setModalError(err.message || 'Failed to record settlement.');
    } finally {
      setSubmittingSettlement(false);
    }
  };

  // Approve Settlement (Admin)
  const handleApproveSettlement = async (settlementId: string) => {
    if (!window.confirm('Are you sure you want to approve and process this settlement? This will allocate unsettled collections and mark the settlement completed.')) {
      return;
    }
    setApprovingSettlementId(settlementId);
    try {
      await ApiClient.approveDealerSettlement(settlementId);
      alert('Settlement approved and processed successfully.');
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to approve settlement.');
    } finally {
      setApprovingSettlementId(null);
    }
  };

  // Open Reject Modal (Admin)
  const handleOpenRejectModal = (settlement: IDealerSettlement) => {
    setRejectingSettlement(settlement);
    setRejectReason('');
    setRejectError(null);
  };

  // Submit Rejection (Admin)
  const handleSubmitReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingSettlement) return;
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      setRejectError('Rejection reason is required (minimum 3 characters).');
      return;
    }
    setSubmittingReject(true);
    try {
      await ApiClient.rejectDealerSettlement(rejectingSettlement.id, rejectReason.trim());
      alert('Settlement request rejected.');
      setRejectingSettlement(null);
      await fetchData();
    } catch (err: any) {
      setRejectError(err.message || 'Failed to reject settlement.');
    } finally {
      setSubmittingReject(false);
    }
  };

  // Submit Reversal
  const handleSubmitReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingSettlement) return;
    if (!reversalReason.trim()) {
      setReversalError('Reversal reason is required.');
      return;
    }

    setSubmittingReversal(true);
    setReversalError(null);
    try {
      await ApiClient.reverseDealerSettlement(reversingSettlement.id, reversalReason.trim());
      alert('Settlement reversed successfully. Allocated collections returned to unsettled state.');
      setReversingSettlement(null);
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
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>
              {isDealer ? 'Store Collections & Remittance' : 'EMI Collections & Settlement'}
            </h2>
            <span className="badge badge-terracotta" style={{ fontSize: 11 }}>
              Dealer Cash Remittance Ledger
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Track money collected by dealers from customers, approve pending collections, and reconcile cash handed over to the company.
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
          {canManageSettlements && (
            <button onClick={() => handleOpenRecordModal()} className="btn btn-primary">
              <Plus size={15} />
              <span>Record Settlement</span>
            </button>
          )}
        </div>
      </div>

      {/* 5 Summary KPI Cards in Simple English */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        {/* Waiting for approval */}
        <div className="crm-card" style={{ padding: 16, borderLeft: '4px solid var(--warning)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning-text)', textTransform: 'uppercase' }}>
            Waiting For Approval
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--warning-text)', marginTop: 4 }}>
            {collectionsSummary?.pendingApprovalCount || 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {formatINR(collectionsSummary?.pendingApprovalAmount || 0)} awaiting review
          </div>
        </div>

        {/* Approved collections */}
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Approved Collections
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
            {collectionsSummary?.approvedCount || 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Verified customer payments
          </div>
        </div>

        {/* Money collected by dealer */}
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Money Collected By Dealer
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
            {formatINR(collectionsSummary?.totalCollectedAmount || summary?.totalCollections || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Total cash received from borrowers
          </div>
        </div>

        {/* Money still to be submitted */}
        <div className="crm-card" style={{ padding: 16, borderLeft: '4px solid var(--danger, #ef4444)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger-text, #dc2626)', textTransform: 'uppercase' }}>
            Money Still To Be Submitted
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--danger-text, #dc2626)', marginTop: 4 }}>
            {formatINR(collectionsSummary?.unsettledAmount ?? summary?.outstandingSettlement ?? 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Pending handover to company
          </div>
        </div>

        {/* Money already submitted */}
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)', textTransform: 'uppercase' }}>
            Money Already Submitted
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
            {formatINR(collectionsSummary?.settledAmount ?? summary?.totalSettled ?? 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Reconciled remittance batches
          </div>
        </div>
      </div>

      {/* Subtab Navigation */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
        <button
          onClick={() => setActiveTab('collections')}
          className={`btn btn-sm ${activeTab === 'collections' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Receipt size={14} style={{ marginRight: 6 }} />
          <span>EMI Collections Ledger ({collectionsTotalCount})</span>
        </button>
        <button
          onClick={() => setActiveTab('batches')}
          className={`btn btn-sm ${activeTab === 'batches' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Banknote size={14} style={{ marginRight: 6 }} />
          <span>Remittance Batches & Reconciliation ({totalCount})</span>
        </button>
      </div>

      {/* TAB 1: COLLECTIONS LEDGER */}
      {activeTab === 'collections' && (
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
                value={approvalFilter}
                onChange={(e) => {
                  setApprovalFilter(e.target.value);
                  setPage(1);
                }}
                className="input-select"
                style={{ fontSize: 13 }}
              >
                <option value="ALL">All Approval Statuses</option>
                <option value="PENDING_VERIFICATION">Waiting For Approval</option>
                <option value="APPROVED">Approved / Success</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <div>
              <select
                value={settlementFilter}
                onChange={(e) => {
                  setSettlementFilter(e.target.value);
                  setPage(1);
                }}
                className="input-select"
                style={{ fontSize: 13 }}
              >
                <option value="ALL">All Settlement Statuses</option>
                <option value="UNSETTLED">Unsettled</option>
                <option value="PARTIALLY_SETTLED">Partially Settled</option>
                <option value="SETTLED">Settled</option>
              </select>
            </div>

            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 220 }}>
              <input
                type="text"
                placeholder="Search by collection ref, borrower, loan account..."
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

          {/* Collections Table */}
          <div className="table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Collection Ref</th>
                  <th>Partner Retail Store</th>
                  <th>Customer</th>
                  <th>Loan Reference</th>
                  <th>Amount</th>
                  <th>Collection Date</th>
                  <th>Approval Status</th>
                  <th>Approved By</th>
                  <th>Settlement Status</th>
                  <th>Still Left to Settle</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      Loading collections ledger...
                    </td>
                  </tr>
                ) : collections.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No dealer EMI collections found matching filters.
                    </td>
                  </tr>
                ) : (
                  collections.map((item) => {
                    const isPending = item.status === 'PENDING_VERIFICATION';
                    const isApproved = item.status === 'APPROVED' || item.status === 'SUCCESS';
                    const isRejected = item.status === 'REJECTED' || item.status === 'FAILED';
                    const isSettled = item.settlementStatus === 'SETTLED';
                    const isPartial = item.settlementStatus === 'PARTIALLY_SETTLED';

                    return (
                      <tr key={item.id}>
                        <td>
                          <span className="mono font-bold" style={{ color: 'var(--primary)' }}>
                            {item.receiptNumber || '—'}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{item.dealerStoreName}</div>
                          <span className="mono badge badge-primary" style={{ fontSize: 10 }}>
                            {item.dealerCode}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{item.customerName}</div>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {item.customerCode}
                          </span>
                        </td>
                        <td>
                          <span className="mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {item.loanAccountNo}
                          </span>
                        </td>
                        <td>
                          <span className="mono font-bold">{formatINR(item.amount)}</span>
                        </td>
                        <td>{formatDate(item.paymentTimestamp)}</td>
                        <td>
                          <span
                            className={`badge ${
                              isPending ? 'badge-warning' : isApproved ? 'badge-paid' : 'badge-danger'
                            }`}
                          >
                            {isPending ? 'Pending Approval' : isApproved ? 'Approved' : 'Rejected'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12 }}>{item.approvedByName || '—'}</span>
                          {item.approvedAt && (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              {formatDate(item.approvedAt)}
                            </div>
                          )}
                        </td>
                        <td>
                          {isPending || isRejected ? (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                          ) : (
                            <span
                              className={`badge ${
                                isSettled ? 'badge-paid' : isPartial ? 'badge-partial' : 'badge-warning'
                              }`}
                            >
                              {isSettled ? 'Settled' : isPartial ? 'Partially Settled' : 'Unsettled'}
                            </span>
                          )}
                        </td>
                        <td>
                          {isApproved ? (
                            <span
                              className="mono font-bold"
                              style={{
                                color: item.remainingUnsettled > 0 ? 'var(--warning-text)' : 'var(--text-secondary)',
                              }}
                            >
                              {formatINR(item.remainingUnsettled)}
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            {isPending && canManageSettlements && (
                              <>
                                <button
                                  onClick={() => handleApproveCollection(item.id)}
                                  disabled={processingCollectionId === item.id}
                                  className="btn btn-sm"
                                  style={{ background: 'var(--success)', color: '#fff', border: 'none' }}
                                  title="Approve and allocate customer EMI"
                                >
                                  <Check size={12} style={{ marginRight: 2 }} />
                                  <span>Approve</span>
                                </button>
                                <button
                                  onClick={() => handleRejectCollection(item.id)}
                                  disabled={processingCollectionId === item.id}
                                  className="btn btn-danger btn-sm"
                                  title="Reject collection"
                                >
                                  <XCircle size={12} style={{ marginRight: 2 }} />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}
                            {isApproved && item.remainingUnsettled > 0 && canManageSettlements && (
                              <button
                                onClick={() => handleOpenRecordModal(item.dealerId)}
                                className="btn btn-primary btn-sm"
                                title="Record remittance settlement for this store"
                              >
                                <span>Settle</span>
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
          {collectionsTotalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Page {page} of {collectionsTotalPages} ({collectionsTotalCount} collections)
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
                  disabled={page >= collectionsTotalPages}
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

      {/* TAB 2: SETTLEMENT BATCHES & RECONCILIATION */}
      {activeTab === 'batches' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Dealer Reconciliation Table */}
          <div className="crm-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Dealer Reconciliation Breakdown</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Real-time balance comparison of approved collections versus completed settlements for each partner store.
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
              {!isDealer && (
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
              )}

              <select
                className="form-input"
                style={{ width: 175 }}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING_APPROVAL">Pending Approval</option>
                <option value="COMPLETED">Completed</option>
                <option value="REJECTED">Rejected</option>
                <option value="REVERSED">Reversed</option>
              </select>

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
                    const isPending = settlement.status === SettlementStatus.PENDING_APPROVAL;
                    const isCompleted = settlement.status === SettlementStatus.COMPLETED;
                    const isRejected = settlement.status === SettlementStatus.REJECTED;
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
                              color: isReversed ? 'var(--text-muted)' : isPending ? 'var(--warning-text, #d97706)' : 'var(--success)',
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
                          {isPending ? (
                            <span className="badge badge-warning" style={{ background: 'rgba(245, 158, 11, 0.12)', color: 'var(--warning-text, #d97706)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                              Pending Approval
                            </span>
                          ) : isRejected ? (
                            <span className="badge badge-danger">Rejected</span>
                          ) : isCompleted ? (
                            <span className="badge badge-paid">Completed</span>
                          ) : (
                            <span className="badge badge-overdue">{settlement.status}</span>
                          )}
                        </td>
                        <td>
                          <span className="badge badge-secondary" style={{ fontSize: 11 }}>
                            {settlement.allocationsCount || 0} receipt(s)
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button
                              onClick={() => handleOpenDetail(settlement.id)}
                              className="btn btn-secondary btn-sm"
                              title="View Settlement Details"
                            >
                              <ExternalLink size={12} />
                              <span>View</span>
                            </button>
                            {canManageSettlements && isPending && (
                              <>
                                <button
                                  onClick={() => handleApproveSettlement(settlement.id)}
                                  disabled={approvingSettlementId === settlement.id}
                                  className="btn btn-success btn-sm"
                                  style={{ background: 'var(--success)', color: '#fff', border: 'none' }}
                                  title="Approve & Process Settlement"
                                >
                                  <Check size={12} />
                                  <span>{approvingSettlementId === settlement.id ? 'Approving...' : 'Approve'}</span>
                                </button>
                                <button
                                  onClick={() => handleOpenRejectModal(settlement)}
                                  className="btn btn-secondary btn-sm"
                                  style={{ color: 'var(--danger-text)' }}
                                  title="Reject Settlement Request"
                                >
                                  <XCircle size={12} />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}
                            {canManageSettlements && isCompleted && (
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
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Showing {settlements.length} of {totalCount} settlements
              </div>
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
          )}
        </div>
      )}

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
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="crm-card" style={{ width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Record Dealer Settlement</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Record a lump-sum funds handover from a partner retail store.
                </p>
              </div>
              <button
                onClick={() => setShowRecordModal(false)}
                className="btn btn-secondary btn-sm"
                style={{ border: 'none' }}
              >
                <X size={16} />
              </button>
            </div>

            {modalError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12, marginBottom: 12 }}>
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmitRecordSettlement} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Partner Retail Store *
                </label>
                <select
                  className="form-input"
                  style={{ width: '100%' }}
                  value={modalDealerId}
                  onChange={(e) => handleModalDealerChange(e.target.value)}
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
                <div style={{ background: 'var(--bg-surface-secondary)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Unsettled Collections Available:</span>
                    <span className="mono font-bold">{loadingUnsettled ? 'Loading...' : modalUnsettled.length} receipt(s)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Total Outstanding Remittance:</span>
                    <span className="mono font-bold" style={{ color: 'var(--primary)' }}>
                      {loadingUnsettled ? '...' : formatINR(totalAvailableForModal)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Settlement Amount (INR) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max={totalAvailableForModal > 0 ? totalAvailableForModal : undefined}
                  className="form-input"
                  style={{ width: '100%' }}
                  placeholder="Enter amount"
                  value={modalAmount}
                  onChange={(e) => setModalAmount(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Settlement Date *
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    style={{ width: '100%' }}
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Payment Method *
                  </label>
                  <select
                    className="form-input"
                    style={{ width: '100%' }}
                    value={modalPaymentMethod}
                    onChange={(e) => setModalPaymentMethod(e.target.value)}
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
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  UTR / Reference Number
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%' }}
                  placeholder="Optional bank transaction reference"
                  value={modalReference}
                  onChange={(e) => setModalReference(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Notes / Remarks
                </label>
                <textarea
                  className="form-input"
                  style={{ width: '100%', minHeight: 60 }}
                  placeholder="Optional settlement notes"
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
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
                  {submittingSettlement ? 'Recording...' : 'Confirm Settlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAIL DRAWER */}
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
        >
          <div
            className="crm-card"
            style={{
              width: '100%',
              maxWidth: 520,
              height: '100%',
              borderRadius: 0,
              padding: 20,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Settlement Details</h3>
                <span className="mono badge badge-terracotta" style={{ fontSize: 11 }}>
                  {settlementDetail?.settlementNumber || 'Loading...'}
                </span>
              </div>
              <button
                onClick={() => setSelectedSettlementId(null)}
                className="btn btn-secondary btn-sm"
                style={{ border: 'none' }}
              >
                <X size={16} />
              </button>
            </div>

            {loadingDetail ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                Loading details...
              </div>
            ) : settlementDetail ? (
              <>
                <div style={{ background: 'var(--bg-surface-secondary)', padding: 14, borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Store Partner</span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{settlementDetail.dealerStoreName}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Settlement Amount</span>
                    <span className="mono font-bold" style={{ fontSize: 14, color: 'var(--success)' }}>
                      {formatINR(settlementDetail.amount)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Date</span>
                    <span style={{ fontSize: 12 }}>{formatDate(settlementDetail.settlementDate)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Status</span>
                    <span className={`badge ${settlementDetail.status === 'COMPLETED' ? 'badge-paid' : 'badge-overdue'}`}>
                      {settlementDetail.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Recorded By</span>
                    <span style={{ fontSize: 12 }}>{settlementDetail.createdByName || 'System'}</span>
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Covered Customer Receipts</h4>
                  <div className="table-container">
                    <table className="crm-table">
                      <thead>
                        <tr>
                          <th>Receipt #</th>
                          <th>Borrower</th>
                          <th>Allocated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {settlementDetail.allocations?.map((alloc) => (
                          <tr key={alloc.id}>
                            <td className="mono">{alloc.receiptNumber || '—'}</td>
                            <td>{alloc.customerName}</td>
                            <td className="mono font-bold">{formatINR(alloc.amountAllocated)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* REVERSAL MODAL */}
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
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="crm-card" style={{ width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Reverse Settlement</h3>
              <button
                onClick={() => setReversingSettlement(null)}
                className="btn btn-secondary btn-sm"
                style={{ border: 'none' }}
              >
                <X size={16} />
              </button>
            </div>

            {reversalError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12, marginBottom: 12 }}>
                {reversalError}
              </div>
            )}

            <form onSubmit={handleSubmitReversal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Are you sure you want to reverse settlement <strong className="mono">{reversingSettlement.settlementNumber}</strong> ({formatINR(reversingSettlement.amount)})?
                This will restore covered customer collections back to the unsettled state.
              </p>

              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Reason for Reversal *
                </label>
                <textarea
                  className="form-input"
                  style={{ width: '100%', minHeight: 60 }}
                  placeholder="State the reason for reversing this settlement"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
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

      {/* REJECTION MODAL */}
      {rejectingSettlement && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="crm-card" style={{ width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Reject Settlement Request</h3>
              <button
                onClick={() => setRejectingSettlement(null)}
                className="btn btn-secondary btn-sm"
                style={{ border: 'none' }}
              >
                <X size={16} />
              </button>
            </div>

            {rejectError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12, marginBottom: 12 }}>
                {rejectError}
              </div>
            )}

            <form onSubmit={handleSubmitReject} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Are you sure you want to reject settlement request <strong className="mono">{rejectingSettlement.settlementNumber}</strong> ({formatINR(rejectingSettlement.amount)}) submitted by <strong>{rejectingSettlement.dealerStoreName}</strong>?
              </p>

              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Reason for Rejection *
                </label>
                <textarea
                  className="form-input"
                  style={{ width: '100%', minHeight: 60 }}
                  placeholder="State the reason for rejecting this settlement request"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setRejectingSettlement(null)}
                  className="btn btn-secondary"
                  disabled={submittingReject}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={submittingReject}
                >
                  {submittingReject ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
