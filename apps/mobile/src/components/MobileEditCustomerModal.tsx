import React, { useState } from 'react';
import { MobileApi } from '../services/mobileApi';
import { ICustomer } from '@crm/shared';
import {
  X,
  Camera,
  CheckCircle2,
  AlertCircle,
  Save,
  User,
  MapPin,
  FileText,
  Phone,
} from 'lucide-react';
import { MobileAttachmentManager, MobileAttachmentItem } from './MobileAttachmentManager';
import { compressImageFile } from '../utils/imageCompressor';

interface MobileEditCustomerModalProps {
  customer: ICustomer;
  existingKycDocs?: any[];
  onClose: () => void;
  onSuccess: () => void;
}

export const MobileEditCustomerModal: React.FC<MobileEditCustomerModalProps> = ({
  customer,
  existingKycDocs = [],
  onClose,
  onSuccess,
}) => {
  const [fullName, setFullName] = useState(customer.fullName || '');
  const [primaryPhone, setPrimaryPhone] = useState(customer.primaryPhone || '');
  const [alternatePhone, setAlternatePhone] = useState(customer.alternatePhone || '');
  const [areaRoute, setAreaRoute] = useState(customer.areaRoute || '');
  const [addressLine1, setAddressLine1] = useState(customer.addressLine1 || '');
  const [city, setCity] = useState(customer.city || '');
  const [pincode, setPincode] = useState(customer.pincode || '');

  // Photo
  const [photoUrl, setPhotoUrl] = useState<string | null>(customer.photoUrl || null);
  const [newPhotoFile, setNewPhotoFile] = useState<File | null>(null);

  // Dynamic Attachments
  const [attachments, setAttachments] = useState<MobileAttachmentItem[]>(() => {
    return existingKycDocs.map((doc) => ({
      id: doc.id,
      category: doc.docType || doc.doc_type || 'Document',
      title: doc.docNumber || doc.doc_number || doc.fileName || '',
      file: null,
      previewUrl: doc.storageKey?.startsWith('data:') ? doc.storageKey : null,
      remoteUrl: doc.storageKey,
      storageKey: doc.storageKey,
      mimeType: doc.fileMimeType || 'application/pdf',
      fileSizeBytes: doc.fileSizeBytes || 0,
      status: 'UPLOADED',
    }));
  });

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    if (!file) return;

    file = await compressImageFile(file, 800, 0.8);
    setNewPhotoFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);

    try {
      // 1. Update Core Customer Details
      await MobileApi.updateCustomer(customer.id, {
        fullName,
        primaryPhone,
        alternatePhone: alternatePhone || undefined,
        areaRoute,
        addressLine1,
        city,
        pincode,
        photoUrl: photoUrl || undefined,
      });

      // 2. Handle deleted KYC documents
      const remainingDocIds = new Set(attachments.map((a) => a.id));
      for (const origDoc of existingKycDocs) {
        if (!remainingDocIds.has(origDoc.id)) {
          try {
            await MobileApi.deleteKYCDocument(origDoc.id);
          } catch (delErr) {
            console.warn('Failed to delete removed doc', origDoc.id, delErr);
          }
        }
      }

      // 3. Upload new KYC documents
      const newItems = attachments.filter((a) => a.file !== null);
      for (const item of newItems) {
        if (item.file) {
          const presigned = await MobileApi.initKYCUpload({
            customerId: customer.id,
            docType: item.category,
            fileName: item.file.name,
            mimeType: item.mimeType || item.file.type || 'image/jpeg',
            fileSizeBytes: item.fileSizeBytes || item.file.size,
          });

          await MobileApi.confirmKYC({
            customerId: customer.id,
            docType: item.category,
            docNumber: item.title || undefined,
            storageKey: presigned.storageKey,
            fileMimeType: presigned.fileMimeType,
            fileSizeBytes: presigned.fileSizeBytes,
          });
        }
      }

      onSuccess();
    } catch (err: any) {
      console.error('Failed to update customer', err);
      setErrorMsg(err.message || 'Failed to save customer changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 60 }}>
      <div
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: 440,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          borderRadius: 12,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-surface-secondary)',
          }}
        >
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800 }}>Edit Customer Profile</h3>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {customer.customerCode} • Active Record
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSave}
          style={{
            padding: '16px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            flex: 1,
          }}
        >
          {errorMsg && (
            <div
              style={{
                background: 'var(--danger-bg)',
                border: '1px solid var(--danger-border)',
                color: 'var(--danger-text)',
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Customer Avatar / Photo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'var(--primary-subtle)',
                color: 'var(--primary)',
                border: '2px solid var(--primary-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <User size={26} />
              )}
            </div>

            <div>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Camera size={13} />
                <span>{photoUrl ? 'Change Photo' : 'Upload Photo'}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handleAvatarFile}
                />
              </label>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                Live selfie or avatar photo
              </div>
            </div>
          </div>

          {/* Section: Personal Info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Full Name *
              </label>
              <input
                type="text"
                className="mobile-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Primary Phone *
                </label>
                <input
                  type="tel"
                  className="mobile-input mono"
                  value={primaryPhone}
                  onChange={(e) => setPrimaryPhone(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Alternate Phone
                </label>
                <input
                  type="tel"
                  className="mobile-input mono"
                  value={alternatePhone}
                  onChange={(e) => setAlternatePhone(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Section: Route & Address */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Collection Area / Route *
              </label>
              <input
                type="text"
                className="mobile-input"
                placeholder="Enter area or route manually (e.g. Dadri, Pari Chowk)"
                value={areaRoute}
                onChange={(e) => setAreaRoute(e.target.value)}
                required
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                Free manual entry. Preserved exactly.
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Address Line 1 *
              </label>
              <input
                type="text"
                className="mobile-input"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  City *
                </label>
                <input
                  type="text"
                  className="mobile-input"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Pincode *
                </label>
                <input
                  type="text"
                  className="mobile-input mono"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          {/* Section: Dynamic Attachments & KYC */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <MobileAttachmentManager
              title="KYC Documents & Customer Photos"
              helperText="Unlimited photos & documents. Add, replace or remove."
              attachments={attachments}
              onChange={setAttachments}
              type="MIXED"
            />
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={onClose}
              className="mobile-btn mobile-btn-secondary"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="mobile-btn mobile-btn-primary"
              style={{ flex: 1.5 }}
            >
              <Save size={14} />
              <span>{saving ? 'Saving Changes...' : 'Save Customer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
