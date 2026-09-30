import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import {
  IFinanceReportResponse,
  FinanceReportCategory,
  FinanceReportType,
  formatINR,
  formatDisplayDate,
  CollectionSource,
  PaymentMode,
  PaymentStatus,
  LoanStatus,
} from '@crm/shared';
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
  Search,
  Building2,
  Store,
  Banknote,
  CreditCard,
  RefreshCw,
  FileText,
  ChevronRight,
  Filter,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const [category, setCategory] = useState<FinanceReportCategory>('collections');
  const [reportType, setReportType] = useState<FinanceReportType>('all-collections');
  const [preset, setPreset] = useState<string>('this-month');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<string>('ALL');
  const [paymentStatus, setPaymentStatus] = useState<string>('ALL');
  const [loanStatus, setLoanStatus] = useState<string>('ALL');
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(25);

  const [reportData, setReportData] = useState<IFinanceReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingSheets, setExportingSheets] = useState(false);
  const [sheetsFeedback, setSheetsFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    url?: string;
    tab?: string;
  } | null>(null);

  // Available report types per category
  const categoryReports: Record<FinanceReportCategory, Array<{ id: FinanceReportType; label: string }>> = {
    collections: [
      { id: 'all-collections', label: 'All Customer Collections' },
      { id: 'direct-collections', label: 'Direct Customer Collections' },
      { id: 'dealer-collections', label: 'Dealer Store Collections' },
      { id: 'agent-collections', label: 'Recovery Agent Collections' },
    ],
    loans: [
      { id: 'disbursements', label: 'Loan Disbursements' },
      { id: 'active-portfolio', label: 'Active Loan Portfolio' },
      { id: 'overdue-loans', label: 'Overdue & Delinquent Loans' },
      { id: 'closed-loans', label: 'Closed / Paid-off Loans' },
    ],
    dealer: [
      { id: 'dealer-reconciliation', label: 'Dealer Ledger Reconciliation' },
      { id: 'dealer-settlements', label: 'Dealer Settlement Remittances' },
      { id: 'dealer-outstanding', label: 'Unsettled Dealer Balances' },
    ],
    recovery: [
      { id: 'agent-performance', label: 'Agent Collection Rankings' },
      { id: 'recovery-queue', label: 'Overdue PAR Recovery Queue' },
    ],
  };

  const handleCategoryChange = (newCat: FinanceReportCategory) => {
    setCategory(newCat);
    const defaultType = categoryReports[newCat][0].id;
    setReportType(defaultType);
    setPage(1);
    setSheetsFeedback(null);
  };

  const handleReportTypeChange = (newType: FinanceReportType) => {
    setReportType(newType);
    setPage(1);
    setSheetsFeedback(null);
  };

  const loadReport = async () => {
    setLoading(true);
    try {
      const res = await ApiClient.getCustomReport({
        category,
        reportType,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search || undefined,
        paymentMode: paymentMode !== 'ALL' ? paymentMode : undefined,
        paymentStatus: paymentStatus !== 'ALL' ? paymentStatus : undefined,
        loanStatus: loanStatus !== 'ALL' ? loanStatus : undefined,
        page,
        limit,
      });
      setReportData(res);
    } catch (err) {
      console.error('Failed to load report data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [category, reportType, page, paymentMode, paymentStatus, loanStatus]);

  const handleApplyFilters = () => {
    setPage(1);
    loadReport();
  };

  const handlePresetSelect = (selectedPreset: string) => {
    setPreset(selectedPreset);
    const today = new Date().toISOString().slice(0, 10);
    const [y, m, d] = today.split('-').map(Number);
    const now = new Date(Date.UTC(y, m - 1, d));

    if (selectedPreset === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (selectedPreset === 'yesterday') {
      const yd = new Date(now);
      yd.setUTCDate(yd.getUTCDate() - 1);
      const s = yd.toISOString().slice(0, 10);
      setStartDate(s);
      setEndDate(s);
    } else if (selectedPreset === 'this-week') {
      const dayOfWeek = now.getUTCDay();
      const diff = (dayOfWeek + 6) % 7;
      const mon = new Date(now);
      mon.setUTCDate(mon.getUTCDate() - diff);
      setStartDate(mon.toISOString().slice(0, 10));
      setEndDate(today);
    } else if (selectedPreset === 'this-month') {
      setStartDate(`${y}-${String(m).padStart(2, '0')}-01`);
      setEndDate(today);
    } else if (selectedPreset === 'last-month') {
      const lastMonthDate = new Date(Date.UTC(y, m - 2, 1));
      const lmY = lastMonthDate.getUTCFullYear();
      const lmM = lastMonthDate.getUTCMonth() + 1;
      const lastDayOfLm = new Date(Date.UTC(lmY, lmM, 0)).getUTCDate();
      setStartDate(`${lmY}-${String(lmM).padStart(2, '0')}-01`);
      setEndDate(`${lmY}-${String(lmM).padStart(2, '0')}-${String(lastDayOfLm).padStart(2, '0')}`);
    } else if (selectedPreset === 'this-year') {
      setStartDate(`${y}-01-01`);
      setEndDate(`${y}-12-31`);
    } else if (selectedPreset === 'all') {
      setStartDate('');
      setEndDate('');
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (search) params.search = search;
      if (paymentMode !== 'ALL') params.paymentMode = paymentMode;
      if (paymentStatus !== 'ALL') params.paymentStatus = paymentStatus;
      if (loanStatus !== 'ALL') params.loanStatus = loanStatus;
      await ApiClient.downloadFinanceReportCsv(reportType, params);
    } catch (err: any) {
      alert(err.message || 'Failed to export report CSV');
    } finally {
      setExporting(false);
    }
  };

  const handleExportGoogleSheets = async () => {
    setExportingSheets(true);
    setSheetsFeedback(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (search) params.search = search;
      if (paymentMode !== 'ALL') params.paymentMode = paymentMode;
      if (paymentStatus !== 'ALL') params.paymentStatus = paymentStatus;
      if (loanStatus !== 'ALL') params.loanStatus = loanStatus;
      
      const res = await ApiClient.exportReportToGoogleSheets(reportType, params);
      setSheetsFeedback({
        type: 'success',
        message: `Successfully synchronized ${res.updatedRows} rows to Google Sheets tab '${res.sheetTitle}'!`,
        url: res.spreadsheetUrl,
        tab: res.sheetTitle,
      });
    } catch (err: any) {
      setSheetsFeedback({
        type: 'error',
        message: err.message || 'Failed to export report to Google Sheets. Check environment configuration.',
      });
    } finally {
      setExportingSheets(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>Finance & Operations Reports Center</h2>
            <span className="badge badge-terracotta">AUDIT LEDGER</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Centralized financial statements, multi-channel collection audits, portfolio aging, CSV & Google Sheets exports.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={loadReport} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <button onClick={handleExportCsv} disabled={exporting} className="btn btn-secondary btn-sm">
            <Download size={13} />
            <span>{exporting ? 'Exporting CSV...' : 'Export CSV'}</span>
          </button>
          <button onClick={handleExportGoogleSheets} disabled={exportingSheets} className="btn btn-primary btn-sm">
            <FileSpreadsheet size={13} className={exportingSheets ? 'animate-spin' : ''} />
            <span>{exportingSheets ? 'Exporting to Sheets...' : 'Export to Google Sheets'}</span>
          </button>
        </div>
      </div>

      {/* Google Sheets Feedback Alert */}
      {sheetsFeedback && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            backgroundColor:
              sheetsFeedback.type === 'success'
                ? 'rgba(16, 185, 129, 0.12)'
                : 'rgba(239, 68, 68, 0.12)',
            border: `1px solid ${
              sheetsFeedback.type === 'success'
                ? 'rgba(16, 185, 129, 0.3)'
                : 'rgba(239, 68, 68, 0.3)'
            }`,
            color: sheetsFeedback.type === 'success' ? '#10B981' : '#EF4444',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {sheetsFeedback.type === 'success' ? (
              <FileSpreadsheet size={16} />
            ) : (
              <AlertTriangle size={16} />
            )}
            <span>{sheetsFeedback.message}</span>
            {sheetsFeedback.url && (
              <a
                href={sheetsFeedback.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  color: '#10B981',
                  textDecoration: 'underline',
                  fontWeight: 700,
                  marginLeft: 4,
                }}
              >
                Open Google Spreadsheet &rarr;
              </a>
            )}
          </div>
          <button
            onClick={() => setSheetsFeedback(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: 700,
              padding: '0 4px',
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Category Tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
        <button
          onClick={() => handleCategoryChange('collections')}
          className={`crm-tab ${category === 'collections' ? 'active' : ''}`}
        >
          <CreditCard size={14} />
          <span>Collections Reports</span>
        </button>
        <button
          onClick={() => handleCategoryChange('loans')}
          className={`crm-tab ${category === 'loans' ? 'active' : ''}`}
        >
          <Banknote size={14} />
          <span>Loans & Portfolio</span>
        </button>
        <button
          onClick={() => handleCategoryChange('dealer')}
          className={`crm-tab ${category === 'dealer' ? 'active' : ''}`}
        >
          <Store size={14} />
          <span>Dealer Reconciliation</span>
        </button>
        <button
          onClick={() => handleCategoryChange('recovery')}
          className={`crm-tab ${category === 'recovery' ? 'active' : ''}`}
        >
          <UserCheck size={14} />
          <span>Recovery & Agents</span>
        </button>
      </div>

      {/* Sub-report selector buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {categoryReports[category].map((r) => (
          <button
            key={r.id}
            onClick={() => handleReportTypeChange(r.id)}
            className={`btn btn-xs ${reportType === r.id ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="crm-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>PRESET:</span>
            {[
              { id: 'today', label: 'Today' },
              { id: 'this-week', label: 'This Week' },
              { id: 'this-month', label: 'This Month' },
              { id: 'last-month', label: 'Last Month' },
              { id: 'this-year', label: 'This Year' },
              { id: 'all', label: 'All Time' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => handlePresetSelect(p.id)}
                className={`btn btn-xs ${preset === p.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '3px 8px' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>From:</span>
              <input
                type="date"
                className="form-input"
                style={{ padding: '4px 8px', fontSize: 12, width: 135 }}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>To:</span>
              <input
                type="date"
                className="form-input"
                style={{ padding: '4px 8px', fontSize: 12, width: 135 }}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <button onClick={handleApplyFilters} className="btn btn-primary btn-xs">
              <Filter size={11} />
              <span>Filter</span>
            </button>
          </div>
        </div>

        {/* Secondary Filters */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
          {category === 'collections' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Mode:</span>
                <select
                  className="form-select"
                  style={{ padding: '4px 8px', fontSize: 12 }}
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                >
                  <option value="ALL">All Modes</option>
                  <option value="UPI">UPI</option>
                  <option value="CASH">CASH</option>
                  <option value="BANK_TRANSFER">BANK TRANSFER</option>
                  <option value="CHEQUE">CHEQUE</option>
                  <option value="DEBIT_CARD">DEBIT CARD</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Status:</span>
                <select
                  className="form-select"
                  style={{ padding: '4px 8px', fontSize: 12 }}
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value)}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="SUCCESS">Completed (Success)</option>
                  <option value="REVERSED">Reversed</option>
                </select>
              </div>
            </>
          )}

          {category === 'loans' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Loan Status:</span>
              <select
                className="form-select"
                style={{ padding: '4px 8px', fontSize: 12 }}
                value={loanStatus}
                onChange={(e) => setLoanStatus(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="CLOSED">CLOSED</option>
                <option value="DEFAULT">DEFAULT / OVERDUE</option>
                <option value="DRAFT">DRAFT</option>
              </select>
            </div>
          )}

          <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
            <input
              type="text"
              placeholder="Search by customer name, phone, code, account number..."
              className="form-input"
              style={{ width: '100%', padding: '4px 10px 4px 28px', fontSize: 12 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
            />
            <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          </div>
        </div>
      </div>

      {/* Summary KPI Banner */}
      {reportData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <div className="crm-card" style={{ padding: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>TOTAL VALUE</span>
            <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--success-text)', marginTop: 4 }}>
              {formatINR(reportData.summary.totalAmount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Active non-reversed total</div>
          </div>

          <div className="crm-card" style={{ padding: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>RECORD COUNT</span>
            <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
              {reportData.summary.recordCount} Records
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Matching filter criteria</div>
          </div>

          <div className="crm-card" style={{ padding: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700 }}>AVERAGE VALUE</span>
            <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
              {formatINR(reportData.summary.averageAmount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Per record average</div>
          </div>
        </div>
      )}

      {/* Itemized Table */}
      <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="crm-table-container">
          {category === 'collections' && (
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date & Time</th>
                  <th>Customer</th>
                  <th>Loan Account</th>
                  <th>Amount</th>
                  <th>Source</th>
                  <th>Store / Agent</th>
                  <th>Mode</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      Loading report records...
                    </td>
                  </tr>
                ) : !reportData || reportData.records.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No matching collection records found for selected filter criteria.
                    </td>
                  </tr>
                ) : (
                  reportData.records.map((r: any) => (
                    <tr key={r.id}>
                      <td className="mono" style={{ fontWeight: 700, fontSize: 12 }}>{r.receipt_number}</td>
                      <td style={{ fontSize: 12 }}>{formatDisplayDate(r.payment_timestamp)}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.customer_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.primary_phone}</div>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{r.loan_account_no}</td>
                      <td className="mono" style={{ fontWeight: 800, color: r.is_reversal ? 'var(--danger)' : 'var(--success-text)' }}>
                        {formatINR(r.amount)}
                      </td>
                      <td>
                        <span className="badge badge-primary" style={{ fontSize: 10 }}>{r.collection_source}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>{r.dealer_store_name || r.source_agent_name || 'Direct'}</td>
                      <td style={{ fontSize: 12 }}>{r.payment_mode}</td>
                      <td>
                        <span className={`badge ${r.is_reversal ? 'badge-danger' : r.status === 'SUCCESS' ? 'badge-success' : 'badge-warning'}`}>
                          {r.is_reversal ? 'REVERSED' : r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {category === 'loans' && (
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Loan Account</th>
                  <th>Customer</th>
                  <th>Principal</th>
                  <th>Outstanding</th>
                  <th>Rate</th>
                  <th>Tenure</th>
                  <th>Disbursed</th>
                  <th>Store / Agent</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      Loading loans...
                    </td>
                  </tr>
                ) : !reportData || reportData.records.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No loans found matching criteria.
                    </td>
                  </tr>
                ) : (
                  reportData.records.map((r: any) => (
                    <tr key={r.id}>
                      <td className="mono" style={{ fontWeight: 700 }}>{r.loan_account_no}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.customer_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.primary_phone}</div>
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>{formatINR(r.principalAmount)}</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>{formatINR(r.outstandingBalance)}</td>
                      <td>{r.annual_interest_rate}%</td>
                      <td>{r.tenure_months}m</td>
                      <td style={{ fontSize: 12 }}>{r.disbursement_date ? formatDisplayDate(r.disbursement_date) : '-'}</td>
                      <td style={{ fontSize: 12 }}>{r.dealer_store_name || r.assigned_agent_name || '-'}</td>
                      <td>
                        <span className={`badge ${r.loan_status === 'ACTIVE' ? 'badge-success' : r.loan_status === 'CLOSED' ? 'badge-primary' : 'badge-danger'}`}>
                          {r.loan_status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {category === 'dealer' && (
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Store Name</th>
                  <th>Code</th>
                  <th>Owner</th>
                  <th>Collections</th>
                  <th>Settled</th>
                  <th>Outstanding Remittance</th>
                  <th>Last Settlement</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      Loading dealer records...
                    </td>
                  </tr>
                ) : !reportData || reportData.records.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No dealer records found.
                    </td>
                  </tr>
                ) : (
                  reportData.records.map((r: any, idx: number) => (
                    <tr key={r.dealerId || r.id || idx}>
                      <td style={{ fontWeight: 700 }}>{r.storeName || r.dealer_store_name}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{r.dealerCode || r.dealer_code}</td>
                      <td>{r.ownerName || r.owner_name}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{formatINR(r.customerCollections || r.amount || 0)}</td>
                      <td className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(r.settledAmount || 0)}</td>
                      <td className="mono" style={{ fontWeight: 800, color: (r.outstandingAmount || 0) > 0 ? 'var(--warning-text)' : 'var(--text-muted)' }}>
                        {formatINR(r.outstandingAmount || 0)}
                      </td>
                      <td style={{ fontSize: 12 }}>{r.lastSettlementDate ? formatDisplayDate(r.lastSettlementDate) : (r.settlement_date ? formatDisplayDate(r.settlement_date) : '-')}</td>
                      <td>
                        <span className="badge badge-success">{r.status || 'ACTIVE'}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {category === 'recovery' && (
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Agent / Account</th>
                  <th>Phone / Route</th>
                  <th>Assigned / Due</th>
                  <th>Lifetime / Overdue</th>
                  <th>Today Collected</th>
                  <th>Status / Activity</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      Loading recovery records...
                    </td>
                  </tr>
                ) : !reportData || reportData.records.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      No recovery records found.
                    </td>
                  </tr>
                ) : (
                  reportData.records.map((r: any, idx: number) => (
                    <tr key={r.agent_id || r.installmentId || idx}>
                      <td style={{ fontWeight: 700 }}>{r.agent_name || r.customerName || r.loanAccountNo}</td>
                      <td>{r.agent_phone || r.areaRoute || r.primaryPhone}</td>
                      <td>{r.assigned_customers_count !== undefined ? `${r.assigned_customers_count} Customers` : `${r.daysOverdue} Days Overdue`}</td>
                      <td className="mono" style={{ fontWeight: 800, color: 'var(--success-text)' }}>
                        {formatINR(r.total_lifetime_collected || r.totalOverdueAmount || 0)}
                      </td>
                      <td className="mono">{r.today_collected !== undefined ? formatINR(r.today_collected) : (r.dueDate ? formatDisplayDate(r.dueDate) : '-')}</td>
                      <td>
                        <span className="badge badge-primary">
                          {r.active_overdue_emis_count !== undefined ? `${r.active_overdue_emis_count} Active EMIs` : (r.status || 'OVERDUE')}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Bar */}
        {reportData && reportData.totalPages > 1 && (
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Showing Page <strong>{reportData.page}</strong> of <strong>{reportData.totalPages}</strong> ({reportData.total} records)
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="btn btn-secondary btn-xs"
              >
                Previous
              </button>
              <button
                disabled={page >= reportData.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="btn btn-secondary btn-xs"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
