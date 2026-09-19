import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import { formatINR } from '@crm/shared';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  UserCheck,
  TrendingUp,
  AlertTriangle,
  Clock,
  Layers,
  Users,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'daily' | 'par' | 'agents'>('daily');
  const [dailyReport, setDailyReport] = useState<{ totalCount: number; totalCollected: number; modeBreakdown: any; records: any[] } | null>(null);
  const [agentsReport, setAgentsReport] = useState<any[]>([]);
  const [parReport, setParReport] = useState<{ summary: any; records: any[] } | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'daily') {
        const daily = await ApiClient.getDailyCollections(selectedDate);
        setDailyReport(daily);
      } else if (activeTab === 'par') {
        const par = await ApiClient.getOverduePar(selectedBucket === 'ALL' ? undefined : selectedBucket);
        setParReport(par);
      } else if (activeTab === 'agents') {
        const agents = await ApiClient.getAgentPerformance();
        setAgentsReport(agents);
      }
    } catch (err) {
      console.error('Failed to load reports', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab, selectedDate, selectedBucket]);

  const handleExport = async (type: 'daily-collections' | 'overdue-par' | 'agent-performance' | 'customers') => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (type === 'daily-collections') params.date = selectedDate;
      if (type === 'overdue-par' && selectedBucket !== 'ALL') params.bucket = selectedBucket;
      await ApiClient.downloadExport(type, params);
    } catch (err: any) {
      alert(err.message || 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Reports & Recovery Analytics</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Daily collection reconciliations, credit risk PAR aging, agent performance, and CSV exports.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => handleExport('customers')}
            disabled={exporting}
            className="btn btn-secondary btn-sm"
          >
            <Users size={13} />
            <span>Export Borrowers CSV</span>
          </button>
          <button
            onClick={() => handleExport(activeTab === 'daily' ? 'daily-collections' : activeTab === 'par' ? 'overdue-par' : 'agent-performance')}
            disabled={exporting}
            className="btn btn-primary btn-sm"
          >
            <Download size={13} />
            <span>{exporting ? 'Exporting...' : 'Export View CSV'}</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
        <button
          onClick={() => setActiveTab('daily')}
          className={`crm-tab ${activeTab === 'daily' ? 'active' : ''}`}
        >
          Daily Collections Report
        </button>
        <button
          onClick={() => setActiveTab('par')}
          className={`crm-tab ${activeTab === 'par' ? 'active' : ''}`}
        >
          Overdue & PAR Aging Report
        </button>
        <button
          onClick={() => setActiveTab('agents')}
          className={`crm-tab ${activeTab === 'agents' ? 'active' : ''}`}
        >
          Agent Recovery Performance
        </button>
      </div>

      {/* TAB 1: DAILY COLLECTIONS */}
      {activeTab === 'daily' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="crm-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Select Reconciliation Date:</span>
            <input
              type="date"
              className="form-input"
              style={{ width: 180 }}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          {dailyReport && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div className="crm-card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>TOTAL COLLECTED</div>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--success-text)', marginTop: 4 }}>
                    {formatINR(dailyReport.totalCollected)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {dailyReport.totalCount} Transactions Recorded
                  </div>
                </div>

                <div className="crm-card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>CASH COLLECTIONS</div>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
                    {formatINR(dailyReport.modeBreakdown?.CASH || 0)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Physical field cash</div>
                </div>

                <div className="crm-card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>DIGITAL (UPI / BANK)</div>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
                    {formatINR((dailyReport.modeBreakdown?.UPI || 0) + (dailyReport.modeBreakdown?.BANK_TRANSFER || 0))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Electronic reconciliation</div>
                </div>
              </div>

              <div className="table-container">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Receipt No</th>
                      <th>Borrower</th>
                      <th>Loan Acc</th>
                      <th>Amount</th>
                      <th>Mode</th>
                      <th>Collected By</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyReport.records.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                          No collections found for {selectedDate}.
                        </td>
                      </tr>
                    ) : (
                      dailyReport.records.map((r: any) => (
                        <tr key={r.id}>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>{r.receipt_number}</td>
                          <td style={{ fontWeight: 600 }}>{r.customer_name}</td>
                          <td className="mono">{r.loan_account_no}</td>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>{formatINR(r.amount)}</td>
                          <td>
                            <span className="badge badge-upcoming">{r.payment_mode}</span>
                          </td>
                          <td>{r.collected_by_name}</td>
                          <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {new Date(r.payment_timestamp).toLocaleTimeString('en-IN', { hour12: true })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: OVERDUE / PAR AGING */}
      {activeTab === 'par' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="crm-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Filter PAR Aging Bucket:</span>
            <select
              className="form-select"
              style={{ width: 220 }}
              value={selectedBucket}
              onChange={(e) => setSelectedBucket(e.target.value)}
            >
              <option value="ALL">All Overdue Buckets (1+ DPD)</option>
              <option value="1-30">1 - 30 Days Past Due</option>
              <option value="31-60">31 - 60 Days Past Due</option>
              <option value="61-90">61 - 90 Days Past Due</option>
              <option value="90+">90+ Days (NPA Default)</option>
            </select>
          </div>

          {parReport && (
            <div className="table-container">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th>Loan Acc</th>
                    <th>Route / Area</th>
                    <th>Due Date</th>
                    <th>DPD</th>
                    <th>Overdue Amount</th>
                    <th>Outstanding Loan</th>
                    <th>Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {parReport.records.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                        No delinquent borrowers found in this aging bucket.
                      </td>
                    </tr>
                  ) : (
                    parReport.records.map((r: any) => (
                      <tr key={r.installment_id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.customer_name}</div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.primary_phone}</div>
                        </td>
                        <td className="mono">{r.loan_account_no}</td>
                        <td>{r.area_route}</td>
                        <td className="mono">{r.due_date}</td>
                        <td className="mono" style={{ fontWeight: 700, color: 'var(--danger-text)' }}>
                          {r.days_overdue} D
                        </td>
                        <td className="mono" style={{ fontWeight: 800, color: 'var(--danger-text)' }}>
                          {formatINR(r.overdue_amount)}
                        </td>
                        <td className="mono">{formatINR(r.outstanding_loan_balance)}</td>
                        <td>
                          <span className={`badge ${r.days_overdue > 60 ? 'badge-overdue' : 'badge-due-today'}`}>
                            {r.par_bucket}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: AGENTS PERFORMANCE */}
      {activeTab === 'agents' && (
        <div className="table-container">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Agent Name</th>
                <th>Assigned Route</th>
                <th>Target Assigned</th>
                <th>Collected Amount</th>
                <th>Recovery %</th>
                <th>Total Receipts</th>
              </tr>
            </thead>
            <tbody>
              {agentsReport.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                    No field agent performance data found.
                  </td>
                </tr>
              ) : (
                agentsReport.map((agent: any) => (
                  <tr key={agent.agent_id}>
                    <td style={{ fontWeight: 700 }}>{agent.agent_name}</td>
                    <td>{agent.assigned_branch || 'General Field'}</td>
                    <td className="mono">{formatINR(agent.target_assigned || 0)}</td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                      {formatINR(agent.total_collected || 0)}
                    </td>
                    <td>
                      <span className="badge badge-paid">
                        {agent.collection_efficiency_pct || 0}% Recovery
                      </span>
                    </td>
                    <td className="mono">{agent.total_receipts || 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
