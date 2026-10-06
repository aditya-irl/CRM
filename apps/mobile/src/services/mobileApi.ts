import { IAgentQueueItem, IUser, ApiResponse, ICustomer } from '@crm/shared';

export function buildApiUrl(endpoint: string = ''): string {
  let base = (import.meta as any).env?.VITE_API_BASE_URL;
  if (!base || base === 'undefined' || base === 'null' || typeof base !== 'string') {
    base = '/api/v1';
  }
  base = base.trim().replace(/\/+$/, '');
  const trimmedEndpoint = (endpoint || '').trim();
  const cleanEndpoint = trimmedEndpoint
    ? trimmedEndpoint.startsWith('/')
      ? trimmedEndpoint
      : `/${trimmedEndpoint}`
    : '';
  return `${base}${cleanEndpoint}`.replace(/([^:]\/)\/+/g, '$1');
}

const API_BASE = buildApiUrl('');

export class MobileApi {
  public static getToken(): string | null {
    return localStorage.getItem('agent_access_token');
  }

  public static setAuth(user: IUser, token: string) {
    localStorage.setItem('agent_access_token', token);
    localStorage.setItem('agent_user', JSON.stringify(user));
  }

  public static getUser(): IUser | null {
    const raw = localStorage.getItem('agent_user');
    return raw ? JSON.parse(raw) : null;
  }

  public static logout() {
    localStorage.removeItem('agent_access_token');
    localStorage.removeItem('agent_user');
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const url = buildApiUrl(endpoint);
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.status === 401) {
        this.logout();
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new Event('agent_auth_expired'));
        }
        throw new Error('Session expired. Please log in again.');
      }

      if (res.status === 403) {
        let errJson: any;
        try { errJson = await res.json(); } catch {}
        throw new Error(errJson?.error?.message || 'Access denied. You do not have permission for this action.');
      }

      let json: ApiResponse<T>;
      try {
        json = await res.json();
      } catch {
        throw new Error(
          `Unable to reach the API server (HTTP ${res.status}). Please ensure the backend is running and try again.`
        );
      }

      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || `Request failed with status ${res.status}`);
      }

      return json.data as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Network request timed out. Please check your connection and try again.');
      }
      if (!navigator.onLine || err.message === 'Failed to fetch' || err.message?.includes('NetworkError')) {
        throw new Error('No internet connection. Please reconnect and try again.');
      }
      throw err;
    }
  }

  public static async login(email: string, pass: string) {
    const res = await this.request<{ user: IUser; tokens: { accessToken: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pass }),
    });
    this.setAuth(res.user, res.tokens.accessToken);
    return res.user;
  }

  /**
   * Fetch agent queue with automatic offline local storage fallback.
   */
  public static async getQueue(status?: string, route?: string, search?: string): Promise<{ items: IAgentQueueItem[]; fromCache: boolean }> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (route) params.append('route', route);
    if (search) params.append('search', search);

    try {
      const res = await this.request<any>(`/emi/queue?${params.toString()}`);
      const items: IAgentQueueItem[] = Array.isArray(res) ? res : res?.items || [];
      // Update local offline cache
      localStorage.setItem('offline_cached_queue', JSON.stringify(items));
      localStorage.setItem('offline_cached_at', new Date().toISOString());
      return { items, fromCache: false };
    } catch (err) {
      console.warn('Network unavailable, loading offline local cache...');
      const cached = localStorage.getItem('offline_cached_queue');
      if (cached) {
        return { items: JSON.parse(cached), fromCache: true };
      }
      throw err;
    }
  }

  public static async getStats() {
    try {
      return await this.request<{
        todayTarget: number;
        todayCollected: number;
        todayPending: number;
        collectionEfficiency: number;
        dueTodayCount: number;
        overdueCount: number;
      }>('/emi/stats');
    } catch {
      return { todayTarget: 0, todayCollected: 0, todayPending: 0, collectionEfficiency: 0, dueTodayCount: 0, overdueCount: 0 };
    }
  }

  public static async getCustomers(search?: string, route?: string): Promise<ICustomer[]> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (route) params.append('route', route);
    try {
      const res = await this.request<any>(`/customers?${params.toString()}`);
      const customers = Array.isArray(res) ? res : res?.customers || [];
      localStorage.setItem('offline_cached_customers', JSON.stringify(customers));
      return customers;
    } catch (err) {
      const cached = localStorage.getItem('offline_cached_customers');
      if (cached) return JSON.parse(cached);
      throw err;
    }
  }

  public static async getCustomerDetail(id: string) {
    try {
      const res = await this.request<{ customer: ICustomer; loans: any[]; kycDocuments: any[]; callLogs: any[] }>(`/customers/${id}`);
      localStorage.setItem(`offline_cached_cust_${id}`, JSON.stringify(res));
      return res;
    } catch (err) {
      const cached = localStorage.getItem(`offline_cached_cust_${id}`);
      if (cached) {
        return JSON.parse(cached);
      }
      throw err;
    }
  }

  public static async getPayments(search?: string) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    const res = await this.request<any>(`/payments?${params.toString()}`);
    return Array.isArray(res) ? res : res?.payments || [];
  }

  public static async logCall(data: any) {
    return this.request<any>('/call-logs', {
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

  public static async initKYCUpload(data: { customerId: string; docType: string; fileName: string; mimeType: string; fileSizeBytes: number }) {
    return this.request<{ uploadUrl: string; storageKey: string; fileMimeType: string; fileSizeBytes: number }>('/kyc/presigned-upload', {
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

  public static async recordPayment(data: any) {
    return this.request<any>('/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}
