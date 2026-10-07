import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import {
  ICustomer,
  ILoan,
  IPayment,
  formatINR,
  formatDateDDMMYYYY,
  CallOutcome,
  PaymentMode,
  KYCType,
} from '@crm/shared';
import { AddCustomerWizard } from '../components/AddCustomerWizard';
import { EditCustomerModal } from '../components/EditCustomerModal';
import { DynamicAttachmentManager, AttachmentItem } from '../components/DynamicAttachmentManager';
import { PortalLinkManager } from '../components/PortalLinkManager';
import {
  Plus,
  Search,
  Users,
  Store,
  ShieldCheck,
  Smartphone,
  Banknote,
  Receipt,
  PhoneCall,
  X,
  Eye,
  ExternalLink,
  MessageCircle,
  Phone,
  FileText,
  Calendar,
  AlertCircle,
  Edit,
  Trash2,
  Image as ImageIcon,
  UserCheck,
  Building2,
  Printer,
} from 'lucide-react';

interface CustomersViewProps {
  userRole?: string;
  refreshTrigger?: number;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ userRole, refreshTrigger }) => {
  const currentUser = ApiClient.getUser();
  const [customers, setCustomers] = useState<ICustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Profile 360 State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<{
    customer: ICustomer;
    loans: ILoan[];
    kycDocuments: any[];
    callLogs: any[];
  } | null>(null);
  const [customerPayments, setCustomerPayments] = useState<IPayment[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeProfileTab, setActiveProfileTab] = useState<'contact' | 'photos' | 'documents' | 'product' | 'finance' | 'payments' | 'calls'>('contact');

  // New inline documents/photos state for customer profile
  const [newDocAttachments, setNewDocAttachments] = useState<AttachmentItem[]>([]);
  const [newCustomerPhotos, setNewCustomerPhotos] = useState<AttachmentItem[]>([]);
  const [newProductPhotos, setNewProductPhotos] = useState<AttachmentItem[]>([]);
  const [savingAttachments, setSavingAttachments] = useState(false);

  // Call Logging Modal for this customer
  const [showCallModal, setShowCallModal] = useState(false);
  const [callOutcome, setCallOutcome] = useState<CallOutcome>(CallOutcome.PROMISED_TO_PAY);
  const [promisedDate, setPromisedDate] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [savingCall, setSavingCall] = useState(false);

  // Customer 360 Payment Details & Receipt Modals
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState<any | null>(null);

  // Inline KYC Document Viewer Modal State
  const [previewDoc, setPreviewDoc] = useState<{
    id: string;
    url: string;
    title: string;
    docType: string;
  } | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.getCustomers(search || undefined, routeFilter || undefined);
      setCustomers(data);
    } catch (err) {
      console.error('Failed to load customers', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      loadData();
      setSelectedCustomerId(null);
      setCustomerDetail(null);
    }
  }, [refreshTrigger]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  const handleOpenDetail = async (id: string) => {
    setSelectedCustomerId(id);
    setLoadingDetail(true);
    setActiveProfileTab('contact');
    setNewDocAttachments([]);
    setNewCustomerPhotos([]);
    setNewProductPhotos([]);
    try {
      const [data, pays] = await Promise.all([
        ApiClient.getCustomerDetail(id),
        ApiClient.listPayments(undefined, 1, 50, id).catch(() => []),
      ]);
      setCustomerDetail(data);
      setCustomerPayments(pays);
    } catch (err: any) {
      alert(err.message || 'Failed to load customer profile');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDownloadKYC = async (docId: string, docMeta?: any) => {
    setLoadingDoc(true);
    try {
      const res = await ApiClient.getKYCDownloadUrl(docId);
      setPreviewDoc({
        id: docId,
        url: res.downloadUrl,
        title: docMeta?.docNumberMasked || docMeta?.docType || 'KYC Document',
        docType: docMeta?.docType || 'DOCUMENT',
      });
    } catch (err: any) {
      alert(err.message || 'Access to document preview denied');
    } finally {
      setLoadingDoc(false);
    }
  };

  const handleDeleteKYC = async (docId: string) => {
    if (!confirm('Are you sure you want to remove this KYC document?')) return;
    try {
      await ApiClient.deleteKYCDocument(docId);
      if (customerDetail) {
        const refreshed = await ApiClient.getCustomerDetail(customerDetail.customer.id);
        setCustomerDetail(refreshed);
      }
      alert('Document removed successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to delete KYC document');
    }
  };

  const handleUploadNewDocuments = async () => {
    if (!customerDetail) return;
    setSavingAttachments(true);
    try {
      for (const doc of newDocAttachments) {
        if (doc.file) {
          let docTypeEnum = KYCType.OTHER;
          const cat = doc.category.toLowerCase();
          if (cat.includes('aadhaar')) docTypeEnum = KYCType.AADHAAR;
          else if (cat.includes('pan')) docTypeEnum = KYCType.PAN;
          else if (cat.includes('voter')) docTypeEnum = KYCType.VOTER_ID;
          else if (cat.includes('driving')) docTypeEnum = KYCType.DRIVING_LICENSE;

          await ApiClient.uploadKYCDocument({
            customerId: customerDetail.customer.id,
            file: doc.file,
            docType: docTypeEnum,
            docNumber: doc.title || null,
          });
        }
      }

      setNewDocAttachments([]);
      const refreshed = await ApiClient.getCustomerDetail(customerDetail.customer.id);
      setCustomerDetail(refreshed);
      alert('New documents registered successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to register new documents');
    } finally {
      setSavingAttachments(false);
    }
  };

  const handleSaveCallLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerDetail) return;
    setSavingCall(true);
    try {
      await ApiClient.logCall({
        customerId: customerDetail.customer.id,
        outcome: callOutcome,
        promisedPaymentDate: promisedDate || undefined,
        notes: callNotes,
        contactPhoneUsed: customerDetail.customer.primaryPhone,
      });
      setShowCallModal(false);
      setCallNotes('');
      // Refresh customer profile
      const refreshed = await ApiClient.getCustomerDetail(customerDetail.customer.id);
      setCustomerDetail(refreshed);
    } catch (err: any) {
      alert(err.message || 'Failed to log call');
    } finally {
      setSavingCall(false);
    }
  };

  const sendWhatsApp = (cust: ICustomer) => {
    const clean = cust.primaryPhone.replace(/\D/g, '');
    const msg = `Dear ${cust.fullName}, greetings from Alpha Mobile Gallery (Shubh Pvt Ltd). Please let us know if you need assistance with your financed account.`;
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Customer Directory & Financed Assets</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Central borrower profiles, financed device details, KYC vault, and amortization schedules.
          </p>
        </div>

        <button onClick={() => setShowWizard(true)} className="btn btn-primary">
          <Plus size={15} />
          <span>Onboard New Customer</span>
        </button>
      </div>

      {/* Filter and Search Bar with Manual Route Input */}
      <div className="crm-card" style={{ padding: 14 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-input"
            style={{ width: 240 }}
            placeholder="Filter by Area / Route (e.g. Dadri, Kasna)..."
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
          />

          <input
            type="text"
            className="form-input"
            style={{ flex: 1, minWidth: 240 }}
            placeholder="Search by borrower name, phone, code, or area route..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button type="submit" className="btn btn-secondary">
            <Search size={14} />
            <span>Search</span>
          </button>
        </form>
      </div>

      {/* Customers Table */}
      <div className="table-container">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Borrower Code</th>
              <th>Full Name</th>
              <th>Primary Phone</th>
              <th>Collection Area / Route</th>
              <th>Active Loans</th>
              <th>Total Outstanding</th>
              <th>KYC Status</th>
              <th>Profile</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  Loading borrower directory...
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  No customers found matching the search criteria.
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                    {c.customerCode}
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.fullName}</td>
                  <td className="mono">{c.primaryPhone}</td>
                  <td>{c.areaRoute}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>{c.activeLoansCount || 0}</td>
                  <td className="mono" style={{ fontWeight: 700, color: (c.totalOutstanding || 0) > 0 ? 'var(--warning-text)' : 'inherit' }}>
                    {formatINR(c.totalOutstanding || 0)}
                  </td>
                  <td>
                    <span className="badge badge-paid">VERIFIED</span>
                  </td>
                  <td>
                    <button onClick={() => handleOpenDetail(c.id)} className="btn btn-secondary btn-sm">
                      <Eye size={13} />
                      <span>View Profile</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 5-Step Customer Onboarding Wizard */}
      <AddCustomerWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onSuccess={() => {
          setShowWizard(false);
          loadData();
        }}
      />

      {/* Central Customer Profile Modal with Clear [ Edit Customer ] Action */}
      {selectedCustomerId && customerDetail && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 860, padding: 0 }}>
            {/* Modal Header */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'var(--primary-subtle)',
                    color: 'var(--primary)',
                    border: '1px solid var(--primary-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    fontWeight: 800,
                    overflow: 'hidden',
                  }}
                >
                  {customerDetail.customer.photoUrl ? (
                    <img
                      src={customerDetail.customer.photoUrl}
                      alt={customerDetail.customer.fullName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    customerDetail.customer.fullName.charAt(0)
                  )}
                </div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>
                    {customerDetail.customer.fullName}
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Code: <span className="mono" style={{ fontWeight: 700 }}>{customerDetail.customer.customerCode}</span> • Route: <strong>{customerDetail.customer.areaRoute}</strong>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Obvious [ Edit Customer ] action */}
                <button
                  onClick={() => setShowEditModal(true)}
                  className="btn btn-primary btn-sm"
                  title="Edit customer details and route while EMI is active"
                >
                  <Edit size={13} />
                  <span>Edit Customer</span>
                </button>

                <button
                  onClick={() => sendWhatsApp(customerDetail.customer)}
                  className="btn btn-secondary btn-sm"
                  style={{ color: '#16a34a' }}
                >
                  <MessageCircle size={13} />
                  <span>WhatsApp</span>
                </button>
                <a
                  href={`tel:${customerDetail.customer.primaryPhone}`}
                  className="btn btn-secondary btn-sm"
                  style={{ textDecoration: 'none' }}
                >
                  <Phone size={13} />
                  <span>Call</span>
                </a>
                <button
                  onClick={() => {
                    setSelectedCustomerId(null);
                    setCustomerDetail(null);
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 4 }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Profile Navigation Tabs */}
            <div
              style={{
                display: 'flex',
                gap: 4,
                padding: '10px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                background: '#ffffff',
                overflowX: 'auto',
              }}
            >
              <button
                onClick={() => setActiveProfileTab('contact')}
                className={`crm-tab ${activeProfileTab === 'contact' ? 'active' : ''}`}
              >
                Contact & Address
              </button>
              <button
                onClick={() => setActiveProfileTab('documents')}
                className={`crm-tab ${activeProfileTab === 'documents' ? 'active' : ''}`}
              >
                Documents ({customerDetail.kycDocuments.length})
              </button>
              <button
                onClick={() => setActiveProfileTab('photos')}
                className={`crm-tab ${activeProfileTab === 'photos' ? 'active' : ''}`}
              >
                Customer Photos
              </button>
              <button
                onClick={() => setActiveProfileTab('product')}
                className={`crm-tab ${activeProfileTab === 'product' ? 'active' : ''}`}
              >
                Financed Item
              </button>
              <button
                onClick={() => setActiveProfileTab('finance')}
                className={`crm-tab ${activeProfileTab === 'finance' ? 'active' : ''}`}
              >
                Finance & EMIs
              </button>
              <button
                onClick={() => setActiveProfileTab('payments')}
                className={`crm-tab ${activeProfileTab === 'payments' ? 'active' : ''}`}
              >
                Payments ({customerPayments.length})
              </button>
              <button
                onClick={() => setActiveProfileTab('calls')}
                className={`crm-tab ${activeProfileTab === 'calls' ? 'active' : ''}`}
              >
                Recovery Calls ({customerDetail.callLogs.length})
              </button>
            </div>

            {/* Profile Tab Contents */}
            <div style={{ padding: 22 }}>
              {/* TAB 1: CONTACT & ADDRESS */}
              {activeProfileTab === 'contact' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    <div className="crm-card" style={{ padding: 14 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>TOTAL OUTSTANDING</div>
                      <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--warning-text)', marginTop: 4 }}>
                        {formatINR(customerDetail.customer.totalOutstanding || 0)}
                      </div>
                    </div>
                    <div className="crm-card" style={{ padding: 14 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>ACTIVE LOANS</div>
                      <div className="mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                        {customerDetail.loans.length} Accounts
                      </div>
                    </div>
                    <div className="crm-card" style={{ padding: 14 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>CREDIT STATUS</div>
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-paid">ACTIVE BORROWER</span>
                      </div>
                    </div>
                  </div>

                  <div className="crm-card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>
                        Contact Details & Collection Route
                      </h4>
                      <button onClick={() => setShowEditModal(true)} className="btn btn-secondary btn-sm">
                        <Edit size={12} />
                        <span>Edit Information</span>
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Primary Phone:</span>{' '}
                        <strong className="mono">{customerDetail.customer.primaryPhone}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Alternate Phone:</span>{' '}
                        <span className="mono">{customerDetail.customer.alternatePhone || 'None'}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Collection Area / Route:</span>{' '}
                        <strong>{customerDetail.customer.areaRoute}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Pincode:</span>{' '}
                        <span className="mono">{customerDetail.customer.pincode}</span>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Address:</span>{' '}
                        <strong>
                          {customerDetail.customer.addressLine1}, {customerDetail.customer.city},{' '}
                          {customerDetail.customer.state} - {customerDetail.customer.pincode}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: DOCUMENTS (KYC) */}
              {activeProfileTab === 'documents' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
                      <ShieldCheck size={16} color="var(--success)" />
                      <span>Private KYC & Document Vault</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {customerDetail.kycDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          padding: 14,
                          background: 'var(--bg-surface-secondary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{doc.docType}</div>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--primary)', marginTop: 2 }}>
                            {doc.docNumberMasked || 'Verified Document'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            Uploaded: {formatDateDDMMYYYY(doc.createdAt || doc.created_at)}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => handleDownloadKYC(doc.id, doc)}
                            className="btn btn-secondary btn-sm"
                            title="Generate temporary 5-min signed URL"
                          >
                            <ExternalLink size={12} />
                            <span>View</span>
                          </button>
                          <button
                            onClick={() => handleDeleteKYC(doc.id)}
                            className="btn btn-secondary btn-sm"
                            style={{ color: 'var(--danger-text)' }}
                            title="Remove document"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add New Documents Inline */}
                  <div style={{ marginTop: 10, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                    <DynamicAttachmentManager
                      title="Upload Additional KYC / Agreement Documents"
                      helperText="Attach additional proof documents without count limit"
                      type="DOCUMENT"
                      attachments={newDocAttachments}
                      onChange={setNewDocAttachments}
                    />

                    {newDocAttachments.some((d) => d.file) && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                        <button
                          onClick={handleUploadNewDocuments}
                          disabled={savingAttachments}
                          className="btn btn-primary btn-sm"
                        >
                          {savingAttachments ? 'Saving Documents...' : 'Save New Documents to Vault'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: CUSTOMER PHOTOS */}
              {activeProfileTab === 'photos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="crm-card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <ImageIcon size={16} color="var(--primary)" />
                      <h4 style={{ fontSize: 13, fontWeight: 700 }}>Customer Live Photo & Avatar</h4>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div
                        style={{
                          width: 80,
                          height: 80,
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-surface-secondary)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {customerDetail.customer.photoUrl ? (
                          <img
                            src={customerDetail.customer.photoUrl}
                            alt="Customer Photo"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)' }}>
                            {customerDetail.customer.fullName.charAt(0)}
                          </span>
                        )}
                      </div>

                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Main Identification Photo</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          Captured during customer verification.
                        </div>
                        <button
                          onClick={() => setShowEditModal(true)}
                          className="btn btn-secondary btn-sm"
                          style={{ marginTop: 8 }}
                        >
                          <span>Update Photo via Edit Profile</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <DynamicAttachmentManager
                    title="Additional Customer Photos (Store Visits, Selfies)"
                    helperText="Store secondary verification photos without limits"
                    type="PHOTO"
                    attachments={newCustomerPhotos}
                    onChange={setNewCustomerPhotos}
                  />
                </div>
              )}

              {/* TAB 4: FINANCED ITEM */}
              {activeProfileTab === 'product' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {customerDetail.loans.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                      No financed products booked for this customer yet.
                    </div>
                  ) : (
                    customerDetail.loans.map((loan) => {
                      const isDealerSource = Boolean(loan.dealerId || loan.dealerStoreName || (loan as any).dealer_store_name);
                      const dealerName = loan.dealerStoreName || (loan as any).dealer_store_name || 'Partner Store';
                      const dealerCode = loan.dealerCode || (loan as any).dealer_code;
                      const deviceBrand = loan.deviceBrand || (loan as any).device_brand || 'Smart Device';
                      const deviceModel = loan.deviceModel || (loan as any).device_model || (loan.principalAmount ? `Asset (${loan.loanAccountNo})` : 'Standard Handset');
                      const deviceName = loan.deviceName || (loan as any).device_name || `${deviceBrand} ${deviceModel}`.trim();
                      const imei1 = loan.imei1 || (loan as any).imei1 || `IMEI-${loan.loanAccountNo.replace(/[^0-9]/g, '').padEnd(15, '0')}`;
                      const imei2 = loan.imei2 || (loan as any).imei2 || null;
                      const deviceStatus = loan.deviceStatus || (loan as any).device_status || 'ACTIVE';
                      const retailPrice = Number((loan as any).retailPrice || loan.principalAmount);
                      const downPayment = Number(loan.downPayment || 0);
                      const financedAmt = Number(loan.netDisbursedAmount || (retailPrice - downPayment));
                      const totalPayable = Number(loan.totalPayable || (loan as any).total_payable || 0);
                      const totalPaid = Number(loan.totalPaid || (loan as any).total_paid || 0);
                      const pendingAmount = Number((loan as any).pendingAmount ?? Math.max(0, totalPayable - totalPaid));
                      const overdueCount = Number((loan as any).overdueCount || 0);
                      const daysOverdue = Number((loan as any).daysOverdue || 0);
                      const nextEmiDate = (loan as any).nextEmiDate ? formatDateDDMMYYYY((loan as any).nextEmiDate) : null;
                      const nextEmiAmt = Number((loan as any).nextEmiAmount || loan.emiAmount);

                      return (
                        <div key={loan.id} className="crm-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {/* Card Header: Device Title & Loan Badge */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 'var(--radius-sm)',
                                  background: 'var(--bg-surface-secondary)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'var(--primary)',
                                }}
                              >
                                <Smartphone size={18} />
                              </div>
                              <div>
                                <h4 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{deviceName}</h4>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                                  Brand: <strong>{deviceBrand}</strong> • Model: <strong>{deviceModel}</strong>
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {isDealerSource ? (
                                <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Store size={12} />
                                  <span>Dealer: {dealerName}</span>
                                  {dealerCode && <span className="mono" style={{ opacity: 0.8 }}>({dealerCode})</span>}
                                </span>
                              ) : (
                                <span className="badge badge-route" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Building2 size={12} />
                                  <span>Direct Customer</span>
                                </span>
                              )}
                              <span className="mono badge badge-primary">{loan.loanAccountNo}</span>
                            </div>
                          </div>

                          {/* SECTION: Financed Device Context */}
                          <div style={{ background: 'var(--bg-surface-secondary)', padding: 12, borderRadius: 'var(--radius-md)' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.04em' }}>
                              Financed Device & Hardware Info
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 12 }}>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Primary IMEI 1</span>
                                <strong className="mono">{imei1}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block' }}>IMEI 2</span>
                                <strong className="mono">{imei2 || '—'}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Retail Cash Price</span>
                                <strong className="mono">{formatINR(retailPrice)}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Hardware Status</span>
                                <span className="badge badge-paid">{deviceStatus}</span>
                              </div>
                            </div>
                          </div>

                          {/* SECTION: Loan & Financing Terms */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, fontSize: 13 }}>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Down Payment</div>
                              <strong className="mono">{formatINR(downPayment)}</strong>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Financed Amount</div>
                              <strong className="mono" style={{ color: 'var(--primary)' }}>{formatINR(financedAmt)}</strong>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Monthly EMI</div>
                              <strong className="mono" style={{ color: 'var(--warning-text)' }}>{formatINR(loan.emiAmount)}</strong>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Loan Status</div>
                              <span className="badge badge-paid">{loan.status}</span>
                            </div>

                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tenure & Rate</div>
                              <span>{loan.tenureMonths} Months • {(loan as any).annualInterestRate ?? '1.0'}%/mo</span>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Loan Origination Date</div>
                              <span>{formatDateDDMMYYYY(loan.disbursementDate)}</span>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>First EMI Start Date</div>
                              <span>{formatDateDDMMYYYY((loan as any).firstEmiDate || loan.disbursementDate)}</span>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Next EMI Due</div>
                              <span style={{ fontWeight: 600 }}>{nextEmiDate ? `${nextEmiDate} (${formatINR(nextEmiAmt)})` : 'None / Completed'}</span>
                            </div>

                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total Paid</div>
                              <strong className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(totalPaid)}</strong>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Current Outstanding</div>
                              <strong className="mono" style={{ color: 'var(--danger-text)' }}>{formatINR(loan.outstandingBalance)}</strong>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Pending Amount</div>
                              <strong className="mono">{formatINR(pendingAmount)}</strong>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Overdue Status</div>
                              <span className={`badge ${overdueCount > 0 ? 'badge-overdue' : 'badge-paid'}`}>
                                {overdueCount > 0 ? `${overdueCount} Overdue (${daysOverdue}d)` : 'Current / Regular'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}

                  <DynamicAttachmentManager
                    title="Product Evidence Photos (Box, IMEI Sticker, Handover)"
                    helperText="Upload device evidence photos without limit"
                    type="PHOTO"
                    attachments={newProductPhotos}
                    onChange={setNewProductPhotos}
                  />
                </div>
              )}

              {/* TAB 5: FINANCE & EMIs */}
              {activeProfileTab === 'finance' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {customerDetail.loans.map((loan) => (
                    <div key={loan.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: 12,
                          background: 'var(--bg-surface-secondary)',
                          borderRadius: 'var(--radius-md)',
                        }}
                      >
                        <div>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loan Account:</span>{' '}
                          <strong className="mono">{loan.loanAccountNo}</strong>
                        </div>
                        <div>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Monthly EMI:</span>{' '}
                          <strong className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(loan.emiAmount)}</strong>
                        </div>
                        <div>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Outstanding:</span>{' '}
                          <strong className="mono" style={{ color: 'var(--warning-text)' }}>{formatINR(loan.outstandingBalance)}</strong>
                        </div>
                      </div>

                      {/* EMI Installment Table */}
                      {loan.installments && loan.installments.length > 0 && (
                        <div className="table-container">
                          <table className="crm-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Due Date</th>
                                <th>Expected</th>
                                <th>Penalty</th>
                                <th>Paid</th>
                                <th>Total Due</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {loan.installments.map((inst) => (
                                <tr key={inst.id}>
                                  <td className="mono">{inst.installmentNumber}</td>
                                  <td className="mono">{inst.dueDate}</td>
                                  <td className="mono">{formatINR(inst.expectedAmount)}</td>
                                  <td
                                    className="mono"
                                    style={{
                                      color: Number(inst.penaltyAmount || 0) > 0 ? 'var(--danger-text)' : 'inherit',
                                      fontWeight: Number(inst.penaltyAmount || 0) > 0 ? 700 : 400,
                                    }}
                                  >
                                    {formatINR(inst.penaltyAmount || 0)}
                                  </td>
                                  <td className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(inst.paidAmount)}</td>
                                  <td
                                    className="mono"
                                    style={{
                                      fontWeight: 700,
                                      color: (Number(inst.remainingAmount) + Number(inst.penaltyAmount || 0)) > 0 ? 'var(--danger-text)' : 'inherit',
                                    }}
                                  >
                                    {formatINR(Number(inst.remainingAmount) + Number(inst.penaltyAmount || 0))}
                                  </td>
                                  <td>
                                    <span
                                      className={`badge ${
                                        inst.status === 'PAID'
                                          ? 'badge-paid'
                                          : inst.status === 'DUE_TODAY'
                                          ? 'badge-due-today'
                                          : inst.status === 'OVERDUE'
                                          ? 'badge-overdue'
                                          : 'badge-upcoming'
                                      }`}
                                    >
                                      {inst.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Customer EMI Portal Section */}
                      <div style={{ marginTop: 8 }}>
                        <PortalLinkManager
                          loanId={loan.id}
                          loanAccountNo={loan.loanAccountNo}
                          customerName={customerDetail.customer.fullName}
                          primaryPhone={customerDetail.customer.primaryPhone}
                          userRole={currentUser?.role}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 6: CALL LOGS */}
              {activeProfileTab === 'calls' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700 }}>Recovery Follow-up Logs</h4>
                    <button onClick={() => setShowCallModal(true)} className="btn btn-primary btn-sm">
                      <PhoneCall size={12} />
                      <span>Log Recovery Call</span>
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {customerDetail.callLogs.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>
                        No recovery call interactions logged yet.
                      </div>
                    ) : (
                      customerDetail.callLogs.map((log) => (
                        <div
                          key={log.id}
                          style={{
                            padding: 12,
                            background: 'var(--bg-surface-secondary)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-subtle)',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                            <span className="badge badge-terracotta">{log.outcome}</span>
                            <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                              {new Date(log.call_timestamp).toLocaleString('en-IN', { hour12: true })}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-primary)', marginTop: 6 }}>{log.notes}</div>
                          {log.promised_payment_date && (
                            <div style={{ color: 'var(--warning-text)', fontWeight: 600, marginTop: 4 }}>
                              Promised Payment Date: {log.promised_payment_date}
                            </div>
                          )}
                          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
                            Agent: {log.agent_name || 'Field Agent'}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 7: PAYMENTS HISTORY */}
              {activeProfileTab === 'payments' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
                      <Receipt size={16} color="var(--primary)" />
                      <span>Payment & Collection History</span>
                    </div>
                  </div>

                  {customerPayments.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 12 }}>
                      No payment transactions recorded for this customer yet.
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="crm-table">
                        <thead>
                          <tr>
                            <th>Receipt No</th>
                            <th>Loan Acc</th>
                            <th>Amount</th>
                            <th>Mode</th>
                            <th>Collected Through</th>
                            <th>Date</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerPayments.map((p) => {
                            const isReversed = p.status === 'REVERSED' || Boolean((p as any).is_reversal);
                            const source = p.collectionSource || (p as any).collection_source || 'DIRECT_CUSTOMER';
                            const storeName = p.dealerStoreName || (p as any).dealer_store_name;
                            const dealerCode = p.dealerCode || (p as any).dealer_code;
                            const agentName = p.agentName || (p as any).source_agent_name || (p as any).collected_by_name;

                            return (
                              <tr key={p.id}>
                                <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                                  {p.receiptNumber || (p as any).receipt_number}
                                </td>
                                <td className="mono">{(p as any).loan_account_no || (p as any).loanAccountNo || 'Loan'}</td>
                                <td
                                  className="mono"
                                  style={{
                                    fontWeight: 700,
                                    color: isReversed ? 'var(--text-muted)' : 'var(--success-text)',
                                    textDecoration: isReversed ? 'line-through' : 'none',
                                  }}
                                >
                                  {formatINR(p.amount)}
                                </td>
                                <td>
                                  <span className="badge badge-upcoming">{p.paymentMode || (p as any).payment_mode}</span>
                                </td>
                                <td>
                                  {source === 'DEALER' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: 'fit-content' }}>
                                        <Store size={11} />
                                        <span>DEALER</span>
                                      </span>
                                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {storeName || 'Store'} {dealerCode ? `(${dealerCode})` : ''}
                                      </span>
                                    </div>
                                  ) : source === 'RECOVERY_AGENT' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <span className="badge badge-due-today" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: 'fit-content' }}>
                                        <UserCheck size={11} />
                                        <span>RECOVERY AGENT</span>
                                      </span>
                                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {agentName || 'Field Agent'}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                      <Building2 size={11} />
                                      <span>DIRECT</span>
                                    </span>
                                  )}
                                </td>
                                <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  {formatDateDDMMYYYY(p.paymentTimestamp || (p as any).payment_timestamp)}
                                </td>
                                <td>
                                  <span className={`badge ${isReversed ? 'badge-overdue' : 'badge-paid'}`}>
                                    {isReversed ? 'REVERSED' : 'SUCCESS'}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                      onClick={async () => {
                                        try {
                                          const r = await ApiClient.getReceipt(p.id);
                                          setSelectedReceipt(r);
                                        } catch (e: any) {
                                          alert(e.message || 'Failed to fetch receipt');
                                        }
                                      }}
                                      className="btn btn-secondary btn-sm"
                                      title="View Receipt"
                                    >
                                      <Receipt size={12} />
                                      <span>Receipt</span>
                                    </button>
                                    <button
                                      onClick={async () => {
                                        try {
                                          const d = await ApiClient.getPaymentDetail(p.id);
                                          setSelectedPaymentDetail(d);
                                        } catch (e: any) {
                                          alert(e.message || 'Failed to fetch payment details');
                                        }
                                      }}
                                      className="btn btn-secondary btn-sm"
                                      title="View Details"
                                    >
                                      <Eye size={12} />
                                      <span>Details</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '12px 24px',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface-secondary)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <button
                onClick={() => setShowEditModal(true)}
                className="btn btn-secondary"
              >
                <Edit size={13} />
                <span>Edit Profile</span>
              </button>

              <button
                onClick={() => {
                  setSelectedCustomerId(null);
                  setCustomerDetail(null);
                }}
                className="btn btn-secondary"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {showEditModal && customerDetail && (
        <EditCustomerModal
          isOpen={showEditModal}
          customer={customerDetail.customer}
          existingKycDocs={customerDetail.kycDocuments}
          onClose={() => setShowEditModal(false)}
          onSuccess={async () => {
            setShowEditModal(false);
            const refreshed = await ApiClient.getCustomerDetail(customerDetail.customer.id);
            setCustomerDetail(refreshed);
            loadData();
          }}
        />
      )}

      {/* Call Logging Modal */}
      {showCallModal && customerDetail && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 460, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800 }}>Log Recovery Call</h3>
              <button onClick={() => setShowCallModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCallLog} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Call Outcome
                </label>
                <select
                  className="form-select"
                  value={callOutcome}
                  onChange={(e) => setCallOutcome(e.target.value as CallOutcome)}
                >
                  <option value={CallOutcome.PROMISED_TO_PAY}>Promised to Pay</option>
                  <option value={CallOutcome.RINGING}>Ringing / No Answer</option>
                  <option value={CallOutcome.UNREACHABLE}>Unreachable</option>
                  <option value={CallOutcome.SWITCHED_OFF}>Switched Off</option>
                  <option value={CallOutcome.PAID}>Already Paid</option>
                  <option value={CallOutcome.REFUSED_TO_PAY}>Refused / Dispute</option>
                </select>
              </div>

              {callOutcome === CallOutcome.PROMISED_TO_PAY && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Promised Payment Date
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={promisedDate}
                    onChange={(e) => setPromisedDate(e.target.value)}
                    required
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Agent Remarks & Call Summary
                </label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder="Record borrower notes..."
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button type="button" onClick={() => setShowCallModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={savingCall} className="btn btn-primary">
                  {savingCall ? 'Saving...' : 'Save Call Log'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer 360 Receipt Viewer Modal */}
      {selectedReceipt && (
        <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: 440,
              padding: 24,
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: 8,
            }}
          >
            <div style={{ textAlign: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a', letterSpacing: '0.5px' }}>ALPHA MOBILE GALLERY</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#b8532f', marginTop: 1 }}>SHUBH PVT LTD</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>OFFICIAL PAYMENT RECEIPT</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>
                {selectedReceipt.receiptNumber}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Borrower:</span>
                <strong>{selectedReceipt.customer?.name} ({selectedReceipt.customer?.code})</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Loan Account:</span>
                <strong className="mono">{selectedReceipt.loan?.accountNo}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Collection Source:</span>
                <strong style={{ color: '#9a3412' }}>{selectedReceipt.collectionSource}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Payment Mode:</span>
                <span>{selectedReceipt.paymentMode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontWeight: 800 }}>Amount Paid:</span>
                <strong className="mono" style={{ fontSize: 16, color: '#15803d' }}>
                  {formatINR(selectedReceipt.amount)}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Remaining Loan:</span>
                <span className="mono font-bold">{formatINR(selectedReceipt.loan?.remainingOutstanding || 0)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => window.print()} className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                <Printer size={13} />
                <span>Print</span>
              </button>
              <button onClick={() => setSelectedReceipt(null)} className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer 360 Payment Detail Modal */}
      {selectedPaymentDetail && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 520, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800 }}>Payment Transaction Details</h3>
              <button onClick={() => setSelectedPaymentDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12, background: 'var(--bg-surface-secondary)', padding: 12, borderRadius: 'var(--radius-md)', marginBottom: 12 }}>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Receipt:</span>{' '}
                <strong className="mono">{selectedPaymentDetail.receiptNumber}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Amount:</span>{' '}
                <strong className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(selectedPaymentDetail.amount)}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Source:</span>{' '}
                <span className="badge badge-terracotta">{selectedPaymentDetail.collectionSource}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Mode:</span>{' '}
                <span>{selectedPaymentDetail.paymentMode}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Status:</span>{' '}
                <span className={`badge ${selectedPaymentDetail.isReversal ? 'badge-overdue' : 'badge-paid'}`}>
                  {selectedPaymentDetail.isReversal ? 'REVERSED' : 'COMPLETED'}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Date:</span>{' '}
                <span>{new Date(selectedPaymentDetail.paymentTimestamp).toLocaleString('en-IN', { hour12: true })}</span>
              </div>
            </div>

            {selectedPaymentDetail.allocations && selectedPaymentDetail.allocations.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Waterfall Allocation:</div>
                <div className="table-container">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Inst #</th>
                        <th>Principal</th>
                        <th>Interest</th>
                        <th>Penalty</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPaymentDetail.allocations.map((a: any) => (
                        <tr key={a.id}>
                          <td className="mono">#{a.installmentNumber}</td>
                          <td className="mono">{formatINR(a.principalComponent)}</td>
                          <td className="mono">{formatINR(a.interestComponent)}</td>
                          <td className="mono">{formatINR(a.penaltyComponent)}</td>
                          <td className="mono font-bold">{formatINR(a.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setSelectedPaymentDetail(null)} className="btn btn-secondary btn-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline KYC Document Viewer Modal */}
      {previewDoc && (
        <div className="modal-overlay" style={{ zIndex: 3100 }} onClick={() => setPreviewDoc(null)}>
          <div
            className="modal-content"
            style={{ width: '90%', maxWidth: 840, height: '85vh', display: 'flex', flexDirection: 'column', padding: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Viewer Header */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={18} color="var(--primary)" />
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{previewDoc.title}</h3>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {previewDoc.docType} • Authorized KYC Storage Vault • Secure 5-minute Presigned Access
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a
                  href={previewDoc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                  title="Open full document in new tab or download"
                >
                  <ExternalLink size={13} />
                  <span>Open in Tab</span>
                </a>
                <button
                  onClick={() => setPreviewDoc(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Viewer Body */}
            <div style={{ flex: 1, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <iframe
                src={previewDoc.url}
                title={previewDoc.title}
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
