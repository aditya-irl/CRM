import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import { IDashboardStats, formatINR } from '@crm/shared';
import {
  TrendingUp,
  AlertCircle,
  Clock,
  CheckCircle2,
  Users,
  Banknote,
  ArrowUpRight,
  PieChart,
  RefreshCw,
  PhoneCall,
  Calendar,
  CreditCard,
} from 'lucide-react';

interface DashboardViewProps {
  onOpenAddCustomer?: () => void;
  onNavigateToTab?: (tab: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onOpenAddCustomer,
  onNavigateToTab,
}) => {
  const [stats, setStats] = useState<IDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentSummary, setAgentSummary] = useState<any[]>([]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsData, agentData] = await Promise.all([
        ApiClient.getDashboardStats(),
        ApiClient.getAgentPerformance().catch(() => []),
      ]);
      setStats(statsData);
      setAgentSummary(agentData);
    } catch (err) {
      console.error('Failed to load dashboard metrics', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const businessDateFormatted = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (loading || !stats) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ height: 40, width: '40%' }} className="skeleton" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ height: 110 }} className="skeleton" />
          ))}
        </div>
        <div style={{ height: 260 }} className="skeleton" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Top Section: Context & Business Date */}
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
              Executive Operations Command
            </h2>
            <span className="badge badge-terracotta">LIVE PORTFOLIO</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Business Date: <strong>{businessDateFormatted}</strong> • Real-time recovery pipeline & PAR risk aging
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={fetchDashboardData} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} />
            <span>Refresh Metrics</span>
          </button>
          {onOpenAddCustomer && (
            <button onClick={onOpenAddCustomer} className="btn btn-primary btn-sm">
              <span>+ New Customer</span>
            </button>
          )}
        </div>
      </div>

      {/* 5 Restrained KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        {/* KPI 1: Today's Collection */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Today's Collected
            </span>
            <CheckCircle2 size={16} color="var(--success)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--success-text)', marginTop: 6 }}>
            {formatINR(stats.todayCollectedAmount)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            <TrendingUp size={12} />
            <span>{stats.collectionEfficiencyPercent}% Collection Efficiency</span>
          </div>
        </div>

        {/* KPI 2: Due Today */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Due Today
            </span>
            <Clock size={16} color="var(--warning)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning-text)', marginTop: 6 }}>
            {formatINR(stats.todayExpectedCollection)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Pending: <span className="mono" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{formatINR(stats.todayPendingCollection)}</span>
          </div>
        </div>

        {/* KPI 3: Overdue Amount */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Overdue Amount
            </span>
            <AlertCircle size={16} color="var(--danger)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger-text)', marginTop: 6 }}>
            {formatINR(stats.totalOverdueAmount)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4, fontWeight: 600 }}>
            {stats.totalOverdueCustomers} Borrowers Delinquent
          </div>
        </div>

        {/* KPI 4: Total Outstanding */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Total Outstanding
            </span>
            <Banknote size={16} color="var(--primary)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
            {formatINR(stats.totalOutstandingAmount)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Active Principal on Books
          </div>
        </div>

        {/* KPI 5: Active Borrowers / Loans */}
        <div className="crm-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Active Borrowers
            </span>
            <Users size={16} color="var(--primary)" />
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>
            {stats.totalActiveLoans}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Financed Accounts Active
          </div>
        </div>
      </div>

      {/* Portfolio at Risk (PAR) Aging Buckets */}
      <div className="crm-card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PieChart size={17} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Portfolio at Risk (PAR) Credit Aging</h3>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Categorized by days past due (DPD)
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-md)',
              background: '#fefce8',
              border: '1px solid #fef08a',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#854d0e', textTransform: 'uppercase' }}>
              1 - 30 Days Past Due
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: '#713f12' }}>
              {formatINR(stats.agingBuckets.bucket0To30)}
            </div>
            <div style={{ fontSize: 11, color: '#a16207', marginTop: 2 }}>Early stage • Soft follow-up</div>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-md)',
              background: '#fff7ed',
              border: '1px solid #fed7aa',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9a3412', textTransform: 'uppercase' }}>
              31 - 60 Days Past Due
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: '#9a3412' }}>
              {formatINR(stats.agingBuckets.bucket31To60)}
            </div>
            <div style={{ fontSize: 11, color: '#c2410c', marginTop: 2 }}>Moderate risk • Route visit</div>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-md)',
              background: '#fff1f2',
              border: '1px solid #fecdd3',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#be123c', textTransform: 'uppercase' }}>
              61 - 90 Days Past Due
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: '#9f1239' }}>
              {formatINR(stats.agingBuckets.bucket61To90)}
            </div>
            <div style={{ fontSize: 11, color: '#be123c', marginTop: 2 }}>High risk • Priority recovery</div>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger-border)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger-text)', textTransform: 'uppercase' }}>
              90+ Days (NPA Default)
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: 'var(--danger-text)' }}>
              {formatINR(stats.agingBuckets.bucket90Plus)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--danger-text)', marginTop: 2 }}>NPA Asset • Legal escalation</div>
          </div>
        </div>
      </div>

      {/* Field Operations & Collections Table */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        {/* Real-time Collection Transactions */}
        <div className="crm-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Real-time Collection Ledger</h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Latest transactions across field routes</span>
          </div>

          <div className="table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Receipt No</th>
                  <th>Borrower</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Collected By</th>
                  <th>Timestamp</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentPayments.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No payments collected yet today.
                    </td>
                  </tr>
                ) : (
                  stats.recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {p.receiptNumber || (p as any).receipt_number}
                      </td>
                      <td style={{ fontWeight: 600 }}>{(p as any).customer_name}</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--success)' }}>
                        {formatINR(p.amount)}
                      </td>
                      <td>
                        <span className="badge badge-upcoming">{p.paymentMode || (p as any).payment_mode}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>{(p as any).collected_by_name}</td>
                      <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(p.paymentTimestamp || (p as any).payment_timestamp).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td>
                        <span className="badge badge-paid">PAID</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Agent Performance Summary */}
        <div className="crm-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Agent Recovery Rate</h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Efficiency</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            {agentSummary.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)', fontSize: 12 }}>
                Field collection agents will appear here as route visits and payments occur.
              </div>
            ) : (
              agentSummary.slice(0, 5).map((agent, i) => (
                <div
                  key={agent.agent_id || i}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{agent.agent_name}</span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>
                      {formatINR(agent.total_collected || 0)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                    <span>Route: {agent.assigned_branch || 'Assigned'}</span>
                    <span>{agent.collection_efficiency_pct || 0}% Recovery</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
