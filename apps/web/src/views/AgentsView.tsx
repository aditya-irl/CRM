import React, { useState, useEffect } from 'react';
import { ApiClient } from '../services/api';
import { formatDateDDMMYYYY } from '@crm/shared';
import { CredentialModal } from '../components/CredentialModal';
import {
  UserCheck,
  Plus,
  Search,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Phone,
  User,
  Clock,
  CheckCircle2,
  X,
  Power,
  RefreshCw,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

interface AgentUser {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  loginId?: string;
  login_id?: string;
  full_name?: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword?: boolean;
  must_change_password?: boolean;
  lastLoginAt?: string | null;
  last_login_at?: string | null;
  createdAt?: string;
  created_at?: string;
}

export const AgentsView: React.FC = () => {
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loginId, setLoginId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Credential Modal State
  const [credentialModalData, setCredentialModalData] = useState<{
    loginId: string;
    temporaryPassword?: string;
    fullName: string;
    phone: string;
    role: string;
    isReset?: boolean;
  } | null>(null);

  // Resetting state
  const [resettingId, setResettingId] = useState<string | null>(null);

  // Delete Agent Modal State
  const [agentToDelete, setAgentToDelete] = useState<AgentUser | null>(null);
  const [reassignToAgentId, setReassignToAgentId] = useState<string>('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.getUsers('COLLECTION_AGENT');
      setAgents(data);
    } catch (err: any) {
      console.error('Failed to load agents', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await ApiClient.createAgent({
        fullName: fullName.trim(),
        phone: phone.trim(),
        loginId: loginId.trim() || undefined,
        status: 'ACTIVE',
      });

      setShowCreateModal(false);
      setFullName('');
      setPhone('');
      setLoginId('');
      loadAgents();

      if (res?.temporaryPassword) {
        setCredentialModalData({
          loginId: res.loginId || res.user?.loginId || phone.trim(),
          temporaryPassword: res.temporaryPassword,
          fullName: res.user?.fullName || fullName.trim(),
          phone: res.user?.phone || phone.trim(),
          role: 'COLLECTION_AGENT',
          isReset: false,
        });
      }
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create collection agent');
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (agent: AgentUser) => {
    const agName = agent.fullName || agent.full_name || 'Agent';
    if (!confirm(`Are you sure you want to reset password for ${agName}? Previous password will be invalidated.`)) {
      return;
    }

    setResettingId(agent.id);
    try {
      const res = await ApiClient.resetAgentPassword(agent.id);
      loadAgents();

      if (res?.temporaryPassword) {
        setCredentialModalData({
          loginId: res.loginId || res.user?.loginId || agent.phone,
          temporaryPassword: res.temporaryPassword,
          fullName: res.user?.fullName || agName,
          phone: res.user?.phone || agent.phone,
          role: 'COLLECTION_AGENT',
          isReset: true,
        });
      } else {
        alert('Password reset successful, but temporary password was not returned.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to reset password');
    } finally {
      setResettingId(null);
    }
  };

  const handleToggleStatus = async (agent: AgentUser) => {
    const nextStatus = agent.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const agName = agent.fullName || agent.full_name || 'Agent';
    if (!confirm(`Are you sure you want to change ${agName}'s status to ${nextStatus}?`)) {
      return;
    }

    try {
      await ApiClient.updateAgentStatus(agent.id, nextStatus);
      loadAgents();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
  };

  const handleDeleteAgent = async () => {
    if (!agentToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await ApiClient.deleteAgent(agentToDelete.id, reassignToAgentId || undefined);
      setDeleteNotice(res.message || 'Agent deleted successfully');
      setAgentToDelete(null);
      setReassignToAgentId('');
      loadAgents();
      setTimeout(() => setDeleteNotice(null), 6000);
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete agent');
    } finally {
      setDeleting(false);
    }
  };

  const filteredAgents = agents.filter((ag) => {
    const name = (ag.fullName || ag.full_name || '').toLowerCase();
    const ph = (ag.phone || '').toLowerCase();
    const lId = (ag.loginId || ag.login_id || '').toLowerCase();
    const matchesSearch = !search || name.includes(search.toLowerCase()) || ph.includes(search.toLowerCase()) || lId.includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || ag.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
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
              <UserCheck size={20} />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Field Collection Agents
              </h1>
              <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Manage recovery agents, provision secure login credentials, and view field assignment access
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Plus size={16} />
          <span>Provision New Agent</span>
        </button>
      </div>

      {deleteNotice && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            background: 'var(--success-bg)',
            border: '1px solid var(--success-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--success-text)',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 20,
          }}
        >
          <CheckCircle2 size={16} />
          <span>{deleteNotice}</span>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div
        className="crm-card"
        style={{
          padding: '16px 20px',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 260 }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
            <Search
              size={15}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: 36, width: '100%' }}
              placeholder="Search by name, phone, or login ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Status:</span>
          {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`btn btn-sm ${statusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, textTransform: 'capitalize' }}
            >
              {st.toLowerCase()}
            </button>
          ))}
          <button
            onClick={loadAgents}
            className="btn btn-secondary btn-sm"
            style={{ marginLeft: 8 }}
            title="Refresh list"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Agents Table */}
      <div className="crm-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Agent Name</th>
                <th>Login ID</th>
                <th>Contact Phone</th>
                <th>Status</th>
                <th>Password State</th>
                <th>Last Login</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Loading collection agents...
                  </td>
                </tr>
              ) : filteredAgents.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    No field collection agents found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredAgents.map((ag) => {
                  const agName = ag.fullName || ag.full_name || 'Agent';
                  const agLogin = ag.loginId || ag.login_id || ag.phone;
                  const mustChange = Boolean(ag.mustChangePassword ?? ag.must_change_password);
                  const lastLogin = ag.lastLoginAt || ag.last_login_at;

                  return (
                    <tr key={ag.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              background: 'var(--bg-surface-secondary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: 12,
                              color: 'var(--primary)',
                            }}
                          >
                            {agName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>
                              {agName}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              Collection Agent
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 13 }}>
                          {agLogin}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                          <Phone size={13} color="var(--text-muted)" />
                          <span className="mono">{ag.phone}</span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${ag.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}
                          style={{ fontSize: 11 }}
                        >
                          {ag.status}
                        </span>
                      </td>
                      <td>
                        {mustChange ? (
                          <span
                            className="badge badge-warning"
                            style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <ShieldAlert size={11} />
                            Must Change Pass
                          </span>
                        ) : (
                          <span
                            className="badge badge-neutral"
                            style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <ShieldCheck size={11} />
                            Active Pass
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {lastLogin ? formatDateDDMMYYYY(lastLogin) : 'Never'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {ag.createdAt || ag.created_at ? formatDateDDMMYYYY(ag.createdAt || ag.created_at!) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            onClick={() => handleResetPassword(ag)}
                            disabled={resettingId === ag.id}
                            className="btn btn-secondary btn-sm"
                            title="Reset Password & Issue One-time Temp Password"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                          >
                            <KeyRound size={12} />
                            <span>{resettingId === ag.id ? 'Resetting...' : 'Reset Pass'}</span>
                          </button>
                          <button
                            onClick={() => handleToggleStatus(ag)}
                            className={`btn btn-sm ${ag.status === 'ACTIVE' ? 'btn-secondary' : 'btn-success'}`}
                            title={ag.status === 'ACTIVE' ? 'Deactivate Agent' : 'Activate Agent'}
                            style={{ fontSize: 11 }}
                          >
                            <Power size={12} />
                            <span>{ag.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</span>
                          </button>
                          <button
                            onClick={() => {
                              setAgentToDelete(ag);
                              setDeleteError(null);
                              setReassignToAgentId('');
                            }}
                            className="btn btn-sm"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              background: 'var(--danger-subtle)',
                              color: 'var(--danger-text)',
                              border: '1px solid var(--danger-border)',
                            }}
                            title="Delete Agent Account"
                          >
                            <Trash2 size={12} />
                            <span>Delete</span>
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

      {/* Create Agent Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 460, width: '100%', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <UserCheck size={20} color="var(--primary)" />
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Provision Collection Agent</h3>
              </div>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateError(null);
                }}
                className="btn btn-secondary btn-sm"
              >
                <X size={15} />
              </button>
            </div>

            {createError && (
              <div
                style={{
                  background: 'var(--danger-subtle)',
                  color: 'var(--danger-text)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  marginBottom: 16,
                }}
              >
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateAgent} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                  Full Name <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                  Phone Number (10 Digits) <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="tel"
                  className="form-input mono"
                  placeholder="e.g. 9876543210"
                  maxLength={10}
                  pattern="[0-9]{10}"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  required
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Used as fallback Login ID if custom ID is not specified.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                  Custom Login ID (Optional)
                </label>
                <input
                  type="text"
                  className="form-input mono"
                  placeholder="e.g. AGENT_RAHUL"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Leave blank to automatically use the phone number as the Login ID.
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface-secondary)',
                  padding: 12,
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}
              >
                A cryptographically secure temporary password will be automatically generated and displayed in a one-time credential modal upon creation. The agent will be required to set a permanent password on first login.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError(null);
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="btn btn-primary">
                  {creating ? 'Provisioning...' : 'Create Agent & Generate Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credential Modal */}
      {credentialModalData && (
        <CredentialModal
          accountType="AGENT"
          title={credentialModalData.isReset ? 'Agent Password Reset' : 'Agent Login Credentials'}
          subtitle={credentialModalData.fullName}
          loginId={credentialModalData.loginId}
          temporaryPassword={credentialModalData.temporaryPassword || ''}
          phone={credentialModalData.phone}
          isReset={credentialModalData.isReset}
          onClose={() => setCredentialModalData(null)}
        />
      )}

      {/* Delete Agent Confirmation Modal */}
      {agentToDelete && (
        <div className="modal-overlay" style={{ zIndex: 2500 }}>
          <div className="modal-content" style={{ maxWidth: 480, width: '100%', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--danger-subtle)',
                    color: 'var(--danger-text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Trash2 size={16} />
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Delete Agent Account
                </h3>
              </div>
              <button
                onClick={() => {
                  setAgentToDelete(null);
                  setDeleteError(null);
                }}
                className="btn btn-secondary btn-sm"
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                Are you sure you want to delete the collection agent account for{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {agentToDelete.fullName || agentToDelete.full_name}
                </strong>{' '}
                (<span className="mono">{agentToDelete.phone || agentToDelete.loginId || agentToDelete.email}</span>)?
              </p>

              <div
                style={{
                  background: 'var(--warning-subtle)',
                  border: '1px solid var(--warning-border)',
                  color: 'var(--warning-text)',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  lineHeight: '1.4',
                  marginBottom: 16,
                }}
              >
                <strong>Security & Financial Audit Guarantee:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                  <li>Agent access will be revoked immediately; active sessions are invalidated.</li>
                  <li>All historical collection records, receipts, and audit trail are permanently preserved.</li>
                  <li>Active customers and loan assignments can be reassigned below, or safely unassigned.</li>
                </ul>
              </div>

              {deleteError && (
                <div
                  style={{
                    background: 'var(--danger-subtle)',
                    color: 'var(--danger-text)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12,
                    marginBottom: 14,
                  }}
                >
                  {deleteError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Reassign Active Cases To: (Optional)
                </label>
                <select
                  className="form-select"
                  value={reassignToAgentId}
                  onChange={(e) => setReassignToAgentId(e.target.value)}
                  style={{ width: '100%', fontSize: 12 }}
                >
                  <option value="">Do not reassign (Safely unassign active loans)</option>
                  {agents
                    .filter((ag) => ag.id !== agentToDelete.id && ag.status === 'ACTIVE')
                    .map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.fullName || ag.full_name} ({ag.phone})
                      </option>
                    ))}
                </select>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  If selected, all active loan and collection assignments are atomically transferred to the chosen agent.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => {
                  setAgentToDelete(null);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAgent}
                disabled={deleting}
                className="btn btn-danger btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Trash2 size={13} />
                <span>{deleting ? 'Deleting...' : 'Confirm Delete Agent'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
