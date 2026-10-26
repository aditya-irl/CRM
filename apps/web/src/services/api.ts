import {
  IUser,
  ICustomer,
  ILoan,
  IDealer,
  DealerStatus,
  IPayment,
  IAgentQueueItem,
  IDashboardStats,
  IAuditLog,
  IAuditLogDetail,
  ApiResponse,
  IDealerCollectionSummary,
  IDealerCollectionLedgerResponse,
  IDealerSettlementsSummary,
  IDealerSettlementsLedgerResponse,
  IDealerSettlement,
  IDealerUnsettledCollection,
  IDealerSettlementCollectionItem,
  IDealerSettlementCollectionsResponse,
  IDealerPayableSummary,
  IDealerPayableEligibleLoan,
  IDealerPayablePayment,
  IDealerPayablesLedgerResponse,
  IAgentCollectionSummary,
  IAgentCollectionLedgerResponse,
  IDirectCollectionSummary,
  IDirectCollectionLedgerResponse,
  IDirectCollectionDetail,
  IFinanceDashboardStats,
  IFinanceReportResponse,
  IDealerDashboardMetrics,
  IDealerLoginAccountResponse,
  INotification,
  ICustomerPortalProfile,
  ICustomerCorrectionRequest,
  ICustomerVerification,
  CustomerVerificationStatus,
  VerificationSection,
  IContactActivity,
  IContactActivitySummary,
  IAgentPerformanceMetrics,
  IAdminContactActivitySummary,
} from '@crm/shared';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { NativeTokenStorage } from '../mobile/secureStorage';

export const DEFAULT_PRODUCTION_API_BASE = 'https://crm-api-a3fd.onrender.com/api/v1';

export function isValidTrustedApiBase(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  const trimmed = rawUrl.trim();
  // Allow relative paths (e.g. '/api/v1')
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase();
    // 1. Localhost and loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return true;
    }
    // 2. Same origin
    if (typeof window !== 'undefined' && window.location && parsed.origin === window.location.origin) {
      return true;
    }
    // 3. Official cloud CRM backend infrastructures (Render and Vercel domains)
    if (parsed.protocol === 'https:' && (hostname.endsWith('.onrender.com') || hostname.endsWith('.vercel.app'))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function buildApiUrl(endpoint: string = ''): string {
  let base = (import.meta as any).env?.VITE_API_BASE_URL;
  if (!base || base === 'undefined' || base === 'null' || typeof base !== 'string') {
    const runtimeOverride = typeof window !== 'undefined' ? (window as any).__CRM_API_BASE_URL__ : undefined;
    if (runtimeOverride && isValidTrustedApiBase(runtimeOverride)) {
      base = runtimeOverride;
    } else if (Capacitor.isNativePlatform()) {
      // In native Android / iOS WebView (capacitor:// or https://localhost),
      // relative paths (/api/v1) cannot resolve to a local server.
      // Route directly to the secure HTTPS production backend.
      base = DEFAULT_PRODUCTION_API_BASE;
    } else {
      base = '/api/v1';
    }
  }
  // Trim spaces and trailing slashes
  base = base.trim().replace(/\/+$/, '');
  const trimmedEndpoint = (endpoint || '').trim();
  const cleanEndpoint = trimmedEndpoint
    ? trimmedEndpoint.startsWith('/')
      ? trimmedEndpoint
      : `/${trimmedEndpoint}`
    : '';
  // Avoid duplicated slashes while preserving protocol (http:// or https://)
  return `${base}${cleanEndpoint}`.replace(/([^:]\/)\/+/g, '$1');
}

const API_BASE = buildApiUrl('');

export interface ICustomerPortalLoanData {
  customerName: string;
  maskedPhone: string;
  customerPhone?: string;
  loanAccountNo: string;
  financedAmount?: number;
  emiAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  pendingInstallments: number;
  overdueInstallments?: number;
  nextDueDate: string | null;
  outstandingBalance: number;
  totalPaid: number;
  totalPenaltyAmount?: number;
  status: string;
  disbursementDate: string;
  maturityDate: string;
  paymentHistory: Array<{
    receiptNumber: string;
    amount: number;
    paymentDate: string;
    paymentMode: string;
    status: string;
  }>;
  installments: Array<{
    installmentNumber: number;
    dueDate: string;
    expectedAmount: number;
    paidAmount: number;
    remainingAmount: number;
    penaltyAmount: number;
    totalDue?: number;
    daysOverdue?: number;
    status: string;
  }>;
}

export interface ICashfreeOrderData {
  orderId: string;
  paymentSessionId: string;
  orderAmount: number;
  orderCurrency: string;
  installmentNumber: number;
  dueDate: string;
  loanAccountNo: string;
  environment: 'sandbox' | 'production';
}

export interface ICashfreeVerifyData {
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'USER_DROPPED' | 'CANCELLED';
  orderId: string;
  installmentNumber?: number;
  orderAmount: number;
  receiptNumber?: string;
  paymentId?: string;
  message?: string;
}


export interface IPortalLinkStatus {
  loanId: string;
  loanAccountNo: string;
  hasActiveLink: boolean;
  isActive: boolean;
  createdAt: string | null;
  lastAccessedAt: string | null;
  revokedAt: string | null;
  portalUrl?: string | null;
}

export interface IPortalLinkResult {
  token: string;
  portalUrl: string;
  loanId: string;
  customerId: string;
  loanAccountNo: string;
  createdAt: string;
  isActive: boolean;
}

export interface IAssignLoanAgentResult {
  loanId: string;
  loanAccountNo: string;
  assignedAgentId: string;
  assignedAgentName: string;
  assignedAgentPhone?: string | null;
  assignmentId: string;
  isReassignment: boolean;
  assignedAt: string;
}

export interface IUnassignLoanAgentResult {
  loanId: string;
  loanAccountNo: string;
  previousAgentId?: string | null;
  previousAgentName?: string | null;
  unassignedAt: string;
}

export class PortalApiError extends Error {
  public statusCode: number;
  public code: string;
  public retryAfter?: number;

  constructor(message: string, statusCode: number, code: string = 'PORTAL_ERROR', retryAfter?: number) {
    super(message);
    this.name = 'PortalApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, PortalApiError.prototype);
  }
}

export function parsePortalResponseError(res: Response, json: any, fallbackMessage: string): PortalApiError {
  const is429 = res.status === 429;
  const retryAfterHeader = res.headers.get('Retry-After');
  const retryAfter = json?.error?.retryAfter || (retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined);
  const code = json?.error?.code || (is429 ? 'TOO_MANY_REQUESTS' : 'API_ERROR');
  const message =
    json?.error?.message ||
    (is429
      ? 'Too many portal access attempts. Please wait a moment before trying again.'
      : fallbackMessage);
  return new PortalApiError(message, res.status, code, retryAfter);
}

export class ApiClient {
  private static refreshPromise: Promise<string> | null = null;
  private static restoreSessionPromise: Promise<boolean> | null = null;
  private static isSessionRestored = false;

  private static getSessionStorage(): Storage | null {
    try {
      if (typeof sessionStorage !== 'undefined') return sessionStorage;
      if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
    } catch {}
    return null;
  }

  private static getLocalStorage(): Storage | null {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch {}
    return null;
  }

  public static async restoreNativeSession(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    if (this.restoreSessionPromise) {
      return this.restoreSessionPromise;
    }

    this.restoreSessionPromise = (async () => {
      try {
        const token = await NativeTokenStorage.getItem('crm_access_token');
        const refreshToken = await NativeTokenStorage.getItem('crm_refresh_token');
        const userRaw = await NativeTokenStorage.getItem('crm_user');

        if (token && userRaw) {
          const session = this.getSessionStorage();
          if (session) {
            session.setItem('crm_access_token', token);
            if (refreshToken) session.setItem('crm_refresh_token', refreshToken);
            session.setItem('crm_user', userRaw);
            this.isSessionRestored = true;
            return true;
          }
        }
      } catch (e: any) {
        console.warn('[ApiClient] Failed to restore native session from secure storage:', e);
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(
            new CustomEvent('crm_secure_storage_error', {
              detail: {
                operation: 'restore',
                message: 'Hardware secure storage is currently inaccessible. Please log in again.',
              },
            })
          );
        }
      } finally {
        this.isSessionRestored = true;
      }
      return false;
    })();

    return this.restoreSessionPromise;
  }

  public static getToken(): string | null {
    const session = this.getSessionStorage();
    return session?.getItem('crm_access_token') || null;
  }

  public static getRefreshToken(): string | null {
    const session = this.getSessionStorage();
    return session?.getItem('crm_refresh_token') || null;
  }

  public static setAuth(user: IUser, token: string, refreshToken?: string) {
    const session = this.getSessionStorage();

    // 1. Write to tab-scoped sessionStorage (authoritative and private to this tab)
    if (session) {
      session.setItem('crm_access_token', token);
      if (refreshToken) {
        session.setItem('crm_refresh_token', refreshToken);
      }
      session.setItem('crm_user', JSON.stringify(user));
    }

    // 2. Eradicate any legacy tokens in localStorage to prevent origin-wide leakage
    const local = this.getLocalStorage();
    if (local && local !== session) {
      local.removeItem('crm_access_token');
      local.removeItem('crm_refresh_token');
      local.removeItem('crm_user');
    }

    // 3. In native mobile (Capacitor), persist credentials to hardware-encrypted secure storage
    if (Capacitor.isNativePlatform()) {
      const writes: Promise<any>[] = [
        NativeTokenStorage.setItem('crm_access_token', token),
        NativeTokenStorage.setItem('crm_user', JSON.stringify(user)),
      ];
      if (refreshToken) {
        writes.push(NativeTokenStorage.setItem('crm_refresh_token', refreshToken));
      } else {
        writes.push(NativeTokenStorage.removeItem('crm_refresh_token'));
      }

      Promise.all(writes).catch((err) => {
        console.error('[ApiClient] Hardware secure storage write failed:', err);
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(
            new CustomEvent('crm_secure_storage_error', {
              detail: {
                operation: 'save',
                message:
                  'Hardware secure storage write failed. Your session is active for this launch, but ensure screen lock / passcode is enabled on this device.',
              },
            })
          );
        }
      });
    }
  }

  public static getUser(): IUser | null {
    const session = this.getSessionStorage();
    const raw = session?.getItem('crm_user') || null;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public static logout() {
    this.restoreSessionPromise = null;
    this.isSessionRestored = false;
    const session = this.getSessionStorage();

    if (session) {
      session.removeItem('crm_access_token');
      session.removeItem('crm_refresh_token');
      session.removeItem('crm_user');
    }

    // Clean up any legacy localStorage entries
    const local = this.getLocalStorage();
    if (local && local !== session) {
      local.removeItem('crm_access_token');
      local.removeItem('crm_refresh_token');
      local.removeItem('crm_user');
    }

    // In native mobile, clear persisted tokens from secure storage
    if (Capacitor.isNativePlatform()) {
      NativeTokenStorage.removeItem('crm_access_token').catch(() => {});
      NativeTokenStorage.removeItem('crm_refresh_token').catch(() => {});
      NativeTokenStorage.removeItem('crm_user').catch(() => {});
    }
  }

  /**
   * Concurrency-safe token refresh. Deduplicates concurrent 401 refresh calls.
   */
  public static async executeRefresh(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const currentRefreshToken = this.getRefreshToken();
    if (!currentRefreshToken) {
      this.logout();
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event('crm_auth_expired'));
      }
      throw new Error('Session expired. Please log in again.');
    }

    this.refreshPromise = (async () => {
      try {
        const url = buildApiUrl('/auth/refresh');
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refreshToken: currentRefreshToken }),
        });

        let json: any;
        try {
          json = await res.json();
        } catch {
          throw new Error('Failed to parse refresh response');
        }

        if (!res.ok || !json.success || !json.data?.accessToken) {
          throw new Error(json?.error?.message || 'Refresh token rejected');
        }

        const newAccessToken: string = json.data.accessToken;
        const newRefreshToken: string | undefined = json.data.refreshToken;

        const session = this.getSessionStorage();
        const local = this.getLocalStorage();

        if (session) {
          session.setItem('crm_access_token', newAccessToken);
          if (newRefreshToken) {
            session.setItem('crm_refresh_token', newRefreshToken);
          }
        }

        if (Capacitor.isNativePlatform()) {
          NativeTokenStorage.setItem('crm_access_token', newAccessToken).catch(() => {});
          if (newRefreshToken) {
            NativeTokenStorage.setItem('crm_refresh_token', newRefreshToken).catch(() => {});
          }
        }
        return newAccessToken;
      } catch (err) {
        this.logout();
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new Event('crm_auth_expired'));
        }
        throw new Error('Session expired. Please log in again.');
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Public Customer Payment Portal request.
   * Completely bypasses admin JWT, localStorage, and session management.
   */
  public static async getCustomerPortalLoan(token: string): Promise<ICustomerPortalLoanData> {
    const url = buildApiUrl(`/portal/loan?token=${encodeURIComponent(token)}&_t=${Date.now()}`);
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(
        `Unable to reach the customer portal server (HTTP ${res.status}). Please check your connection and try again.`
      );
    }

    if (!res.ok || !json.success) {
      throw parsePortalResponseError(res, json, 'Invalid or expired portal link');
    }

    return json.data as ICustomerPortalLoanData;
  }

  /**
   * Public Customer Portal - list borrower's own KYC documents.
   */
  public static async getCustomerPortalKYCDocuments(token: string): Promise<Array<{
    id: string;
    docType: string;
    docNumberMasked?: string;
    status: string;
    fileMimeType: string;
    fileSizeBytes: number;
    createdAt: string;
    verifiedAt?: string;
  }>> {
    const url = buildApiUrl(`/portal/kyc?token=${encodeURIComponent(token)}`);
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Unable to reach the customer portal server (HTTP ${res.status}).`);
    }

    if (!res.ok || !json.success) {
      throw parsePortalResponseError(res, json, 'Failed to load KYC documents');
    }

    return json.data || [];
  }

  /**
   * Public Customer Portal - get short-lived presigned download URL for borrower's own KYC document.
   */
  public static async getCustomerPortalKYCDownloadUrl(docId: string, token: string) {
    const url = buildApiUrl(`/portal/kyc/${encodeURIComponent(docId)}/presigned-download?token=${encodeURIComponent(token)}`);
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Unable to retrieve document preview (HTTP ${res.status}).`);
    }

    if (!res.ok || !json.success) {
      throw new Error(json.error?.message || 'Failed to generate document preview link');
    }

    let downloadUrl = json.data.downloadUrl;
    if (downloadUrl && !downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
      downloadUrl = buildApiUrl(downloadUrl.replace(/^\/api\/v1/, ''));
    }

    return { ...json.data, downloadUrl };
  }

  // Admin Customer Portal Link Management
  public static async getPortalLinkStatus(loanId: string): Promise<IPortalLinkStatus> {
    return this.request<IPortalLinkStatus>(`/portal/loans/${loanId}/link`);
  }

  public static async generatePortalLink(loanId: string): Promise<IPortalLinkResult> {
    return this.request<IPortalLinkResult>(`/portal/loans/${loanId}/link`, {
      method: 'POST',
    });
  }

  public static async regeneratePortalLink(loanId: string): Promise<IPortalLinkResult> {
    return this.request<IPortalLinkResult>(`/portal/loans/${loanId}/regenerate`, {
      method: 'POST',
    });
  }

  public static async revokePortalLink(loanId: string): Promise<{ success: boolean; revokedCount: number }> {
    return this.request<{ success: boolean; revokedCount: number }>(`/portal/loans/${loanId}/revoke`, {
      method: 'POST',
    });
  }

  /**
   * Public Customer Portal - fetch borrower profile and KYC verification info.
   */
  public static async getCustomerPortalProfile(token: string): Promise<ICustomerPortalProfile> {
    const url = buildApiUrl(`/portal/profile?token=${encodeURIComponent(token)}`);
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Unable to reach the customer portal server (HTTP ${res.status}).`);
    }

    if (!res.ok || !json.success) {
      throw parsePortalResponseError(res, json, 'Failed to load profile details');
    }

    return json.data as ICustomerPortalProfile;
  }

  /**
   * Public Customer Portal - borrower confirms that displayed details are correct.
   */
  public static async confirmCustomerPortalProfile(
    token: string,
    section: VerificationSection = VerificationSection.ALL
  ): Promise<{ success: boolean; status: CustomerVerificationStatus; confirmedAt: string; message: string }> {
    const url = buildApiUrl(`/portal/verify/confirm?token=${encodeURIComponent(token)}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ section }),
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Unable to submit confirmation (HTTP ${res.status}).`);
    }

    if (!res.ok || !json.success) {
      throw parsePortalResponseError(res, json, 'Failed to submit verification confirmation');
    }

    return json.data;
  }

  /**
   * Public Customer Portal - borrower reports an issue / requests correction.
   */
  public static async reportCustomerPortalIssue(
    token: string,
    section: VerificationSection,
    explanation: string
  ): Promise<{ success: boolean; requestId: string; status: CustomerVerificationStatus; message: string }> {
    const url = buildApiUrl(`/portal/verify/report-issue?token=${encodeURIComponent(token)}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ section, explanation }),
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Unable to submit issue report (HTTP ${res.status}).`);
    }

    if (!res.ok || !json.success) {
      throw parsePortalResponseError(res, json, 'Failed to submit issue report');
    }

    return json.data;
  }

  /**
   * Public Customer Portal - create Cashfree payment order for outstanding EMI.
   */
  public static async createCustomerPortalPaymentOrder(
    token: string,
    installmentNumber?: number
  ): Promise<ICashfreeOrderData> {
    const url = buildApiUrl(`/portal/payment/orders?token=${encodeURIComponent(token)}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        installmentNumber,
      }),
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Unable to reach the customer payment server (HTTP ${res.status}).`);
    }

    if (!res.ok || !json.success) {
      throw parsePortalResponseError(res, json, 'Failed to initiate payment checkout order');
    }

    return json.data as ICashfreeOrderData;
  }

  /**
   * Public Customer Portal - verify Cashfree payment order status.
   */
  public static async verifyCustomerPortalPaymentOrder(
    token: string,
    orderId: string
  ): Promise<ICashfreeVerifyData> {
    const url = buildApiUrl(`/portal/payment/orders/${encodeURIComponent(orderId)}/verify?token=${encodeURIComponent(token)}`);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Unable to verify payment status (HTTP ${res.status}).`);
    }

    if (!res.ok || !json.success) {
      throw parsePortalResponseError(res, json, 'Failed to verify payment order');
    }

    return json.data as ICashfreeVerifyData;
  }

  // Staff Review Methods (Protected by Admin JWT)
  public static async getPortalVerificationRequests(params?: {
    status?: string;
    section?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    requests: ICustomerCorrectionRequest[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.section) query.set('section', params.section);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/portal/verification-requests${qs}`);
  }

  public static async getCustomerVerifications(customerId: string): Promise<{
    customer: { id: string; customerCode: string; fullName: string };
    verification: ICustomerVerification;
    requests: ICustomerCorrectionRequest[];
  }> {
    return this.request(`/portal/customers/${customerId}/verifications`);
  }

  public static async reviewCustomerCorrectionRequest(
    requestId: string,
    status: 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED',
    resolutionNotes?: string
  ): Promise<{ success: boolean; requestId: string; status: string; customerVerificationStatus: string; message: string }> {
    return this.request(`/portal/verification-requests/${requestId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolutionNotes }),
    });
  }

  private static async request<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
    // In native mobile, await session restoration if a request fires during early app initialization
    if (Capacitor.isNativePlatform() && !this.isSessionRestored && this.restoreSessionPromise) {
      await this.restoreSessionPromise;
    }

    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    // Public /auth/login endpoint should never transmit stale/invalid Bearer tokens
    if (token && !endpoint.includes('/auth/login')) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = buildApiUrl(endpoint);
    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers,
      });
    } catch (networkErr: any) {
      const msg = (networkErr?.message || '').toLowerCase();
      if (msg.includes('failed to fetch') || msg.includes('load failed') || msg.includes('networkerror')) {
        throw new Error(
          'Unable to reach the CRM server. Please check your internet connection. If the backend is waking from a cold start, please retry in a few moments.'
        );
      }
      throw networkErr;
    }

    let json: ApiResponse<T> | undefined;
    try {
      json = await res.json();
    } catch {
      // The API server is unreachable (proxy/gateway error with non-JSON body).
      // In Safari/WebKit, res.json() on an empty body throws:
      //   "The string did not match the expected pattern."
      // In Chrome it throws: "Unexpected end of JSON input"
      // Provide a clear, actionable message instead.
      if (res.status === 401) {
        if (endpoint.includes('/auth/login')) {
          throw new Error('Invalid credentials');
        }
        if (endpoint.includes('/auth/refresh')) {
          this.logout();
          throw new Error('Session expired. Please log in again.');
        }
        if (endpoint.includes('/auth/change-password')) {
          throw new Error('Current password is incorrect');
        }

        // Automatic retry with refresh for authenticated protected endpoints
        if (!isRetry && this.getRefreshToken()) {
          try {
            await this.executeRefresh();
            return this.request<T>(endpoint, options, true);
          } catch {
            throw new Error('Session expired. Please log in again.');
          }
        }

        this.logout();
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new Event('crm_auth_expired'));
        }
        throw new Error('Session expired. Please log in again.');
      }

      if (res.status === 405) {
        const error = new Error(
          'API request rejected with HTTP 405 Method Not Allowed. The frontend is requesting its own static host instead of the backend API server. Please ensure VITE_API_BASE_URL is configured for this environment.'
        );
        (error as any).statusCode = 405;
        throw error;
      }

      throw new Error(
        `Unable to reach the API server (HTTP ${res.status}). Please ensure the backend is running and try again.`
      );
    }

    if (res.status === 401) {
      if (endpoint.includes('/auth/login')) {
        const errorMsg = json?.error?.message || 'Invalid credentials';
        throw new Error(errorMsg);
      }
      if (endpoint.includes('/auth/change-password')) {
        const errorMsg = json?.error?.message || 'Current password is incorrect';
        throw new Error(errorMsg);
      }
      if (endpoint.includes('/auth/refresh')) {
        this.logout();
        const errorMsg = json?.error?.message || 'Session expired. Please log in again.';
        throw new Error(errorMsg);
      }

      // Automatic retry with refresh for authenticated protected endpoints
      if (!isRetry && this.getRefreshToken()) {
        try {
          await this.executeRefresh();
          return this.request<T>(endpoint, options, true);
        } catch {
          throw new Error('Session expired. Please log in again.');
        }
      }

      this.logout();
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event('crm_auth_expired'));
      }
      throw new Error('Session expired. Please log in again.');
    }

    if (res.status === 405) {
      const error = new Error(
        'API request rejected with HTTP 405 Method Not Allowed. The frontend is requesting its own static host instead of the backend API server. Please ensure VITE_API_BASE_URL is configured for this environment.'
      );
      (error as any).statusCode = 405;
      throw error;
    }

    if (res.status === 413) {
      throw new Error(
        'The uploaded photo or request payload is too large. Please select a smaller or compressed image (max 10MB).'
      );
    }

    if (!res.ok || !json.success) {
      const detailsMsg = Array.isArray(json?.error?.details) && json.error.details.length > 0
        ? json.error.details.map((d: any) => (d.field ? `${d.field}: ${d.issue || d.message}` : (d.issue || d.message))).join(', ')
        : '';
      const baseMsg = json?.error?.message || 'An error occurred during API request';
      const fullMsg = detailsMsg && !baseMsg.includes(detailsMsg)
        ? `${baseMsg} (${detailsMsg})`
        : baseMsg;
      const error = new Error(fullMsg);
      (error as any).details = json?.error?.details;
      (error as any).code = json?.error?.code;
      (error as any).statusCode = res.status;
      throw error;
    }

    return json.data as T;
  }

  public static updateUser(updates: Partial<IUser>): IUser | null {
    const current = this.getUser();
    if (!current) return null;
    const updated = { ...current, ...updates };
    const session = this.getSessionStorage();
    if (session) {
      session.setItem('crm_user', JSON.stringify(updated));
    }
    return updated;
  }

  // Auth
  public static async login(email: string, pass: string) {
    const cleanIdentifier = (email || '').trim();
    // Clear any stale local auth state before initiating a new login request
    this.logout();
    const res = await this.request<{ user: IUser; tokens: { accessToken: string; refreshToken?: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: cleanIdentifier, identifier: cleanIdentifier, password: pass }),
    });
    this.setAuth(res.user, res.tokens.accessToken, res.tokens.refreshToken);
    return res.user;
  }

  public static async changePassword(currentPassword: string, newPassword: string) {
    const res = await this.request<{ success: boolean; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    this.updateUser({ mustChangePassword: false });
    return res;
  }

  // Dashboard & Reports
  public static async getDashboardStats() {
    return this.request<IDashboardStats>('/reports/dashboard-stats');
  }

  public static async getDailyCollections(date?: string, agentId?: string, mode?: string, route?: string) {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (agentId) params.append('agentId', agentId);
    if (mode) params.append('mode', mode);
    if (route) params.append('route', route);
    return this.request<{ totalCount: number; totalCollected: number; modeBreakdown: any; records: IPayment[] }>(`/reports/daily-collections?${params.toString()}`);
  }

  public static async getOverduePar(bucket?: string, route?: string, agentId?: string) {
    const params = new URLSearchParams();
    if (bucket) params.append('bucket', bucket);
    if (route) params.append('route', route);
    if (agentId) params.append('agentId', agentId);
    return this.request<{ summary: any; records: any[]; total: number }>(`/reports/overdue-par?${params.toString()}`);
  }

  public static async getAgentPerformance() {
    return this.request<any[]>('/reports/agent-performance');
  }

  public static async downloadExport(type: 'daily-collections' | 'overdue-par' | 'agent-performance' | 'customers', queryParams: Record<string, string> = {}) {
    const token = this.getToken();
    const params = new URLSearchParams({ type, ...queryParams });
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/reports/export?${params.toString()}`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: 'Export failed' } }));
      throw new Error(err.error?.message || 'Failed to export CSV');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // Customers
  public static async getCustomers(search?: string, route?: string, page = 1, limit = 50) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (route) params.append('route', route);
    params.append('page', String(page));
    params.append('limit', String(limit));
    const res = await this.request<any>(`/customers?${params.toString()}`);
    return Array.isArray(res) ? res : res?.customers || [];
  }

  public static async getCustomerDetail(id: string) {
    return this.request<{ customer: ICustomer; loans: ILoan[]; kycDocuments: any[]; callLogs: any[] }>(`/customers/${id}`);
  }

  public static async createCustomer(data: any) {
    return this.request<ICustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async onboardCustomer(data: {
    customer: any;
    loan?: any;
    idempotencyKey?: string | null;
  }): Promise<{ customer: ICustomer; loan: ILoan | null }> {
    const headers: Record<string, string> = {};
    if (data.idempotencyKey) {
      headers['Idempotency-Key'] = data.idempotencyKey;
    }
    return this.request<{ customer: ICustomer; loan: ILoan | null }>('/customers/onboard', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
  }

  public static async updateCustomer(id: string, data: any) {
    return this.request<ICustomer>(`/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  /**
   * Upload customer photo directly to the authenticated photo endpoint.
   * Normalizes MIME types (e.g. image/jpg -> image/jpeg) and handles mobile camera captures.
   */
  public static async uploadCustomerPhoto(customerId: string, file: File): Promise<{
    photoUrl: string;
    customer: ICustomer;
  }> {
    let mimeType = file.type || 'image/jpeg';
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

    let fileName = file.name || 'customer-photo.jpg';
    if (!fileName.includes('.')) {
      fileName = `${fileName}.jpg`;
    }

    const fileBase64 = await this.fileToBase64(file);
    const res = await this.request<{
      success: boolean;
      data: {
        photoUrl: string;
        customer: ICustomer;
      };
    }>(`/customers/${customerId}/photo`, {
      method: 'POST',
      body: JSON.stringify({
        fileName,
        mimeType,
        fileBase64,
      }),
    });
    return res.data;
  }

  /**
   * Get an authorized display URL for a customer photo.
   * If the photoUrl is an internal API endpoint (e.g. /api/v1/customers/:id/photo),
   * this builds the full API URL and appends the current auth token for secure <img> rendering.
   */
  public static getAuthorizedPhotoUrl(photoUrl?: string | null): string {
    if (!photoUrl) return '';
    if (photoUrl.startsWith('/api/v1/') || photoUrl.startsWith('/')) {
      const cleanPath = photoUrl.replace(/^\/api\/v1/, '');
      const fullUrl = buildApiUrl(cleanPath);
      if (cleanPath.startsWith('/customers/') && !cleanPath.includes('token=')) {
        const token = this.getToken();
        if (token) {
          const sep = fullUrl.includes('?') ? '&' : '?';
          return `${fullUrl}${sep}token=${encodeURIComponent(token)}`;
        }
      }
      return fullUrl;
    }
    if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
      if (photoUrl.includes('/customers/') && photoUrl.includes('/photo') && !photoUrl.includes('token=')) {
        const token = this.getToken();
        if (token) {
          const sep = photoUrl.includes('?') ? '&' : '?';
          return `${photoUrl}${sep}token=${encodeURIComponent(token)}`;
        }
      }
      return photoUrl;
    }
    return photoUrl;
  }


  // Loans
  public static async calculateLoanPreview(data: any) {
    return this.request<any>('/loans/calculate-preview', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async createLoan(data: any) {
    return this.request<ILoan>('/loans', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async submitLoanForApproval(id: string, notes?: string) {
    return this.request<any>(`/loans/${id}/submit-approval`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  }

  public static async approveLoan(id: string, notes?: string) {
    return this.request<any>(`/loans/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  }

  public static async disburseLoan(id: string) {
    return this.request<any>(`/loans/${id}/disburse`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  public static async rejectLoan(id: string, reason: string) {
    return this.request<any>(`/loans/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public static async getLoans(search?: string, status?: string, page = 1, limit = 50) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status) params.append('status', status);
    params.append('page', String(page));
    params.append('limit', String(limit));
    const res = await this.request<any>(`/loans?${params.toString()}`);
    return Array.isArray(res) ? res : res?.loans || [];
  }

  public static async getPendingApprovals() {
    return this.request<any[]>('/loans/pending-approvals');
  }

  public static async getLoanDetail(id: string) {
    return this.request<{ loan: ILoan; installments: any[]; payments: any[] }>(`/loans/${id}`);
  }

  public static async getLoanById(id: string) {
    return this.getLoanDetail(id);
  }

  public static async listLoans(filters?: any, page = 1, limit = 50) {
    if (typeof filters === 'string') {
      return this.getLoans(filters, undefined, page, limit);
    }
    const search = filters?.search;
    const status = filters?.status;
    return this.getLoans(search, status, page, limit);
  }

  // Financed Devices
  public static async getFinancedDevices(filters: any = {}) {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.search) params.append('search', filters.search);
    if (filters.dealerId) params.append('dealerId', filters.dealerId);
    if (filters.financingSource && filters.financingSource !== 'ALL') params.append('financingSource', filters.financingSource);
    if (filters.deviceStatus && filters.deviceStatus !== 'ALL') params.append('deviceStatus', filters.deviceStatus);
    return this.request<{ data: any[]; meta: any }>(`/loans/devices?${params.toString()}`);
  }

  // Agent Queue
  public static async getAgentQueue(status?: string, route?: string, search?: string) {
    const params = new URLSearchParams();
    if (status && status !== 'ALL') params.append('status', status.trim());
    if (route && route.trim()) params.append('route', route.trim());
    if (search && search.trim()) params.append('search', search.trim());
    const queryString = params.toString();
    const endpoint = queryString ? `/emi/queue?${queryString}` : '/emi/queue';
    const res = await this.request<any>(endpoint);
    return Array.isArray(res) ? res : res?.items || [];
  }

  public static async getAgentStats() {
    return this.request<{ todayTarget: number; todayCollected: number; todayPending: number; collectionEfficiency: number; dueTodayCount: number; overdueCount: number }>('/emi/stats');
  }

  // Payments
  public static async getPaymentPreview(params: {
    loanId: string;
    installmentId?: string;
    amount?: number | string;
    penaltyAmount?: number | string;
  }) {
    const qs = new URLSearchParams();
    qs.append('loanId', params.loanId);
    if (params.installmentId) qs.append('installmentId', params.installmentId);
    if (params.amount !== undefined && params.amount !== null && String(params.amount).trim() !== '') {
      qs.append('amount', String(params.amount).trim());
    }
    if (params.penaltyAmount !== undefined && params.penaltyAmount !== null && String(params.penaltyAmount).trim() !== '') {
      qs.append('penaltyAmount', String(params.penaltyAmount).trim());
    }
    return this.request<any>(`/payments/preview?${qs.toString()}`);
  }

  public static async recordPayment(data: any) {
    return this.request<any>('/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async getReceipt(id: string) {
    return this.request<any>(`/payments/receipt/${id}`);
  }

  public static async getPaymentDetail(id: string) {
    return this.request<any>(`/payments/${id}`);
  }

  public static async getPaymentsSummary(filters: any = {}) {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.collectionSource && filters.collectionSource !== 'ALL') params.append('collectionSource', filters.collectionSource);
    if (filters.status && filters.status !== 'ALL') params.append('status', filters.status);
    if (filters.paymentMode && filters.paymentMode !== 'ALL') params.append('paymentMode', filters.paymentMode);
    if (filters.search) params.append('search', filters.search);
    return this.request<any>(`/payments/summary?${params.toString()}`);
  }

  public static async reversePayment(id: string, reason: string) {
    return this.request<any>(`/payments/${id}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ paymentId: id, reason }),
    });
  }

  public static async approvePayment(id: string) {
    return this.request<any>(`/payments/${id}/approve`, {
      method: 'POST',
    });
  }

  public static async rejectPayment(id: string, reason: string) {
    return this.request<any>(`/payments/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public static async listPayments(
    filterOrSearch?: string | {
      search?: string;
      page?: number;
      limit?: number;
      customerId?: string;
      loanId?: string;
      collectionSource?: string;
      status?: string;
      paymentMode?: string;
      startDate?: string;
      endDate?: string;
    },
    page = 1,
    limit = 50,
    customerId?: string,
    loanId?: string
  ) {
    const params = new URLSearchParams();
    if (typeof filterOrSearch === 'object' && filterOrSearch !== null) {
      if (filterOrSearch.search) params.append('search', filterOrSearch.search);
      if (filterOrSearch.customerId) params.append('customerId', filterOrSearch.customerId);
      if (filterOrSearch.loanId) params.append('loanId', filterOrSearch.loanId);
      if (filterOrSearch.collectionSource && filterOrSearch.collectionSource !== 'ALL') {
        params.append('collectionSource', filterOrSearch.collectionSource);
      }
      if (filterOrSearch.status && filterOrSearch.status !== 'ALL') {
        params.append('status', filterOrSearch.status);
      }
      if (filterOrSearch.paymentMode && filterOrSearch.paymentMode !== 'ALL') {
        params.append('paymentMode', filterOrSearch.paymentMode);
      }
      if (filterOrSearch.startDate) params.append('startDate', filterOrSearch.startDate);
      if (filterOrSearch.endDate) params.append('endDate', filterOrSearch.endDate);
      params.append('page', String(filterOrSearch.page || 1));
      params.append('limit', String(filterOrSearch.limit || 50));
    } else {
      if (typeof filterOrSearch === 'string' && filterOrSearch) params.append('search', filterOrSearch);
      if (customerId) params.append('customerId', customerId);
      if (loanId) params.append('loanId', loanId);
      params.append('page', String(page));
      params.append('limit', String(limit));
    }
    const res = await this.request<any>(`/payments?${params.toString()}`);
    return Array.isArray(res) ? res : res?.payments || [];
  }

  public static async getPaymentsLedger(filters: any = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.customerId) params.append('customerId', filters.customerId);
    if (filters.loanId) params.append('loanId', filters.loanId);
    if (filters.collectionSource && filters.collectionSource !== 'ALL') {
      params.append('collectionSource', filters.collectionSource);
    }
    if (filters.status && filters.status !== 'ALL') {
      params.append('status', filters.status);
    }
    if (filters.paymentMode && filters.paymentMode !== 'ALL') {
      params.append('paymentMode', filters.paymentMode);
    }
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    params.append('page', String(filters.page || 1));
    params.append('limit', String(filters.limit || 25));

    return this.request<any>(`/payments?${params.toString()}`);
  }

  // Call Logs
  public static async logCall(data: any) {
    return this.request<any>('/call-logs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async getCustomerCallLogs(customerId: string) {
    return this.request<any[]>(`/call-logs/customer/${customerId}`);
  }

  // KYC
  public static async getKYCDownloadUrl(docId: string) {
    const res = await this.request<{
      documentId: string;
      customerId: string;
      docType: string;
      docNumberMasked?: string;
      downloadUrl: string;
      fileMimeType?: string;
      expiresInSeconds?: number;
    }>(`/kyc/${docId}/presigned-download`);

    let url = res.downloadUrl;
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = buildApiUrl(url.replace(/^\/api\/v1/, ''));
    }
    return { ...res, downloadUrl: url };
  }

  public static async getKYCViewToken(docId: string) {
    return this.request<{
      token: string;
      expiresIn: number;
      viewUrl: string;
    }>(`/kyc/${docId}/view-token`);
  }

  public static async getKYCDocuments(customerId: string) {
    return this.request<any[]>(`/kyc/customer/${customerId}`);
  }

  public static async initKYCUpload(data: { customerId: string; docType: string; fileName: string; mimeType: string; fileSizeBytes: number }) {
    return this.request<{ uploadUrl: string; storageKey: string; fileMimeType: string; fileSizeBytes: number; expiresSizeBytes?: number }>('/kyc/presigned-upload', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async confirmKYC(data: { customerId: string; docType: string; docNumber?: string | null; storageKey: string; fileMimeType: string; fileSizeBytes: number }) {
    return this.request<any>('/kyc/confirm', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Complete 3-stage KYC document upload:
   * 1. Request presigned upload URL from API.
   * 2. PUT file binary data to storage (S3 presigned PUT or local API receiver).
   * 3. Confirm document metadata with backend.
   */
  private static fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Direct server-side KYC upload (bypasses browser CORS issues with private S3/B2 buckets).
   */
  public static async directUploadKYCDocument(data: {
    customerId: string;
    docType: string;
    file: File;
    docNumber?: string | null;
  }) {
    const fileBase64 = await this.fileToBase64(data.file);
    const mimeType = data.file.type || 'application/octet-stream';
    const res = await this.request<{
      success: boolean;
      data: any;
    }>('/kyc/direct-upload', {
      method: 'POST',
      body: JSON.stringify({
        customerId: data.customerId,
        docType: data.docType,
        docNumber: data.docNumber || null,
        fileName: data.file.name,
        mimeType,
        fileBase64,
      }),
    });
    return res.data;
  }

  public static async uploadKYCDocument(data: {
    customerId: string;
    docType: string;
    file: File;
    docNumber?: string | null;
  }) {
    const mimeType = data.file.type || 'application/octet-stream';

    // 1. Attempt presigned PUT upload
    let initRes: any = null;
    try {
      initRes = await this.initKYCUpload({
        customerId: data.customerId,
        docType: data.docType,
        fileName: data.file.name,
        mimeType,
        fileSizeBytes: data.file.size,
      });
    } catch (initErr) {
      console.warn('[KYC Upload] Presigned initialization failed, falling back to direct server upload:', initErr);
      return this.directUploadKYCDocument(data);
    }

    let uploadUrl = initRes.uploadUrl;
    if (uploadUrl.startsWith('/')) {
      uploadUrl = buildApiUrl(uploadUrl.replace(/^\/api\/v1/, ''));
    }

    let putSucceeded = false;
    try {
      const headers: Record<string, string> = {
        'Content-Type': mimeType,
      };
      if (uploadUrl.includes('/api/v1/')) {
        const token = this.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: data.file,
      });

      if (uploadRes.ok) {
        putSucceeded = true;
      } else {
        console.warn(`[KYC Upload] Presigned PUT returned HTTP ${uploadRes.status}, falling back to direct server upload.`);
      }
    } catch (putErr) {
      console.warn('[KYC Upload] Browser presigned PUT failed (CORS/network), falling back to direct server upload:', putErr);
    }

    if (putSucceeded) {
      try {
        return await this.confirmKYC({
          customerId: data.customerId,
          docType: data.docType,
          docNumber: data.docNumber || null,
          storageKey: initRes.storageKey,
          fileMimeType: mimeType,
          fileSizeBytes: data.file.size,
        });
      } catch (confirmErr) {
        console.warn('[KYC Upload] Confirmation failed, falling back to direct server upload:', confirmErr);
      }
    }

    // 2. Direct server upload fallback (ensures file is safely stored in S3/B2)
    return this.directUploadKYCDocument(data);
  }

  public static async deleteKYCDocument(docId: string) {
    return this.request<{ success: boolean; message: string }>(`/kyc/${docId}`, {
      method: 'DELETE',
    });
  }

  // Audit Logs
  public static async getAuditLogs(entity?: string) {
    const params = new URLSearchParams();
    if (entity) params.append('entity', entity);
    const res = await this.request<any>(`/audit-logs?${params.toString()}`);
    return Array.isArray(res) ? res : res?.logs || [];
  }

  public static async getAuditLogById(id: string): Promise<IAuditLogDetail> {
    return this.request<IAuditLogDetail>(`/audit-logs/${encodeURIComponent(id)}`);
  }

  // Dealers / Mobile Stores
  public static async getDealers(search?: string, status?: string, area?: string, page = 1, limit = 50) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status) params.append('status', status);
    if (area) params.append('area', area);
    params.append('page', String(page));
    params.append('limit', String(limit));
    const res = await this.request<any>(`/dealers?${params.toString()}`);
    return Array.isArray(res) ? res : res?.dealers || [];
  }

  public static async getDealerDetail(id: string) {
    return this.request<{ dealer: IDealer; loans: any[] }>(`/dealers/${id}`);
  }

  public static async createDealer(data: any) {
    return this.request<IDealer>('/dealers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async updateDealer(id: string, data: any) {
    return this.request<IDealer>(`/dealers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public static async updateDealerStatus(id: string, status: DealerStatus) {
    return this.request<{ id: string; status: DealerStatus }>(`/dealers/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  public static async createDealerLogin(dealerId: string) {
    return this.request<IDealerLoginAccountResponse>(`/dealers/${dealerId}/login-account`, {
      method: 'POST',
    });
  }

  public static async resetDealerPassword(dealerId: string) {
    return this.request<IDealerLoginAccountResponse>(`/dealers/${dealerId}/reset-password`, {
      method: 'POST',
    });
  }

  public static async updateDealerLoginStatus(dealerId: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.request<{ dealerId: string; status: string }>(`/dealers/${dealerId}/login-status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  public static async getDealerDashboard(dealerId?: string) {
    const query = dealerId ? `?dealerId=${encodeURIComponent(dealerId)}` : '';
    return this.request<IDealerDashboardMetrics>(`/dealers/dashboard${query}`);
  }

  public static async getDealerMe() {
    return this.request<{ dealer: IDealer; loans: any[] }>('/dealers/me');
  }

  public static async deleteDealer(id: string) {
    return this.request<{ success: boolean; message: string }>(`/dealers/${id}`, {
      method: 'DELETE',
    });
  }

  // Users / Agents Management
  public static async getUsers(role?: string, status?: string) {
    const params = new URLSearchParams();
    if (role) params.append('role', role);
    if (status) params.append('status', status);
    const res = await this.request<any>(`/users?${params.toString()}`);
    return Array.isArray(res) ? res : res?.users || [];
  }

  public static async getAgents(status?: string, search?: string) {
    const params = new URLSearchParams({ role: 'COLLECTION_AGENT' });
    if (status) params.append('status', status);
    if (search) params.append('search', search);
    const res = await this.request<any>(`/users?${params.toString()}`);
    return Array.isArray(res) ? res : res?.users || [];
  }

  public static async createAgent(data: {
    fullName: string;
    phone: string;
    loginId?: string | null;
    status?: string;
    assignedBranch?: string | null;
    areaRoute?: string | null;
  }) {
    return this.request<{
      agentId: string;
      loginId: string;
      temporaryPassword: string;
      mustChangePassword: boolean;
      user: any;
    }>('/users/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async assignLoanAgent(loanId: string, agentId: string, notes?: string) {
    return this.request<IAssignLoanAgentResult>(`/loans/${loanId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agentId, notes }),
    });
  }

  public static async unassignLoanAgent(loanId: string, reason?: string) {
    return this.request<IUnassignLoanAgentResult>(`/loans/${loanId}/unassign`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public static async getLoanAssignmentHistory(loanId: string) {
    return this.request<any[]>(`/loans/${loanId}/assignments`);
  }

  public static async resetAgentPassword(agentId: string) {
    return this.request<{
      agentId: string;
      loginId: string;
      temporaryPassword: string;
      mustChangePassword: boolean;
      user: any;
    }>(`/users/agents/${agentId}/reset-password`, {
      method: 'POST',
    });
  }

  public static async updateAgentStatus(agentId: string, status: string) {
    return this.request<{ id: string; status: string }>(`/users/agents/${agentId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  public static async deleteAgent(agentId: string, reassignToAgentId?: string) {
    return this.request<{ success: boolean; message: string; reassignedCount?: number; unassignedCount?: number }>(
      `/users/agents/${agentId}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ reassignToAgentId }),
      }
    );
  }

  public static async getAgentDashboard() {
    return this.request<any>('/emi/agent-dashboard');
  }

  // Dealer Collections Ledger
  public static async getDealerCollections(paramsQuery: {
    dealerId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.dealerId) params.append('dealerId', paramsQuery.dealerId);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    if (paramsQuery.search) params.append('search', paramsQuery.search);
    if (paramsQuery.page) params.append('page', String(paramsQuery.page));
    if (paramsQuery.limit) params.append('limit', String(paramsQuery.limit));
    return this.request<IDealerCollectionLedgerResponse>(`/dealer-collections?${params.toString()}`);
  }

  public static async getDealerCollectionsSummary(paramsQuery: {
    dealerId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.dealerId) params.append('dealerId', paramsQuery.dealerId);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    return this.request<IDealerCollectionSummary>(`/dealer-collections/summary?${params.toString()}`);
  }

  public static async getSingleDealerCollections(dealerId: string) {
    return this.request<any>(`/dealer-collections/dealers/${dealerId}`);
  }

  // Dealer Settlement & Reconciliation
  public static async getDealerSettlements(paramsQuery: {
    dealerId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.dealerId) params.append('dealerId', paramsQuery.dealerId);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    if (paramsQuery.status) params.append('status', paramsQuery.status);
    if (paramsQuery.search) params.append('search', paramsQuery.search);
    if (paramsQuery.page) params.append('page', String(paramsQuery.page));
    if (paramsQuery.limit) params.append('limit', String(paramsQuery.limit));
    return this.request<IDealerSettlementsLedgerResponse>(`/dealer-settlements?${params.toString()}`);
  }

  public static async getDealerSettlementsSummary(paramsQuery: {
    dealerId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.dealerId) params.append('dealerId', paramsQuery.dealerId);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    return this.request<IDealerSettlementsSummary>(`/dealer-settlements/summary?${params.toString()}`);
  }

  public static async getUnsettledCollectionsForDealer(dealerId: string) {
    return this.request<IDealerUnsettledCollection[]>(`/dealer-settlements/dealers/${dealerId}/unsettled-collections`);
  }

  public static async getDealerSettlementDetail(id: string) {
    return this.request<IDealerSettlement>(`/dealer-settlements/${id}`);
  }

  public static async createDealerSettlement(data: {
    dealerId: string;
    amount: number;
    settlementDate: string;
    paymentMethod: string;
    referenceNumber?: string | null;
    notes?: string | null;
    allocations?: Array<{ paymentId: string; amountAllocated: number }>;
  }) {
    return this.request<IDealerSettlement>('/dealer-settlements', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async requestDealerSettlement(data: {
    dealerId: string;
    amount: number;
    settlementDate: string;
    paymentMethod: string;
    referenceNumber?: string | null;
    notes?: string | null;
  }) {
    return this.request<IDealerSettlement>('/dealer-settlements/request', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async approveDealerSettlement(id: string) {
    return this.request<IDealerSettlement>(`/dealer-settlements/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  public static async rejectDealerSettlement(id: string, reason: string) {
    return this.request<IDealerSettlement>(`/dealer-settlements/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public static async reverseDealerSettlement(id: string, reason: string) {
    return this.request<IDealerSettlement>(`/dealer-settlements/${id}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public static async getDealerSettlementCollections(paramsQuery: {
    dealerId?: string;
    branchId?: string;
    approvalStatus?: string;
    settlementStatus?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.dealerId) params.append('dealerId', paramsQuery.dealerId);
    if (paramsQuery.branchId) params.append('branchId', paramsQuery.branchId);
    if (paramsQuery.approvalStatus) params.append('approvalStatus', paramsQuery.approvalStatus);
    if (paramsQuery.settlementStatus) params.append('settlementStatus', paramsQuery.settlementStatus);
    if (paramsQuery.search) params.append('search', paramsQuery.search);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    if (paramsQuery.page) params.append('page', paramsQuery.page.toString());
    if (paramsQuery.limit) params.append('limit', paramsQuery.limit.toString());
    return this.request<IDealerSettlementCollectionsResponse>(`/dealer-settlements/collections?${params.toString()}`);
  }

  // Dealer Payables (Company pays Dealer for financed products)
  public static async getDealerPayablesSummary(paramsQuery: {
    dealerId?: string;
    branchId?: string;
  } = {}) {
    const params = new URLSearchParams();
    if (paramsQuery.dealerId) params.append('dealerId', paramsQuery.dealerId);
    if (paramsQuery.branchId) params.append('branchId', paramsQuery.branchId);
    return this.request<IDealerPayableSummary>(`/dealer-payables/summary?${params.toString()}`);
  }

  public static async getEligibleLoansForDealerPayable(dealerId: string) {
    return this.request<IDealerPayableEligibleLoan[]>(`/dealer-payables/dealers/${dealerId}/eligible-loans`);
  }

  public static async getDealerPayablePayments(paramsQuery: {
    dealerId?: string;
    branchId?: string;
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (paramsQuery.dealerId) params.append('dealerId', paramsQuery.dealerId);
    if (paramsQuery.branchId) params.append('branchId', paramsQuery.branchId);
    if (paramsQuery.status) params.append('status', paramsQuery.status);
    if (paramsQuery.search) params.append('search', paramsQuery.search);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    if (paramsQuery.page) params.append('page', paramsQuery.page.toString());
    if (paramsQuery.limit) params.append('limit', paramsQuery.limit.toString());
    return this.request<IDealerPayablesLedgerResponse>(`/dealer-payables?${params.toString()}`);
  }

  public static async recordDealerPayablePayment(data: {
    dealerId: string;
    amount: number;
    paymentDate: string;
    paymentMethod: string;
    referenceNumber?: string | null;
    notes?: string | null;
    allocations?: Array<{ loanId: string; amountAllocated: number }>;
  }) {
    return this.request<IDealerPayablePayment>('/dealer-payables', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async reverseDealerPayablePayment(id: string, reason: string) {
    return this.request<IDealerPayablePayment>(`/dealer-payables/${id}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public static async getDealerPayablePaymentDetail(id: string) {
    return this.request<IDealerPayablePayment & { allocations: any[] }>(`/dealer-payables/${id}`);
  }

  // Trigger automated jobs
  public static async triggerBackgroundJobs() {
    return this.request<any>('/system/trigger-jobs', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  // Recovery Agent Collections Ledger
  public static async getAgentCollections(paramsQuery: {
    agentId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.agentId) params.append('agentId', paramsQuery.agentId);
    if (paramsQuery.status) params.append('status', paramsQuery.status);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    if (paramsQuery.search) params.append('search', paramsQuery.search);
    if (paramsQuery.page) params.append('page', String(paramsQuery.page));
    if (paramsQuery.limit) params.append('limit', String(paramsQuery.limit));
    return this.request<IAgentCollectionLedgerResponse>(`/agent-collections?${params.toString()}`);
  }

  public static async getAgentCollectionsSummary(paramsQuery: {
    agentId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.agentId) params.append('agentId', paramsQuery.agentId);
    if (paramsQuery.status) params.append('status', paramsQuery.status);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    return this.request<IAgentCollectionSummary>(`/agent-collections/summary?${params.toString()}`);
  }

  public static async getSingleAgentCollections(agentId: string) {
    return this.request<any>(`/agent-collections/agents/${agentId}`);
  }

  // Direct Customer Collections Ledger
  public static async getDirectCollections(paramsQuery: {
    startDate?: string;
    endDate?: string;
    paymentMode?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    if (paramsQuery.paymentMode) params.append('paymentMode', paramsQuery.paymentMode);
    if (paramsQuery.status) params.append('status', paramsQuery.status);
    if (paramsQuery.search) params.append('search', paramsQuery.search);
    if (paramsQuery.page) params.append('page', String(paramsQuery.page));
    if (paramsQuery.limit) params.append('limit', String(paramsQuery.limit));
    return this.request<IDirectCollectionLedgerResponse>(`/direct-collections?${params.toString()}`);
  }

  public static async getDirectCollectionsSummary(paramsQuery: {
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    return this.request<IDirectCollectionSummary>(`/direct-collections/summary?${params.toString()}`);
  }

  public static async getDirectPaymentDetail(id: string) {
    return this.request<IDirectCollectionDetail>(`/direct-collections/${id}`);
  }

  // Finance Dashboard & Reports (Task 8)
  public static async getFinanceDashboard(paramsQuery: {
    preset?: string;
    startDate?: string;
    endDate?: string;
  } = {}) {
    const params = new URLSearchParams();
    if (paramsQuery.preset) params.append('preset', paramsQuery.preset);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    return this.request<IFinanceDashboardStats>(`/reports/finance-dashboard?${params.toString()}`);
  }

  public static async getCustomReport(paramsQuery: {
    category?: string;
    reportType?: string;
    startDate?: string;
    endDate?: string;
    dealerId?: string;
    agentId?: string;
    collectionSource?: string;
    paymentMode?: string;
    paymentStatus?: string;
    loanStatus?: string;
    bucket?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    Object.entries(paramsQuery).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '' && val !== 'ALL') {
        params.append(key, String(val));
      }
    });
    return this.request<IFinanceReportResponse>(`/reports/custom?${params.toString()}`);
  }

  public static async getDealerFinancingAnalytics(paramsQuery: {
    dealerId?: string;
    preset?: string;
    startDate?: string;
    endDate?: string;
  } = {}) {
    const params = new URLSearchParams();
    if (paramsQuery.dealerId) params.append('dealerId', paramsQuery.dealerId);
    if (paramsQuery.preset) params.append('preset', paramsQuery.preset);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    return this.request<any>(`/reports/dealer-financing-analytics?${params.toString()}`);
  }

  public static async downloadFinanceReportCsv(type: string, paramsQuery: Record<string, string> = {}) {
    const cleanParams: Record<string, string> = { type };
    Object.entries(paramsQuery).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '' && val !== 'ALL') {
        cleanParams[key] = String(val);
      }
    });
    const params = new URLSearchParams(cleanParams);
    const token = this.getToken();
    const res = await fetch(`${API_BASE}/reports/export?${params.toString()}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: 'Export failed' } }));
      throw new Error(err.error?.message || 'Failed to export CSV');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_export.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  public static async exportReportToGoogleSheets(
    typeOrCategory: string,
    paramsQuery: Record<string, string> = {}
  ): Promise<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    sheetTitle: string;
    updatedRows: number;
    updatedColumns: number;
    exportedAt: string;
  }> {
    const filters: Record<string, string> = {};
    Object.entries(paramsQuery).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '' && val !== 'ALL') {
        filters[key] = String(val);
      }
    });

    return this.request<{
      spreadsheetId: string;
      spreadsheetUrl: string;
      sheetTitle: string;
      updatedRows: number;
      updatedColumns: number;
      exportedAt: string;
    }>('/reports/export/google-sheets', {
      method: 'POST',
      body: JSON.stringify({
        type: typeOrCategory,
        ...filters,
      }),
    });
  }

  // ─── Settings Endpoints ──────────────────────────────────────────
  public static async getDealerPenaltySetting(): Promise<{ allowDealerPenalty: boolean }> {
    return this.request<{ allowDealerPenalty: boolean }>('/settings/dealer-penalty');
  }

  public static async updateDealerPenaltySetting(
    allowDealerPenalty: boolean
  ): Promise<{ allowDealerPenalty: boolean }> {
    return this.request<{ allowDealerPenalty: boolean }>('/settings/dealer-penalty', {
      method: 'PATCH',
      body: JSON.stringify({ allowDealerPenalty }),
    });
  }

  // ─── EMI Penalty Endpoints ───────────────────────────────────────
  public static async addEmiPenalty(
    emiId: string,
    amount: number,
    reason: string,
    idempotencyKey?: string
  ): Promise<{
    penalty: any;
    installment: any;
    loan: any;
  }> {
    return this.request<{
      penalty: any;
      installment: any;
      loan: any;
    }>(`/emi/${emiId}/penalties`, {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify({ amount, reason, idempotencyKey }),
    });
  }

  public static async getEmiPenalties(emiId: string): Promise<{
    emiId: string;
    installmentNumber: number;
    penaltyAmount: number;
    activePenaltyTotal: number;
    penalties: Array<{
      id: string;
      emiInstallmentId: string;
      loanId: string;
      amount: number;
      paidAmount: number;
      status: string;
      reason: string;
      createdBy: string;
      createdByName?: string;
      createdAt: string;
      reversedBy?: string;
      reversedByName?: string;
      reversedAt?: string;
      reversalReason?: string;
    }>;
  }> {
    return this.request(`/emi/${emiId}/penalties`);
  }

  public static async reversePenalty(
    penaltyId: string,
    reason: string
  ): Promise<any> {
    return this.request(`/emi/penalties/${penaltyId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public static async waivePenalty(
    penaltyId: string,
    reason: string
  ): Promise<any> {
    return this.request(`/emi/penalties/${penaltyId}/waive`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // --- In-App Notifications ---
  public static async getNotifications(unreadOnly?: boolean): Promise<{
    notifications: INotification[];
    unreadCount: number;
    total: number;
  }> {
    const query = unreadOnly ? '?unreadOnly=true' : '';
    const res = await this.request<{ notifications: INotification[]; unreadCount: number; total: number }>(`/notifications${query}`);
    return res;
  }

  public static async markNotificationAsRead(id: string): Promise<{
    notification: INotification;
    unreadCount: number;
  }> {
    return this.request<{ notification: INotification; unreadCount: number }>(`/notifications/${id}/read`, {
      method: 'PATCH',
    });
  }

  public static async markAllNotificationsAsRead(): Promise<{
    success: boolean;
    unreadCount: number;
  }> {
    return this.request<{ success: boolean; unreadCount: number }>('/notifications/mark-all-read', {
      method: 'POST',
    });
  }

  public static async getNotificationUnreadCount(): Promise<{ unreadCount: number }> {
    return this.request<{ unreadCount: number }>('/notifications/unread-count');
  }

  // --- Contact Activities & Follow-ups ---
  public static async createContactActivity(data: any): Promise<IContactActivity> {
    const res = await this.request<{ success: boolean; data: IContactActivity }>('/contact-activities', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return (res as any).data || res;
  }

  public static async getContactActivities(queryParams: Record<string, any> = {}): Promise<{
    data: IContactActivity[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.set(k, String(v));
      }
    });
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<{
      success: boolean;
      data: IContactActivity[];
      meta: { total: number; page: number; limit: number; totalPages: number };
    }>(`/contact-activities${qs}`);
    return {
      data: (res as any).data || [],
      meta: (res as any).meta || { total: 0, page: 1, limit: 50, totalPages: 1 },
    };
  }

  public static async getContactActivitySummary(params?: { date?: string; agentId?: string }): Promise<IContactActivitySummary> {
    const qs = new URLSearchParams();
    if (params?.date) qs.set('date', params.date);
    if (params?.agentId) qs.set('agentId', params.agentId);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    const res = await this.request<{ success: boolean; data: IContactActivitySummary }>(`/contact-activities/summary${query}`);
    return (res as any).data || res;
  }

  public static async getAdminContactActivitySummary(queryParams: Record<string, any> = {}): Promise<IAdminContactActivitySummary> {
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.set(k, String(v));
      }
    });
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<{ success: boolean; data: IAdminContactActivitySummary }>(`/contact-activities/admin-summary${qs}`);
    return (res as any).data || res;
  }

  public static async getCustomerContactActivities(customerId: string): Promise<IContactActivity[]> {
    const res = await this.request<{ success: boolean; data: IContactActivity[] }>(`/contact-activities/customer/${customerId}`);
    return (res as any).data || res;
  }

  public static async updateContactActivityFollowUp(id: string, data: any): Promise<IContactActivity> {
    const res = await this.request<{ success: boolean; data: IContactActivity }>(`/contact-activities/${id}/follow-up`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return (res as any).data || res;
  }

  public static async downloadContactActivitiesExport(queryParams: Record<string, string> = {}) {
    const token = this.getToken();
    const params = new URLSearchParams(queryParams);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/contact-activities/export?${params.toString()}`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: 'Export failed' } }));
      throw new Error(err.error?.message || 'Failed to export Contact Activities CSV');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contact_activities_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }
}



