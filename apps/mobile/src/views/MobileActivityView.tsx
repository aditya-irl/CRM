import React, { useEffect, useState } from 'react';
import { MobileApi } from '../services/mobileApi';
import { IPayment, formatINR } from '@crm/shared';
import { Receipt, CheckCircle2, PhoneCall, Calendar } from 'lucide-react';

export const MobileActivityView: React.FC = () => {
  const [payments, setPayments] = useState<IPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPayments = async () => {
    setLoading(true);
    try {
      const data = await MobileApi.getPayments();
      setPayments(data);
    } catch (err) {
      console.error('Failed to load activity payments', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayments();
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayPayments = payments.filter((p) => {
    const isToday = (p.paymentTimestamp || (p as any).payment_timestamp || '').slice(0, 10) === todayStr;
    const isReversed = p.status === 'REVERSED' || Boolean((p as any).is_reversal);
    return isToday && !isReversed;
  });
  const todayTotal = todayPayments.reduce((acc, p) => acc + Number(p.amount || 0), 0);

  return (
    <div style={{ paddingBottom: 70, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          background: '#ffffff',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>Field Collection Activity</h2>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Recent transactions and field settlement records
        </div>
      </div>

      {/* Summary KPI Banner */}
      <div style={{ padding: '12px 16px 0 16px' }}>
        <div
          style={{
            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
            color: '#ffffff',
            padding: '14px 16px',
            borderRadius: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Today's Field Collections
            </div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: '#38bdf8', marginTop: 2 }}>
              {formatINR(todayTotal)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span
              style={{
                background: 'rgba(255, 255, 255, 0.12)',
                padding: '4px 10px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {todayPayments.length} receipts
            </span>
          </div>
        </div>
      </div>

      {/* Activity List */}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading activity logs...</div>
        ) : payments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <Receipt size={32} color="var(--primary)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 700 }}>No Collection Records</div>
            <div style={{ fontSize: 12, marginTop: 2 }}>Payments recorded on routes will appear here.</div>
          </div>
        ) : (
          payments.map((p) => (
            <div key={p.id} className="mobile-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{(p as any).customer_name || 'Borrower'}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.receiptNumber || (p as any).receipt_number} • {(p as any).loan_account_no}
                  </div>
                </div>
                <span className="mobile-badge badge-paid">PAID</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'var(--bg-surface-secondary)',
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>AMOUNT COLLECTED</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: 'var(--success-text)' }}>
                    {formatINR(p.amount)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11 }}>
                  <div>Mode: <strong>{p.paymentMode || (p as any).payment_mode}</strong></div>
                  <div className="mono" style={{ color: 'var(--text-muted)' }}>
                    {new Date(p.paymentTimestamp || (p as any).payment_timestamp).toLocaleTimeString('en-IN', { hour12: true })}
                  </div>
                </div>
              </div>

              {/* Collection Channel Tag */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                <span>Channel:</span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    background:
                      (p.collectionSource || (p as any).collection_source) === 'DEALER'
                        ? '#e0f2fe'
                        : (p.collectionSource || (p as any).collection_source) === 'RECOVERY_AGENT'
                        ? '#fef3c7'
                        : '#f1f5f9',
                    color:
                      (p.collectionSource || (p as any).collection_source) === 'DEALER'
                        ? '#0369a1'
                        : (p.collectionSource || (p as any).collection_source) === 'RECOVERY_AGENT'
                        ? '#92400e'
                        : '#475569',
                  }}
                >
                  {(p.collectionSource || (p as any).collection_source) === 'DEALER'
                    ? `Partner Store: ${p.dealerStoreName || (p as any).dealer_store_name || 'Dealer'}`
                    : (p.collectionSource || (p as any).collection_source) === 'RECOVERY_AGENT'
                    ? `Recovery Agent: ${p.agentName || (p as any).agent_name || 'Rahul Singh'}`
                    : 'Direct Customer'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
