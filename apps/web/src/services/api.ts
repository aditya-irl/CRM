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
  IAgentCollectionSummary,
  IAgentCollectionLedgerResponse,
  IDirectCollectionSummary,
  IDirectCollectionLedgerResponse,
  IDirectCollectionDetail,
  IFinanceDashboardStats,
  IFinanceReportResponse,
  IDealerDashboardMetrics,
  IDealerLoginAccountResponse,
} from '@crm/shared';

export function buildApiUrl(endpoint: string = ''): string {
  let base = (import.meta as any).env?.VITE_API_BASE_URL;
  if (!base || base === 'undefined' || base === 'null' || typeof base !== 'string') {
    base = '/api/v1';
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

export class ApiClient {
  private static refreshPromise: Promise<string> | null = null;

  public static getToken(): string | null {
    return localStorage.getItem('crm_access_token');
  }

  public static getRefreshToken(): string | null {
    return localStorage.getItem('crm_refresh_token');
  }

  public static setAuth(user: IUser, token: string, refreshToken?: string) {
    localStorage.setItem('crm_access_token', token);
    if (refreshToken) {
      localStorage.setItem('crm_refresh_token', refreshToken);
    }
    localStorage.setItem('crm_user', JSON.stringify(user));
  }

  public static getUser(): IUser | null {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  }

  public static logout() {
    localStorage.removeItem('crm_access_token');
    localStorage.removeItem('crm_refresh_token');
    localStorage.removeItem('crm_user');
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

        localStorage.setItem('crm_access_token', newAccessToken);
        if (newRefreshToken) {
          localStorage.setItem('crm_refresh_token', newRefreshToken);
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
    const url = buildApiUrl(`/portal/loan?token=${encodeURIComponent(token)}`);
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
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
      throw new Error(json.error?.message || 'Invalid or expired portal link');
    }

    return json.data as ICustomerPortalLoanData;
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

  private static async request<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = buildApiUrl(endpoint);
    const res = await fetch(url, {
      ...options,
      headers,
    });

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
      throw error;
    }

    return json.data as T;
  }

  public static updateUser(updates: Partial<IUser>): IUser | null {
    const current = this.getUser();
    if (!current) return null;
    const updated = { ...current, ...updates };
    localStorage.setItem('crm_user', JSON.stringify(updated));
    return updated;
  }

  // Auth
  public static async login(email: string, pass: string) {
    const res = await this.request<{ user: IUser; tokens: { accessToken: string; refreshToken?: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pass }),
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
  }): Promise<{ customer: ICustomer; loan: ILoan | null }> {
    return this.request<{ customer: ICustomer; loan: ILoan | null }>('/customers/onboard', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async updateCustomer(id: string, data: any) {
    return this.request<ICustomer>(`/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
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

  // Agent Queue
  public static async getAgentQueue(status?: string, route?: string, search?: string) {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (route) params.append('route', route);
    if (search) params.append('search', search);
    const res = await this.request<any>(`/emi/queue?${params.toString()}`);
    return Array.isArray(res) ? res : res?.items || [];
  }

  public static async getAgentStats() {
    return this.request<{ todayTarget: number; todayCollected: number; todayPending: number; collectionEfficiency: number; dueTodayCount: number; overdueCount: number }>('/emi/stats');
  }

  // Payments
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
    const res = await this.request<{ downloadUrl: string }>(`/kyc/${docId}/presigned-download`);
    let url = res.downloadUrl;
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      let base = (import.meta as any).env?.VITE_API_BASE_URL || '';
      base = base.trim().replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
      if (base) {
        url = `${base}${url.startsWith('/') ? '' : '/'}${url}`;
      }
    }
    return { ...res, downloadUrl: url };
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
  public static async uploadKYCDocument(data: {
    customerId: string;
    docType: string;
    file: File;
    docNumber?: string | null;
  }) {
    const mimeType = data.file.type || 'application/octet-stream';
    const initRes = await this.initKYCUpload({
      customerId: data.customerId,
      docType: data.docType,
      fileName: data.file.name,
      mimeType,
      fileSizeBytes: data.file.size,
    });

    let uploadUrl = initRes.uploadUrl;
    if (uploadUrl.startsWith('/')) {
      uploadUrl = buildApiUrl(uploadUrl.replace(/^\/api\/v1/, ''));
    }

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

    if (!uploadRes.ok) {
      throw new Error(`Failed to upload document file: HTTP ${uploadRes.status}`);
    }

    return this.confirmKYC({
      customerId: data.customerId,
      docType: data.docType,
      docNumber: data.docNumber || null,
      storageKey: initRes.storageKey,
      fileMimeType: mimeType,
      fileSizeBytes: data.file.size,
    });
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
    return this.request<{ success: boolean; data: any }>(`/loans/${loanId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agentId, notes }),
    });
  }

  public static async unassignLoanAgent(loanId: string, reason?: string) {
    return this.request<{ success: boolean; data: any }>(`/loans/${loanId}/unassign`, {
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

  public static async reverseDealerSettlement(id: string, reason: string) {
    return this.request<IDealerSettlement>(`/dealer-settlements/${id}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
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
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.agentId) params.append('agentId', paramsQuery.agentId);
    if (paramsQuery.startDate) params.append('startDate', paramsQuery.startDate);
    if (paramsQuery.endDate) params.append('endDate', paramsQuery.endDate);
    if (paramsQuery.search) params.append('search', paramsQuery.search);
    if (paramsQuery.page) params.append('page', String(paramsQuery.page));
    if (paramsQuery.limit) params.append('limit', String(paramsQuery.limit));
    return this.request<IAgentCollectionLedgerResponse>(`/agent-collections?${params.toString()}`);
  }

  public static async getAgentCollectionsSummary(paramsQuery: {
    agentId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (paramsQuery.agentId) params.append('agentId', paramsQuery.agentId);
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
    reason: string
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
      body: JSON.stringify({ amount, reason }),
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
}



