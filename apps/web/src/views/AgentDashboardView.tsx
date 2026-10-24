import React, { useState, useEffect } from 'react';
import { ApiClient } from '../services/api';
import {
  IAgentQueueItem,
  formatINR,
  formatDateDDMMYYYY,
  PaymentMode,
  CollectionSource,
  IUser,
} from '@crm/shared';
import { RecordPaymentModal } from '../components/RecordPaymentModal';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Calendar,
  AlertTriangle,
  Clock,
  DollarSign,
  Phone,
  MessageCircle,
  Receipt,
  Search,
  RefreshCw,
  Eye,
  CheckCircle2,
  X,
  FileText,
  ShieldCheck,
} from 'lucide-react';

interface AgentDashboardStats {
  assignedCustomers: number;
  activeLoans: number;
  todayDue: number;
  todayDueCount?: number;
  todayCollected: number;
  todayCollectionCount?: number;
  todayPending?: number;
  todayPendingCount?: number;
  upcomingDues?: number;
  upcomingDueCount?: number;
  overdueCustomers?: number;
  overdueAmount: number;
  overdueEmisCount?: number;
  collectionPerformance?: number;
  recentCollections: any[];
}

interface AgentDashboardViewProps {
  onNavigateToTab?: (tab: string) => void;
}

export const AgentDashboardView: React.FC<AgentDashboardViewProps> = ({ onNavigateToTab }) => {
  const [currentUser] = useState<IUser | null>(ApiClient.getUser());
  const [stats, setStats] = useState<AgentDashboardStats | null>(null);
  const [queueItems, setQueueItems] = useState<IAgentQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Active View Tab: 'ASSIGNED_CUSTOMERS' | 'COLLECTIONS'
  const [activeTab, setActiveTab] = useState<'ASSIGNED_CUSTOMERS' | 'COLLECTIONS'>('ASSIGNED_CUSTOMERS');

  // Filter for obligations: 'ALL' | 'TODAY' | 'OVERDUE' | 'UPCOMING'
  const [dueFilter, setDueFilter] = useState<'ALL' | 'TODAY' | 'OVERDUE' | 'UPCOMING'>('ALL');

  // Filter for collections tab: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');

  // Search input
  const [search, setSearch] = useState('');

  // Payment Modal State
  const [selectedItemForPayment, setSelectedItemForPayment] = useState<IAgentQueueItem | null>(null);

  // EMI Details Modal State
  const [selectedItemForDetails, setSelectedItemForDetails] = useState<IAgentQueueItem | null>(null);
  const [loanDetails, setLoanDetails] = useState<any | null>(null);
  const [loadingLoanDetails, setLoadingLoanDetails] = useState(false);

  const loadDashboardData = async () => {
    try {
      const queueStatus = dueFilter === 'ALL' ? undefined : dueFilter;
      const [dashStats, qList] = await Promise.all([
        ApiClient.getAgentDashboard(),
        ApiClient.getAgentQueue(queueStatus, undefined, search || undefined),
      ]);
      setStats(dashStats);
      setQueueItems(qList);
    } catch (err: any) {
      console.error('Failed to load agent dashboard', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [dueFilter]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  // Open Detailed EMI Breakdown
  const handleOpenDetails = async (item: IAgentQueueItem) => {
    setSelectedItemForDetails(item);
    setLoanDetails(null);
    setLoadingLoanDetails(true);
    try {
      const details = await ApiClient.getLoanById(item.loanId);
      setLoanDetails(details);
    } catch (err: any) {
      console.error('Failed to load full loan details', err);
    } finally {
      setLoadingLoanDetails(false);
    }
  };

  // WhatsApp reminder message
  const handleSendWhatsApp = (item: IAgentQueueItem) => {
    const rawPhone = item.primaryPhone || item.customerPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const phoneWithCode = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const dueAmt = formatINR((item.remainingAmount || item.expectedAmount || 0) + (item.penaltyAmount || 0));
    const msg = `Namaste ${item.customerName}, this is an EMI collection reminder from Alpha Mobile Gallery / Shubh Pvt Ltd regarding your EMI payment of ${dueAmt} for Loan Account ${item.loanAccountNo} (Due: ${formatDateDDMMYYYY(item.dueDate)}). Please pay on time to avoid additional charges. Thank you.`;
    window.open(`https://wa.me/${phoneWithCode}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // Filter items based on local search query
  const filteredItems = queueItems.filter((item) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const phone = (item.primaryPhone || item.customerPhone || '').toLowerCase();
    const custCode = (item.customerCode || '').toLowerCase();
    const loanAcc = (item.loanAccountNo || '').toLowerCase();
    return (
      item.customerName.toLowerCase().includes(s) ||
      phone.includes(s) ||
      custCode.includes(s) ||
      loanAcc.includes(s)
    );
  });

  return (
    <div style={{ padding: '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Field Collection Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
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
            <LayoutDashboard size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              Collection Agent Dashboard (Recovery Agent Dashboard)
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Field collection targets, assigned customer obligations, and payment receipts
            </p>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
          <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
        </button>
      </div>

      {/* 4 Authoritative Summary Cards (Layout E) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        {/* 1. Today's Collections */}
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Today's Approved Collections
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--success-text)', marginTop: 4 }}>
                {stats ? formatINR(stats.todayCollected) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: 'var(--success-subtle)',
                color: 'var(--success-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <DollarSign size={18} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            <span>Approved: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{stats?.todayCollectionCount ?? 0}</strong> receipts</span>
            {Boolean(stats?.todayPending && stats.todayPending > 0) && (
              <span className="badge badge-warning" style={{ fontSize: 10, padding: '2px 6px', fontWeight: 700 }} title="Collections submitted and awaiting administrator approval">
                Pending: {formatINR(stats?.todayPending ?? 0)} ({stats?.todayPendingCount ?? 0})
              </span>
            )}
          </div>
        </div>

        {/* 2. EMIs Due Today */}
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                EMIs Due Today / Today's Due
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning-text)', marginTop: 4 }}>
                {stats ? formatINR(stats.todayDue) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: 'var(--warning-subtle)',
                color: 'var(--warning-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Obligations Due Today: <span className="mono" style={{ fontWeight: 700, color: 'var(--warning-text)' }}>{stats?.todayDueCount ?? 0}</span>
          </div>
        </div>

        {/* 3. Overdue EMIs */}
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Overdue EMIs / Overdue Portfolio
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger-text)', marginTop: 4 }}>
                {stats ? formatINR(stats.overdueAmount) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: 'var(--danger-subtle)',
                color: 'var(--danger-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangle size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Overdue Count: <span className="mono" style={{ fontWeight: 700, color: 'var(--danger-text)' }}>{stats?.overdueEmisCount ?? 0}</span> ({stats?.overdueCustomers ?? 0} borrowers)
          </div>
        </div>

        {/* 4. Assigned Customers */}
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Assigned Customers
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                {stats?.assignedCustomers ?? '—'}
              </div>
            </div>
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
              <Users size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Assigned Loans: <span className="mono" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{stats?.activeLoans ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setActiveTab('ASSIGNED_CUSTOMERS')}
            className={`crm-tab ${activeTab === 'ASSIGNED_CUSTOMERS' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
          >
            <Users size={15} />
            <span>Assigned Customers & Dues (Recovery Queue)</span>
            <span
              style={{
                background: activeTab === 'ASSIGNED_CUSTOMERS' ? 'var(--primary)' : 'var(--bg-surface-secondary)',
                color: activeTab === 'ASSIGNED_CUSTOMERS' ? '#ffffff' : 'var(--text-secondary)',
                borderRadius: 12,
                padding: '2px 7px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {filteredItems.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('COLLECTIONS')}
            className={`crm-tab ${activeTab === 'COLLECTIONS' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
          >
            <Receipt size={15} />
            <span>Today's Collections / Recent Collections</span>
            <span
              style={{
                background: activeTab === 'COLLECTIONS' ? 'var(--primary)' : 'var(--bg-surface-secondary)',
                color: activeTab === 'COLLECTIONS' ? '#ffffff' : 'var(--text-secondary)',
                borderRadius: 12,
                padding: '2px 7px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {stats?.recentCollections?.length ?? 0}
            </span>
          </button>
        </div>

        {/* Quick Search */}
        {activeTab === 'ASSIGNED_CUSTOMERS' && (
          <div style={{ position: 'relative', width: 280, maxWidth: '100%' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: 32, fontSize: 12, height: 34, width: '100%' }}
              placeholder="Search customer, phone, code, loan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Assigned Customers & Obligations View */}
      {activeTab === 'ASSIGNED_CUSTOMERS' && (
        <div>
          {/* Due Filter Pills */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Obligation Status:</span>
            {(
              [
                { id: 'ALL', label: 'All Assigned' },
                { id: 'TODAY', label: "Due Today" },
                { id: 'OVERDUE', label: 'Overdue EMIs' },
                { id: 'UPCOMING', label: 'Upcoming EMI Dues' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setDueFilter(f.id)}
                className={`btn btn-sm ${dueFilter === f.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Assigned Customers Table / Cards */}
          <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Customer & Contact</th>
                    <th>Assigned Loan Reference</th>
                    <th>Next EMI Due</th>
                    <th>EMI Amount Due</th>
                    <th>Collection Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                        Loading assigned customer obligations...
                      </td>
                    </tr>
                  ) : filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                        No assigned customers or EMI obligations found for this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const totalDue = (item.remainingAmount || item.expectedAmount || 0) + (item.penaltyAmount || 0);
                      const isOverdue = item.daysOverdue > 0;
                      const isDueToday = item.status === 'DUE_TODAY' || item.daysOverdue === 0;

                      return (
                        <tr key={item.installmentId}>
                          {/* Customer Name, Code, and Phone */}
                          <td>
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>
                                {item.customerName}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                {item.customerCode && (
                                  <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                                    {item.customerCode}
                                  </span>
                                )}
                                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {item.primaryPhone || item.customerPhone}
                                </span>
                              </div>
                              {item.areaRoute && (
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                  Route: {item.areaRoute}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Assigned Loan Reference */}
                          <td>
                            <div>
                              <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 12 }}>
                                {item.loanAccountNo}
                              </span>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                EMI #{item.installmentNumber} of {item.totalInstallments}
                              </div>
                              {item.totalOutstandingLoan > 0 && (
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                  Bal: <span className="mono">{formatINR(item.totalOutstandingLoan)}</span>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Next EMI Due Date */}
                          <td style={{ fontSize: 12, fontWeight: 600 }}>
                            {formatDateDDMMYYYY(item.dueDate)}
                          </td>

                          {/* EMI Amount Due */}
                          <td>
                            <div>
                              <div className="mono" style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 14 }}>
                                {formatINR(totalDue)}
                              </div>
                              {item.penaltyAmount > 0 && (
                                <div style={{ fontSize: 10, color: 'var(--danger-text)' }}>
                                  (Incl. {formatINR(item.penaltyAmount)} late fee)
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Payment / Collection Status */}
                          <td>
                            {isOverdue ? (
                              <span className="badge badge-danger" style={{ fontSize: 11 }}>
                                {item.daysOverdue} Days Overdue
                              </span>
                            ) : isDueToday ? (
                              <span className="badge badge-warning" style={{ fontSize: 11 }}>
                                Due Today
                              </span>
                            ) : (
                              <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                                Upcoming
                              </span>
                            )}
                            {item.overdueEmisCount && item.overdueEmisCount > 1 ? (
                              <div style={{ fontSize: 10, color: 'var(--danger-text)', marginTop: 3 }}>
                                {item.overdueEmisCount} Overdue EMIs
                              </div>
                            ) : null}
                          </td>

                          {/* Actions: View EMI Details & Collect Payment */}
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {/* Collect EMI or Pending Indicator */}
                              {item.hasPendingCollection ? (
                                <span
                                  className="badge badge-warning"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    padding: '5px 8px',
                                  }}
                                  title="A payment collection submission for this EMI is currently pending administrator approval"
                                >
                                  <Clock size={11} />
                                  <span>Pending Approval</span>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setSelectedItemForPayment(item)}
                                  className="btn btn-success btn-sm"
                                  title="Collect payment against this EMI obligation"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                                >
                                  <DollarSign size={12} />
                                  <span>Collect EMI</span>
                                </button>
                              )}

                              {/* View EMI Details */}
                              <button
                                onClick={() => handleOpenDetails(item)}
                                className="btn btn-secondary btn-sm"
                                title="View full EMI details, schedule, and collection history"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                              >
                                <Eye size={12} />
                                <span>Details</span>
                              </button>

                              {/* Call Customer */}
                              <a
                                href={`tel:${item.primaryPhone || item.customerPhone || ''}`}
                                className="btn btn-secondary btn-sm"
                                title="Call customer"
                                style={{ padding: '6px 8px' }}
                              >
                                <Phone size={12} />
                              </a>

                              {/* WhatsApp Reminder */}
                              <button
                                onClick={() => handleSendWhatsApp(item)}
                                className="btn btn-secondary btn-sm"
                                title="Send WhatsApp collection reminder"
                                style={{ padding: '6px 8px', color: '#25D366' }}
                              >
                                <MessageCircle size={12} />
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
        </div>
      )}

      {/* Today's Collections Tab */}
      {activeTab === 'COLLECTIONS' && (
        <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Status Filter Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              background: 'var(--bg-surface-secondary)',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginRight: 6 }}>
              Status Filter:
            </span>
            {[
              { id: 'ALL', label: 'All Collections', count: stats?.recentCollections?.length ?? 0 },
              {
                id: 'PENDING',
                label: 'Pending Approval',
                count: (stats?.recentCollections || []).filter(
                  (c: any) => c.status === 'PENDING_APPROVAL' || c.status === 'PENDING_VERIFICATION'
                ).length,
              },
              {
                id: 'APPROVED',
                label: 'Approved',
                count: (stats?.recentCollections || []).filter((c: any) => c.status === 'SUCCESS').length,
              },
              {
                id: 'REJECTED',
                label: 'Rejected',
                count: (stats?.recentCollections || []).filter((c: any) => c.status === 'REJECTED').length,
              },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setCollectionStatusFilter(f.id as any)}
                className={`btn btn-sm ${collectionStatusFilter === f.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span>{f.label}</span>
                <span
                  style={{
                    background: collectionStatusFilter === f.id ? 'rgba(255,255,255,0.2)' : 'var(--bg-surface)',
                    padding: '1px 6px',
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Customer</th>
                  <th>Loan Account</th>
                  <th>Amount Submitted</th>
                  <th>Payment Mode</th>
                  <th>Status</th>
                  <th>Submission Date</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filtered = (stats?.recentCollections || []).filter((col: any) => {
                    if (collectionStatusFilter === 'ALL') return true;
                    if (collectionStatusFilter === 'PENDING')
                      return col.status === 'PENDING_APPROVAL' || col.status === 'PENDING_VERIFICATION';
                    if (collectionStatusFilter === 'APPROVED') return col.status === 'SUCCESS';
                    if (collectionStatusFilter === 'REJECTED') return col.status === 'REJECTED';
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                          No collections found matching filter "{collectionStatusFilter}".
                        </td>
                      </tr>
                    );
                  }

                  return filtered.map((col: any) => {
                    const isPending =
                      col.status === 'PENDING_APPROVAL' || col.status === 'PENDING_VERIFICATION';
                    const isApproved = col.status === 'SUCCESS';
                    const isRejected = col.status === 'REJECTED';

                    return (
                      <tr key={col.id}>
                        <td>
                          <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                            {col.receipt_number || 'RECEIPT'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{col.customer_name}</td>
                        <td>
                          <span className="mono">{col.loan_account_no}</span>
                        </td>
                        <td
                          className="mono"
                          style={{
                            fontWeight: 700,
                            color: isApproved
                              ? 'var(--success-text)'
                              : isPending
                              ? 'var(--warning-text)'
                              : 'var(--text-muted)',
                          }}
                        >
                          {formatINR(Number(col.amount))}
                        </td>
                        <td>
                          <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                            {col.payment_mode}
                          </span>
                        </td>
                        <td>
                          {isPending && (
                            <span className="badge badge-warning" style={{ fontSize: 11, fontWeight: 700 }}>
                              Pending Approval
                            </span>
                          )}
                          {isApproved && (
                            <span className="badge badge-success" style={{ fontSize: 11, fontWeight: 700 }}>
                              Approved
                            </span>
                          )}
                          {isRejected && (
                            <div>
                              <span
                                className="badge badge-danger"
                                style={{ fontSize: 11, fontWeight: 700 }}
                                title={col.reversal_reason || 'Rejected by Admin'}
                              >
                                Rejected
                              </span>
                              {col.reversal_reason && (
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: 'var(--danger-text)',
                                    marginTop: 2,
                                    maxWidth: 180,
                                  }}
                                >
                                  {col.reversal_reason}
                                </div>
                              )}
                            </div>
                          )}
                          {!isPending && !isApproved && !isRejected && (
                            <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                              {col.status}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {new Date(col.payment_date).toLocaleString()}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EMI Details Modal (Requirement 4.B) */}
      {selectedItemForDetails && (
        <div className="modal-overlay" style={{ zIndex: 2200 }}>
          <div className="modal-content" style={{ maxWidth: 640, width: '100%', padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--primary-subtle)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FileText size={18} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
                    EMI Details — {selectedItemForDetails.customerName}
                  </h3>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Loan Account: <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>{selectedItemForDetails.loanAccountNo}</span>
                    {selectedItemForDetails.customerCode ? ` • Ref: ${selectedItemForDetails.customerCode}` : ''}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedItemForDetails(null)}
                className="btn btn-secondary btn-sm"
              >
                <X size={15} />
              </button>
            </div>

            {/* Obligation Breakdown Card */}
            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: 16,
                marginBottom: 18,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Installment #{selectedItemForDetails.installmentNumber} of {selectedItemForDetails.totalInstallments}
                </div>
                {selectedItemForDetails.daysOverdue > 0 ? (
                  <span className="badge badge-danger">
                    {selectedItemForDetails.daysOverdue} Days Overdue
                  </span>
                ) : (
                  <span className="badge badge-warning">
                    Due Date: {formatDateDDMMYYYY(selectedItemForDetails.dueDate)}
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>EMI Scheduled Amount:</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                    {formatINR(selectedItemForDetails.expectedAmount)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Amount Already Collected:</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--success-text)', marginTop: 2 }}>
                    {formatINR(selectedItemForDetails.paidAmount || 0)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Remaining EMI Due:</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--warning-text)', marginTop: 2 }}>
                    {formatINR(selectedItemForDetails.remainingAmount)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Late Payment Penalty:</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: selectedItemForDetails.penaltyAmount > 0 ? 'var(--danger-text)' : 'var(--text-muted)', marginTop: 2 }}>
                    {selectedItemForDetails.penaltyAmount > 0 ? formatINR(selectedItemForDetails.penaltyAmount) : '₹0'}
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 12, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Total Collection Amount:</span>
                <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
                  {formatINR((selectedItemForDetails.remainingAmount || selectedItemForDetails.expectedAmount) + (selectedItemForDetails.penaltyAmount || 0))}
                </span>
              </div>
            </div>

            {/* Authoritative Loan Amortization Schedule */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase' }}>
                Full Loan Amortization Schedule
              </div>
              {loadingLoanDetails ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
                  Loading loan schedule...
                </div>
              ) : loanDetails?.installments ? (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                  <table className="crm-table" style={{ fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Due Date</th>
                        <th>Expected</th>
                        <th>Paid</th>
                        <th>Remaining</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loanDetails.installments.map((inst: any) => (
                        <tr key={inst.id} style={{ background: inst.id === selectedItemForDetails.installmentId ? 'var(--primary-subtle)' : undefined }}>
                          <td className="mono" style={{ fontWeight: 700 }}>{inst.installmentNumber}</td>
                          <td>{formatDateDDMMYYYY(inst.dueDate)}</td>
                          <td className="mono">{formatINR(inst.expectedAmount)}</td>
                          <td className="mono" style={{ color: inst.paidAmount > 0 ? 'var(--success-text)' : undefined }}>
                            {formatINR(inst.paidAmount)}
                          </td>
                          <td className="mono" style={{ fontWeight: 600 }}>{formatINR(inst.remainingAmount)}</td>
                          <td>
                            <span
                              className={`badge ${
                                inst.status === 'PAID'
                                  ? 'badge-success'
                                  : inst.status === 'OVERDUE'
                                  ? 'badge-danger'
                                  : 'badge-neutral'
                              }`}
                              style={{ fontSize: 10 }}
                            >
                              {inst.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Schedule details available via standard collection API.
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setSelectedItemForDetails(null)}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const item = selectedItemForDetails;
                  setSelectedItemForDetails(null);
                  setSelectedItemForPayment(item);
                }}
                className="btn btn-success btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <DollarSign size={13} />
                <span>Collect This EMI</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal using approved collection workflow (Requirement 4.C) */}
      {selectedItemForPayment && (
        <RecordPaymentModal
          isOpen={!!selectedItemForPayment}
          onClose={() => setSelectedItemForPayment(null)}
          onSuccess={(_receipt) => {
            setSelectedItemForPayment(null);
            loadDashboardData();
          }}
          user={currentUser || ApiClient.getUser() || undefined}
          preselectedLoan={{
            id: selectedItemForPayment.loanId,
            loanAccountNo: selectedItemForPayment.loanAccountNo,
            customerId: selectedItemForPayment.customerId,
            customerName: selectedItemForPayment.customerName,
            customerCode: selectedItemForPayment.customerCode,
            outstandingBalance: selectedItemForPayment.totalOutstandingLoan,
            emiAmount: selectedItemForPayment.emiAmount,
            status: 'ACTIVE',
          }}
          preselectedInstallment={{
            id: selectedItemForPayment.installmentId,
            loanId: selectedItemForPayment.loanId,
            installmentNumber: selectedItemForPayment.installmentNumber,
            dueDate: selectedItemForPayment.dueDate,
            expectedAmount: selectedItemForPayment.expectedAmount,
            remainingAmount: selectedItemForPayment.remainingAmount,
            penaltyAmount: selectedItemForPayment.penaltyAmount,
            status: selectedItemForPayment.status,
          }}
        />
      )}
    </div>
  );
};
