import React, { useRef, useState } from 'react';
import { Camera, Upload, X, CheckCircle2, Image as ImageIcon, FileText } from 'lucide-react';

export type MediaCategory = 'CUSTOMER_PHOTO' | 'DOCUMENT_PHOTO' | 'PRODUCT_PHOTO' | 'INVOICE_PHOTO' | 'OTHER';

export interface MediaUploadResult {
  file: File | null;
  previewUrl: string | null;
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
}

interface MediaUploaderProps {
  label: string;
  category: MediaCategory;
  value?: string | null;
  onChange: (result: MediaUploadResult) => void;
  accept?: string;
  helperText?: string;
  required?: boolean;
}

export const MediaUploader: React.FC<MediaUploaderProps> = ({
  label,
  category,
  value,
  onChange,
  accept = 'image/jpeg,image/png,image/webp,application/pdf',
  helperText,
  required = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(value || null);
  const [fileName, setFileName] = useState<string>('');
  const [isPdf, setIsPdf] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdfFile = file.type === 'application/pdf';
    setIsPdf(isPdfFile);
    setFileName(file.name);

    if (isPdfFile) {
      setPreview(null);
      onChange({
        file,
        previewUrl: null,
        mimeType: file.type,
        fileName: file.name,
        fileSizeBytes: file.size,
      });
    } else {
      const reader = new FileReader();
      reader.onloadend = () => {
        const url = reader.result as string;
        setPreview(url);
        onChange({
          file,
          previewUrl: url,
          mimeType: file.type,
          fileName: file.name,
          fileSizeBytes: file.size,
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreview(null);
    setFileName('');
    setIsPdf(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    onChange({
      file: null,
      previewUrl: null,
      mimeType: '',
      fileName: '',
      fileSizeBytes: 0,
    });
  };

  const getCategoryBadge = () => {
    switch (category) {
      case 'CUSTOMER_PHOTO':
        return <span className="badge badge-terracotta">CUSTOMER PHOTO</span>;
      case 'DOCUMENT_PHOTO':
        return <span className="badge badge-upcoming">KYC DOCUMENT</span>;
      case 'PRODUCT_PHOTO':
        return <span className="badge badge-paid">PRODUCT / DEVICE</span>;
      case 'INVOICE_PHOTO':
        return <span className="badge badge-due-today">INVOICE PROOF</span>;
      default:
        return <span className="badge badge-upcoming">MEDIA</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
        </label>
        {getCategoryBadge()}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {preview || isPdf ? (
        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: 10,
            background: 'var(--bg-surface-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
            {preview ? (
              <img
                src={preview}
                alt="Upload preview"
                style={{ width: 48, height: 48, borderRadius: 'var(--radius-sm)', objectFit: 'cover', border: '1px solid var(--border-subtle)' }}
              />
            ) : (
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 'var(--radius-sm)',
                  background: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <FileText size={22} color="var(--primary)" />
              </div>
            )}
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {fileName || 'Document attached'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <CheckCircle2 size={12} />
                <span>Ready for upload</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary btn-sm"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className="btn btn-secondary btn-sm"
              style={{ color: 'var(--danger)' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 12px',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary btn-sm"
            >
              <Upload size={13} />
              <span>Choose File</span>
            </button>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="btn btn-secondary btn-sm"
            >
              <Camera size={13} />
              <span>Take Photo</span>
            </button>
          </div>
          {helperText && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{helperText}</span>
          )}
        </div>
      )}
    </div>
  );
};
