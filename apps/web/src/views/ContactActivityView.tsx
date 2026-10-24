import React, { useEffect, useState } from 'react';
import {
  IContactActivity,
  IContactActivitySummary,
  IAdminContactActivitySummary,
  IAgentPerformanceMetrics,
  UserRole,
  formatINR,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  MessageSquare,
  Mail,
  UserCheck,
  CheckCircle2,
  Calendar,
  Clock,
  AlertCircle,
  AlertTriangle,
  Download,
  Filter,
  Plus,
  Search,
  Eye,
  RefreshCw,
  TrendingUp,
  FileSpreadsheet,
  Users,
} from 'lucide-react';
import { LogContactModal } from '../components/LogContactModal';
import { ContactActivityDetailModal } from '../components/ContactActivityDetailModal';

export const ContactActivityView: React.FC = () => {
  const currentUser = ApiClient.getUser();
  const isAdmin =
    currentUser?.role === UserRole.SUPER_ADMIN ||
    currentUser?.role === UserRole.ADMIN ||
    currentUser?.role === UserRole.BRANCH_MANAGER;

  // View state
  const [activities, setActivities] = useState<IContactActivity[]>([]);
  const [totalActivities, setTotalActivities] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);

  // Summary state
  const [summary, setSummary] = useState<IContactActivitySummary | null>(null);
  const [adminSummary, setAdminSummary] = useState<IAdminContactActivitySummary | null>(null);

  // Filters state
  const [preset, setPreset] = useState<string>('TODAY');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<string>('');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('');
  const [commitmentStatusFilter, setCommitmentStatusFilter] = useState<string>('');
  const [followUpStatusFilter, setFollowUpStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');

  // Modals
  const [showLogModal, setShowLogModal] = useState<boolean>(false);
  const [selectedActivity, setSelectedActivity] = useState<IContactActivity | null>(null);

  // Load metrics & activity list
  const loadData = async () => {
    setLoading(true);
    try {
      const queryParams: Record<string, any> = {
        page,
        limit,
        preset,
        search: searchQuery.trim() || undefined,
        contactMethod: methodFilter || undefined,
        contactOutcome: outcomeFilter || undefined,
        commitmentStatus: commitmentStatusFilter || undefined,
        followUpStatus: followUpStatusFilter || undefined,
      };

      if (preset === 'CUSTOM') {
        if (startDate) queryParams.startDate = startDate;
        if (endDate) queryParams.endDate = endDate;
      }

      if (isAdmin && selectedAgentId) {
        queryParams.agentId = selectedAgentId;
      }

      // Fetch activities list
      const listRes = await ApiClient.getContactActivities(queryParams);
      setActivities(listRes.data || []);
      setTotalActivities(listRes.meta?.total || 0);

      // Fetch Today's 12 Activity Summary metrics
      const summaryRes = await ApiClient.getContactActivitySummary({
        agentId: isAdmin && selectedAgentId ? selectedAgentId : undefined,
      });
      setSummary(summaryRes);

      // If Admin, also fetch Admin Summary & Agent Performance metrics
      if (isAdmin) {
        const adminRes = await ApiClient.getAdminContactActivitySummary({
          preset,
          startDate: preset === 'CUSTOM' ? startDate : undefined,
          endDate: preset === 'CUSTOM' ? endDate : undefined,
        });
        setAdminSummary(adminRes);
      }
    } catch (err) {
      console.error('Failed to load contact activity data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [
    page,
    preset,
    startDate,
    endDate,
    methodFilter,
    outcomeFilter,
    commitmentStatusFilter,
    followUpStatusFilter,
    selectedAgentId,
  ]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadData();
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const exportParams: Record<string, string> = {
        preset,
      };
      if (preset === 'CUSTOM') {
        if (startDate) exportParams.startDate = startDate;
        if (endDate) exportParams.endDate = endDate;
      }
      if (selectedAgentId) exportParams.agentId = selectedAgentId;
      if (methodFilter) exportParams.contactMethod = methodFilter;
      if (outcomeFilter) exportParams.contactOutcome = outcomeFilter;

      await ApiClient.downloadContactActivitiesExport(exportParams);
    } catch (err: any) {
      alert(err.message || 'CSV Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: '#0f172a' }}>
            {isAdmin ? 'Agent Contact Activity & Follow-ups Monitoring' : 'My Contact Activity & Follow-ups'}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Real-time tracking of customer contact attempts, reasons for non-payment, promises to pay, and scheduled recovery appointments.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {isAdmin && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleExportCsv}
              disabled={exporting}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <Download size={15} />
              <span>{exporting ? 'Exporting...' : 'Export Activity CSV'}</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowLogModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          >
            <Plus size={16} />
            <span>Log Contact</span>
          </button>
        </div>
      </div>

      {/* SECTION A: Today's Activity Summary (12 Metrics Cards) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
            Today's Activity Summary
          </h3>
          <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>
            * Button clicks are never counted as telco deliveries. Collections are tracked separately.
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 12,
          }}
        >
          {/* 1. Contacted */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Unique Contacted</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#1e293b' }}>
              {summary?.totalCustomersContacted ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Customers today</div>
          </div>

          {/* 2. Call Attempts */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Call Attempts</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#2563eb' }}>
              {summary?.totalCallAttempts ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#2563eb', marginTop: 2 }}>Dialed attempts</div>
          </div>

          {/* 3. Calls Answered */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Calls Answered</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#16a34a' }}>
              {summary?.callsAnswered ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>Agent reported</div>
          </div>

          {/* 4. Calls Unanswered */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Unanswered / Busy</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#dc2626' }}>
              {summary?.callsUnanswered ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>No answer / unreachable</div>
          </div>

          {/* 5. WhatsApp Sent/Opened */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>WhatsApp Actions</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#0d9488' }}>
              {summary?.whatsAppCount ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#0d9488', marginTop: 2 }}>Initiated / Reported</div>
          </div>

          {/* 6. SMS Attempts */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>SMS Attempts</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#475569' }}>
              {summary?.smsCount ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Reported SMS</div>
          </div>

          {/* 7. In-person Visits */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>In-Person Visits</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#7c3aed' }}>
              {summary?.inPersonVisits ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 2 }}>Field visits</div>
          </div>

          {/* 8. Successful Conversations */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Conversations</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#0284c7' }}>
              {summary?.successfulConversations ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#0284c7', marginTop: 2 }}>Meaningful dialogues</div>
          </div>

          {/* 9. Promised to Pay */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Promises to Pay</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#059669' }}>
              {summary?.promisedToPayCount ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>
              Payment commitments
            </div>
          </div>

          {/* 10. Follow-ups Due Today */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Follow-ups Due</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#ea580c' }}>
              {summary?.followUpsDueToday ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#ea580c', marginTop: 2 }}>Scheduled today</div>
          </div>

          {/* 11. Follow-ups Overdue */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Overdue Follow-ups</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#b91c1c' }}>
              {summary?.followUpsOverdue ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 2 }}>Action required</div>
          </div>

          {/* 12. Collections Resulting from Contact */}
          <div className="crm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Linked Collections</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: '#15803d' }}>
              {formatINR(Number(summary?.collectionsResultingAmount || 0))}
            </div>
            <div style={{ fontSize: 11, color: '#15803d', marginTop: 2 }}>
              {summary?.collectionsResultingCount ?? 0} payments confirmed
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: Admin Monitoring Performance Table */}
      {isAdmin && adminSummary && adminSummary.agents && adminSummary.agents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
            Agent Performance Overview (Filtered Window)
          </h3>

          <div className="table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Agent Name</th>
                  <th>Unique Contacted</th>
                  <th>Call Attempts</th>
                  <th>Conversations</th>
                  <th>Follow-ups Completed</th>
                  <th>Follow-ups Overdue</th>
                  <th>Promises Made</th>
                  <th>Promises Fulfilled</th>
                  <th>Collections Recorded</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {adminSummary.agents.map((perf: IAgentPerformanceMetrics) => (
                  <tr key={perf.agentId}>
                    <td style={{ fontWeight: 600 }}>
                      <div>{perf.agentName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{perf.agentEmail}</div>
                    </td>
                    <td>{perf.customersContacted}</td>
                    <td>{perf.callAttempts}</td>
                    <td>{perf.conversationsCompleted}</td>
                    <td>
                      <span className="badge badge-success">{perf.followUpsCompleted}</span>
                    </td>
                    <td>
                      {perf.followUpsOverdue > 0 ? (
                        <span className="badge badge-danger">{perf.followUpsOverdue}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>0</span>
                      )}
                    </td>
                    <td>
                      <div>{perf.promisesMade}</div>
                    </td>
                    <td>
                      <span className="badge badge-success">{perf.promisesFulfilled}</span>
                    </td>
                    <td style={{ fontWeight: 700, color: '#15803d' }}>
                      {formatINR(Number(perf.collectionsAmount))}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {perf.collectionsCount} collections
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => setSelectedAgentId(perf.agentId)}
                      >
                        {selectedAgentId === perf.agentId ? 'Viewing' : 'Filter Activity'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION B: Activity Filters */}
      <div className="crm-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {/* Preset Buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'TODAY', label: 'Today' },
              { id: 'YESTERDAY', label: 'Yesterday' },
              { id: 'LAST_7_DAYS', label: 'Last 7 Days' },
              { id: 'LAST_30_DAYS', label: 'Last 30 Days' },
              { id: 'CUSTOM', label: 'Custom Range' },
              { id: 'ALL', label: 'All Records' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPreset(p.id);
                  setPage(1);
                }}
                className={`btn ${preset === p.id ? 'btn-primary' : 'btn-outline'}`}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Reset Filters */}
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setPreset('TODAY');
              setStartDate('');
              setEndDate('');
              setMethodFilter('');
              setOutcomeFilter('');
              setCommitmentStatusFilter('');
              setFollowUpStatusFilter('');
              setSearchQuery('');
              setSelectedAgentId('');
              setPage(1);
            }}
            style={{ fontSize: 11, padding: '4px 10px', color: 'var(--text-muted)' }}
          >
            Clear Filters
          </button>
        </div>

        {/* Custom Date Range if selected */}
        {preset === 'CUSTOM' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>From:</span>
            <input
              type="date"
              className="form-input"
              style={{ width: 160 }}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600 }}>To:</span>
            <input
              type="date"
              className="form-input"
              style={{ width: 160 }}
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
        )}

        {/* Detailed Dropdown Filters & Search */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {/* Method Filter */}
          <select
            className="form-select"
            value={methodFilter}
            onChange={(e) => {
              setMethodFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Contact Methods</option>
            <option value="PHONE_CALL">Phone Call</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="SMS">SMS</option>
            <option value="IN_PERSON_VISIT">In-Person Visit</option>
            <option value="OTHER">Other</option>
          </select>

          {/* Outcome Filter */}
          <select
            className="form-select"
            value={outcomeFilter}
            onChange={(e) => {
              setOutcomeFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Outcomes</option>
            <option value="ANSWERED_CONVERSATION">Answered / Conversation</option>
            <option value="NO_ANSWER">No Answer</option>
            <option value="BUSY">Busy</option>
            <option value="SWITCHED_OFF_UNREACHABLE">Switched Off / Unreachable</option>
            <option value="INVALID_NUMBER">Invalid Number</option>
            <option value="WHATSAPP_MESSAGE_SENT">WhatsApp Sent</option>
            <option value="SMS_SENT">SMS Sent</option>
            <option value="VISIT_COMPLETED">Visit Completed</option>
            <option value="CUSTOMER_REFUSED_TO_TALK">Refused to Talk</option>
            <option value="OTHER">Other</option>
          </select>

          {/* Commitment Status */}
          <select
            className="form-select"
            value={commitmentStatusFilter}
            onChange={(e) => {
              setCommitmentStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Commitment Statuses</option>
            <option value="PENDING">Pending Commitment</option>
            <option value="FULFILLED">Fulfilled Commitment</option>
            <option value="BROKEN">Broken Commitment</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {/* Follow-up Status */}
          <select
            className="form-select"
            value={followUpStatusFilter}
            onChange={(e) => {
              setFollowUpStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Follow-up Statuses</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="OVERDUE">Overdue</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search customer, loan, agent..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-outline" style={{ padding: '6px 10px' }}>
              <Search size={14} />
            </button>
          </form>
        </div>
      </div>

      {/* SECTION C: Activity Timeline / Table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
            Contact Timeline & Records ({totalActivities} Total)
          </h3>
          <button
            type="button"
            className="btn btn-outline"
            onClick={loadData}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={12} />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div
              className="animate-spin"
              style={{
                width: 24,
                height: 24,
                border: '2px solid var(--border-subtle)',
                borderTopColor: 'var(--primary)',
                borderRadius: '50%',
                margin: '0 auto 10px',
              }}
            />
            <span>Loading contact activities...</span>
          </div>
        ) : activities.length === 0 ? (
          <div
            className="crm-card"
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <PhoneCall size={36} color="var(--border-subtle)" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>
                No Contact Activities Found
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                No contact attempts match your current filters. Click "Log Contact" to record a customer call or visit.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowLogModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 4 }}
            >
              <Plus size={15} />
              <span>Log Contact Now</span>
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Customer & Loan</th>
                  {isAdmin && <th>Agent</th>}
                  <th>Method</th>
                  <th>Outcome</th>
                  <th>Response & Reason</th>
                  <th>Commitment</th>
                  <th>Next Follow-up</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((act) => {
                  const createdAtDate = new Date(act.createdAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  });

                  return (
                    <tr key={act.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        <div>{createdAtDate}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          ID: {act.id.slice(0, 8)}
                        </div>
                      </td>

                      <td>
                        <div style={{ fontWeight: 600 }}>{act.customerName || 'N/A'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Ref: {act.customerCode || act.customerId.slice(0, 8)}
                        </div>
                        {act.loanAccountNo && (
                          <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 500 }}>
                            Acc: {act.loanAccountNo}
                          </div>
                        )}
                      </td>

                      {isAdmin && (
                        <td>
                          <div style={{ fontWeight: 500 }}>{act.agentName || 'Agent'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{act.agentEmail}</div>
                        </td>
                      )}

                      <td>
                        <span
                          className="badge badge-info"
                          style={{ fontSize: 11, textTransform: 'none' }}
                        >
                          {act.contactMethod === 'OTHER'
                            ? act.contactMethodOther || 'Other'
                            : act.contactMethod.replace(/_/g, ' ')}
                        </span>
                      </td>

                      <td>
                        <span
                          className="badge"
                          style={{
                            fontSize: 11,
                            backgroundColor:
                              act.contactOutcome === 'ANSWERED_CONVERSATION_COMPLETED' ||
                              act.contactOutcome === 'VISIT_COMPLETED'
                                ? '#dcfce7'
                                : '#fee2e2',
                            color:
                              act.contactOutcome === 'ANSWERED_CONVERSATION_COMPLETED' ||
                              act.contactOutcome === 'VISIT_COMPLETED'
                                ? '#15803d'
                                : '#b91c1c',
                          }}
                        >
                          {act.contactOutcome === 'OTHER'
                            ? act.contactOutcomeOther || 'Other'
                            : act.contactOutcome.replace(/_/g, ' ')}
                        </span>
                      </td>

                      <td style={{ maxWidth: 220 }}>
                        {act.customerResponseCategory && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#1e3a8a' }}>
                            {act.customerResponseCategory.replace(/_/g, ' ')}
                          </div>
                        )}
                        {act.customerResponseNotes && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--text-secondary)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 200,
                            }}
                          >
                            "{act.customerResponseNotes}"
                          </div>
                        )}
                        {act.nonPaymentReason && (
                          <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }}>
                            Reason: {act.nonPaymentReason.replace(/_/g, ' ')}
                          </div>
                        )}
                      </td>

                      <td>
                        {act.promisedPaymentAmount ? (
                          <div>
                            <div style={{ fontWeight: 700, color: '#15803d', fontSize: 12 }}>
                              {formatINR(Number(act.promisedPaymentAmount))}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              Due: {act.promisedPaymentDate || 'N/A'}
                            </div>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                color:
                                  act.commitmentStatus === 'FULFILLED'
                                    ? '#15803d'
                                    : act.commitmentStatus === 'BROKEN'
                                    ? '#b91c1c'
                                    : '#92400e',
                              }}
                            >
                              {act.commitmentStatus}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>

                      <td>
                        {act.followUpDate ? (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600 }}>{act.followUpDate}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              {act.followUpTime || '11:00'} ({act.followUpPriority})
                            </div>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                color:
                                  act.followUpStatus === 'COMPLETED'
                                    ? '#15803d'
                                    : act.followUpStatus === 'CANCELLED'
                                    ? '#64748b'
                                    : '#0284c7',
                              }}
                            >
                              {act.followUpStatus}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>None</span>
                        )}
                      </td>

                      <td>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => setSelectedActivity(act)}
                          style={{
                            fontSize: 11,
                            padding: '4px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Eye size={12} />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalActivities > limit && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalActivities)} of{' '}
              {totalActivities} contact entries
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-outline"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={page * limit >= totalActivities}
                onClick={() => setPage((prev) => prev + 1)}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Log Contact Modal */}
      <LogContactModal
        isOpen={showLogModal}
        onClose={() => setShowLogModal(false)}
        onSuccess={() => {
          loadData();
        }}
      />

      {/* Contact Activity Detail Modal */}
      <ContactActivityDetailModal
        activity={selectedActivity}
        onClose={() => setSelectedActivity(null)}
        onActivityUpdated={() => {
          loadData();
        }}
      />
    </div>
  );
};
