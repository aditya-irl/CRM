import React, { useEffect, useState, useRef } from 'react';
import { MobileApi } from '../services/mobileApi';
import { ICustomer, formatINR, PaymentMode } from '@crm/shared';
import {
  Search,
  Phone,
  MessageCircle,
  DollarSign,
  Smartphone,
  X,
  CheckCircle2,
  Calendar,
  AlertCircle,
  FileText,
  Edit,
  Plus,
  Trash2,
  Camera,
  Upload,
  User,
  ShieldCheck,
  Clock,
  ExternalLink,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { MobileEditCustomerModal } from '../components/MobileEditCustomerModal';
import { compressImageFile } from '../utils/imageCompressor';

export const MobileCustomersView: React.FC = () => {
  const [customers, setCustomers] = useState<ICustomer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Detail Sheet State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<{
    customer: ICustomer;
    loans: any[];
    kycDocuments: any[];
    callLogs: any[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);

  // Payment modal state
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedLoanForPay, setSelectedLoanForPay] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMode, setPayMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [refNo, setRefNo] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [receiptResult, setReceiptResult] = useState<any | null>(null);

  // Quick Direct Upload state
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadingCategory, setUploadingCategory] = useState<string>('Aadhaar Front');
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<any | null>(null);
  const directFileInputRef = useRef<HTMLInputElement>(null);
  const directCameraInputRef = useRef<HTMLInputElement>(null);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const data = await MobileApi.getCustomers(search || undefined);
      setCustomers(data);
    } catch (err) {
      console.error('Failed to load customers', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadCustomers();
  };

  const handleOpenDetail = async (id: string) => {
    setSelectedCustomerId(id);
    setLoadingDetail(true);
    try {
      const data = await MobileApi.getCustomerDetail(id);
      setCustomerDetail(data);
    } catch (err: any) {
      alert(err.message || 'Failed to load customer profile');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRefreshDetail = async () => {
    if (!selectedCustomerId) return;
    try {
      const data = await MobileApi.getCustomerDetail(selectedCustomerId);
      setCustomerDetail(data);
      loadCustomers();
    } catch (err) {
      console.error('Failed to refresh customer detail', err);
    }
  };

  const sendWhatsApp = (cust: ICustomer) => {
    const cleanPhone = cust.primaryPhone.replace(/\D/g, '');
    const msg = `Hello ${cust.fullName}, greeting from collection service. Please reach out if you have any questions regarding your EMI account.`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleOpenPayFromCustomer = (loan: any) => {
    setSelectedLoanForPay(loan);
    setPayAmount(Number(loan.emiAmount || loan.emi_amount || 0));
    setPayMode(PaymentMode.CASH);
    setRefNo('');
    setShowPayModal(true);
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoanForPay || !customerDetail) return;
    setSavingPayment(true);
    try {
      const idempotencyKey = `MOB_CUST_${customerDetail.customer.id}_${Date.now()}`;
      const res = await MobileApi.recordPayment({
        loanId: selectedLoanForPay.id,
        customerId: customerDetail.customer.id,
        amount: Number(payAmount),
        paymentMode: payMode,
        referenceNumber: refNo || undefined,
        idempotencyKey,
      });
      setShowPayModal(false);
      setReceiptResult(res);
      handleRefreshDetail();
    } catch (err: any) {
      alert(err.message || 'Payment collection failed');
    } finally {
      setSavingPayment(false);
    }
  };

  // Direct Attachment Upload Handlers
  const triggerDirectUpload = (category: string, isCamera: boolean) => {
    setUploadingCategory(category);
    if (isCamera) {
      directCameraInputRef.current?.click();
    } else {
      directFileInputRef.current?.click();
    }
  };

  const handleDirectFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    if (!file || !customerDetail) return;

    setUploadingDoc(true);
    try {
      if (file.type.startsWith('image/')) {
        file = await compressImageFile(file, 1600, 0.85);
      }

      const presigned = await MobileApi.initKYCUpload({
        customerId: customerDetail.customer.id,
        docType: uploadingCategory,
        fileName: file.name,
        mimeType: file.type || 'image/jpeg',
        fileSizeBytes: file.size,
      });

      await MobileApi.confirmKYC({
        customerId: customerDetail.customer.id,
        docType: uploadingCategory,
        docNumber: file.name,
        storageKey: presigned.storageKey,
        fileMimeType: presigned.fileMimeType,
        fileSizeBytes: presigned.fileSizeBytes,
      });

      await handleRefreshDetail();
    } catch (err: any) {
      alert(err.message || 'Attachment upload failed');
    } finally {
      setUploadingDoc(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('Are you sure you want to remove this attachment?')) return;
    try {
      await MobileApi.deleteKYCDocument(docId);
      await handleRefreshDetail();
    } catch (err: any) {
      alert(err.message || 'Failed to remove document');
    }
  };

  return (
    <div style={{ paddingBottom: 70, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Hidden inputs for direct attachment upload */}
      <input
        ref={directFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        style={{ display: 'none' }}
        onChange={handleDirectFilePicked}
      />
      <input
        ref={directCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleDirectFilePicked}
      />

      {/* Search Header */}
      <div
        style={{
          background: '#ffffff',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              className="mobile-input"
              style={{ paddingLeft: 34, height: 38, fontSize: 13 }}
              placeholder="Search by name, phone, area route..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Search
              size={15}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 10, top: 12 }}
            />
          </div>
          <button type="submit" className="mobile-btn mobile-btn-secondary" style={{ minHeight: 38, padding: '0 12px' }}>
            Search
          </button>
        </form>
      </div>

      {/* Contact List */}
      <div style={{ flex: 1, background: '#ffffff' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading borrowers...</div>
        ) : customers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            No customers found matching your search.
          </div>
        ) : (
          customers.map((c) => {
            const hasOutstanding = (c.totalOutstanding || 0) > 0;
            return (
              <div
                key={c.id}
                className="contact-row"
                onClick={() => handleOpenDetail(c.id)}
              >
                <div className="contact-avatar">
                  {c.photoUrl ? (
                    <img src={c.photoUrl} alt={c.fullName} />
                  ) : (
                    c.fullName.charAt(0)
                  )}
                </div>

                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {c.fullName}
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {c.customerCode}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {c.primaryPhone}
                    </div>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: hasOutstanding ? 'var(--warning-text)' : 'var(--success-text)' }}>
                      {formatINR(c.totalOutstanding || 0)}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    📍 {c.areaRoute}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Customer Detail Bottom Sheet / Modal */}
      {selectedCustomerId && customerDetail && (
        <div className="modal-overlay" style={{ zIndex: 50 }}>
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: 460,
              maxHeight: '94vh',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              borderRadius: 14,
            }}
          >
            {/* Header: Customer Photo + Info + Edit Button */}
            <div
              style={{
                padding: '16px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--bg-surface-secondary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  className="contact-avatar"
                  style={{ width: 48, height: 48, fontSize: 18, border: '2px solid var(--primary-border)' }}
                >
                  {customerDetail.customer.photoUrl ? (
                    <img src={customerDetail.customer.photoUrl} alt={customerDetail.customer.fullName} />
                  ) : (
                    customerDetail.customer.fullName.charAt(0)
                  )}
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800 }}>{customerDetail.customer.fullName}</h3>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {customerDetail.customer.primaryPhone} • {customerDetail.customer.customerCode}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    📍 {customerDetail.customer.areaRoute}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => setShowEditModal(true)}
                  className="mobile-btn mobile-btn-primary"
                  style={{ minHeight: 32, padding: '4px 10px', fontSize: 12 }}
                >
                  <Edit size={13} />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => {
                    setSelectedCustomerId(null);
                    setCustomerDetail(null);
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* 3 Primary Action Buttons */}
            <div style={{ padding: '12px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <a
                href={`tel:${customerDetail.customer.primaryPhone}`}
                className="mobile-btn mobile-btn-secondary"
                style={{ textDecoration: 'none', color: 'var(--text-primary)' }}
              >
                <Phone size={14} color="var(--primary)" />
                <span>Call</span>
              </a>

              <button
                onClick={() => sendWhatsApp(customerDetail.customer)}
                className="mobile-btn mobile-btn-secondary"
                style={{ color: '#16a34a' }}
              >
                <MessageCircle size={14} />
                <span>WhatsApp</span>
              </button>

              {customerDetail.loans.length > 0 ? (
                <button
                  onClick={() => handleOpenPayFromCustomer(customerDetail.loans[0])}
                  className="mobile-btn mobile-btn-success"
                >
                  <DollarSign size={14} />
                  <span>Collect</span>
                </button>
              ) : (
                <button disabled className="mobile-btn mobile-btn-secondary">
                  <span>No Loans</span>
                </button>
              )}
            </div>

            {/* Scrollable Customer Profile Sections */}
            <div style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              
              {/* SECTION: CONTACT & ROUTE */}
              <div className="mobile-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    Contact & Route
                  </div>
                  <span className="mobile-badge badge-paid">ACTIVE</span>
                </div>
                <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div><strong>Name:</strong> {customerDetail.customer.fullName}</div>
                  <div><strong>Phone:</strong> <span className="mono">{customerDetail.customer.primaryPhone}</span></div>
                  {customerDetail.customer.alternatePhone && (
                    <div><strong>Alt Phone:</strong> <span className="mono">{customerDetail.customer.alternatePhone}</span></div>
                  )}
                  <div><strong>Area / Route:</strong> {customerDetail.customer.areaRoute}</div>
                  <div><strong>Address:</strong> {customerDetail.customer.addressLine1}, {customerDetail.customer.city} - {customerDetail.customer.pincode}</div>
                </div>
              </div>

              {/* SECTION: DOCUMENTS (Dynamic attachments without limits) */}
              <div className="mobile-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    Documents ({customerDetail.kycDocuments.length})
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => triggerDirectUpload('Aadhaar Front', false)}
                      className="mobile-btn mobile-btn-secondary"
                      style={{ minHeight: 28, padding: '2px 8px', fontSize: 11 }}
                    >
                      <Plus size={11} />
                      <span>Add Doc</span>
                    </button>
                    <button
                      onClick={() => triggerDirectUpload('Aadhaar Front', true)}
                      className="mobile-btn mobile-btn-secondary"
                      style={{ minHeight: 28, padding: '2px 8px', fontSize: 11 }}
                    >
                      <Camera size={11} />
                      <span>Cam</span>
                    </button>
                  </div>
                </div>

                {uploadingDoc && (
                  <div style={{ textAlign: 'center', padding: 8, fontSize: 11, color: 'var(--primary)' }}>
                    Uploading attachment...
                  </div>
                )}

                {customerDetail.kycDocuments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 11, color: 'var(--text-muted)' }}>
                    No documents uploaded. Tap "+ Add Doc" or "Cam" to attach documents.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {customerDetail.kycDocuments.map((doc: any) => {
                      const isImage = doc.fileMimeType?.startsWith('image/') || doc.storageKey?.startsWith('data:image');
                      return (
                        <div
                          key={doc.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: 8,
                            background: 'var(--bg-surface-secondary)',
                            borderRadius: 6,
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}
                            onClick={() => setSelectedPreviewDoc(doc)}
                          >
                            {isImage ? (
                              <img
                                src={doc.storageKey}
                                alt={doc.docType}
                                style={{ width: 38, height: 38, borderRadius: 4, objectFit: 'cover' }}
                              />
                            ) : (
                              <div style={{ width: 38, height: 38, borderRadius: 4, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <FileText size={18} color="var(--primary)" />
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700 }}>{doc.docType || doc.doc_type}</div>
                              <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                {doc.docNumber || doc.fileName || 'Verified Doc'}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={() => setSelectedPreviewDoc(doc)}
                              className="mobile-btn mobile-btn-secondary"
                              style={{ minHeight: 28, padding: '2px 6px', fontSize: 11 }}
                            >
                              <Eye size={12} />
                            </button>
                            <button
                              onClick={() => handleDeleteDoc(doc.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--danger-text)', padding: 4, cursor: 'pointer' }}
                              title="Delete document"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* SECTION: PRODUCT / DEVICE & PHOTOS */}
              {customerDetail.loans.length > 0 && (
                <div className="mobile-card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                      <Smartphone size={14} color="var(--primary)" />
                      <span>Financed Device & Photos</span>
                    </div>
                    <button
                      onClick={() => triggerDirectUpload('Product Front View', true)}
                      className="mobile-btn mobile-btn-secondary"
                      style={{ minHeight: 28, padding: '2px 8px', fontSize: 11 }}
                    >
                      <Plus size={11} />
                      <span>Add Photo</span>
                    </button>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>Loan Acc: <span className="mono" style={{ fontWeight: 600 }}>{customerDetail.loans[0].loanAccountNo || customerDetail.loans[0].loan_account_no}</span></div>
                    <div>Principal: <span className="mono">{formatINR(customerDetail.loans[0].principalAmount || customerDetail.loans[0].principal_amount)}</span></div>
                    <div>Monthly EMI: <strong className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(customerDetail.loans[0].emiAmount || customerDetail.loans[0].emi_amount)}</strong></div>
                  </div>
                </div>
              )}

              {/* SECTION: FINANCE & BALANCES */}
              <div
                style={{
                  background: 'var(--bg-surface-secondary)',
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700 }}>OUTSTANDING BALANCE</div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--warning-text)', marginTop: 2 }}>
                    {formatINR(customerDetail.customer.totalOutstanding || 0)}
                  </div>
                </div>
                <span className="badge badge-paid">ACTIVE BORROWER</span>
              </div>

              {/* SECTION: CALL HISTORY */}
              {customerDetail.callLogs && customerDetail.callLogs.length > 0 && (
                <div className="mobile-card" style={{ padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Recent Call History
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {customerDetail.callLogs.slice(0, 3).map((log: any) => (
                      <div key={log.id} style={{ fontSize: 11, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                          <span>{log.outcome}</span>
                          <span className="mono" style={{ color: 'var(--text-muted)' }}>
                            {log.createdAt ? new Date(log.createdAt).toLocaleDateString() : 'Recent'}
                          </span>
                        </div>
                        {log.notes && <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{log.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Close Button */}
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface-secondary)' }}>
              <button
                onClick={() => {
                  setSelectedCustomerId(null);
                  setCustomerDetail(null);
                }}
                className="mobile-btn mobile-btn-secondary"
                style={{ width: '100%' }}
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {showEditModal && customerDetail && (
        <MobileEditCustomerModal
          customer={customerDetail.customer}
          existingKycDocs={customerDetail.kycDocuments}
          onClose={() => setShowEditModal(false)}
          onSuccess={async () => {
            setShowEditModal(false);
            await handleRefreshDetail();
          }}
        />
      )}

      {/* Collect Payment Modal */}
      {showPayModal && selectedLoanForPay && customerDetail && (
        <div className="modal-overlay" style={{ zIndex: 60 }}>
          <div className="modal-content" style={{ width: '100%', maxWidth: 400, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>Collect Payment</h3>
              <button onClick={() => setShowPayModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: 'var(--bg-surface-secondary)', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
              <div>Borrower: <strong>{customerDetail.customer.fullName}</strong></div>
              <div>Loan Acc: <span className="mono">{selectedLoanForPay.loanAccountNo || selectedLoanForPay.loan_account_no}</span></div>
            </div>

            <form onSubmit={handleSavePayment} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Collection Amount (₹)
                </label>
                <input
                  type="number"
                  className="mobile-input mono"
                  style={{ fontSize: 18, fontWeight: 700 }}
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Payment Mode
                </label>
                <select className="mobile-select" value={payMode} onChange={(e) => setPayMode(e.target.value as PaymentMode)}>
                  <option value={PaymentMode.CASH}>Cash</option>
                  <option value={PaymentMode.UPI}>UPI (QR / GooglePay)</option>
                  <option value={PaymentMode.BANK_TRANSFER}>Bank Transfer</option>
                </select>
              </div>

              {payMode !== PaymentMode.CASH && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Txn Ref No / UPI ID
                  </label>
                  <input
                    type="text"
                    className="mobile-input mono"
                    placeholder="UPI Reference..."
                    value={refNo}
                    onChange={(e) => setRefNo(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setShowPayModal(false)} className="mobile-btn mobile-btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" disabled={savingPayment} className="mobile-btn mobile-btn-success" style={{ flex: 1 }}>
                  {savingPayment ? 'Processing...' : 'Settle & Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {receiptResult && (
        <div className="modal-overlay" style={{ zIndex: 70 }}>
          <div className="modal-content" style={{ width: '100%', maxWidth: 360, textAlign: 'center', padding: 24 }}>
            <CheckCircle2 size={36} color="var(--success)" style={{ margin: '0 auto 6px' }} />
            <h3 style={{ fontSize: 16, fontWeight: 800 }}>PAYMENT COLLECTED</h3>
            <div className="mono" style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13 }}>
              {receiptResult.receiptNumber}
            </div>

            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                padding: 12,
                borderRadius: 8,
                margin: '14px 0',
                fontSize: 13,
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div>Loan Acc: <span className="mono">{receiptResult.loanAccountNo}</span></div>
              <div style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                Amount: {formatINR(receiptResult.amountCollected)}
              </div>
              <div>
                Remaining Loan: <span className="mono">{formatINR(receiptResult.remainingLoanOutstanding)}</span>
              </div>
            </div>

            <button onClick={() => setReceiptResult(null)} className="mobile-btn mobile-btn-primary" style={{ width: '100%' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Document Full View Modal */}
      {selectedPreviewDoc && (
        <div className="modal-overlay" style={{ zIndex: 80 }} onClick={() => setSelectedPreviewDoc(null)}>
          <div className="modal-content" style={{ maxWidth: 360, width: '90%', padding: 14, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{selectedPreviewDoc.docType || 'Document'}</span>
              <button onClick={() => setSelectedPreviewDoc(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            {selectedPreviewDoc.storageKey?.startsWith('data:image') || selectedPreviewDoc.fileMimeType?.startsWith('image/') ? (
              <img src={selectedPreviewDoc.storageKey} alt="Doc" style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 6 }} />
            ) : (
              <div style={{ padding: 24, background: 'var(--bg-surface-secondary)', borderRadius: 6, fontSize: 12 }}>
                <div>Document Key: <span className="mono">{selectedPreviewDoc.storageKey}</span></div>
                <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>MIME: {selectedPreviewDoc.fileMimeType}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
