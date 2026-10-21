import React, { useEffect, useState, useRef } from 'react';
import { IDealerDashboardMetrics, formatINR, formatDateDDMMYYYY } from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  Store,
  Users,
  CreditCard,
  Banknote,
  CheckCircle2,
  Clock,
  RefreshCw,
  Phone,
  MapPin,
  ShieldCheck,
  Receipt,
  ArrowUpRight,
  TrendingUp,
  UserPlus,
  AlertCircle,
} from 'lucide-react';
import { AddCustomerWizard } from '../components/AddCustomerWizard';
import { RecordPaymentModal } from '../components/RecordPaymentModal';

interface DealerDashboardViewProps {
  onNavigateToTab?: (tab: string) => void;
}

export const DealerDashboardView: React.FC<DealerDashboardViewProps> = ({ onNavigateToTab }) => {
  const [data, setData] = useState<IDealerDashboardMetrics | null>(null);
  const [showOnboardWizard, setShowOnboardWizard] = useState(false);
  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false);
  const [selectedLoanForPayment, setSelectedLoanForPayment] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const [activeSubTab, setActiveSubTab] = useState<'loans' | 'collections' | 'settlements'>('loans');

  const fetchDashboardData = async () => {
    const reqId = ++requestIdRef.current;
    if (data) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await ApiClient.getDealerDashboard();
      if (reqId !== requestIdRef.current) return;
      setData(res);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err: any) {
      if (reqId !== requestIdRef.current) return;
      console.error('Failed to load dealer dashboard metrics', err);
      setError(err?.message || 'Failed to load partner store metrics');
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return formatDateDDMMYYYY(dateStr);
  };


  if (!data && error) {
    return (
      <div className="crm-card" style={{ padding: '36px 24px', textAlign: 'center', maxWidth: 600, margin: '40px auto' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <AlertCircle size={24} />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
          Partner Store Dashboard Unavailable
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
          {error}
        </p>
        <button
          onClick={() => fetchDashboardData()}
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '0 auto' }}
        >
          <RefreshCw size={14} />
          <span>Retry Loading Store Data</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Background Refresh Error Alert (Stale Data Banner) */}
      {error && (
        <div
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid var(--warning-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--warning-text)' }}>
            <AlertCircle size={16} />
            <span>
              Unable to refresh store metrics ({error}). Displaying data loaded at {lastUpdated || 'earlier'}.
            </span>
          </div>
          <button
            onClick={() => fetchDashboardData()}
            className="btn btn-secondary btn-sm"
            disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            <span>{refreshing ? 'Refreshing...' : 'Retry'}</span>
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div
        className="crm-card"
        style={{
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          background: 'linear-gradient(135deg, #ffffff 0%, var(--bg-surface-secondary) 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-md)',
              background: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <Store size={26} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                {data?.dealer?.storeName || 'Store Partner Dashboard'}
              </h2>
              {data?.dealer?.dealerCode && (
                <span className="mono badge badge-primary" style={{ fontSize: 12 }}>
                  {data.dealer.dealerCode}
                </span>
              )}
              <span className="badge badge-paid">
                <ShieldCheck size={11} style={{ marginRight: 4 }} />
                Dealer Isolated
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginTop: 6,
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              {data?.dealer?.ownerName && (
                <span>
                  Owner: <strong>{data.dealer.ownerName}</strong>
                </span>
              )}
              {data?.dealer?.phone && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Phone size={12} /> {data.dealer.phone}
                </span>
              )}
              {data?.dealer?.areaCity && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={12} /> {data.dealer.areaCity}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => {
              setSelectedLoanForPayment(null);
              setShowRecordPaymentModal(true);
            }}
            className="btn btn-primary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <CreditCard size={14} />
            <span>Record EMI Payment</span>
          </button>
          <button
            onClick={() => setShowOnboardWizard(true)}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <UserPlus size={14} />
            <span>Add Customer</span>
          </button>
          <button
            onClick={fetchDashboardData}
            disabled={loading}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {/* Active Customers */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Store Borrowers
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, color: 'var(--text-primary)' }}>
                {loading ? '—' : data?.metrics.totalCustomers || 0}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
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
            Customers registered via this store
          </div>
        </div>

        {/* Active Financed Phones/Loans */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Active Financed Phones
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, color: 'var(--text-primary)' }}>
                {loading ? '—' : data?.metrics.activeLoans || 0}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(16, 185, 129, 0.1)',
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CreditCard size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            {data?.metrics.approvedLoans ? `${data.metrics.approvedLoans} approved • ` : ''}
            {data?.metrics.pendingLoans ? `${data.metrics.pendingLoans} pending review • ` : ''}
            {data?.metrics.closedLoans || 0} closed
          </div>
        </div>

        {/* Total Financed Volume */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Financed Portfolio
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, color: 'var(--primary)' }}>
                {loading ? '—' : formatINR(data?.metrics.totalFinancedAmount || 0)}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--primary-subtle)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Total principal originated
          </div>
        </div>

        {/* Active Outstanding Balance */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Active Outstanding
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, color: 'var(--warning-text, #d97706)' }}>
                {loading ? '—' : formatINR(data?.metrics.totalOutstandingBalance || 0)}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(245, 158, 11, 0.1)',
                color: 'var(--warning)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Remaining balance on active loans
          </div>
        </div>

        {/* Store Collections Collected */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Total Store Collections
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, color: 'var(--success)' }}>
                {loading ? '—' : formatINR(data?.metrics.totalCollectedAmount || 0)}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(16, 185, 129, 0.1)',
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Receipt size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Total EMI payments collected
          </div>
        </div>

        {/* Unsettled Remittance Balance */}
        <div className="crm-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Pending Remittance
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  marginTop: 6,
                  color: (data?.metrics.unsettledCollectionAmount || 0) > 0 ? 'var(--danger-text, #dc2626)' : 'var(--text-primary)',
                }}
              >
                {loading ? '—' : formatINR(data?.metrics.unsettledCollectionAmount || 0)}
              </div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Banknote size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Cash collected awaiting settlement
          </div>
        </div>
      </div>

      {/* Main Operations Card */}
      <div className="crm-card" style={{ padding: 20 }}>
        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setActiveSubTab('loans')}
              className={`btn btn-sm ${activeSubTab === 'loans' ? 'btn-primary' : 'btn-secondary'}`}
            >
              <CreditCard size={14} />
              <span>Financed Phones ({data?.recentLoans.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveSubTab('collections')}
              className={`btn btn-sm ${activeSubTab === 'collections' ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Receipt size={14} />
              <span>Recent Collections ({data?.recentCollections.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveSubTab('settlements')}
              className={`btn btn-sm ${activeSubTab === 'settlements' ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Banknote size={14} />
              <span>Remittance Settlements ({data?.recentSettlements.length || 0})</span>
            </button>
          </div>

          {onNavigateToTab && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => onNavigateToTab('loans')}
                className="btn btn-secondary btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span>View All Store Loans</span>
                <ArrowUpRight size={13} />
              </button>
              <button
                onClick={() => onNavigateToTab('dealer-payables')}
                className="btn btn-secondary btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span>Company Payments</span>
                <ArrowUpRight size={13} />
              </button>
              <button
                onClick={() => onNavigateToTab('customers')}
                className="btn btn-secondary btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span>View All Store Customers</span>
                <ArrowUpRight size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Tab 1: Financed Loans */}
        {activeSubTab === 'loans' && (
          <div>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading store loans...
              </div>
            ) : !data?.recentLoans || data.recentLoans.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                No financed loans found for this partner store.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="crm-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Loan Account</th>
                      <th>Customer Name</th>
                      <th>Mobile Phone</th>
                      <th>Principal</th>
                      <th>EMI Amount</th>
                      <th>Outstanding</th>
                      <th>Status</th>
                      <th>Disbursed On</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLoans.map((l) => (
                      <tr key={l.id}>
                        <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                          {l.loanAccountNo}
                        </td>
                        <td>
                          <strong>{l.customerName}</strong>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {l.customerCode}
                          </div>
                        </td>
                        <td className="mono">{l.primaryPhone}</td>
                        <td className="font-bold">{formatINR(l.principalAmount)}</td>
                        <td>{formatINR(l.emiAmount)}</td>
                        <td className="font-bold" style={{ color: 'var(--warning-text, #d97706)' }}>
                          {formatINR(l.outstandingBalance)}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              l.status === 'ACTIVE'
                                ? 'badge-paid'
                                : l.status === 'CLOSED'
                                ? 'badge-upcoming'
                                : 'badge-overdue'
                            }`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td>{formatDate(l.disbursementDate)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {(l.status === 'ACTIVE' || Number(l.outstandingBalance) > 0) && (
                            <button
                              onClick={() => {
                                setSelectedLoanForPayment(l);
                                setShowRecordPaymentModal(true);
                              }}
                              className="btn btn-primary btn-xs"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              title="Record EMI payment collected at store"
                            >
                              Record EMI
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Recent Collections */}
        {activeSubTab === 'collections' && (
          <div>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading store collections...
              </div>
            ) : !data?.recentCollections || data.recentCollections.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                No collections recorded yet for this partner store.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="crm-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Receipt #</th>
                      <th>Customer</th>
                      <th>Loan Account</th>
                      <th>Amount</th>
                      <th>Payment Mode</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Remittance State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentCollections.map((c) => (
                      <tr key={c.id}>
                        <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                          {c.receiptNumber}
                        </td>
                        <td><strong>{c.customerName}</strong></td>
                        <td className="mono">{c.loanAccountNo}</td>
                        <td className="font-bold" style={{ color: 'var(--success)' }}>
                          {formatINR(c.amount)}
                        </td>
                        <td>
                          <span className="badge badge-route">{c.paymentMode}</span>
                        </td>
                        <td>{formatDate(c.paymentDate)}</td>
                        <td>
                          <span
                            className={`badge ${
                              c.status === 'SUCCESS' ? 'badge-paid' : 'badge-overdue'
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              c.settlementStatus === 'SETTLED'
                                ? 'badge-paid'
                                : c.settlementStatus === 'PARTIALLY_SETTLED'
                                ? 'badge-partial'
                                : 'badge-due-today'
                            }`}
                          >
                            {c.settlementStatus || 'UNSETTLED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Remittance Settlements */}
        {activeSubTab === 'settlements' && (
          <div>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading settlements history...
              </div>
            ) : !data?.recentSettlements || data.recentSettlements.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                No remittance settlements recorded yet.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="crm-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Settlement Ref</th>
                      <th>Total Remitted</th>
                      <th>Payment Method</th>
                      <th>Settlement Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSettlements.map((s) => (
                      <tr key={s.id}>
                        <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                          {s.settlementReference}
                        </td>
                        <td className="font-bold" style={{ color: 'var(--success)' }}>
                          {formatINR(s.totalAmount)}
                        </td>
                        <td>
                          <span className="badge badge-route">{s.paymentMethod}</span>
                        </td>
                        <td>{formatDate(s.settlementDate)}</td>
                        <td>
                          <span
                            className={`badge ${
                              s.status === 'COMPLETED' ? 'badge-paid' : 'badge-overdue'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Security Isolation Notice */}
      <div
        style={{
          padding: '12px 18px',
          background: 'var(--bg-surface-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
      >
        <ShieldCheck size={16} color="var(--success)" />
        <span>
          <strong>Store Partner Security:</strong> This dashboard is cryptographically scoped to your partner store credentials. You have direct access to your customer portfolio, financed phones, collection records, and remittance settlements. Company-wide metrics and other store data are strictly isolated.
        </span>
      </div>

      {showOnboardWizard && (
        <AddCustomerWizard
          isOpen={showOnboardWizard}
          onClose={() => setShowOnboardWizard(false)}
          onSuccess={() => {
            setShowOnboardWizard(false);
            fetchDashboardData();
          }}
        />
      )}

      {showRecordPaymentModal && (
        <RecordPaymentModal
          isOpen={showRecordPaymentModal}
          onClose={() => {
            setShowRecordPaymentModal(false);
            setSelectedLoanForPayment(null);
          }}
          onSuccess={() => {
            fetchDashboardData();
          }}
          preselectedLoan={selectedLoanForPayment}
          user={ApiClient.getUser() || undefined}
          isDealerContext={true}
          dealerId={data?.dealer?.id}
          dealerStoreName={data?.dealer?.storeName}
        />
      )}
    </div>
  );
};
