import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import {
  IFinanceDashboardStats,
  IPaymentDetail,
  IUser,
  UserRole,
  formatINR,
  formatDisplayDate,
  CollectionSource,
} from '@crm/shared';
import {
  TrendingUp,
  AlertCircle,
  Clock,
  CheckCircle2,
  Users,
  Banknote,
  ArrowUpRight,
  RefreshCw,
  Calendar,
  CreditCard,
  Building2,
  Store,
  UserCheck,
  Percent,
  Receipt,
  FileText,
  Eye,
  Printer,
  X,
  Layers,
  ArrowDownRight,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

interface DashboardViewProps {
  onOpenAddCustomer?: () => void;
  onNavigateToTab?: (tab: string) => void;
  user?: IUser;
}

/** Roles permitted to view the executive finance dashboard */
const DASHBOARD_ALLOWED_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.BRANCH_MANAGER,
] as const;

export const DashboardView: React.FC<DashboardViewProps> = ({
  onOpenAddCustomer,
  onNavigateToTab,
  user: userProp,
}) => {
  const [stats, setStats] = useState<IFinanceDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<string>('this-month');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [paymentDetail, setPaymentDetail] = useState<IPaymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [receiptData, setReceiptData] = useState<any | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  // Pending Approvals Alert State
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(0);

  // Dealer-Wise Financing Analytics State
  const [dealersList, setDealersList] = useState<any[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>('');
  const [dealerAnalyticsPreset, setDealerAnalyticsPreset] = useState<string>('this-month');
  const [dealerStartDate, setDealerStartDate] = useState<string>('');
  const [dealerEndDate, setDealerEndDate] = useState<string>('');
  const [dealerAnalytics, setDealerAnalytics] = useState<any | null>(null);
  const [loadingDealerAnalytics, setLoadingDealerAnalytics] = useState<boolean>(false);

  const fetchDealerAnalytics = async (
    targetDealerId = selectedDealerId,
    targetPreset = dealerAnalyticsPreset,
    start = dealerStartDate,
    end = dealerEndDate
  ) => {
    setLoadingDealerAnalytics(true);
    try {
      const res = await ApiClient.getDealerFinancingAnalytics({
        dealerId: targetDealerId || undefined,
        preset: targetPreset,
        startDate: targetPreset === 'custom' ? start : undefined,
        endDate: targetPreset === 'custom' ? end : undefined,
      });
      setDealerAnalytics(res);
    } catch (err) {
      console.error('Failed to load dealer financing analytics', err);
    } finally {
      setLoadingDealerAnalytics(false);
    }
  };

  const fetchDashboardData = async (
    targetPreset = preset,
    start = customStartDate,
    end = customEndDate
  ) => {
    // Guard: only SUPER_ADMIN, ADMIN, BRANCH_MANAGER may call the finance dashboard endpoint.
    // COLLECTION_AGENT and DEALER are not authorized; skip the request to avoid a guaranteed 403.
    const effectiveUser = userProp ?? ApiClient.getUser();
    if (
      effectiveUser &&
      !DASHBOARD_ALLOWED_ROLES.includes(effectiveUser.role as typeof DASHBOARD_ALLOWED_ROLES[number])
    ) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await ApiClient.getFinanceDashboard({
        preset: targetPreset,
        startDate: targetPreset === 'custom' ? start : undefined,
        endDate: targetPreset === 'custom' ? end : undefined,
      });
      setStats(data);
    } catch (err) {
      console.error('Failed to load executive finance dashboard metrics', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData(preset);

    // Load pending approvals count for alert banner
    ApiClient.getPendingApprovals()
      .then((data) => setPendingApprovalsCount(Array.isArray(data) ? data.length : 0))
      .catch(() => setPendingApprovalsCount(0));

    // Load active dealers for analytics dropdown
    ApiClient.getDealers(undefined, 'ACTIVE')
      .then((data) => setDealersList(Array.isArray(data) ? data : []))
      .catch(() => setDealersList([]));

    fetchDealerAnalytics(selectedDealerId, dealerAnalyticsPreset);
  }, [preset]);

  const handlePresetChange = (newPreset: string) => {
    setPreset(newPreset);
    if (newPreset !== 'custom') {
      fetchDashboardData(newPreset);
    }
  };

  const handleCustomApply = () => {
    if (customStartDate && customEndDate) {
      fetchDashboardData('custom', customStartDate, customEndDate);
    }
  };

  const openPaymentDetail = async (paymentId: string) => {
    setSelectedPaymentId(paymentId);
    setDetailLoading(true);
    try {
      const data = await ApiClient.getPaymentDetail(paymentId);
      setPaymentDetail(data);
    } catch (err) {
      console.error('Failed to fetch payment detail', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const openReceiptModal = async (paymentId: string) => {
    setReceiptLoading(true);
    try {
      const res = await ApiClient.getReceipt(paymentId);
      setReceiptData(res?.receipt || res);
    } catch (err) {
      console.error('Failed to load payment receipt', err);
    } finally {
      setReceiptLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const businessDateFormatted = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (loading && !stats) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ height: 40, width: '40%' }} className="skeleton" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} style={{ height: 110 }} className="skeleton" />
          ))}
        </div>
        <div style={{ height: 260 }} className="skeleton" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. Header & Context */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
              Executive Finance & Operations Command
            </h2>
            <span className="badge badge-terracotta">LIVE PORTFOLIO</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Business Date: <strong>{businessDateFormatted}</strong> • Asia/Kolkata timezone • Reconciled
            with core loan & payment ledgers
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={() => fetchDashboardData()} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          {onOpenAddCustomer && (
            <button onClick={onOpenAddCustomer} className="btn btn-primary btn-sm">
              <span>+ New Customer</span>
            </button>
          )}
        </div>
      </div>

      {/* Pending Approvals Alert Banner */}
      {pendingApprovalsCount > 0 && (
        <div
          style={{
            padding: '12px 18px',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid var(--warning)',
            borderRadius: 'var(--radius-md, 8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={20} color="var(--warning-text, #b45309)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning-text, #92400e)' }}>
              Action Required: {pendingApprovalsCount} dealer-originated loan{pendingApprovalsCount > 1 ? 's are' : ' is'} pending Super Admin approval.
            </span>
          </div>
          <button
            onClick={() => onNavigateToTab?.('loans')}
            className="btn btn-sm"
            style={{ background: 'var(--warning, #f59e0b)', color: '#fff', border: 'none', fontWeight: 700 }}
          >
            Review Approval Queue →
          </button>
        </div>
      )}

      {/* 2. Global Date Filter Bar */}
      <div
        className="crm-card"
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginRight: 6 }}>
            PERIOD:
          </span>
          {[
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'this-week', label: 'This Week' },
            { id: 'this-month', label: 'This Month' },
            { id: 'last-month', label: 'Last Month' },
            { id: 'this-quarter', label: 'This Quarter' },
            { id: 'this-year', label: 'This Year' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom Range' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => handlePresetChange(item.id)}
              className={`btn btn-xs ${preset === item.id ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="date"
              className="form-input"
              style={{ padding: '4px 8px', fontSize: 12, width: 140 }}
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
            <input
              type="date"
              className="form-input"
              style={{ padding: '4px 8px', fontSize: 12, width: 140 }}
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
            />
            <button onClick={handleCustomApply} className="btn btn-primary btn-xs">
              Apply
            </button>
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Active Window:{' '}
          <strong style={{ color: 'var(--text-primary)' }}>
            {stats.period.startDate} to {stats.period.endDate}
          </strong>
        </div>
      </div>

      {/* 3. Top 6 KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
        }}
      >
        {/* KPI 1: Total Disbursed */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Total Disbursed
            </span>
            <Banknote size={16} color="var(--primary)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
            {formatINR(stats.topKpis.totalDisbursed)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {stats.topKpis.disbursedLoanCount} Loans Financed
          </div>
        </div>

        {/* KPI 2: Active Portfolio */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Active Portfolio
            </span>
            <Layers size={16} color="var(--primary)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
            {formatINR(stats.topKpis.activePortfolio)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Across {stats.topKpis.activeLoanCount} Active Loans
          </div>
        </div>

        {/* KPI 3: Total Collections */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Total Collections
            </span>
            <CheckCircle2 size={16} color="var(--success)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--success-text)', marginTop: 6 }}>
            {formatINR(stats.topKpis.totalCollections)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4, fontWeight: 600 }}>
            {stats.topKpis.collectionCount} Transactions
          </div>
        </div>

        {/* KPI 4: Overdue / Outstanding */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Total Overdue
            </span>
            <AlertCircle size={16} color="var(--danger)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger)', marginTop: 6 }}>
            {formatINR(stats.topKpis.totalOverdueAmount)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
            {stats.topKpis.overdueLoanCount} Overdue Loans ({stats.topKpis.overdueCustomerCount} Cust.)
          </div>
        </div>

        {/* KPI 5: Collection Efficiency */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Collection Efficiency
            </span>
            <Percent size={16} color="var(--warning)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning-text)', marginTop: 6 }}>
            {stats.topKpis.collectionEfficiencyPercent}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Due in Window: {formatINR(stats.topKpis.totalDueAmount)}
          </div>
        </div>

        {/* KPI 6: Active Loans */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Active Borrowers
            </span>
            <Users size={16} color="var(--primary)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
            {stats.portfolioSummary.totalCustomers}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {stats.topKpis.activeLoanCount} Active Accounts
          </div>
        </div>
      </div>

      {/* 4. Collection Source Performance Breakdown */}
      <div className="crm-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 800 }}>Collection Channel Breakdown</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Channel distribution across Direct Customer, Partner Store Dealers, and Field Recovery Agents
            </p>
          </div>
          <button
            onClick={() => onNavigateToTab && onNavigateToTab('payments')}
            className="btn btn-secondary btn-xs"
          >
            <span>View Full Ledger</span>
            <ChevronRight size={12} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {/* Direct Customer */}
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={16} color="var(--primary)" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Direct Customer</span>
              </div>
              <span className="badge badge-primary">{stats.sourceBreakdown.directCustomer.sharePercent}%</span>
            </div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>
              {formatINR(stats.sourceBreakdown.directCustomer.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.sourceBreakdown.directCustomer.count} Transactions
            </div>
          </div>

          {/* Dealer */}
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Store size={16} color="var(--warning)" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Dealer / Store</span>
              </div>
              <span className="badge badge-warning">{stats.sourceBreakdown.dealer.sharePercent}%</span>
            </div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>
              {formatINR(stats.sourceBreakdown.dealer.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.sourceBreakdown.dealer.count} Transactions
            </div>
          </div>

          {/* Recovery Agent */}
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <UserCheck size={16} color="var(--success)" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Recovery Agent</span>
              </div>
              <span className="badge badge-success">{stats.sourceBreakdown.recoveryAgent.sharePercent}%</span>
            </div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>
              {formatINR(stats.sourceBreakdown.recoveryAgent.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.sourceBreakdown.recoveryAgent.count} Transactions
            </div>
          </div>
        </div>
      </div>

      {/* 5. Portfolio Health & PAR Aging Buckets */}
      <div className="crm-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 800 }}>Credit Risk & Portfolio-at-Risk (PAR) Aging</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Active loan balance and overdue exposure segmented by Days Past Due (DPD) buckets
            </p>
          </div>
          <button
            onClick={() => onNavigateToTab && onNavigateToTab('reports')}
            className="btn btn-secondary btn-xs"
          >
            <span>PAR Report</span>
            <ChevronRight size={12} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {/* Current (0 DPD) */}
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>CURRENT (0 DPD)</span>
              <span className="badge badge-success">HEALTHY</span>
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--success-text)', marginTop: 6 }}>
              {formatINR(stats.agingBuckets.current.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.agingBuckets.current.count} Installments
            </div>
          </div>

          {/* 1-30 DPD */}
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>1–30 DPD</span>
              <span className="badge badge-warning">WATCH</span>
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--warning-text)', marginTop: 6 }}>
              {formatINR(stats.agingBuckets.dpd1To30.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.agingBuckets.dpd1To30.count} Overdue
            </div>
          </div>

          {/* 31-60 DPD */}
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>31–60 DPD</span>
              <span className="badge badge-danger">DELINQUENT</span>
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--danger)', marginTop: 6 }}>
              {formatINR(stats.agingBuckets.dpd31To60.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.agingBuckets.dpd31To60.count} Overdue
            </div>
          </div>

          {/* 61-90 DPD */}
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>61–90 DPD</span>
              <span className="badge badge-danger">HIGH RISK</span>
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--danger)', marginTop: 6 }}>
              {formatINR(stats.agingBuckets.dpd61To90.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.agingBuckets.dpd61To90.count} Overdue
            </div>
          </div>

          {/* 90+ DPD */}
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>90+ DPD (NPA)</span>
              <span className="badge badge-danger">DEFAULT</span>
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--danger)', marginTop: 6 }}>
              {formatINR(stats.agingBuckets.dpd90Plus.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.agingBuckets.dpd90Plus.count} Overdue
            </div>
          </div>
        </div>
      </div>

      {/* 5.5 Dealer-Wise Financing Analytics (Requirements 23, 24, 25) */}
      <div className="crm-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Building2 size={18} color="var(--primary)" />
              <h3 style={{ fontSize: 16, fontWeight: 800 }}>Partner Store Financing Analytics</h3>
              <span className="badge badge-terracotta">CORE FINANCING</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Aggregated loan origination, financed principal (Retail Price − Down Payment), down payments, and recovery performance per dealer.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Dealer Selector */}
            <select
              className="form-select"
              style={{ fontSize: 13, minWidth: 200 }}
              value={selectedDealerId}
              onChange={(e) => {
                setSelectedDealerId(e.target.value);
                fetchDealerAnalytics(e.target.value, dealerAnalyticsPreset);
              }}
            >
              <option value="">All Partner Stores ({dealersList.length})</option>
              {dealersList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.storeName} ({d.dealerCode})
                </option>
              ))}
            </select>

            {/* Date Preset Buttons */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'today', label: 'Today' },
                { id: 'this-month', label: 'This Month' },
                { id: 'this-year', label: 'This Year' },
                { id: 'all', label: 'All Time' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setDealerAnalyticsPreset(p.id);
                    fetchDealerAnalytics(selectedDealerId, p.id);
                  }}
                  className={`btn btn-xs ${dealerAnalyticsPreset === p.id ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => fetchDealerAnalytics(selectedDealerId, dealerAnalyticsPreset)}
              className="btn btn-secondary btn-xs"
              title="Refresh dealer financing statistics"
            >
              <RefreshCw size={12} className={loadingDealerAnalytics ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Aggregated KPI Cards */}
        {dealerAnalytics?.summary && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>TOTAL FINANCED PRINCIPAL</div>
              <div className="mono font-bold" style={{ fontSize: 18, color: 'var(--primary)', marginTop: 4 }}>
                {formatINR(dealerAnalytics.summary.totalFinancedPrincipal)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Retail Price − Down Payment</div>
            </div>

            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>DOWN PAYMENTS</div>
              <div className="mono font-bold" style={{ fontSize: 18, marginTop: 4 }}>
                {formatINR(dealerAnalytics.summary.totalDownPayment)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Collected at store</div>
            </div>

            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>TOTAL COLLECTED</div>
              <div className="mono font-bold" style={{ fontSize: 18, color: 'var(--success-text)', marginTop: 4 }}>
                {formatINR(dealerAnalytics.summary.totalAmountCollected)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Repayments recovered</div>
            </div>

            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>TOTAL OUTSTANDING</div>
              <div className="mono font-bold" style={{ fontSize: 18, marginTop: 4 }}>
                {formatINR(dealerAnalytics.summary.totalOutstanding)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Remaining balance</div>
            </div>

            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>TOTAL OVERDUE</div>
              <div className="mono font-bold" style={{ fontSize: 18, color: dealerAnalytics.summary.totalOverdue > 0 ? 'var(--danger-text)' : 'var(--text-primary)', marginTop: 4 }}>
                {formatINR(dealerAnalytics.summary.totalOverdue)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Overdue installments</div>
            </div>

            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>VOLUME METRICS</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
                {dealerAnalytics.summary.totalCustomers} Borrowers • {dealerAnalytics.summary.totalPhonesFinanced} Phones
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {dealerAnalytics.summary.activeLoans} Active • {dealerAnalytics.summary.overdueLoans} Overdue
              </div>
            </div>
          </div>
        )}

        {/* Dealer Breakdown Table */}
        <div className="crm-table-container">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Partner Store</th>
                <th>Customers</th>
                <th>Loans / Phones</th>
                <th>Financed Principal</th>
                <th>Down Payment</th>
                <th>Collected</th>
                <th>Outstanding</th>
                <th>Overdue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loadingDealerAnalytics ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                    Loading partner financing metrics...
                  </td>
                </tr>
              ) : !dealerAnalytics?.dealers || dealerAnalytics.dealers.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No dealer financing records found for the selected period.
                  </td>
                </tr>
              ) : (
                dealerAnalytics.dealers.map((dealer: any) => (
                  <tr
                    key={dealer.dealerId}
                    style={selectedDealerId === dealer.dealerId ? { background: 'rgba(234, 88, 12, 0.05)' } : {}}
                  >
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{dealer.storeName}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {dealer.dealerCode} • {dealer.contactPerson} ({dealer.phone})
                      </div>
                    </td>
                    <td className="mono">{dealer.totalCustomers}</td>
                    <td className="mono">{dealer.totalLoans}</td>
                    <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                      {formatINR(dealer.totalFinancedPrincipal)}
                    </td>
                    <td className="mono">{formatINR(dealer.totalDownPayment)}</td>
                    <td className="mono font-semibold" style={{ color: 'var(--success-text)' }}>
                      {formatINR(dealer.totalCollected)}
                    </td>
                    <td className="mono">{formatINR(dealer.totalOutstanding)}</td>
                    <td className="mono" style={{ color: dealer.totalOverdue > 0 ? 'var(--danger-text)' : 'inherit', fontWeight: dealer.totalOverdue > 0 ? 700 : 400 }}>
                      {formatINR(dealer.totalOverdue)}
                    </td>
                    <td>
                      <span className={`badge ${dealer.status === 'ACTIVE' ? 'badge-paid' : 'badge-warning'}`}>
                        {dealer.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. Dealer Reconciliation Summary & Table */}
      <div className="crm-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 800 }}>Partner Store / Dealer Settlement Reconciliation</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Tracking customer collections at partner stores vs. completed remittances to Finance Company
            </p>
          </div>
          <button
            onClick={() => onNavigateToTab && onNavigateToTab('dealer-settlements')}
            className="btn btn-secondary btn-xs"
          >
            <span>Settlements View</span>
            <ChevronRight size={12} />
          </button>
        </div>

        {/* Reconcile Metrics */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>TOTAL COLLECTED BY DEALERS</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
              {formatINR(stats.dealerReconciliation.totalCollectedThroughDealers)}
            </div>
          </div>
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>COMPLETED SETTLEMENTS</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--success-text)', marginTop: 4 }}>
              {formatINR(stats.dealerReconciliation.totalDealerSettled)}
            </div>
          </div>
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>OUTSTANDING REMITTANCE</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: stats.dealerReconciliation.outstandingDealerRemittance > 0 ? 'var(--warning-text)' : 'var(--text-primary)', marginTop: 4 }}>
              {formatINR(stats.dealerReconciliation.outstandingDealerRemittance)}
            </div>
          </div>
          <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>UNSETTLED DEALERS</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
              {stats.dealerReconciliation.unsettledDealersCount} Stores
            </div>
          </div>
        </div>

        {/* Dealer Table */}
        <div className="crm-table-container">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Partner Store</th>
                <th>Code</th>
                <th>Collections</th>
                <th>Settled</th>
                <th>Outstanding</th>
                <th>Txns</th>
                <th>Last Settlement</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stats.dealerReconciliation.dealers.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                    No partner store records found.
                  </td>
                </tr>
              ) : (
                stats.dealerReconciliation.dealers.map((d) => (
                  <tr key={d.dealerId}>
                    <td>
                      <button
                        onClick={() => onNavigateToTab && onNavigateToTab('dealers')}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontWeight: 700,
                          color: 'var(--primary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {d.storeName}
                      </button>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{d.dealerCode}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{formatINR(d.customerCollections)}</td>
                    <td className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(d.settled)}</td>
                    <td className="mono" style={{ fontWeight: 700, color: d.outstanding > 0 ? 'var(--warning-text)' : 'var(--text-muted)' }}>
                      {formatINR(d.outstanding)}
                    </td>
                    <td>{d.collectionCount}</td>
                    <td style={{ fontSize: 12 }}>{d.lastSettlementDate ? formatDisplayDate(d.lastSettlementDate) : 'Never'}</td>
                    <td>
                      <span className={`badge ${d.status === 'ACTIVE' ? 'badge-success' : 'badge-secondary'}`}>
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. Recovery Agent & Direct Channel Performance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {/* Recovery Agent Table */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800 }}>Recovery Agent Performance</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Field collection metrics and agent productivity
              </p>
            </div>
            <button
              onClick={() => onNavigateToTab && onNavigateToTab('agent-collections')}
              className="btn btn-secondary btn-xs"
            >
              <span>Agent Ledger</span>
              <ChevronRight size={12} />
            </button>
          </div>

          <div className="crm-table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Lifetime</th>
                  <th>Txns</th>
                  <th>Today</th>
                  <th>This Month</th>
                </tr>
              </thead>
              <tbody>
                {stats.recoveryAgentSummary.agents.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 14, color: 'var(--text-muted)' }}>
                      No collection agents found.
                    </td>
                  </tr>
                ) : (
                  stats.recoveryAgentSummary.agents.map((ag) => (
                    <tr key={ag.agentId}>
                      <td style={{ fontWeight: 600 }}>{ag.agentName}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{formatINR(ag.collections)}</td>
                      <td>{ag.paymentCount}</td>
                      <td className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(ag.todayCollections)}</td>
                      <td className="mono">{formatINR(ag.monthCollections)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Direct Channel Summary */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800 }}>Direct Customer Channel</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Direct online and bank remittance collections
              </p>
            </div>
            <button
              onClick={() => onNavigateToTab && onNavigateToTab('direct-collections')}
              className="btn btn-secondary btn-xs"
            >
              <span>Direct Ledger</span>
              <ChevronRight size={12} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>TOTAL DIRECT</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                {formatINR(stats.directCustomerSummary.totalDirectCollections)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {stats.directCustomerSummary.paymentCount} Payments
              </div>
            </div>

            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>AVERAGE TICKET</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
                {formatINR(stats.directCustomerSummary.averagePayment)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Per direct payment
              </div>
            </div>

            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>TODAY'S DIRECT</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--success-text)', marginTop: 4 }}>
                {formatINR(stats.directCustomerSummary.todayCollections)}
              </div>
            </div>

            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>THIS MONTH DIRECT</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                {formatINR(stats.directCustomerSummary.monthCollections)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 8. Operational Quick-Stats */}
      <div
        className="crm-card"
        style={{
          padding: '14px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
        }}
      >
        <div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>AVERAGE LOAN TICKET</span>
          <div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
            {formatINR(stats.operationalMetrics.averageLoanAmount)}
          </div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>AVERAGE EMI AMOUNT</span>
          <div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
            {formatINR(stats.operationalMetrics.averageEmiAmount)}
          </div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>AVERAGE PAYMENT TICKET</span>
          <div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
            {formatINR(stats.operationalMetrics.averagePaymentAmount)}
          </div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>ACTIVE PARTNER STORES</span>
          <div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
            {stats.operationalMetrics.activeDealersCount}
          </div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>ACTIVE RECOVERY AGENTS</span>
          <div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
            {stats.operationalMetrics.activeAgentsCount}
          </div>
        </div>
      </div>

      {/* 9. Recent Collections & Settlements Feeds */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {/* Recent Collections */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800 }}>Recent Customer Collections</h3>
            <button
              onClick={() => onNavigateToTab && onNavigateToTab('payments')}
              className="btn btn-secondary btn-xs"
            >
              <span>View All</span>
              <ChevronRight size={12} />
            </button>
          </div>

          <div className="crm-table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Source</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentCollections.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 14, color: 'var(--text-muted)' }}>
                      No payments recorded yet.
                    </td>
                  </tr>
                ) : (
                  stats.recentCollections.map((p) => (
                    <tr key={p.id}>
                      <td className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{p.receiptNumber}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.customerName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.loanAccountNo}</div>
                      </td>
                      <td className="mono" style={{ fontWeight: 700, color: p.isReversal ? 'var(--danger)' : 'var(--success-text)' }}>
                        {formatINR(p.amount)}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            p.collectionSource === CollectionSource.DIRECT_CUSTOMER
                              ? 'badge-primary'
                              : p.collectionSource === CollectionSource.DEALER
                              ? 'badge-warning'
                              : 'badge-success'
                          }`}
                          style={{ fontSize: 10 }}
                        >
                          {p.collectionSource === CollectionSource.DIRECT_CUSTOMER
                            ? 'Direct'
                            : p.collectionSource === CollectionSource.DEALER
                            ? 'Dealer'
                            : 'Agent'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => openPaymentDetail(p.id)}
                            className="btn btn-secondary btn-xs"
                            title="View Details"
                          >
                            <Eye size={12} />
                          </button>
                          <button
                            onClick={() => openReceiptModal(p.id)}
                            className="btn btn-secondary btn-xs"
                            title="Print Receipt"
                          >
                            <Receipt size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Dealer Settlements */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800 }}>Recent Dealer Remittances</h3>
            <button
              onClick={() => onNavigateToTab && onNavigateToTab('dealer-settlements')}
              className="btn btn-secondary btn-xs"
            >
              <span>View All</span>
              <ChevronRight size={12} />
            </button>
          </div>

          <div className="crm-table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Settlement No</th>
                  <th>Store</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentSettlements.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 14, color: 'var(--text-muted)' }}>
                      No dealer settlements recorded yet.
                    </td>
                  </tr>
                ) : (
                  stats.recentSettlements.map((s) => (
                    <tr key={s.id}>
                      <td className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{s.settlementNumber}</td>
                      <td>{s.dealerStoreName}</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                        {formatINR(s.amount)}
                      </td>
                      <td>{s.paymentMethod}</td>
                      <td>
                        <span className={`badge ${s.status === 'COMPLETED' ? 'badge-success' : 'badge-danger'}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* PAYMENT DETAIL DRAWER */}
      {selectedPaymentId && (
        <div className="crm-modal-backdrop" onClick={() => setSelectedPaymentId(null)}>
          <div
            className="crm-drawer"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 480,
              maxWidth: '90vw',
              background: 'var(--bg-surface)',
              borderLeft: '1px solid var(--border-subtle)',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-xl)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800 }}>Payment Transaction Details</h3>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {paymentDetail?.receiptNumber || selectedPaymentId}
                </span>
              </div>
              <button onClick={() => setSelectedPaymentId(null)} className="btn btn-secondary btn-xs">
                <X size={14} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {detailLoading || !paymentDetail ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ height: 60 }} className="skeleton" />
                  <div style={{ height: 120 }} className="skeleton" />
                </div>
              ) : (
                <>
                  {paymentDetail.isReversal && (
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 'var(--radius-md)',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid var(--danger)',
                      }}
                    >
                      <div style={{ color: 'var(--danger)', fontWeight: 800, fontSize: 13 }}>
                        ⚠️ TRANSACTION REVERSED
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4 }}>
                        <strong>Reason:</strong> {paymentDetail.reversalReason || 'Reversed by Administrator'}
                      </div>
                    </div>
                  )}

                  {/* Payment Info */}
                  <div className="crm-card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      TRANSACTION SUMMARY
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Amount:</span>
                        <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: 'var(--success-text)' }}>
                          {formatINR(paymentDetail.amount)}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Payment Mode:</span>
                        <div style={{ fontWeight: 700 }}>{paymentDetail.paymentMode}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Collection Source:</span>
                        <div style={{ fontWeight: 700 }}>{paymentDetail.collectionSource}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Payment Date:</span>
                        <div>{formatDisplayDate(paymentDetail.paymentTimestamp)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Customer Info */}
                  <div className="crm-card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      BORROWER INFORMATION
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{paymentDetail.customer?.name || paymentDetail.customerName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      Phone: {paymentDetail.customer?.phone || paymentDetail.customerPhone} • Code: {paymentDetail.customer?.code || paymentDetail.customerCode}
                    </div>
                  </div>

                  {/* Loan Info */}
                  <div className="crm-card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      LOAN ACCOUNT
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="mono" style={{ fontWeight: 800 }}>{paymentDetail.loan?.accountNo || paymentDetail.loanAccountNo}</span>
                      <span className="badge badge-primary">{paymentDetail.loan?.status || paymentDetail.loanStatus}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      Outstanding: <span className="mono" style={{ fontWeight: 700 }}>{formatINR(paymentDetail.loan?.outstandingBalance || paymentDetail.loanOutstanding || 0)}</span>
                    </div>
                  </div>

                  {/* Waterfall Allocation */}
                  {paymentDetail.allocations && paymentDetail.allocations.length > 0 && (
                    <div className="crm-card" style={{ padding: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        WATERFALL ALLOCATION
                      </div>
                      {paymentDetail.allocations.map((a, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '8px 0',
                            borderBottom: idx < paymentDetail.allocations!.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                            <span>Installment #{a.installmentNumber}</span>
                            <span className="mono">{formatINR(a.totalAmount)}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            <span>Principal: {formatINR(a.principalComponent)}</span>
                            <span>Interest: {formatINR(a.interestComponent)}</span>
                            <span>Penalty: {formatINR(a.penaltyComponent)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Receipt Trigger */}
                  <button
                    onClick={() => openReceiptModal(paymentDetail.id)}
                    className="btn btn-secondary btn-sm"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    <Receipt size={14} />
                    <span>View Official Printable Receipt</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL PRINTABLE RECEIPT MODAL */}
      {receiptData && (
        <div className="crm-modal-backdrop" onClick={() => setReceiptData(null)}>
          <div
            className="crm-modal printable-receipt-container"
            style={{ width: 560, maxWidth: '95vw', padding: 0, overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Actions Bar (hidden during print) */}
            <div
              className="no-print"
              style={{
                padding: '12px 18px',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>Payment Receipt</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handlePrint} className="btn btn-primary btn-xs">
                  <Printer size={13} />
                  <span>Print Receipt</span>
                </button>
                <button onClick={() => setReceiptData(null)} className="btn btn-secondary btn-xs">
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Printable Receipt Paper Body */}
            <div
              className="printable-receipt"
              style={{
                padding: '24px 30px',
                background: '#ffffff',
                color: '#1e293b',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              {/* Header */}
              <div style={{ textAlign: 'center', borderBottom: '2px dashed #cbd5e1', paddingBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                  <BrandLogo variant="receipt" size="sm" showLegal={false} />
                </div>
                <h2 style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  ALPHA MOBILE GALLERY
                </h2>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#b8532f', marginTop: 1 }}>
                  SHUBH PVT LTD
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {receiptData.financeCompany?.phone || '+91 80000 12345'} • support@alphamobilegallery.com
                </div>
                <div style={{ marginTop: 8, display: 'inline-block', padding: '3px 10px', background: '#f1f5f9', borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                  OFFICIAL PAYMENT RECEIPT
                </div>
              </div>

              {/* Top Meta */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '14px 0', fontSize: 12 }}>
                <div>
                  <span style={{ color: '#64748b' }}>Receipt Number:</span>
                  <div style={{ fontWeight: 800, fontFamily: 'monospace' }}>{receiptData.payment?.receiptNumber || receiptData.receiptNumber}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: '#64748b' }}>Payment Date:</span>
                  <div style={{ fontWeight: 700 }}>{formatDisplayDate(receiptData.payment?.paymentDate || receiptData.paymentDate || receiptData.payment?.paymentTimestamp)}</div>
                </div>
              </div>

              {/* Amount Box */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 6,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  textAlign: 'center',
                  margin: '12px 0',
                }}
              >
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                  Amount Received
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', fontFamily: 'monospace', marginTop: 2 }}>
                  {formatINR(receiptData.payment?.amount || receiptData.amount || 0)}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  Mode: <strong>{receiptData.payment?.paymentMethod || receiptData.paymentMode}</strong> • Ref: {receiptData.payment?.referenceNumber || receiptData.referenceNumber || 'N/A'}
                </div>
              </div>

              {/* Details Table */}
              <div style={{ borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '10px 0', margin: '12px 0', fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Customer:</span>
                  <span style={{ fontWeight: 700 }}>{receiptData.customer?.name || receiptData.customerName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Customer Phone:</span>
                  <span>{receiptData.customer?.phone || receiptData.customerPhone}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Loan Account:</span>
                  <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{receiptData.loan?.loanNumber || receiptData.loanAccountNo}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Collection Source:</span>
                  <span style={{ fontWeight: 700 }}>
                    {receiptData.payment?.collectionSource || receiptData.collectionSource}
                  </span>
                </div>
                {receiptData.dealer && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: '#64748b' }}>Collected Through Dealer:</span>
                    <span style={{ fontWeight: 700 }}>{receiptData.dealer.storeName} ({receiptData.dealer.code})</span>
                  </div>
                )}
                {receiptData.recoveryAgent && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: '#64748b' }}>Collected Through Agent:</span>
                    <span style={{ fontWeight: 700 }}>{receiptData.recoveryAgent.name}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ textAlign: 'center', marginTop: 16, fontSize: 10, color: '#94a3b8' }}>
                This is a computer-generated receipt issued by {receiptData.financeCompany?.name || 'Finance CRM'}. No physical signature required.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
