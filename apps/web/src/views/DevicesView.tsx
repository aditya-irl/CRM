import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import {
  IDeviceItem,
  formatINR,
  formatDateDDMMYYYY,
} from '@crm/shared';
import {
  Smartphone,
  Search,
  Filter,
  Eye,
  Store,
  Building2,
  X,
  CreditCard,
  User,
  ShieldCheck,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  RefreshCw,
  Hash,
  Clock,
} from 'lucide-react';

interface DevicesViewProps {
  onNavigateToTab?: (tab: string) => void;
}

export const DevicesView: React.FC<DevicesViewProps> = ({ onNavigateToTab }) => {
  const [devices, setDevices] = useState<IDeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'DEALER' | 'DIRECT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'LOCKED' | 'INACTIVE'>('ALL');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Detail Modal / Drawer State
  const [selectedDevice, setSelectedDevice] = useState<IDeviceItem | null>(null);

  const fetchDevices = async (targetPage = page) => {
    setLoading(true);
    try {
      const res = await ApiClient.getFinancedDevices({
        page: targetPage,
        limit,
        search: search.trim() || undefined,
        financingSource: sourceFilter !== 'ALL' ? sourceFilter : undefined,
        deviceStatus: statusFilter !== 'ALL' ? statusFilter : undefined,
      });

      if (res && res.data) {
        setDevices(res.data);
        if (res.meta) {
          setTotalCount(res.meta.total || 0);
          setTotalPages(res.meta.totalPages || 1);
        }
      } else {
        setDevices(Array.isArray(res) ? res : []);
      }
    } catch (err) {
      console.error('Failed to load financed devices', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices(1);
  }, [sourceFilter, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDevices(1);
  };

  // Summary Metrics
  const totalFinancedValue = devices.reduce((sum, d) => sum + (Number(d.financedAmount) || 0), 0);
  const activeCount = devices.filter((d) => d.deviceStatus === 'ACTIVE').length;
  const overdueCount = devices.filter((d) => Number(d.overdueCount || 0) > 0 || Number(d.daysOverdue || 0) > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
            <Smartphone size={26} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Financed Devices & Asset Registry
              </h2>
              <span className="mono badge badge-primary" style={{ fontSize: 12 }}>
                {totalCount} Units Registered
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              Complete IMEI collateral tracking, partner store origination context, and loan financing status.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => fetchDevices(page)}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title="Refresh device records"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Portfolio Devices
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: 'var(--text-primary)' }}>
            {totalCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Total financed equipment
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Financed Value (Page)
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: 'var(--primary)' }}>
            {formatINR(totalFinancedValue)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Net disbursed equipment capital
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Active Hardware
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: 'var(--success-text)' }}>
            {activeCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Active financed units
          </div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Overdue / At Risk
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: overdueCount > 0 ? 'var(--danger-text)' : 'var(--text-muted)' }}>
            {overdueCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Associated with overdue EMIs
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="crm-card" style={{ padding: 16 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Search by Brand, Model, IMEI, Customer, Loan Account, Dealer..."
              className="form-input"
              style={{ paddingLeft: 36, width: '100%' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Source:</span>
            <select
              className="form-select"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as any)}
              style={{ minWidth: 140 }}
            >
              <option value="ALL">All Sources</option>
              <option value="DEALER">Dealer Partner</option>
              <option value="DIRECT">Direct Customer</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Device Status:</span>
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              style={{ minWidth: 120 }}
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="LOCKED">Locked</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Search size={14} />
            <span>Search</span>
          </button>
        </form>
      </div>

      {/* Devices Table */}
      <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="crm-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Device</th>
                <th>Brand / Model</th>
                <th>IMEI</th>
                <th>Customer</th>
                <th>Financing Source</th>
                <th>Loan Account</th>
                <th>Financed Amt</th>
                <th>Monthly EMI</th>
                <th>Loan Status</th>
                <th>Device Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Loading financed devices...
                  </td>
                </tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    No financed devices found matching your filters.
                  </td>
                </tr>
              ) : (
                devices.map((device) => {
                  const isDealer = device.financingSource === 'DEALER';
                  return (
                    <tr
                      key={device.id}
                      onClick={() => setSelectedDevice(device)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--bg-surface-secondary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--primary)',
                              flexShrink: 0,
                            }}
                          >
                            <Smartphone size={16} />
                          </div>
                          <div>
                            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                              {device.deviceName}
                            </strong>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              Retail: {formatINR(device.retailPrice)}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{device.deviceBrand}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{device.deviceModel}</div>
                      </td>

                      <td className="mono" style={{ fontSize: 12 }}>
                        <div>{device.imei1}</div>
                        {device.imei2 && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            IMEI 2: {device.imei2}
                          </div>
                        )}
                      </td>

                      <td>
                        <strong style={{ fontSize: 12 }}>{device.customerName}</strong>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {device.customerCode} • {device.primaryPhone}
                        </div>
                      </td>

                      <td>
                        {isDealer ? (
                          <span
                            className="badge badge-terracotta"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            title={`Store Code: ${device.dealerCode || '—'}`}
                          >
                            <Store size={11} />
                            <span>Dealer: {device.dealerStoreName || 'Partner Store'}</span>
                          </span>
                        ) : (
                          <span
                            className="badge badge-route"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <Building2 size={11} />
                            <span>Direct Customer</span>
                          </span>
                        )}
                      </td>

                      <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {device.loanAccountNo}
                      </td>

                      <td className="mono font-bold">
                        {formatINR(device.financedAmount)}
                      </td>

                      <td className="mono" style={{ color: 'var(--warning-text, #d97706)', fontWeight: 600 }}>
                        {formatINR(device.emiAmount)}
                      </td>

                      <td>
                        <span
                          className={`badge ${
                            device.loanStatus === 'ACTIVE'
                              ? 'badge-paid'
                              : device.loanStatus === 'PENDING_APPROVAL'
                              ? 'badge-warning'
                              : device.loanStatus === 'CLOSED'
                              ? 'badge-primary'
                              : 'badge-overdue'
                          }`}
                        >
                          {device.loanStatus}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`badge ${
                            device.deviceStatus === 'ACTIVE'
                              ? 'badge-paid'
                              : device.deviceStatus === 'LOCKED'
                              ? 'badge-danger'
                              : 'badge-route'
                          }`}
                        >
                          {device.deviceStatus}
                        </span>
                      </td>

                      <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedDevice(device)}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          title="View complete device context"
                        >
                          <Eye size={12} />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Showing Page {page} of {totalPages} ({totalCount} total devices)
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => {
                  const p = page - 1;
                  setPage(p);
                  fetchDevices(p);
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => {
                  const p = page + 1;
                  setPage(p);
                  fetchDevices(p);
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Device Detail Drawer / Modal */}
      {selectedDevice && (
        <div className="modal-overlay" onClick={() => setSelectedDevice(null)}>
          <div
            className="modal-content"
            style={{ width: '100%', maxWidth: 760, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                  }}
                >
                  <Smartphone size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                    {selectedDevice.deviceName}
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    IMEI: <span className="mono">{selectedDevice.imei1}</span> • Account:{' '}
                    <span className="mono" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                      {selectedDevice.loanAccountNo}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedDevice(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* SECTION 1: DEVICE DETAILS */}
            <div className="crm-card" style={{ padding: 16, marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  letterSpacing: '0.04em',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Smartphone size={14} color="var(--primary)" />
                <span>Device Specifications</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Brand</div>
                  <strong>{selectedDevice.deviceBrand}</strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Model</div>
                  <strong>{selectedDevice.deviceModel}</strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Device Status</div>
                  <span className="badge badge-paid">{selectedDevice.deviceStatus}</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>IMEI 1 / Primary</div>
                  <strong className="mono">{selectedDevice.imei1}</strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>IMEI 2 / Secondary</div>
                  <strong className="mono">{selectedDevice.imei2 || '—'}</strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Retail Cash Price</div>
                  <strong className="mono">{formatINR(selectedDevice.retailPrice)}</strong>
                </div>
              </div>
            </div>

            {/* SECTION 2: CUSTOMER CONTEXT */}
            <div className="crm-card" style={{ padding: 16, marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  letterSpacing: '0.04em',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <User size={14} color="var(--primary)" />
                <span>Customer & Ownership Context</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Customer Name</div>
                  <strong style={{ fontSize: 14 }}>{selectedDevice.customerName}</strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Customer Code</div>
                  <strong className="mono">{selectedDevice.customerCode}</strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Primary Phone</div>
                  <strong className="mono">{selectedDevice.primaryPhone}</strong>
                </div>
              </div>
            </div>

            {/* SECTION 3: FINANCING TERMS & DEALER ORIGINATION */}
            <div className="crm-card" style={{ padding: 16, marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  letterSpacing: '0.04em',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CreditCard size={14} color="var(--primary)" />
                <span>Financing & Originating Source</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Loan Account Number</div>
                  <strong className="mono" style={{ color: 'var(--primary)' }}>
                    {selectedDevice.loanAccountNo}
                  </strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Financing Source</div>
                  {selectedDevice.financingSource === 'DEALER' ? (
                    <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Store size={11} />
                      <span>Dealer: {selectedDevice.dealerStoreName}</span>
                    </span>
                  ) : (
                    <span className="badge badge-route" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Building2 size={11} />
                      <span>Direct Customer</span>
                    </span>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Loan Status</div>
                  <span className="badge badge-paid">{selectedDevice.loanStatus}</span>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Financed Amount</div>
                  <strong className="mono" style={{ color: 'var(--primary)' }}>
                    {formatINR(selectedDevice.financedAmount)}
                  </strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Down Payment</div>
                  <strong className="mono">{formatINR(selectedDevice.downPayment)}</strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tenure & Rate</div>
                  <span>
                    {selectedDevice.tenureMonths} Months • {selectedDevice.annualInterestRate}% / mo
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Monthly Installment (EMI)</div>
                  <strong className="mono" style={{ color: 'var(--warning-text, #d97706)' }}>
                    {formatINR(selectedDevice.emiAmount)}
                  </strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Loan Origination Date</div>
                  <span>{formatDateDDMMYYYY(selectedDevice.disbursementDate)}</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>First EMI Start Date</div>
                  <span>{formatDateDDMMYYYY(selectedDevice.firstEmiDate)}</span>
                </div>
              </div>
            </div>

            {/* SECTION 4: PAYMENT & COLLECTION STATE */}
            <div className="crm-card" style={{ padding: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  letterSpacing: '0.04em',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Calendar size={14} color="var(--primary)" />
                <span>Repayment & Collection Status</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total Paid to Date</div>
                  <strong className="mono" style={{ color: 'var(--success-text)' }}>
                    {formatINR(selectedDevice.totalPaid)}
                  </strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Current Outstanding</div>
                  <strong className="mono" style={{ color: 'var(--danger-text)' }}>
                    {formatINR(selectedDevice.outstandingBalance)}
                  </strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Pending Amount</div>
                  <strong className="mono">{formatINR(selectedDevice.pendingAmount)}</strong>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Next EMI Due Date</div>
                  <strong className="mono">
                    {selectedDevice.nextDueDate ? formatDateDDMMYYYY(selectedDevice.nextDueDate) : 'None / Completed'}
                  </strong>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Overdue Installments</div>
                  <span
                    className={`badge ${selectedDevice.overdueCount > 0 ? 'badge-overdue' : 'badge-paid'}`}
                  >
                    {selectedDevice.overdueCount > 0
                      ? `${selectedDevice.overdueCount} Overdue (${selectedDevice.daysOverdue} days)`
                      : 'None'}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Applicable Penalty</div>
                  <strong
                    className="mono"
                    style={{
                      color: selectedDevice.penaltyAmount > 0 ? 'var(--danger-text)' : 'inherit',
                      fontWeight: selectedDevice.penaltyAmount > 0 ? 700 : 400,
                    }}
                  >
                    {formatINR(selectedDevice.penaltyAmount)}
                  </strong>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setSelectedDevice(null)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
