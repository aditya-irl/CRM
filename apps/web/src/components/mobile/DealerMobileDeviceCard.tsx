import React from 'react';
import { IDeviceItem, formatINR } from '@crm/shared';
import { Smartphone, ShieldCheck, Lock, Eye, CreditCard, User } from 'lucide-react';

export interface DealerMobileDeviceCardProps {
  device: IDeviceItem | any;
  onViewDetails: (device: any) => void;
}

export const DealerMobileDeviceCard: React.FC<DealerMobileDeviceCardProps> = ({
  device,
  onViewDetails,
}) => {
  const isLocked = device.deviceStatus === 'LOCKED';
  const isActive = device.deviceStatus === 'ACTIVE';

  // Securely mask IMEI (keep first 6 and last 4 digits)
  const rawImei = String(device.imei1 || device.imei || '');
  const maskedImei =
    rawImei.length >= 10
      ? `${rawImei.slice(0, 6)}******${rawImei.slice(-4)}`
      : rawImei || '—';

  return (
    <div
      className="crm-card dealer-device-card"
      data-testid={`dealer-device-card-${device.id}`}
      style={{
        padding: 14,
        marginBottom: 10,
        background: '#ffffff',
        border: isLocked ? '1.5px solid #fca5a5' : '1px solid #e2e8f0',
        borderRadius: 12,
        boxShadow: '0 2px 4px rgba(15, 23, 42, 0.05)',
      }}
    >
      {/* Top Header: Brand, Model, Status Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: isLocked ? '#fee2e2' : '#eff6ff',
              color: isLocked ? '#dc2626' : '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Smartphone size={20} />
          </div>
          <div>
            <h4
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: '#0f172a',
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              {device.deviceName || `${device.deviceBrand || device.brand || 'Device'} ${device.deviceModel || device.model || ''}`.trim()}
            </h4>
            <div className="mono" style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              IMEI: <span style={{ fontWeight: 600 }}>{maskedImei}</span>
            </div>
          </div>
        </div>

        {/* Device Status */}
        <div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 6,
              background: isLocked ? '#fee2e2' : isActive ? '#dcfce7' : '#f1f5f9',
              color: isLocked ? '#b91c1c' : isActive ? '#15803d' : '#475569',
              border: `1px solid ${isLocked ? '#fca5a5' : isActive ? '#bbf7d0' : '#cbd5e1'}`,
              textTransform: 'uppercase',
            }}
          >
            {isLocked ? <Lock size={10} /> : <ShieldCheck size={10} />}
            <span>{device.deviceStatus || 'ACTIVE'}</span>
          </span>
        </div>
      </div>

      {/* Customer & Loan Info */}
      <div
        style={{
          background: '#f8fafc',
          borderRadius: 8,
          padding: '8px 10px',
          marginTop: 10,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          fontSize: 12,
          border: '1px solid #e2e8f0',
        }}
      >
        <div>
          <span style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>
            Borrower
          </span>
          <div style={{ fontWeight: 700, color: '#0f172a', marginTop: 1 }}>
            {device.customerName || '—'}
          </div>
          {device.customerPhone && (
            <div className="mono" style={{ fontSize: 11, color: '#64748b' }}>
              {device.customerPhone}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'right' }}>
          <span style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>
            Loan Account
          </span>
          <div className="mono font-bold" style={{ color: '#2563eb', marginTop: 1 }}>
            {device.loanAccountNo || '—'}
          </div>
          {device.financedAmount && (
            <div style={{ fontSize: 11, color: '#0f172a', fontWeight: 700 }}>
              {formatINR(Number(device.financedAmount))}
            </div>
          )}
        </div>
      </div>

      {/* Actions (>= 48px touch targets) */}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          data-testid="dealer-device-details-btn"
          className="dealer-touch-btn-48"
          onClick={() => onViewDetails(device)}
          style={{
            width: '100%',
            height: 48,
            borderRadius: 8,
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            color: '#1e293b',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
        >
          <Eye size={16} />
          <span>Device Details & Security Audit</span>
        </button>
      </div>
    </div>
  );
};
