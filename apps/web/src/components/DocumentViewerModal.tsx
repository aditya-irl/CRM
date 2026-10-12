import React, { useState, useEffect } from 'react';
import {
  FileText,
  Image as ImageIcon,
  ExternalLink,
  Download,
  X,
  RefreshCw,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import { ApiClient } from '../services/api';

export interface DocumentViewerModalProps {
  documentId?: string;
  initialUrl?: string;
  title: string;
  docType?: string;
  fileMimeType?: string;
  portalToken?: string;
  onClose: () => void;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  documentId,
  initialUrl,
  title,
  docType = 'KYC Document',
  fileMimeType,
  portalToken,
  onClose,
}) => {
  const [url, setUrl] = useState<string | null>(initialUrl || null);
  const [mimeType, setMimeType] = useState<string | undefined>(fileMimeType);
  const [loading, setLoading] = useState<boolean>(!initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchDocumentUrl = async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = portalToken
        ? await ApiClient.getCustomerPortalKYCDownloadUrl(documentId, portalToken)
        : await ApiClient.getKYCDownloadUrl(documentId);
      setUrl(res.downloadUrl);
      if (res.fileMimeType) {
        setMimeType(res.fileMimeType);
      }
    } catch (err: any) {
      console.error('Failed to load document preview:', err);
      const msg = err.message || 'Unable to retrieve document from secure storage.';
      setError(msg);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!initialUrl && documentId) {
      fetchDocumentUrl();
    }
  }, [documentId]);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchDocumentUrl();
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoom(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

  // Determine media category
  const urlLower = (url || '').toLowerCase();
  const mimeLower = (mimeType || '').toLowerCase();

  const isImage =
    mimeLower.startsWith('image/') ||
    urlLower.includes('.jpg') ||
    urlLower.includes('.jpeg') ||
    urlLower.includes('.png') ||
    urlLower.includes('.webp') ||
    urlLower.includes('.gif');

  const isPdf =
    mimeLower === 'application/pdf' ||
    urlLower.includes('.pdf') ||
    (!isImage && !mimeLower && urlLower.includes('pdf'));

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 3200, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          width: '92%',
          maxWidth: 960,
          height: '88vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          borderRadius: 'var(--radius-lg, 12px)',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Viewer Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-surface-secondary)',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md, 8px)',
                background: isImage ? '#eff6ff' : isPdf ? '#fef2f2' : '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isImage ? 'var(--primary)' : isPdf ? 'var(--danger, #ef4444)' : 'var(--text-secondary)',
              }}
            >
              {isImage ? <ImageIcon size={20} /> : <FileText size={20} />}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {title}
                </h3>
                <span className="badge badge-primary" style={{ fontSize: 10, padding: '2px 6px' }}>
                  {docType}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <ShieldCheck size={12} color="var(--success, #10b981)" />
                <span>Secure Storage Vault</span>
                <span>•</span>
                <Clock size={11} />
                <span>5-min presigned token</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isImage && url && !error && !loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '2px 4px', marginRight: 4 }}>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: 4, height: 26, minWidth: 26 }}
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
                <span style={{ fontSize: 11, padding: '0 4px', minWidth: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: 4, height: 26, minWidth: 26 }}
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleRotate}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: 4, height: 26, minWidth: 26 }}
                  title="Rotate 90deg"
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            )}

            {documentId && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="btn btn-secondary btn-sm"
                title="Refresh presigned URL"
              >
                <RefreshCw size={13} className={isRefreshing ? 'spin' : ''} />
                <span>{isRefreshing ? 'Refreshing...' : 'Refresh Link'}</span>
              </button>
            )}

            {url && !error && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
                title="Open in new browser tab"
              >
                <ExternalLink size={13} />
                <span>Open in Tab</span>
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 6,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Close viewer (Esc)"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Viewer Body */}
        <div
          style={{
            flex: 1,
            background: isImage ? '#0f172a' : '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            position: 'relative',
            padding: isImage ? 16 : 0,
          }}
        >
          {loading && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <RefreshCw size={32} className="spin" color="var(--primary)" style={{ marginBottom: 14 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>Loading secure document...</div>
              <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)' }}>
                Validating permissions and generating access token
              </div>
            </div>
          )}

          {error && !loading && (
            <div
              style={{
                maxWidth: 480,
                textAlign: 'center',
                padding: '24px 28px',
                background: '#ffffff',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md, 8px)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
              }}
            >
              <AlertCircle size={40} color="var(--danger, #ef4444)" style={{ marginBottom: 12 }} />
              <h4 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>
                Unable to Display Document
              </h4>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 16px 0' }}>
                {error}
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                {documentId && (
                  <button type="button" onClick={handleRefresh} className="btn btn-primary btn-sm">
                    <RefreshCw size={13} />
                    <span>Try Again</span>
                  </button>
                )}
                <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
                  <span>Close</span>
                </button>
              </div>
            </div>
          )}

          {!loading && !error && url && (
            <>
              {isImage ? (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'auto',
                  }}
                >
                  <img
                    src={url}
                    alt={title}
                    style={{
                      maxWidth: zoom <= 1 ? '100%' : 'none',
                      maxHeight: zoom <= 1 ? '100%' : 'none',
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transformOrigin: 'center center',
                      transition: 'transform 0.15s ease-out',
                      borderRadius: 4,
                      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                      objectFit: 'contain',
                    }}
                    onError={() => {
                      setError(
                        'Failed to render image from secure storage. The file may be missing from the vault or corrupted.'
                      );
                    }}
                  />
                </div>
              ) : isPdf ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <iframe
                    src={url}
                    title={title}
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                  <div
                    style={{
                      padding: '8px 16px',
                      background: '#ffffff',
                      borderTop: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span>
                      Viewing PDF document. If preview does not render, use <strong>Open in Tab</strong>.
                    </span>
                    <a
                      href={url}
                      download
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                    >
                      <Download size={12} />
                      <span>Download</span>
                    </a>
                  </div>
                </div>
              ) : (
                /* Fallback for other file formats */
                <div
                  style={{
                    textAlign: 'center',
                    padding: 32,
                    background: '#ffffff',
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <FileText size={48} color="var(--primary)" style={{ marginBottom: 12 }} />
                  <h4 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px 0' }}>{title}</h4>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
                    Type: {mimeType || 'Binary Document'}
                  </p>
                  <a href={url} download className="btn btn-primary btn-sm">
                    <Download size={14} />
                    <span>Download Document</span>
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
