import React, { useState } from 'react';
import { ApiClient } from '../services/api';
import { ICustomer, KYCType } from '@crm/shared';
import { DynamicAttachmentManager, AttachmentItem } from './DynamicAttachmentManager';
import { MediaUploader, MediaUploadResult } from './MediaUploader';
import { X, CheckCircle2, AlertCircle, User, ShieldCheck, MapPin, Save } from 'lucide-react';

interface EditCustomerModalProps {
  isOpen: boolean;
  customer: ICustomer;
  existingKycDocs?: any[];
  onClose: () => void;
  onSuccess: (updatedCustomer: ICustomer) => void;
}

export const EditCustomerModal: React.FC<EditCustomerModalProps> = ({
  isOpen,
  customer,
  existingKycDocs = [],
  onClose,
  onSuccess,
}) => {
  const [fullName, setFullName] = useState(customer.fullName || '');
  const [primaryPhone, setPrimaryPhone] = useState(customer.primaryPhone || '');
  const [alternatePhone, setAlternatePhone] = useState(customer.alternatePhone || '');
  const [addressLine1, setAddressLine1] = useState(customer.addressLine1 || '');
  const [addressLine2, setAddressLine2] = useState(customer.addressLine2 || '');
  const [landmark, setLandmark] = useState(customer.landmark || '');
  const [city, setCity] = useState(customer.city || 'Delhi');
  const [state, setState] = useState(customer.state || 'Delhi');
  const [pincode, setPincode] = useState(customer.pincode || '');
  const [areaRoute, setAreaRoute] = useState(customer.areaRoute || '');
  const [mainPhoto, setMainPhoto] = useState<MediaUploadResult | null>(null);

  // New Documents to upload
  const [docAttachments, setDocAttachments] = useState<AttachmentItem[]>([]);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !primaryPhone.trim() || !addressLine1.trim() || !areaRoute.trim() || !pincode.trim()) {
      setErrorMsg('Please complete all required fields.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    try {
      // 1. Update customer profile details
      const updated = await ApiClient.updateCustomer(customer.id, {
        fullName: fullName.trim(),
        primaryPhone: primaryPhone.trim(),
        alternatePhone: alternatePhone.trim() || null,
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2.trim() || null,
        landmark: landmark.trim() || null,
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        areaRoute: areaRoute.trim(),
        photoUrl: mainPhoto?.previewUrl || customer.photoUrl || null,
      });

      // 2. Process any new KYC document uploads if provided
      for (const item of docAttachments) {
        if (item.file) {
          try {
            let docTypeEnum: KYCType = KYCType.OTHER;
            const catLower = item.category.toLowerCase();
            if (catLower.includes('aadhaar')) docTypeEnum = KYCType.AADHAAR;
            else if (catLower.includes('pan')) docTypeEnum = KYCType.PAN;
            else if (catLower.includes('voter')) docTypeEnum = KYCType.VOTER_ID;
            else if (catLower.includes('driving')) docTypeEnum = KYCType.DRIVING_LICENSE;

            // Confirm document registration
            await ApiClient.confirmKYC({
              customerId: customer.id,
              docType: docTypeEnum,
              docNumber: item.title || null,
              storageKey: `kyc/${customer.id}/${Date.now()}_${item.file.name}`,
              fileMimeType: item.mimeType || 'image/jpeg',
              fileSizeBytes: item.fileSizeBytes || item.file.size,
            });
          } catch (docErr) {
            console.warn('Doc registration notice:', docErr);
          }
        }
      }

      onSuccess(updated);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update customer details.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExistingDoc = async (docId: string) => {
    if (!confirm('Are you sure you want to remove this KYC document?')) return;
    try {
      await ApiClient.deleteKYCDocument(docId);
      alert('Document removed successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to remove document.');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: '100%', maxWidth: 740, padding: 0 }}>
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-surface-secondary)',
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800 }}>Edit Customer Profile & Attachments</h2>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Borrower Code: <span className="mono" style={{ fontWeight: 700 }}>{customer.customerCode}</span> • Updates are live while EMI is active
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {errorMsg && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--danger-bg)',
                  border: '1px solid var(--danger-border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--danger-text)',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle size={15} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Basic Information */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Full Name <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Primary Phone <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="tel"
                  className="form-input mono"
                  value={primaryPhone}
                  onChange={(e) => setPrimaryPhone(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Alternate Phone
                </label>
                <input
                  type="tel"
                  className="form-input mono"
                  value={alternatePhone}
                  onChange={(e) => setAlternatePhone(e.target.value)}
                  placeholder="+91..."
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Collection Area / Route <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter area or route manually (e.g. Dadri, Alpha 1, Pari Chowk, Kasna)..."
                  value={areaRoute}
                  onChange={(e) => setAreaRoute(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Shop / Street Address Line 1 <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>City</label>
                <input type="text" className="form-input" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>State</label>
                <input type="text" className="form-input" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Pincode <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input type="text" className="form-input mono" value={pincode} onChange={(e) => setPincode(e.target.value)} required />
              </div>
            </div>

            {/* Customer Photo Uploader */}
            <div style={{ marginTop: 4 }}>
              <MediaUploader
                label="Update Customer Photo / Avatar"
                category="CUSTOMER_PHOTO"
                value={customer.photoUrl || undefined}
                helperText="Upload or take fresh customer live photo"
                onChange={setMainPhoto}
              />
            </div>

            {/* Dynamic Documents Upload Section */}
            <div style={{ marginTop: 10, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
              <DynamicAttachmentManager
                title="Attach Additional Documents / KYC"
                helperText="Upload KYC documents, proof of address, agreement scans, or invoice copies without count limit."
                type="DOCUMENT"
                attachments={docAttachments}
                onChange={setDocAttachments}
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div
            style={{
              padding: '14px 22px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              <Save size={14} />
              <span>{saving ? 'Saving Updates...' : 'Save Customer Updates'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
