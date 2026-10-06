import React, { useState, useEffect } from 'react';
import { ApiClient } from '../services/api';
import {
  IAgentQueueItem,
  formatINR,
  PaymentMode,
  CollectionSource,
  IUser,
} from '@crm/shared';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Calendar,
  AlertTriangle,
  Clock,
  TrendingUp,
  DollarSign,
  Phone,
  MessageCircle,
  Receipt,
  CheckCircle2,
  Filter,
  Search,
  ExternalLink,
  X,
  RefreshCw,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react';

interface AgentDashboardStats {
  assignedCustomers: number;
  activeLoans: number;
  todayDue: number;
  todayCollected: number;
  todayPending: number;
  upcomingDuesCount: number;
  upcomingDuesAmount: number;
  overdueCustomersCount: number;
  overdueAmount: number;
  collectionEfficiency: number;
  recentCollections: any[];
}

interface AgentDashboardViewProps {
  onNavigateToTab?: (tab: string) => void;
}

export const AgentDashboardView: React.FC<AgentDashboardViewProps> = ({ onNavigateToTab }) => {
  const [currentUser, setCurrentUser] = useState<IUser | null>(ApiClient.getUser());
  const [stats, setStats] = useState<AgentDashboardStats | null>(null);
  const [queueItems, setQueueItems] = useState<IAgentQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Active View Tab: 'UPCOMING' | 'RECOVERY' | 'RECENT'
  const [activeSubTab, setActiveSubTab] = useState<'UPCOMING' | 'RECOVERY' | 'RECENT'>('UPCOMING');

  // Upcoming Filter: 'TODAY' | 'TOMORROW' | 'NEXT_7_DAYS' | 'OVERDUE'
  const [upcomingFilter, setUpcomingFilter] = useState<'TODAY' | 'TOMORROW' | 'NEXT_7_DAYS' | 'OVERDUE'>('TODAY');

  // Search
  const [search, setSearch] = useState('');

  // Payment Modal State
  const [selectedItemForPayment, setSelectedItemForPayment] = useState<IAgentQueueItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [refNumber, setRefNumber] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Active Receipt Modal
  const [activeReceipt, setActiveReceipt] = useState<any | null>(null);

  const loadDashboardData = async () => {
    try {
      const [dashStats, qList] = await Promise.all([
        ApiClient.getAgentDashboard(),
        ApiClient.getAgentQueue(upcomingFilter, undefined, search || undefined),
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
  }, [upcomingFilter]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  // Open Payment Modal
  const handleOpenPayment = (item: IAgentQueueItem) => {
    setSelectedItemForPayment(item);
    const fullDue = (item.remainingAmount || item.expectedAmount || 0) + (item.penaltyAmount || 0);
    setPaymentAmount(fullDue);
    setPaymentMode(PaymentMode.CASH);
    setRefNumber('');
    setPaymentNotes('');
    setPaymentError(null);
  };

  // Submit Payment using existing payment engine
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForPayment) return;
    const user = currentUser || ApiClient.getUser();
    if (!user) {
      alert('User session not found. Please log in again.');
      return;
    }

    setSubmittingPayment(true);
    setPaymentError(null);
    try {
      const idempotencyKey = `AGT_${selectedItemForPayment.installmentId}_${Date.now()}`;
      const res = await ApiClient.recordPayment({
        loanId: selectedItemForPayment.loanId,
        emiId: selectedItemForPayment.installmentId,
        customerId: selectedItemForPayment.customerId,
        amount: Number(paymentAmount),
        paymentMode,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        agentId: user.id,
        referenceNumber: refNumber || undefined,
        notes: paymentNotes || undefined,
        idempotencyKey,
      });

      setSelectedItemForPayment(null);
      setActiveReceipt(res);
      loadDashboardData();
    } catch (err: any) {
      setPaymentError(err.message || 'Failed to record payment');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // WhatsApp reminder message
  const handleSendWhatsApp = (item: IAgentQueueItem) => {
    const rawPhone = item.primaryPhone || item.customerPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const phoneWithCode = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const dueAmt = formatINR((item.remainingAmount || item.expectedAmount || 0) + (item.penaltyAmount || 0));
    const msg = `Namaste ${item.customerName}, this is a gentle reminder from Alpha Mobile Gallery / Shubh Pvt Ltd regarding your EMI payment of ${dueAmt} for Loan Account ${item.loanAccountNo} (Due: ${new Date(item.dueDate).toLocaleDateString()}). Please make the payment promptly to avoid late fees. Thank you.`;
    window.open(`https://wa.me/${phoneWithCode}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const filteredItems = queueItems.filter((item) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const phone = (item.primaryPhone || item.customerPhone || '').toLowerCase();
    return (
      item.customerName.toLowerCase().includes(s) ||
      phone.includes(s) ||
      item.loanAccountNo.toLowerCase().includes(s)
    );
  });

  return (
    <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              <LayoutDashboard size={20} />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Recovery Agent Dashboard
              </h1>
              <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Field operations overview, assigned recovery targets, and collections
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
      </div>

      {/* KPI Stats Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Assigned Customers */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Assigned Customers
              </div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
                {stats?.assignedCustomers ?? '—'}
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
              <Users size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Active Loans: <span className="mono" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{stats?.activeLoans ?? 0}</span>
          </div>
        </div>

        {/* Today's Target / Due */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Today's Due
              </div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--warning-text)', marginTop: 6 }}>
                {stats ? formatINR(stats.todayDue) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 38,
                height: 38,
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
            Pending Today: <span className="mono" style={{ fontWeight: 700, color: 'var(--danger-text)' }}>{stats ? formatINR(stats.todayPending) : '—'}</span>
          </div>
        </div>

        {/* Today's Collection */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Today's Collection
              </div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--success-text)', marginTop: 6 }}>
                {stats ? formatINR(stats.todayCollected) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 38,
                height: 38,
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
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Efficiency: <span className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>{stats?.collectionEfficiency ?? 0}%</span>
          </div>
        </div>

        {/* Total Overdue */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Overdue Portfolio
              </div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--danger-text)', marginTop: 6 }}>
                {stats ? formatINR(stats.overdueAmount) : '—'}
              </div>
            </div>
            <div
              style={{
                width: 38,
                height: 38,
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
            Delinquent Accounts: <span className="mono" style={{ fontWeight: 700, color: 'var(--danger-text)' }}>{stats?.overdueCustomersCount ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Main Section Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setActiveSubTab('UPCOMING')}
            className={`crm-tab ${activeSubTab === 'UPCOMING' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
          >
            <Calendar size={15} />
            <span>Upcoming EMI Dues</span>
          </button>
          <button
            onClick={() => {
              setActiveSubTab('RECOVERY');
              setUpcomingFilter('OVERDUE');
            }}
            className={`crm-tab ${activeSubTab === 'RECOVERY' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
          >
            <AlertTriangle size={15} />
            <span>Recovery Queue</span>
          </button>
          <button
            onClick={() => setActiveSubTab('RECENT')}
            className={`crm-tab ${activeSubTab === 'RECENT' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
          >
            <Receipt size={15} />
            <span>Recent Collections</span>
          </button>
        </div>

        {/* Search Input */}
        {activeSubTab !== 'RECENT' && (
          <div style={{ position: 'relative', width: 280 }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: 32, fontSize: 12, height: 34 }}
              placeholder="Search customer, phone, loan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Sub-Filters for Upcoming Dues */}
      {activeSubTab === 'UPCOMING' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Due Period:</span>
          {(['TODAY', 'TOMORROW', 'NEXT_7_DAYS', 'OVERDUE'] as const).map((filterKey) => {
            const labels: Record<string, string> = {
              TODAY: "Today's Due",
              TOMORROW: 'Tomorrow',
              NEXT_7_DAYS: 'Next 7 Days',
              OVERDUE: 'All Overdue',
            };
            return (
              <button
                key={filterKey}
                onClick={() => setUpcomingFilter(filterKey)}
                className={`btn btn-sm ${upcomingFilter === filterKey ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11 }}
              >
                {labels[filterKey]}
              </button>
            );
          })}
        </div>
      )}

      {/* SECTION A & B: Due List / Recovery Queue Table */}
      {activeSubTab !== 'RECENT' ? (
        <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Loan & Installment</th>
                  <th>Due Date</th>
                  <th>EMI Amount</th>
                  <th>Late Penalty</th>
                  <th>Total Due</th>
                  <th>Overdue Status</th>
                  {activeSubTab === 'RECOVERY' && <th>Priority</th>}
                  {activeSubTab === 'RECOVERY' && <th>Last Payment</th>}
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      Loading recovery records...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No recovery items found for this filter.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const totalDue = (item.remainingAmount || item.expectedAmount || 0) + (item.penaltyAmount || 0);
                    const isOverdue = item.daysOverdue > 0;
                    const priorityColor =
                      item.priority === 'HIGH'
                        ? 'badge-danger'
                        : item.priority === 'MEDIUM'
                        ? 'badge-warning'
                        : 'badge-neutral';

                    return (
                      <tr key={item.installmentId}>
                        <td>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>
                              {item.customerName}
                            </div>
                            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              {item.primaryPhone || item.customerPhone}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div>
                            <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 12 }}>
                              {item.loanAccountNo}
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              EMI #{item.installmentNumber}
                              {item.overdueEmisCount && item.overdueEmisCount > 1 ? ` • ${item.overdueEmisCount} EMIs Overdue` : ''}
                            </div>
                            {item.assignedByName && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                Assigned by {item.assignedByName}
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {new Date(item.dueDate).toLocaleDateString()}
                        </td>
                        <td className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                          {formatINR(item.expectedAmount || item.remainingAmount || 0)}
                        </td>
                        <td className="mono" style={{ color: item.penaltyAmount > 0 ? 'var(--danger-text)' : 'var(--text-muted)', fontSize: 13 }}>
                          {item.penaltyAmount > 0 ? formatINR(item.penaltyAmount) : '—'}
                        </td>
                        <td className="mono" style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 14 }}>
                          {formatINR(totalDue)}
                        </td>
                        <td>
                          {isOverdue ? (
                            <span className="badge badge-danger" style={{ fontSize: 11 }}>
                              {item.daysOverdue} Days Overdue
                            </span>
                          ) : (
                            <span className="badge badge-warning" style={{ fontSize: 11 }}>
                              Due Today / Upcoming
                            </span>
                          )}
                        </td>
                        {activeSubTab === 'RECOVERY' && (
                          <td>
                            <span className={`badge ${priorityColor}`} style={{ fontSize: 11 }}>
                              {item.priority || 'NORMAL'}
                            </span>
                          </td>
                        )}
                        {activeSubTab === 'RECOVERY' && (
                          <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {item.lastPaymentDate ? (
                              <div>
                                <div>{new Date(item.lastPaymentDate).toLocaleDateString()}</div>
                                <div className="mono" style={{ fontWeight: 600 }}>{formatINR(item.lastPaymentAmount || 0)}</div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>No previous payment</span>
                            )}
                          </td>
                        )}
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {/* Record Payment */}
                            <button
                              onClick={() => handleOpenPayment(item)}
                              className="btn btn-success btn-sm"
                              title="Record payment collected in the field"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                            >
                              <DollarSign size={12} />
                              <span>Record Payment</span>
                            </button>

                            {/* Call */}
                            <a
                              href={`tel:${item.primaryPhone || item.customerPhone || ''}`}
                              className="btn btn-secondary btn-sm"
                              title="Call customer directly"
                              style={{ padding: '6px 8px' }}
                            >
                              <Phone size={12} />
                            </a>

                            {/* WhatsApp */}
                            <button
                              onClick={() => handleSendWhatsApp(item)}
                              className="btn btn-secondary btn-sm"
                              title="Send WhatsApp payment reminder"
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
      ) : (
        /* SECTION C: Recent Collections */
        <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Customer</th>
                  <th>Loan Account</th>
                  <th>Amount Collected</th>
                  <th>Payment Mode</th>
                  <th>Payment Date</th>
                </tr>
              </thead>
              <tbody>
                {stats?.recentCollections && stats.recentCollections.length > 0 ? (
                  stats.recentCollections.map((col: any) => (
                    <tr key={col.id}>
                      <td>
                        <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                          {col.receipt_number || 'RECEIPT'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{col.customer_name}</td>
                      <td><span className="mono">{col.loan_account_no}</span></td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                        {formatINR(Number(col.amount))}
                      </td>
                      <td>
                        <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                          {col.payment_mode}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {new Date(col.payment_date).toLocaleString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No recent collections recorded yet today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {selectedItemForPayment && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 440, width: '100%', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DollarSign size={20} color="var(--success)" />
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Record Field Collection</h3>
              </div>
              <button onClick={() => setSelectedItemForPayment(null)} className="btn btn-secondary btn-sm">
                <X size={15} />
              </button>
            </div>

            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                padding: 12,
                borderRadius: 'var(--radius-sm)',
                marginBottom: 16,
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div><strong>Customer:</strong> {selectedItemForPayment.customerName}</div>
              <div><strong>Loan Account:</strong> <span className="mono">{selectedItemForPayment.loanAccountNo}</span> (EMI #{selectedItemForPayment.installmentNumber})</div>
              <div><strong>Base EMI:</strong> {formatINR(selectedItemForPayment.emiAmount)}</div>
              {selectedItemForPayment.penaltyAmount > 0 && (
                <div style={{ color: 'var(--danger-text)' }}>
                  <strong>Late Penalty:</strong> {formatINR(selectedItemForPayment.penaltyAmount)}
                </div>
              )}
            </div>

            {paymentError && (
              <div
                style={{
                  background: 'var(--danger-subtle)',
                  color: 'var(--danger-text)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  marginBottom: 14,
                }}
              >
                {paymentError}
              </div>
            )}

            <form onSubmit={handleSubmitPayment} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Collected Amount (₹) <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="form-input mono"
                  style={{ fontSize: 16, fontWeight: 700 }}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Payment Mode
                </label>
                <select
                  className="form-select"
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                >
                  <option value={PaymentMode.CASH}>Cash (Field Handover)</option>
                  <option value={PaymentMode.UPI}>UPI (QR Code / Direct)</option>
                  <option value={PaymentMode.BANK_TRANSFER}>Bank Transfer</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Collection Source
                </label>
                <input
                  type="text"
                  className="form-input"
                  value="RECOVERY_AGENT (Field Collection)"
                  disabled
                  style={{ background: 'var(--bg-surface-secondary)', color: 'var(--text-secondary)' }}
                />
              </div>

              {paymentMode !== PaymentMode.CASH && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Reference / UTR Number
                  </label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder="e.g. UPI Ref / Txn ID"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Field Notes / Remarks (Optional)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Collected at customer residence"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setSelectedItemForPayment(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={submittingPayment} className="btn btn-success">
                  {submittingPayment ? 'Processing Waterfall...' : 'Settle & Generate Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Receipt Result Popup */}
      {activeReceipt && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 440, padding: 24, textAlign: 'center' }}>
            <CheckCircle2 size={40} color="var(--success)" style={{ margin: '0 auto 8px' }} />
            <h3 style={{ fontSize: 18, fontWeight: 800 }}>PAYMENT COLLECTED</h3>
            <div className="mono" style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 14, marginTop: 4 }}>
              {activeReceipt.receiptNumber}
            </div>

            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                padding: 14,
                borderRadius: 'var(--radius-sm)',
                margin: '16px 0',
                fontSize: 13,
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div>Alpha Mobile Gallery / Shubh Pvt Ltd</div>
              <div>Loan Acc: <span className="mono">{activeReceipt.loanAccountNo}</span></div>
              <div style={{ fontWeight: 700, color: 'var(--success-text)', fontSize: 15 }}>
                Amount: {formatINR(activeReceipt.amountCollected)}
              </div>
              <div>Source: <span className="badge badge-neutral">RECOVERY_AGENT</span></div>
              <div>
                Remaining Balance: <span className="mono">{formatINR(activeReceipt.remainingLoanOutstanding)}</span>
              </div>
            </div>

            <button onClick={() => setActiveReceipt(null)} className="btn btn-primary" style={{ width: '100%' }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
