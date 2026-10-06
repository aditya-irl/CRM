import React, { useState, useEffect } from 'react';
import { IDealer, DealerStatus, UserRole } from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  Store,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  Edit2,
  Power,
  X,
  Smartphone,
  CheckCircle,
  AlertCircle,
  Building,
  Receipt,
  ArrowRight,
  Landmark,
  Banknote,
  Shield,
  KeyRound,
  Copy,
  Check,
  MessageSquare,
} from 'lucide-react';

const formatINR = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

interface DealersViewProps {
  onNavigateToCollections?: (dealerId: string) => void;
  onNavigateToSettlements?: (dealerId: string) => void;
}

export const DealersView: React.FC<DealersViewProps> = ({
  onNavigateToCollections,
  onNavigateToSettlements,
}) => {
  const [dealers, setDealers] = useState<IDealer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Super Admin Settings State
  const currentUser = ApiClient.getUser();
  const [allowDealerPenalty, setAllowDealerPenalty] = useState(false);
  const [settingLoading, setSettingLoading] = useState(false);

  useEffect(() => {
    if (currentUser?.role === UserRole.SUPER_ADMIN) {
      ApiClient.getDealerPenaltySetting()
        .then((res) => setAllowDealerPenalty(res.allowDealerPenalty))
        .catch((err) => console.error('Failed to load dealer penalty setting', err));
    }
  }, [currentUser?.role]);

  const handleToggleDealerPenalty = async () => {
    setSettingLoading(true);
    try {
      const res = await ApiClient.updateDealerPenaltySetting(!allowDealerPenalty);
      setAllowDealerPenalty(res.allowDealerPenalty);
    } catch (err: any) {
      alert(err.message || 'Failed to update setting');
    } finally {
      setSettingLoading(false);
    }
  };

  // Drawer / Modal states
  const [selectedDealerId, setSelectedDealerId] = useState<string | null>(null);
  const [dealerDetail, setDealerDetail] = useState<{ dealer: IDealer; loans: any[] } | null>(null);
  const [dealerCollectionsData, setDealerCollectionsData] = useState<any | null>(null);
  const [dealerSettlementsData, setDealerSettlementsData] = useState<any | null>(null);
  const [drawerTab, setDrawerTab] = useState<'loans' | 'collections' | 'settlements'>('loans');
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Add / Edit Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDealer, setEditingDealer] = useState<IDealer | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    storeName: '',
    ownerName: '',
    phone: '',
    alternatePhone: '',
    email: '',
    address: '',
    areaCity: '',
  });
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Dealer Auth states
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authActionNotice, setAuthActionNotice] = useState<string | null>(null);
  const [authModalCredentials, setAuthModalCredentials] = useState<{
    storeName: string;
    dealerCode: string;
    dealerPhone?: string | null;
    loginId: string;
    temporaryPassword: string;
    isReset?: boolean;
  } | null>(null);
  const [copiedPass, setCopiedPass] = useState(false);
  const [copiedLoginId, setCopiedLoginId] = useState(false);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  const handleCreateDealerLogin = async (dealer: IDealer) => {
    setAuthActionLoading(true);
    setAuthActionNotice(null);
    try {
      const res = await ApiClient.createDealerLogin(dealer.id);
      setAuthModalCredentials({
        storeName: dealer.storeName,
        dealerCode: dealer.dealerCode,
        dealerPhone: dealer.phone,
        loginId: res.loginId,
        temporaryPassword: res.temporaryPassword,
        isReset: false,
      });
      const updated = await ApiClient.getDealerDetail(dealer.id);
      setDealerDetail(updated);
      fetchDealers();
    } catch (err: any) {
      alert(err.message || 'Failed to create dealer login');
    } finally {
      setAuthActionLoading(false);
    }
  };

  const handleResetDealerPassword = async (dealer: IDealer) => {
    if (!window.confirm(`Reset temporary password for ${dealer.storeName}?`)) {
      return;
    }
    setAuthActionLoading(true);
    setAuthActionNotice(null);
    try {
      const res = await ApiClient.resetDealerPassword(dealer.id);
      setAuthModalCredentials({
        storeName: dealer.storeName,
        dealerCode: dealer.dealerCode,
        dealerPhone: dealer.phone,
        loginId: res.loginId,
        temporaryPassword: res.temporaryPassword,
        isReset: true,
      });
      const updated = await ApiClient.getDealerDetail(dealer.id);
      setDealerDetail(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to reset password');
    } finally {
      setAuthActionLoading(false);
    }
  };

  const handleToggleDealerLoginStatus = async (dealer: IDealer, currentStatus?: string | null) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const actionWord = nextStatus === 'ACTIVE' ? 'activate' : 'disable';
    if (!window.confirm(`Are you sure you want to ${actionWord} login access for ${dealer.storeName}?`)) {
      return;
    }
    setAuthActionLoading(true);
    try {
      await ApiClient.updateDealerLoginStatus(dealer.id, nextStatus as any);
      setAuthActionNotice(`Login access ${nextStatus === 'ACTIVE' ? 'activated' : 'disabled'} successfully.`);
      setTimeout(() => setAuthActionNotice(null), 4000);
      const updated = await ApiClient.getDealerDetail(dealer.id);
      setDealerDetail(updated);
      fetchDealers();
    } catch (err: any) {
      alert(err.message || 'Failed to update login status');
    } finally {
      setAuthActionLoading(false);
    }
  };

  const fetchDealers = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.getDealers(
        search || undefined,
        statusFilter === 'ALL' ? undefined : statusFilter,
        areaFilter || undefined
      );
      setDealers(data);
    } catch (err) {
      console.error('Failed to load dealers', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDealers();
  }, [statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDealers();
  };

  const handleOpenDetail = async (id: string) => {
    setSelectedDealerId(id);
    setLoadingDetail(true);
    setDrawerTab('loans');
    try {
      const [detail, collections, settlements] = await Promise.all([
        ApiClient.getDealerDetail(id),
        ApiClient.getSingleDealerCollections(id).catch(() => null),
        ApiClient.getDealerSettlements({ dealerId: id, limit: 10 }).catch(() => null),
      ]);
      setDealerDetail(detail);
      setDealerCollectionsData(collections);
      setDealerSettlementsData(settlements);
    } catch (err) {
      alert('Failed to load dealer details');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleOpenAdd = () => {
    setFormData({
      storeName: '',
      ownerName: '',
      phone: '',
      alternatePhone: '',
      email: '',
      address: '',
      areaCity: '',
    });
    setFormError(null);
    setShowAddModal(true);
  };

  const handleOpenEdit = (dealer: IDealer) => {
    setEditingDealer(dealer);
    setFormData({
      storeName: dealer.storeName,
      ownerName: dealer.ownerName,
      phone: dealer.phone,
      alternatePhone: dealer.alternatePhone || '',
      email: dealer.email || '',
      address: dealer.address,
      areaCity: dealer.areaCity,
    });
    setFormError(null);
  };

  const handleSaveDealer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);

    try {
      if (editingDealer) {
        await ApiClient.updateDealer(editingDealer.id, {
          storeName: formData.storeName.trim(),
          ownerName: formData.ownerName.trim(),
          phone: formData.phone.trim(),
          alternatePhone: formData.alternatePhone.trim() || null,
          email: formData.email.trim() || null,
          address: formData.address.trim(),
          areaCity: formData.areaCity.trim(),
        });
        setEditingDealer(null);
      } else {
        await ApiClient.createDealer({
          storeName: formData.storeName.trim(),
          ownerName: formData.ownerName.trim(),
          phone: formData.phone.trim(),
          alternatePhone: formData.alternatePhone.trim() || null,
          email: formData.email.trim() || null,
          address: formData.address.trim(),
          areaCity: formData.areaCity.trim(),
        });
        setShowAddModal(false);
      }

      await fetchDealers();
      if (selectedDealerId) {
        await handleOpenDetail(selectedDealerId);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to save dealer information');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggleStatus = async (dealer: IDealer) => {
    const nextStatus = dealer.status === DealerStatus.ACTIVE ? DealerStatus.INACTIVE : DealerStatus.ACTIVE;
    const confirmMsg =
      nextStatus === DealerStatus.INACTIVE
        ? `Are you sure you want to deactivate "${dealer.storeName}"? Inactive dealers cannot originate new loans, but existing loans will remain valid.`
        : `Reactivate "${dealer.storeName}" for new device financing?`;

    if (!confirm(confirmMsg)) return;

    try {
      await ApiClient.updateDealerStatus(dealer.id, nextStatus);
      await fetchDealers();
      if (selectedDealerId === dealer.id) {
        await handleOpenDetail(dealer.id);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to change dealer status');
    }
  };

  // Metrics
  const totalCount = dealers.length;
  const activeCount = dealers.filter((d) => d.status === DealerStatus.ACTIVE).length;
  const inactiveCount = dealers.filter((d) => d.status === DealerStatus.INACTIVE).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Dealer & Retail Store Network</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Manage partner mobile phone retail stores originating consumer financing agreements.
          </p>
        </div>

        <button onClick={handleOpenAdd} className="btn btn-primary">
          <Plus size={15} />
          <span>Add New Partner Store</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Total Partner Stores
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
            {totalCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Registered phone outlets</div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)', textTransform: 'uppercase' }}>
            Active Stores
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
            {activeCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Originating active loans</div>
        </div>

        <div className="crm-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger-text)', textTransform: 'uppercase' }}>
            Inactive Stores
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--danger-text)', marginTop: 4 }}>
            {inactiveCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Suspended / Closed outlets</div>
        </div>
      </div>

      {/* Super Admin Late Payment Penalty Permission Control */}
      {currentUser?.role === UserRole.SUPER_ADMIN && (
        <div
          className="crm-card"
          style={{
            padding: '16px 20px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ maxWidth: 640 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={18} color="var(--primary)" />
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                Late Payment Penalty: Allow Dealers to Add Penalty
              </h4>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              When enabled, dealer users can manually add late-payment penalties to overdue EMIs belonging to their own customers.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: allowDealerPenalty ? 'var(--success-bg, rgba(34, 197, 94, 0.1))' : 'var(--bg-surface-secondary)',
                  color: allowDealerPenalty ? 'var(--success-text)' : 'var(--text-muted)',
                  border: `1px solid ${allowDealerPenalty ? 'var(--success-border, rgba(34, 197, 94, 0.3))' : 'var(--border-subtle)'}`,
                }}
              >
                {allowDealerPenalty ? 'PERMISSION: ON' : 'PERMISSION: OFF'}
              </span>
            </div>

            <button
              type="button"
              onClick={handleToggleDealerPenalty}
              disabled={settingLoading}
              className={`btn btn-sm ${allowDealerPenalty ? 'btn-danger' : 'btn-primary'}`}
              style={{ minWidth: 120 }}
            >
              {settingLoading
                ? 'Saving...'
                : allowDealerPenalty
                ? 'Turn OFF'
                : 'Turn ON'}
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="crm-card" style={{ padding: 14 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Status Tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-surface-secondary)', padding: 3, borderRadius: 'var(--radius-md)' }}>
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`btn btn-sm ${statusFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ border: 'none' }}
            >
              All Stores ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('ACTIVE')}
              className={`btn btn-sm ${statusFilter === 'ACTIVE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ border: 'none' }}
            >
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('INACTIVE')}
              className={`btn btn-sm ${statusFilter === 'INACTIVE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ border: 'none' }}
            >
              Inactive ({inactiveCount})
            </button>
          </div>

          <input
            type="text"
            className="form-input"
            style={{ width: 220 }}
            placeholder="Filter Area (e.g. Dadri, Kasna)..."
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
          />

          <input
            type="text"
            className="form-input"
            style={{ flex: 1, minWidth: 240 }}
            placeholder="Search by store name, owner, phone, or dealer code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button type="submit" className="btn btn-secondary">
            <Search size={14} />
            <span>Search</span>
          </button>
        </form>
      </div>

      {/* Dealers Table */}
      <div className="table-container">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Dealer Code</th>
              <th>Store Name</th>
              <th>Owner / Contact</th>
              <th>Phone Number</th>
              <th>Area / City</th>
              <th>Financed Loans</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Loading retail stores...
                </td>
              </tr>
            ) : dealers.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  No dealer partner stores found matching criteria.
                </td>
              </tr>
            ) : (
              dealers.map((dealer) => {
                const isActive = dealer.status === DealerStatus.ACTIVE;
                return (
                  <tr key={dealer.id}>
                    <td>
                      <span className="mono badge badge-terracotta">{dealer.dealerCode}</span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{dealer.storeName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dealer.address}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{dealer.ownerName}</div>
                      {dealer.email && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{dealer.email}</div>
                      )}
                    </td>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>{dealer.phone}</span>
                      {dealer.alternatePhone && (
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Alt: {dealer.alternatePhone}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-route">{dealer.areaCity}</span>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {dealer.activeLoansCount || 0} active
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {dealer.totalCustomersCount || 0} borrowers
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${isActive ? 'badge-paid' : 'badge-overdue'}`}>
                        {dealer.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleOpenDetail(dealer.id)}
                          className="btn btn-secondary btn-sm"
                          title="View Dealer 360"
                        >
                          <ExternalLink size={12} />
                          <span>View</span>
                        </button>
                        <button
                          onClick={() => handleOpenEdit(dealer)}
                          className="btn btn-secondary btn-sm"
                          title="Edit Store Information"
                        >
                          <Edit2 size={12} />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleToggleStatus(dealer)}
                          className="btn btn-secondary btn-sm"
                          style={{
                            color: isActive ? 'var(--danger-text)' : 'var(--success)',
                          }}
                          title={isActive ? 'Deactivate Store' : 'Activate Store'}
                        >
                          <Power size={12} />
                          <span>{isActive ? 'Deactivate' : 'Activate'}</span>
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

      {/* DEALER DETAILS DRAWER */}
      {selectedDealerId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 1000,
          }}
          onClick={() => {
            setSelectedDealerId(null);
            setDealerDetail(null);
            setDealerCollectionsData(null);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 680,
              height: '100%',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-8px 0 24px rgba(0,0,0,0.15)',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {loadingDetail || !dealerDetail ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading store 360 profile...
              </div>
            ) : (
              <div>
                {/* Drawer Header */}
                <div
                  style={{
                    padding: '18px 24px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--bg-surface-secondary)',
                  }}
                >
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
                      <Store size={20} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 800 }}>{dealerDetail.dealer.storeName}</h3>
                      <span className="mono badge badge-terracotta" style={{ marginTop: 2 }}>
                        {dealerDetail.dealer.dealerCode}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => handleOpenEdit(dealerDetail.dealer)}
                      className="btn btn-secondary btn-sm"
                    >
                      <Edit2 size={13} />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => {
                        setSelectedDealerId(null);
                        setDealerDetail(null);
                        setDealerCollectionsData(null);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                {/* Drawer Content */}
                <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {/* Status & Area Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={`badge ${dealerDetail.dealer.status === DealerStatus.ACTIVE ? 'badge-paid' : 'badge-overdue'}`}>
                      {dealerDetail.dealer.status}
                    </span>
                    <span className="badge badge-route">Area: {dealerDetail.dealer.areaCity}</span>
                  </div>

                  {/* Store Details Card */}
                  <div className="crm-card" style={{ padding: 16 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Contact & Store Information</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Owner / Proprietor</div>
                        <strong>{dealerDetail.dealer.ownerName}</strong>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Primary Mobile</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="mono font-bold">{dealerDetail.dealer.phone}</span>
                          <a href={`tel:${dealerDetail.dealer.phone}`} style={{ color: 'var(--primary)' }}>
                            <Phone size={12} />
                          </a>
                        </div>
                      </div>
                      {dealerDetail.dealer.alternatePhone && (
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Alternate Phone</div>
                          <span className="mono">{dealerDetail.dealer.alternatePhone}</span>
                        </div>
                      )}
                      {dealerDetail.dealer.email && (
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Email Address</div>
                          <span>{dealerDetail.dealer.email}</span>
                        </div>
                      )}
                      <div style={{ gridColumn: 'span 2' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Store Address</div>
                        <div>{dealerDetail.dealer.address}, {dealerDetail.dealer.areaCity}</div>
                      </div>
                    </div>
                  </div>

                  {/* Dealer Authentication & Login Management Card */}
                  <div className="crm-card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Shield size={14} color="var(--primary)" /> Store Portal Authentication
                      </h4>
                      {dealerDetail.dealer.userId ? (
                        <span className={`badge ${dealerDetail.dealer.userStatus === 'ACTIVE' ? 'badge-paid' : 'badge-overdue'}`}>
                          {dealerDetail.dealer.userStatus || 'ACTIVE'}
                        </span>
                      ) : (
                        <span className="badge badge-upcoming">No Account</span>
                      )}
                    </div>

                    {authActionNotice && (
                      <div
                        style={{
                          padding: '8px 12px',
                          background: 'var(--success-bg)',
                          border: '1px solid var(--success-border)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--success-text)',
                          fontSize: 12,
                          marginBottom: 12,
                        }}
                      >
                        {authActionNotice}
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Login Identifier</div>
                          <span className="mono font-bold" style={{ color: 'var(--primary)' }}>
                            {dealerDetail.dealer.dealerCode}
                          </span>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Account Status</div>
                          <strong>{dealerDetail.dealer.userId ? (dealerDetail.dealer.userStatus || 'ACTIVE') : 'Not Configured'}</strong>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        {!dealerDetail.dealer.userId ? (
                          <button
                            type="button"
                            onClick={() => handleCreateDealerLogin(dealerDetail.dealer)}
                            disabled={authActionLoading}
                            className="btn btn-primary btn-sm"
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <KeyRound size={13} />
                            <span>{authActionLoading ? 'Creating...' : 'Create Login'}</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleResetDealerPassword(dealerDetail.dealer)}
                              disabled={authActionLoading}
                              className="btn btn-secondary btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                              <KeyRound size={13} />
                              <span>{authActionLoading ? 'Resetting...' : 'Reset Password'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleDealerLoginStatus(dealerDetail.dealer, dealerDetail.dealer.userStatus)}
                              disabled={authActionLoading}
                              className={`btn btn-sm ${dealerDetail.dealer.userStatus === 'ACTIVE' ? 'btn-danger-outline' : 'btn-primary'}`}
                              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                              <Power size={13} />
                              <span>{dealerDetail.dealer.userStatus === 'ACTIVE' ? 'Disable Login' : 'Activate Login'}</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Drawer Tab Switcher */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      background: 'var(--bg-surface-secondary)',
                      padding: 4,
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setDrawerTab('loans')}
                      className={`btn btn-sm ${drawerTab === 'loans' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ flex: 1, border: 'none', display: 'flex', justifyContent: 'center', gap: 6, fontSize: 12 }}
                    >
                      <Smartphone size={13} />
                      <span>Loans ({dealerDetail.loans.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawerTab('collections')}
                      className={`btn btn-sm ${drawerTab === 'collections' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ flex: 1, border: 'none', display: 'flex', justifyContent: 'center', gap: 6, fontSize: 12 }}
                    >
                      <Receipt size={13} />
                      <span>
                        Collections ({dealerCollectionsData?.metrics?.paymentCount || 0})
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawerTab('settlements')}
                      className={`btn btn-sm ${drawerTab === 'settlements' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ flex: 1, border: 'none', display: 'flex', justifyContent: 'center', gap: 6, fontSize: 12 }}
                    >
                      <Banknote size={13} />
                      <span>
                        Settlements ({dealerSettlementsData?.records?.length || 0})
                      </span>
                    </button>
                  </div>

                  {/* TAB 1: FINANCED LOANS */}
                  {drawerTab === 'loans' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* Summary Metric Cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                        <div className="crm-card" style={{ padding: 12, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700 }}>BORROWERS</div>
                          <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                            {dealerDetail.dealer.totalCustomersCount || 0}
                          </div>
                        </div>
                        <div className="crm-card" style={{ padding: 12, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--success-text)', fontWeight: 700 }}>ACTIVE LOANS</div>
                          <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
                            {dealerDetail.dealer.activeLoansCount || 0}
                          </div>
                        </div>
                        <div className="crm-card" style={{ padding: 12, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700 }}>CLOSED LOANS</div>
                          <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                            {dealerDetail.dealer.closedLoansCount || 0}
                          </div>
                        </div>
                      </div>

                      <h4 style={{ fontSize: 13, fontWeight: 700 }}>
                        Originated Consumer Loans ({dealerDetail.loans.length})
                      </h4>
                      {dealerDetail.loans.length === 0 ? (
                        <div
                          style={{
                            textAlign: 'center',
                            padding: 24,
                            color: 'var(--text-muted)',
                            background: 'var(--bg-surface-secondary)',
                            borderRadius: 'var(--radius-md)',
                          }}
                        >
                          No loans originated through this retail store yet.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {dealerDetail.loans.map((loan: any) => (
                            <div
                              key={loan.id}
                              className="crm-card"
                              style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            >
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <Smartphone size={14} color="var(--primary)" />
                                  <strong style={{ fontSize: 13 }}>{loan.customerName}</strong>
                                  <span className="mono badge badge-terracotta" style={{ fontSize: 10 }}>
                                    {loan.loanAccountNo}
                                  </span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  Borrower Phone: {loan.primaryPhone} • Disbursed: {loan.disbursementDate || 'Pending'}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div className="mono font-bold">{formatINR(loan.principalAmount)}</div>
                                <span className={`badge ${loan.status === 'ACTIVE' ? 'badge-paid' : 'badge-terracotta'}`} style={{ fontSize: 10 }}>
                                  {loan.status}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: COLLECTIONS */}
                  {drawerTab === 'collections' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* Collection Metric Cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                        <div className="crm-card" style={{ padding: 12 }}>
                          <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase' }}>
                            Total Collections
                          </div>
                          <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)', marginTop: 2 }}>
                            {formatINR(dealerCollectionsData?.metrics?.totalCollections || 0)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            {dealerCollectionsData?.metrics?.paymentCount || 0} total EMI payments
                          </div>
                        </div>

                        <div className="crm-card" style={{ padding: 12 }}>
                          <div style={{ fontSize: 10, color: 'var(--success-text)', fontWeight: 700, textTransform: 'uppercase' }}>
                            Today's Collections
                          </div>
                          <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--success)', marginTop: 2 }}>
                            {formatINR(dealerCollectionsData?.metrics?.todayCollections || 0)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            Collected today (IST)
                          </div>
                        </div>

                        <div className="crm-card" style={{ padding: 12 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase' }}>
                            This Month
                          </div>
                          <div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                            {formatINR(dealerCollectionsData?.metrics?.monthCollections || 0)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            Current calendar month
                          </div>
                        </div>

                        <div className="crm-card" style={{ padding: 12 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase' }}>
                            Average Collection
                          </div>
                          <div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                            {formatINR(dealerCollectionsData?.metrics?.averageCollection || 0)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            Per receipt ticket
                          </div>
                        </div>
                      </div>

                      {/* Header + View All Collections Link */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                        <h4 style={{ fontSize: 13, fontWeight: 700 }}>Recent EMI Collections</h4>
                        {onNavigateToCollections && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDealerId(null);
                              setDealerDetail(null);
                              setDealerCollectionsData(null);
                              onNavigateToCollections(dealerDetail.dealer.id);
                            }}
                            className="btn btn-primary btn-sm"
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <span>View All Collections</span>
                            <ArrowRight size={13} />
                          </button>
                        )}
                      </div>

                      {/* Recent Collections Table */}
                      {(!dealerCollectionsData?.recentCollections || dealerCollectionsData.recentCollections.length === 0) ? (
                        <div
                          style={{
                            textAlign: 'center',
                            padding: 24,
                            color: 'var(--text-muted)',
                            background: 'var(--bg-surface-secondary)',
                            borderRadius: 'var(--radius-md)',
                          }}
                        >
                          No EMI payments collected through this retail store yet.
                        </div>
                      ) : (
                        <div className="table-container" style={{ maxHeight: 320, overflowY: 'auto' }}>
                          <table className="crm-table" style={{ fontSize: 12 }}>
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Customer</th>
                                <th>Amount</th>
                                <th>Mode</th>
                                <th>Receipt</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dealerCollectionsData.recentCollections.map((col: any) => (
                                <tr key={col.id}>
                                  <td>{formatDate(col.paymentDate)}</td>
                                  <td>
                                    <div style={{ fontWeight: 600 }}>{col.customerName}</div>
                                    <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                      {col.loanAccountNo}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="mono font-bold" style={{ color: col.isReversal ? 'var(--text-muted)' : 'var(--success)' }}>
                                      {formatINR(col.amount)}
                                    </span>
                                    {col.isReversal && (
                                      <span className="badge badge-overdue" style={{ fontSize: 9, marginLeft: 4 }}>
                                        REVERSED
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    <span className="badge badge-route">{col.paymentMode}</span>
                                  </td>
                                  <td>
                                    <span className="mono" style={{ fontSize: 11 }}>{col.receiptNumber}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: SETTLEMENTS & RECONCILIATION */}
                  {drawerTab === 'settlements' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* Summary Cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                        <div className="crm-card" style={{ padding: 12 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase' }}>
                            Collections
                          </div>
                          <div className="mono font-bold" style={{ fontSize: 18, marginTop: 2 }}>
                            {formatINR(dealerSettlementsData?.summary?.totalCollections || 0)}
                          </div>
                        </div>

                        <div className="crm-card" style={{ padding: 12 }}>
                          <div style={{ fontSize: 10, color: 'var(--success-text)', fontWeight: 700, textTransform: 'uppercase' }}>
                            Settled
                          </div>
                          <div className="mono font-bold" style={{ fontSize: 18, color: 'var(--success)', marginTop: 2 }}>
                            {formatINR(dealerSettlementsData?.summary?.totalSettled || 0)}
                          </div>
                        </div>

                        <div className="crm-card" style={{ padding: 12 }}>
                          <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase' }}>
                            Outstanding
                          </div>
                          <div className="mono font-bold" style={{ fontSize: 18, color: 'var(--primary)', marginTop: 2 }}>
                            {formatINR(dealerSettlementsData?.summary?.outstandingSettlement || 0)}
                          </div>
                        </div>
                      </div>

                      {/* Header + View Settlement History Link */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                        <h4 style={{ fontSize: 13, fontWeight: 700 }}>Settlement Remittance History</h4>
                        {onNavigateToSettlements && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDealerId(null);
                              setDealerDetail(null);
                              setDealerCollectionsData(null);
                              setDealerSettlementsData(null);
                              onNavigateToSettlements(dealerDetail.dealer.id);
                            }}
                            className="btn btn-primary btn-sm"
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <span>View Settlement History</span>
                            <ArrowRight size={13} />
                          </button>
                        )}
                      </div>

                      {/* Recent Settlements Table */}
                      {(!dealerSettlementsData?.records || dealerSettlementsData.records.length === 0) ? (
                        <div
                          style={{
                            textAlign: 'center',
                            padding: 24,
                            color: 'var(--text-muted)',
                            background: 'var(--bg-surface-secondary)',
                            borderRadius: 'var(--radius-md)',
                          }}
                        >
                          No settlement batches recorded for this retail store yet.
                        </div>
                      ) : (
                        <div className="table-container" style={{ maxHeight: 320, overflowY: 'auto' }}>
                          <table className="crm-table" style={{ fontSize: 12 }}>
                            <thead>
                              <tr>
                                <th>Settlement No</th>
                                <th>Date</th>
                                <th>Amount</th>
                                <th>Method</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dealerSettlementsData.records.map((stl: any) => (
                                <tr key={stl.id}>
                                  <td>
                                    <span className="mono badge badge-terracotta" style={{ fontSize: 10 }}>
                                      {stl.settlementNumber}
                                    </span>
                                  </td>
                                  <td>{formatDate(stl.settlementDate)}</td>
                                  <td>
                                    <span className="mono font-bold" style={{ color: stl.status === 'COMPLETED' ? 'var(--success)' : 'var(--text-muted)' }}>
                                      {formatINR(stl.amount)}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="badge badge-route">{stl.paymentMethod}</span>
                                  </td>
                                  <td>
                                    <span className={`badge ${stl.status === 'COMPLETED' ? 'badge-paid' : 'badge-overdue'}`}>
                                      {stl.status}
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADD / EDIT DEALER MODAL */}
      {(showAddModal || editingDealer) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: 16,
          }}
          onClick={() => {
            setShowAddModal(false);
            setEditingDealer(null);
          }}
        >
          <div
            className="crm-card"
            style={{
              width: '100%',
              maxWidth: 520,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--bg-surface-secondary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Store size={18} color="var(--primary)" />
                <h3 style={{ fontSize: 16, fontWeight: 800 }}>
                  {editingDealer ? `Edit Store: ${editingDealer.storeName}` : 'Add Partner Retail Store'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingDealer(null);
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveDealer} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {formError && (
                <div
                  style={{
                    padding: 10,
                    background: 'var(--danger-subtle)',
                    border: '1px solid var(--danger-border)',
                    color: 'var(--danger-text)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 12,
                  }}
                >
                  {formError}
                </div>
              )}

              {editingDealer && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Dealer Code
                  </label>
                  <input
                    type="text"
                    className="form-input mono"
                    value={editingDealer.dealerCode}
                    disabled
                    style={{ background: 'var(--bg-surface-secondary)' }}
                  />
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Store Name <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Rathore Mobile - Dadri"
                    value={formData.storeName}
                    onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Owner / Proprietor Name <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Rakesh Kumar"
                    value={formData.ownerName}
                    onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Mobile Number <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="tel"
                    className="form-input mono"
                    placeholder="10-digit mobile number"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Alternate Phone
                  </label>
                  <input
                    type="tel"
                    className="form-input mono"
                    placeholder="Secondary contact"
                    value={formData.alternatePhone}
                    onChange={(e) => setFormData({ ...formData, alternatePhone: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Email Address
                </label>
                <input
                  type="text"
                  inputMode="email"
                  className="form-input"
                  placeholder="store.contact@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Area / City <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Dadri, Alpha 1, Pari Chowk"
                  value={formData.areaCity}
                  onChange={(e) => setFormData({ ...formData, areaCity: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Full Store Address <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="Shop number, market name, landmark..."
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  required
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingDealer(null);
                  }}
                  className="btn btn-secondary"
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={formSubmitting}>
                  {formSubmitting ? 'Saving Store...' : editingDealer ? 'Update Store' : 'Add Store'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Temporary Password Display Modal */}
      {authModalCredentials && (
        <div className="crm-modal-backdrop" style={{ zIndex: 100 }}>
          <div className="crm-modal" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--primary-subtle)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <KeyRound size={18} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                    {authModalCredentials.isReset ? 'Dealer Password Reset' : 'Dealer Login Created'}
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{authModalCredentials.storeName}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAuthModalCredentials(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                aria-label="Close credentials modal"
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                color: 'var(--warning-text, #b45309)',
                marginBottom: 18,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                lineHeight: 1.5,
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Notice:</strong> This temporary password is shown only once. Save/share it securely. The dealer will be required to change it after first login.
              </div>
            </div>

            {/* Credential Details Card */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div
                style={{
                  background: 'var(--bg-surface-secondary)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2, fontWeight: 500 }}>Dealer ID</div>
                  <div className="mono font-bold" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                    {authModalCredentials.dealerCode}
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface-secondary)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2, fontWeight: 500 }}>Login ID</div>
                  <div className="mono font-bold" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                    {authModalCredentials.loginId}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(authModalCredentials.loginId);
                    setCopiedLoginId(true);
                    setTimeout(() => setCopiedLoginId(false), 2500);
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {copiedLoginId ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                  <span>{copiedLoginId ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface-secondary)',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3, fontWeight: 500 }}>Temporary Password</div>
                  <div
                    className="mono font-bold"
                    style={{
                      fontSize: 15,
                      color: 'var(--primary)',
                      wordBreak: 'break-all',
                      userSelect: 'all',
                      background: 'var(--bg-canvas, rgba(0,0,0,0.03))',
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px dashed var(--border-subtle)',
                    }}
                  >
                    {authModalCredentials.temporaryPassword}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(authModalCredentials.temporaryPassword);
                    setCopiedPass(true);
                    setTimeout(() => setCopiedPass(false), 2500);
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                >
                  {copiedPass ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                  <span>{copiedPass ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(authModalCredentials.temporaryPassword);
                    setCopiedPass(true);
                    setTimeout(() => setCopiedPass(false), 2500);
                  }}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}
                >
                  {copiedPass ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                  <span>{copiedPass ? 'Password Copied!' : 'Copy Password'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(authModalCredentials.loginId);
                    setCopiedLoginId(true);
                    setTimeout(() => setCopiedLoginId(false), 2500);
                  }}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}
                >
                  {copiedLoginId ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                  <span>{copiedLoginId ? 'Login ID Copied!' : 'Copy Login ID'}</span>
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    const fullCreds = `Dealer Login Credentials\nDealer ID: ${authModalCredentials.dealerCode}\nStore: ${authModalCredentials.storeName}\nLogin ID: ${authModalCredentials.loginId}\nTemporary Password: ${authModalCredentials.temporaryPassword}\n\nNote: This temporary password is shown only once. You will be required to change it after first login.`;
                    navigator.clipboard.writeText(fullCreds);
                    setCopiedCredentials(true);
                    setTimeout(() => setCopiedCredentials(false), 2500);
                  }}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}
                >
                  {copiedCredentials ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                  <span>{copiedCredentials ? 'Credentials Copied!' : 'Copy Credentials'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const rawPhone = (authModalCredentials.dealerPhone || '').replace(/\D/g, '');
                    const cleanPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
                    const msg = `Hello ${authModalCredentials.storeName}, your dealer portal credentials for Alpha Mobile Gallery CRM:\n\nDealer ID: ${authModalCredentials.dealerCode}\nLogin ID: ${authModalCredentials.loginId}\nTemporary Password: ${authModalCredentials.temporaryPassword}\n\nPlease login and change your password upon first access.`;
                    const waUrl = cleanPhone
                      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`
                      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                    window.open(waUrl, '_blank', 'noopener,noreferrer');
                  }}
                  className="btn btn-secondary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontSize: 13,
                    color: '#16a34a',
                    borderColor: 'rgba(22, 163, 74, 0.3)',
                    background: 'rgba(22, 163, 74, 0.05)',
                  }}
                >
                  <MessageSquare size={14} />
                  <span>WhatsApp Dealer</span>
                </button>
              </div>

              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setAuthModalCredentials(null)}
                  className="btn btn-primary"
                  style={{ minWidth: 100 }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
