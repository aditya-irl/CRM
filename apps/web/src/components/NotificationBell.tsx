import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IUser, UserRole, INotification, NotificationType, NotificationStatus, formatDateDDMMYYYY } from '@crm/shared';
import { ApiClient } from '../services/api';
import { Bell, CheckCircle2, Store, AlertCircle, X, RefreshCw, CheckCheck } from 'lucide-react';

interface NotificationBellProps {
  user: IUser;
  onNavigate?: (tab: string, params?: { statusTab?: string; loanId?: string; dealerId?: string; search?: string }) => void;
}

export function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'Just now';

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;

    return formatDateDDMMYYYY(dateStr);
  } catch {
    return formatDateDDMMYYYY(dateStr);
  }
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ user, onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<INotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const isAdmin =
    user.role === UserRole.SUPER_ADMIN ||
    user.role === UserRole.ADMIN ||
    user.role === UserRole.BRANCH_MANAGER;

  // Filter notifications: non-admin roles must NEVER see dealer approval notifications
  const filterNotificationsForRole = useCallback(
    (items: INotification[]) => {
      if (isAdmin) return items;
      return items.filter(
        (n) =>
          n.type !== NotificationType.DEALER_APPROVAL_REQUIRED &&
          n.type !== NotificationType.LOAN_APPROVAL_REQUEST
      );
    },
    [isAdmin]
  );

  const fetchNotifications = useCallback(async () => {
    if (!isAdmin) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.getNotifications();
      const filtered = filterNotificationsForRole(res.notifications || []);
      setNotifications(filtered);
      // Compute unread count based on filtered list to ensure strict role-scoping
      const filteredUnread = filtered.filter((n) => n.status !== NotificationStatus.READ).length;
      setUnreadCount(filteredUnread);
    } catch (err: any) {
      console.error('Failed to load notifications', err);
      setError(err?.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, filterNotificationsForRole]);

  // Initial fetch on mount
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  // Non-admin roles (Dealer, Collection Agent) must never render admin dealer approval notifications
  if (!isAdmin) {
    return null;
  }

  const handleToggle = () => {
    if (!isOpen) {
      fetchNotifications();
    }
    setIsOpen((prev) => !prev);
  };

  const handleMarkAsRead = async (notification: INotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await ApiClient.markNotificationAsRead(notification.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, status: NotificationStatus.READ } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await ApiClient.markAllNotificationsAsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, status: NotificationStatus.READ }))
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read', err);
    }
  };

  const handleNotificationClick = async (notification: INotification) => {
    // 1. Mark as read immediately if not already read
    if (notification.status !== NotificationStatus.READ) {
      await handleMarkAsRead(notification);
    }

    // 2. Close dropdown
    setIsOpen(false);

    // 3. Navigate directly to relevant dealer approval / admin screen
    if (!onNavigate) return;

    const meta = (notification.metadata as Record<string, any>) || {};
    const isApproval =
      notification.type === NotificationType.DEALER_APPROVAL_REQUIRED ||
      notification.type === NotificationType.LOAN_APPROVAL_REQUEST;

    if (isApproval) {
      const loanId = meta.loanId || meta.requestId;
      const loanAccountNo = meta.loanAccountNo;
      const dealerId = meta.dealerId;

      if (loanId || loanAccountNo) {
        onNavigate('loans', {
          statusTab: 'PENDING_APPROVAL',
          loanId,
          search: loanAccountNo,
        });
      } else if (dealerId) {
        onNavigate('dealers', {
          dealerId,
          search: meta.dealerName || meta.dealerCode,
        });
      } else {
        onNavigate('loans', {
          statusTab: 'PENDING_APPROVAL',
        });
      }
    } else {
      onNavigate('dashboard');
    }
  };

  // Render text for DEALER_APPROVAL_REQUIRED
  const getNotificationContent = (item: INotification) => {
    const isDealerApproval =
      item.type === NotificationType.DEALER_APPROVAL_REQUIRED ||
      item.type === NotificationType.LOAN_APPROVAL_REQUEST;

    if (isDealerApproval) {
      const meta = (item.metadata as Record<string, any>) || {};
      const dealerName =
        meta.dealerName ||
        meta.storeName ||
        (item.body?.match(/Dealer "([^"]+)"/)?.[1]) ||
        'Partner Store';

      return {
        title: 'Dealer Approval Required',
        message: `Dealer ${dealerName} has submitted a request for approval.`,
        isApproval: true,
      };
    }

    return {
      title: item.title,
      message: item.body,
      isApproval: false,
    };
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Bell Trigger Button */}
      <button
        onClick={handleToggle}
        data-testid="notification-bell-btn"
        className="btn btn-secondary btn-sm"
        title="Admin Notifications"
        aria-label={`Notifications (${unreadCount} unread)`}
        style={{
          position: 'relative',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-md, 8px)',
        }}
      >
        <Bell size={15} color="var(--text-secondary)" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: 'var(--primary, #b8532f)',
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 800,
              minWidth: 17,
              height: 17,
              borderRadius: 'var(--radius-full, 9999px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid #ffffff',
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          data-testid="notification-dropdown"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 380,
            maxWidth: 'calc(100vw - 32px)',
            background: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border-subtle, #e2ddd5)',
            borderRadius: 'var(--radius-lg, 12px)',
            boxShadow: 'var(--shadow-modal, 0 12px 32px -4px rgba(0, 0, 0, 0.16))',
            zIndex: 1000,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle, #e2ddd5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-surface, #ffffff)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                Notifications
              </span>
              {unreadCount > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: 'var(--primary-subtle, #faede8)',
                    color: 'var(--primary, #b8532f)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full, 9999px)',
                    border: '1px solid var(--primary-border, #eed8ce)',
                  }}
                >
                  {unreadCount} unread
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                  }}
                >
                  All caught up
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  data-testid="mark-all-read-btn"
                  className="btn btn-secondary btn-xs"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  title="Mark all as read"
                >
                  <CheckCheck size={12} />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="btn btn-secondary btn-xs"
                style={{ padding: '2px 6px' }}
                title="Close"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List Area */}
          <div
            style={{
              maxHeight: 380,
              overflowY: 'auto',
              background: 'var(--bg-surface, #ffffff)',
            }}
          >
            {loading && notifications.length === 0 ? (
              <div
                data-testid="notifications-loading"
                style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                {[1, 2, 3].map((i) => (
                  <div key={i} style={{ height: 56 }} className="skeleton" />
                ))}
              </div>
            ) : error ? (
              <div
                data-testid="notifications-error"
                style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <AlertCircle size={20} color="var(--danger, #b91c1c)" />
                <span style={{ fontSize: 12, color: 'var(--danger-text, #991b1b)' }}>{error}</span>
                <button onClick={fetchNotifications} className="btn btn-secondary btn-xs">
                  <RefreshCw size={11} />
                  <span>Retry</span>
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div
                data-testid="notifications-empty"
                style={{
                  padding: '40px 16px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  color: 'var(--text-muted)',
                }}
              >
                <CheckCircle2 size={28} color="var(--success, #2e7d32)" />
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  No notifications
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  You are completely caught up. New dealer requests will appear here.
                </div>
              </div>
            ) : (
              notifications.map((item) => {
                const isUnread = item.status !== NotificationStatus.READ;
                const content = getNotificationContent(item);

                return (
                  <div
                    key={item.id}
                    data-testid={`notification-item-${item.id}`}
                    onClick={() => handleNotificationClick(item)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--border-subtle, #e2ddd5)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      cursor: 'pointer',
                      background: isUnread
                        ? 'rgba(184, 83, 47, 0.04)'
                        : 'var(--bg-surface, #ffffff)',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = isUnread
                        ? 'rgba(184, 83, 47, 0.08)'
                        : 'var(--bg-surface-secondary, #f0ece3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isUnread
                        ? 'rgba(184, 83, 47, 0.04)'
                        : 'var(--bg-surface, #ffffff)';
                    }}
                  >
                    {/* Icon */}
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 'var(--radius-md, 8px)',
                        background: content.isApproval
                          ? 'var(--primary-subtle, #faede8)'
                          : 'var(--bg-surface-secondary, #f0ece3)',
                        color: content.isApproval
                          ? 'var(--primary, #b8532f)'
                          : 'var(--text-secondary)',
                        border: content.isApproval
                          ? '1px solid var(--primary-border, #eed8ce)'
                          : '1px solid var(--border-subtle, #e2ddd5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {content.isApproval ? <Store size={15} /> : <Bell size={15} />}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: isUnread ? 800 : 600,
                            color: 'var(--text-primary)',
                          }}
                        >
                          {content.title}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>

                      <p
                        style={{
                          fontSize: 12,
                          color: isUnread ? 'var(--text-primary)' : 'var(--text-secondary)',
                          marginTop: 3,
                          lineHeight: 1.4,
                          wordBreak: 'break-word',
                        }}
                      >
                        {content.message}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {isUnread && (
                      <div
                        data-testid="unread-dot"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: 'var(--primary, #b8532f)',
                          marginTop: 6,
                          flexShrink: 0,
                        }}
                        title="Unread notification"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
