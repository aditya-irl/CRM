import React from 'react';
import { X, Filter, Check } from 'lucide-react';

export interface AgentMobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  statusFilter: string;
  onSelectStatus: (status: string) => void;
  routeFilter?: string;
  onChangeRoute?: (route: string) => void;
  statusOptions: { id: string; label: string; count?: number }[];
  title?: string;
}

export const AgentMobileFilterSheet: React.FC<AgentMobileFilterSheetProps> = ({
  isOpen,
  onClose,
  statusFilter,
  onSelectStatus,
  routeFilter = '',
  onChangeRoute,
  statusOptions,
  title = 'Filter Collection Queue',
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1150,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="crm-card"
        style={{
          width: '100%',
          maxWidth: '500px',
          margin: '0 auto',
          background: '#ffffff',
          borderRadius: '16px 16px 0 0',
          padding: '16px 20px',
          paddingBottom: 'calc(20px + var(--sab, 0px))',
          boxShadow: '0 -10px 25px rgba(0,0,0,0.15)',
          animation: 'slideUpSheet 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Drag Handle */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: '#cbd5e1',
            margin: '0 auto 12px',
          }}
        />

        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={18} color="#2563eb" />
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: '#0f172a' }}>
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close filters"
            style={{
              height: 36,
              width: 36,
              borderRadius: 8,
              background: '#f1f5f9',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Route / Area input if supported */}
        {onChangeRoute && (
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 700,
                color: '#475569',
                marginBottom: 6,
                textTransform: 'uppercase',
              }}
            >
              Filter by Area / Route
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Pari Chowk, Sector 18..."
              value={routeFilter}
              onChange={(e) => onChangeRoute(e.target.value)}
              style={{
                height: 44,
                fontSize: 14,
                padding: '0 12px',
                borderRadius: 8,
              }}
            />
          </div>
        )}

        {/* Status Option Chips (Min 48px Touch Targets) */}
        <div style={{ marginBottom: 18 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 700,
              color: '#475569',
              marginBottom: 8,
              textTransform: 'uppercase',
            }}
          >
            Obligation & Due Status
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {statusOptions.map((opt) => {
              const isSelected = statusFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onSelectStatus(opt.id);
                    onClose();
                  }}
                  style={{
                    height: 48,
                    borderRadius: 10,
                    border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: isSelected ? '#eff6ff' : '#f8fafc',
                    color: isSelected ? '#1e40af' : '#1e293b',
                    fontWeight: isSelected ? 800 : 600,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 16px',
                    cursor: 'pointer',
                    touchAction: 'manipulation',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{opt.label}</span>
                    {opt.count !== undefined && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 10,
                          background: isSelected ? '#bfdbfe' : '#e2e8f0',
                          color: isSelected ? '#1e3a8a' : '#475569',
                        }}
                      >
                        {opt.count}
                      </span>
                    )}
                  </div>
                  {isSelected && <Check size={18} color="#2563eb" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dismiss Button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            height: 48,
            borderRadius: 8,
            background: '#0f172a',
            color: '#ffffff',
            border: 'none',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
        >
          Apply & View Results
        </button>
      </div>
    </div>
  );
};

