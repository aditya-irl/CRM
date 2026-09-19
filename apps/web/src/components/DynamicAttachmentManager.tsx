import React, { useRef } from 'react';
import {
  Upload,
  Camera,
  Trash2,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Plus,
  Eye,
} from 'lucide-react';
import { compressImageFile } from '../utils/imageCompressor';

export interface AttachmentItem {
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

interface DynamicAttachmentManagerProps {
  attachments: AttachmentItem[];
  onChange: (attachments: AttachmentItem[]) => void;
  allowedCategories?: string[];
  type?: 'DOCUMENT' | 'PHOTO' | 'MIXED';
  title?: string;
  helperText?: string;
  readOnly?: boolean;
  onViewRemote?: (item: AttachmentItem) => void;
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

export const DynamicAttachmentManager: React.FC<DynamicAttachmentManagerProps> = ({
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

  const categories =
    allowedCategories ||
    (type === 'DOCUMENT'
      ? DEFAULT_DOC_CATEGORIES
      : type === 'PHOTO'
      ? DEFAULT_PHOTO_CATEGORIES
      : [...DEFAULT_DOC_CATEGORIES, ...DEFAULT_PHOTO_CATEGORIES]);

  const handleAddNewItem = (categoryHint?: string) => {
    const newItem: AttachmentItem = {
      id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

  const handleUpdateItem = (id: string, updates: Partial<AttachmentItem>) => {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Hidden file & camera inputs */}
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
          {title && <h4 style={{ fontSize: 13, fontWeight: 700 }}>{title}</h4>}
          {helperText && <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{helperText}</p>}
        </div>

        {!readOnly && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => handleAddNewItem(type === 'PHOTO' ? 'Customer Live Photo' : 'Aadhaar Front')}
              className="btn btn-secondary btn-sm"
            >
              <Plus size={13} />
              <span>{type === 'PHOTO' ? 'Add Photo' : type === 'DOCUMENT' ? 'Add Document' : 'Add Attachment'}</span>
            </button>
          </div>
        )}
      </div>

      {attachments.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            No attachments added yet. There is no limit on the number of photos or documents.
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => handleAddNewItem()}
              className="btn btn-primary btn-sm"
            >
              <Plus size={13} />
              <span>+ Add First {type === 'PHOTO' ? 'Photo' : 'Document'}</span>
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {attachments.map((item, index) => {
            const hasPreview = Boolean(item.previewUrl || item.remoteUrl);
            const isPdf = item.mimeType === 'application/pdf';

            return (
              <div
                key={item.id}
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {index + 1}
                    </span>

                    {!readOnly ? (
                      <select
                        className="form-select"
                        style={{ maxWidth: 220, fontSize: 12, padding: '4px 8px', height: 32 }}
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
                      <span className="badge badge-terracotta">{item.category}</span>
                    )}

                    {!readOnly && (
                      <input
                        type="text"
                        className="form-input"
                        style={{ flex: 1, fontSize: 12, padding: '4px 8px', height: 32 }}
                        placeholder="Optional Title / Identifier / Doc Number (e.g. Front View, 9876 5432)..."
                        value={item.title}
                        onChange={(e) => handleUpdateItem(item.id, { title: e.target.value })}
                      />
                    )}
                  </div>

                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      className="btn btn-secondary btn-sm"
                      style={{ color: 'var(--danger-text)', padding: '4px 8px', height: 32 }}
                      title="Remove attachment"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {/* Media Preview & Upload Controls */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {hasPreview ? (
                      <img
                        src={item.previewUrl || item.remoteUrl || ''}
                        alt={item.title || item.category}
                        style={{
                          width: 54,
                          height: 54,
                          borderRadius: 'var(--radius-sm)',
                          objectFit: 'cover',
                          border: '1px solid var(--border-subtle)',
                        }}
                      />
                    ) : isPdf ? (
                      <div
                        style={{
                          width: 54,
                          height: 54,
                          borderRadius: 'var(--radius-sm)',
                          background: '#ffffff',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <FileText size={24} color="var(--primary)" />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: 54,
                          height: 54,
                          borderRadius: 'var(--radius-sm)',
                          background: '#ffffff',
                          border: '1px dashed var(--border-strong)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <ImageIcon size={22} />
                      </div>
                    )}

                    <div style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>
                        {item.file?.name || item.title || item.category}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {item.fileSizeBytes > 0 ? `${(item.fileSizeBytes / 1024).toFixed(1)} KB` : 'No file chosen'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    {item.remoteUrl && onViewRemote && (
                      <button
                        type="button"
                        onClick={() => onViewRemote(item)}
                        className="btn btn-secondary btn-sm"
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
                          className="btn btn-secondary btn-sm"
                        >
                          <Upload size={12} />
                          <span>{hasPreview || isPdf ? 'Replace' : 'Browse File'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerUpload(item.id, true)}
                          className="btn btn-secondary btn-sm"
                        >
                          <Camera size={12} />
                          <span>Camera</span>
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
    </div>
  );
};
