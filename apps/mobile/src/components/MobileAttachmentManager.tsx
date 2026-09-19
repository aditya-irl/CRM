import React, { useRef, useState } from 'react';
import {
  Upload,
  Camera,
  Trash2,
  FileText,
  Image as ImageIcon,
  Plus,
  Eye,
  X,
} from 'lucide-react';
import { compressImageFile } from '../utils/imageCompressor';

export interface MobileAttachmentItem {
  id: string;
  category: string;
  title: string;
  file: File | null;
  previewUrl: string | null;
  remoteUrl?: string | null;
  storageKey?: string | null;
  mimeType: string;
  fileSizeBytes: number;
  status: 'READY' | 'UPLOADING' | 'UPLOADED' | 'ERROR';
  errorMessage?: string;
}

interface MobileAttachmentManagerProps {
  attachments: MobileAttachmentItem[];
  onChange: (attachments: MobileAttachmentItem[]) => void;
  allowedCategories?: string[];
  type?: 'DOCUMENT' | 'PHOTO' | 'MIXED';
  title?: string;
  helperText?: string;
  readOnly?: boolean;
  onViewRemote?: (item: MobileAttachmentItem) => void;
}

const DEFAULT_DOC_CATEGORIES = [
  'Aadhaar Front',
  'Aadhaar Back',
  'PAN Card',
  'Driving Licence',
  'Voter ID',
  'Address Proof',
  'Loan Agreement',
  'Purchase Invoice',
  'Other Document',
];

const DEFAULT_PHOTO_CATEGORIES = [
  'Customer Live Photo',
  'Customer Selfie',
  'Product Front View',
  'Product Back View',
  'Product IMEI / Serial Tag',
  'Product Box / Condition',
  'Invoice Proof Photo',
  'Store Handover Photo',
  'Other Photo',
];

export const MobileAttachmentManager: React.FC<MobileAttachmentManagerProps> = ({
  attachments,
  onChange,
  allowedCategories,
  type = 'MIXED',
  title,
  helperText,
  readOnly = false,
  onViewRemote,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const activeItemIdRef = useRef<string | null>(null);

  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);

  const categories =
    allowedCategories ||
    (type === 'DOCUMENT'
      ? DEFAULT_DOC_CATEGORIES
      : type === 'PHOTO'
      ? DEFAULT_PHOTO_CATEGORIES
      : [...DEFAULT_DOC_CATEGORIES, ...DEFAULT_PHOTO_CATEGORIES]);

  const handleAddNewItem = (categoryHint?: string) => {
    const newItem: MobileAttachmentItem = {
      id: `mob_att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      category: categoryHint || categories[0],
      title: '',
      file: null,
      previewUrl: null,
      mimeType: '',
      fileSizeBytes: 0,
      status: 'READY',
    };
    onChange([...attachments, newItem]);
  };

  const handleRemoveItem = (id: string) => {
    onChange(attachments.filter((a) => a.id !== id));
  };

  const handleUpdateItem = (id: string, updates: Partial<MobileAttachmentItem>) => {
    onChange(
      attachments.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    const targetId = activeItemIdRef.current;
    if (!file || !targetId) return;

    if (file.type.startsWith('image/')) {
      file = await compressImageFile(file);
    }

    const isPdf = file.type === 'application/pdf';
    if (isPdf) {
      handleUpdateItem(targetId, {
        file,
        previewUrl: null,
        mimeType: file.type,
        fileSizeBytes: file.size,
        title: file.name,
        status: 'READY',
      });
    } else {
      const reader = new FileReader();
      const currentFile = file;
      reader.onloadend = () => {
        handleUpdateItem(targetId, {
          file: currentFile,
          previewUrl: reader.result as string,
          mimeType: currentFile.type,
          fileSizeBytes: currentFile.size,
          title: currentFile.name,
          status: 'READY',
        });
      };
      reader.readAsDataURL(file);
    }

    if (e.target) e.target.value = '';
  };

  const triggerUpload = (id: string, isCamera: boolean) => {
    activeItemIdRef.current = id;
    if (isCamera) {
      cameraInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Hidden native inputs for mobile */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        style={{ display: 'none' }}
        onChange={handleFilePicked}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFilePicked}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {title && <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>}
          {helperText && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{helperText}</div>}
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={() => handleAddNewItem()}
            className="mobile-btn mobile-btn-secondary"
            style={{ minHeight: 32, padding: '4px 10px', fontSize: 12 }}
          >
            <Plus size={13} />
            <span>{type === 'PHOTO' ? '+ Add Photo' : type === 'DOCUMENT' ? '+ Add Document' : '+ Add Item'}</span>
          </button>
        )}
      </div>

      {attachments.length === 0 ? (
        <div
          style={{
            padding: '16px 12px',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 8,
            background: 'var(--bg-surface-secondary)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            No attachments added yet. No limit on photos or documents.
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => handleAddNewItem()}
              className="mobile-btn mobile-btn-primary"
              style={{ minHeight: 32, fontSize: 12, padding: '4px 12px', marginTop: 4 }}
            >
              <Plus size={13} />
              <span>+ Add {type === 'PHOTO' ? 'Photo' : 'Document'}</span>
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {attachments.map((item, index) => {
            const hasPreview = Boolean(item.previewUrl || item.remoteUrl);
            const isPdf = item.mimeType === 'application/pdf';

            return (
              <div
                key={item.id}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {/* Header row: category + delete */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: '#ffffff',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {index + 1}
                    </span>

                    {!readOnly ? (
                      <select
                        className="mobile-select"
                        style={{ fontSize: 12, padding: '4px 8px', height: 32, flex: 1 }}
                        value={item.category}
                        onChange={(e) => handleUpdateItem(item.id, { category: e.target.value })}
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="mobile-badge badge-paid">{item.category}</span>
                    )}
                  </div>

                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--danger-text)',
                        padding: 4,
                        cursor: 'pointer',
                      }}
                      title="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                {!readOnly && (
                  <input
                    type="text"
                    className="mobile-input"
                    style={{ fontSize: 11, padding: '4px 8px', height: 30 }}
                    placeholder="Optional label / ID / doc no..."
                    value={item.title}
                    onChange={(e) => handleUpdateItem(item.id, { title: e.target.value })}
                  />
                )}

                {/* Thumbnail & Controls */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: hasPreview ? 'pointer' : 'default' }}
                    onClick={() => {
                      const url = item.previewUrl || item.remoteUrl;
                      if (url) setPreviewModalUrl(url);
                    }}
                  >
                    {hasPreview ? (
                      <img
                        src={item.previewUrl || item.remoteUrl || ''}
                        alt={item.title || item.category}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 6,
                          objectFit: 'cover',
                          border: '1px solid var(--border-subtle)',
                        }}
                      />
                    ) : isPdf ? (
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 6,
                          background: '#ffffff',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <FileText size={20} color="var(--primary)" />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 6,
                          background: '#ffffff',
                          border: '1px dashed var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <ImageIcon size={18} />
                      </div>
                    )}

                    <div style={{ fontSize: 11 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {item.file?.name || item.title || item.category}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                        {item.fileSizeBytes > 0 ? `${(item.fileSizeBytes / 1024).toFixed(1)} KB` : 'No file chosen'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4 }}>
                    {item.remoteUrl && onViewRemote && (
                      <button
                        type="button"
                        onClick={() => onViewRemote(item)}
                        className="mobile-btn mobile-btn-secondary"
                        style={{ minHeight: 30, padding: '2px 8px', fontSize: 11 }}
                      >
                        <Eye size={12} />
                        <span>View</span>
                      </button>
                    )}

                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => triggerUpload(item.id, false)}
                          className="mobile-btn mobile-btn-secondary"
                          style={{ minHeight: 30, padding: '2px 8px', fontSize: 11 }}
                        >
                          <Upload size={12} />
                          <span>{hasPreview || isPdf ? 'Replace' : 'File'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerUpload(item.id, true)}
                          className="mobile-btn mobile-btn-secondary"
                          style={{ minHeight: 30, padding: '2px 8px', fontSize: 11 }}
                        >
                          <Camera size={12} />
                          <span>Cam</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fullscreen Preview Modal */}
      {previewModalUrl && (
        <div
          className="modal-overlay"
          style={{ zIndex: 100 }}
          onClick={() => setPreviewModalUrl(null)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 360, width: '90%', padding: 12, textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Attachment Preview</span>
              <button
                onClick={() => setPreviewModalUrl(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            <img
              src={previewModalUrl}
              alt="Preview"
              style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 6 }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
