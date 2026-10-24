import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Sparkles } from 'lucide-react';
import { isChunkLoadError, CHUNK_RELOAD_STORAGE_KEY } from '../utils/lazyWithRetry';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled CRM UI error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private handleGoDashboard = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (typeof window !== 'undefined') {
      window.location.hash = '#dashboard';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  };

  private handleUpdateAndReload = () => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
      } catch {
        // Ignore
      }
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      const isChunkError = isChunkLoadError(this.state.error);

      if (isChunkError) {
        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
              minHeight: 380,
              textAlign: 'center',
            }}
          >
            <div
              className="crm-card"
              style={{
                maxWidth: 540,
                width: '100%',
                padding: 28,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'var(--primary-bg, rgba(99, 102, 241, 0.12))',
                  color: 'var(--primary, #6366f1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <Sparkles size={26} />
              </div>

              <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
                Application Update Available
              </h3>

              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.5 }}>
                A newer version of the CRM has been deployed with updated workflow components. Please refresh to load the latest application bundle. Your session is active and secure.
              </p>

              {this.state.error && (
                <div
                  style={{
                    background: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    width: '100%',
                    textAlign: 'left',
                    marginBottom: 20,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: 'var(--text-muted)',
                    overflowX: 'auto',
                  }}
                >
                  <strong>Deployment notice:</strong> {this.state.error.message || 'Updated module bundle required'}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={this.handleUpdateAndReload}
                  className="btn btn-primary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={14} />
                  <span>Update &amp; Reload Application</span>
                </button>
                <button
                  type="button"
                  onClick={this.handleGoDashboard}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Home size={14} />
                  <span>Go to Dashboard</span>
                </button>
              </div>
            </div>
          </div>
        );
      }

      // Standard non-chunk component render exception
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            minHeight: 380,
            textAlign: 'center',
          }}
        >
          <div
            className="crm-card"
            style={{
              maxWidth: 540,
              width: '100%',
              padding: 28,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--danger-bg)',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <AlertTriangle size={24} />
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
              {this.props.fallbackTitle || 'Section Display Interrupted'}
            </h3>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              An unexpected error occurred while rendering this view. Your session and data are completely safe and have not been affected.
            </p>

            {this.state.error && (
              <div
                style={{
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 20,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'var(--danger-text)',
                  overflowX: 'auto',
                }}
              >
                <strong>Error:</strong> {this.state.error.message || 'Unknown render exception'}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={this.handleReset}
                className="btn btn-primary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <RefreshCw size={14} />
                <span>Reload This Section</span>
              </button>
              <button
                type="button"
                onClick={this.handleGoDashboard}
                className="btn btn-secondary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Home size={14} />
                <span>Go to Dashboard</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
