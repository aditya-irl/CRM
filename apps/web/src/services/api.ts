import {
  IUser,
  ICustomer,
  ILoan,
  IPayment,
  IAgentQueueItem,
  IDashboardStats,
  IAuditLog,
  ApiResponse,
} from '@crm/shared';

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || '/api/v1';

export class ApiClient {
  public static getToken(): string | null {
    return localStorage.getItem('crm_access_token');
  }

  public static setAuth(user: IUser, token: string) {
    localStorage.setItem('crm_access_token', token);
    localStorage.setItem('crm_user', JSON.stringify(user));
  }

  public static getUser(): IUser | null {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  }

  public static logout() {
    localStorage.removeItem('crm_access_token');
    localStorage.removeItem('crm_user');
  }

  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.logout();
      window.dispatchEvent(new Event('crm_auth_expired'));
      throw new Error('Session expired. Please log in again.');
    }

    const json: ApiResponse<T> = await res.json();

    if (!res.ok || !json.success) {
      throw new Error(json.error?.message || 'An error occurred during API request');
    }

    return json.data as T;
  }

  // Auth
  public static async login(email: string, pass: string) {
    const res = await this.request<{ user: IUser; tokens: { accessToken: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pass }),
    });
    this.setAuth(res.user, res.tokens.accessToken);
    return res.user;
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

  public static async reversePayment(id: string, reason: string) {
    return this.request<any>(`/payments/${id}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ paymentId: id, reason }),
    });
  }

  public static async listPayments(search?: string, page = 1, limit = 50) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    params.append('page', String(page));
    params.append('limit', String(limit));
    const res = await this.request<any>(`/payments?${params.toString()}`);
    return Array.isArray(res) ? res : res?.payments || [];
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
    return this.request<{ downloadUrl: string }>(`/kyc/${docId}/presigned-download`);
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

  // Trigger automated jobs
  public static async triggerBackgroundJobs() {
    return this.request<any>('/system/trigger-jobs', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
}
