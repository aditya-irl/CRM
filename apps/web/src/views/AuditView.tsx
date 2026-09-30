import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import { IAuditLog } from '@crm/shared';
import { ShieldCheck, Search, Eye, Filter, X } from 'lucide-react';
import { AuditDetailModal } from '../components/AuditDetailModal';

export const AuditView: React.FC = () => {
  const [logs, setLogs] = useState<IAuditLog[]>([]);
  const [entityFilter, setEntityFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.getAuditLogs(entityFilter || undefined);
      setLogs(data);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [entityFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Immutable Financial Audit Trail</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Cryptographically sealed system audit records protecting all financial mutations and user operations.
          </p>
        </div>
      </div>

      <div className="crm-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Filter size={15} color="var(--primary)" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Filter by Entity:</span>
        <select
          className="form-select"
          style={{ width: 220 }}
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
        >
          <option value="">All Audited Entities</option>
          <option value="Payment">Payments & Collections</option>
          <option value="Loan">Loans & Amortizations</option>
          <option value="Customer">Customers</option>
          <option value="KYCDocument">KYC Documents</option>
          <option value="CallLog">Call Logs</option>
          <option value="User">User Authentication</option>
        </select>
      </div>

      <div className="table-container">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Entity ID</th>
              <th>Actor</th>
              <th>IP Address</th>
              <th>State Delta</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  Loading audit trail...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  No audit logs found for this filter.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(log.createdAt || (log as any).created_at).toLocaleString('en-IN', { hour12: true })}
                  </td>
                  <td>
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 12 }}>
                      {log.action}
                    </span>
                  </td>
                  <td>{log.entity}</td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {(log.entityId || (log as any).entity_id)?.slice(0, 12)}...
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {(log as any).user_full_name || 'System Auto'}
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {log.ipAddress || (log as any).ip_address || '127.0.0.1'}
                  </td>
                  <td>
                    <button
                      onClick={() => setSelectedLogId(log.id)}
                      className="btn btn-secondary btn-sm"
                      id={`inspect-btn-${log.id}`}
                    >
                      <Eye size={12} />
                      <span>Inspect</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Professional Enterprise Audit-Log Inspector Modal */}
      {selectedLogId && (
        <AuditDetailModal
          logId={selectedLogId}
          onClose={() => setSelectedLogId(null)}
        />
      )}
    </div>
  );
};
