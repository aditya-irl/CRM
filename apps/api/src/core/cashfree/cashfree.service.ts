import crypto from 'crypto';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';

export interface CashfreeCustomerDetails {
  customerId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone: string;
}

export interface CreateCashfreeOrderInput {
  orderId: string;
  orderAmount: number;
  orderCurrency?: string;
  customerDetails: CashfreeCustomerDetails;
  returnUrl: string;
  notifyUrl?: string;
  orderNote?: string;
}

export interface CashfreeOrderResponse {
  cfOrderId: string;
  orderId: string;
  paymentSessionId: string;
  orderStatus: string;
  orderAmount: number;
  orderCurrency: string;
}

export interface CashfreePaymentItem {
  cfPaymentId: string;
  paymentStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'USER_DROPPED' | string;
  paymentAmount: number;
  paymentCurrency: string;
  paymentMessage?: string;
  paymentTime?: string;
  bankReference?: string;
  paymentMethod?: any;
  paymentGroup?: string;
}

export class CashfreeService {
  private static readonly SANDBOX_URL = 'https://sandbox.cashfree.com/pg';
  private static readonly PRODUCTION_URL = 'https://api.cashfree.com/pg';

  public static isConfigured(): boolean {
    const clientId = env.CASHFREE_CLIENT_ID || process.env.CASHFREE_CLIENT_ID;
    const clientSecret = env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_CLIENT_SECRET;
    return Boolean(clientId && clientSecret && clientId.trim() && clientSecret.trim());
  }

  public static getEnvironment(): 'sandbox' | 'production' {
    const raw = (env.CASHFREE_ENV || process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
    return raw === 'production' ? 'production' : 'sandbox';
  }

  public static getBaseUrl(): string {
    return this.getEnvironment() === 'production' ? this.PRODUCTION_URL : this.SANDBOX_URL;
  }

  public static getApiVersion(): string {
    return env.CASHFREE_API_VERSION || process.env.CASHFREE_API_VERSION || '2023-08-01';
  }

  private static getCredentials(): { clientId: string; clientSecret: string } {
    const clientId = (env.CASHFREE_CLIENT_ID || process.env.CASHFREE_CLIENT_ID || '').trim();
    const clientSecret = (env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
      throw new AppError(
        'Cashfree payment gateway is not configured. Missing CASHFREE_CLIENT_ID or CASHFREE_CLIENT_SECRET.',
        503
      );
    }

    return { clientId, clientSecret };
  }

  /**
   * Normalize Indian phone numbers to 10 digits as required by Cashfree.
   */
  public static sanitizePhone(phone: string): string {
    if (!phone) return '9999999999';
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 10) {
      return digits.slice(-10);
    }
    return digits.padEnd(10, '0');
  }

  /**
   * Create an order on Cashfree Payment Gateway.
   * Returns the paymentSessionId needed by Redirect Checkout.
   */
  public static async createOrder(input: CreateCashfreeOrderInput): Promise<CashfreeOrderResponse> {
    const { clientId, clientSecret } = this.getCredentials();
    const url = `${this.getBaseUrl()}/orders`;

    const cleanPhone = this.sanitizePhone(input.customerDetails.customerPhone);
    const cleanCustomerName = (input.customerDetails.customerName || 'Borrower').trim().slice(0, 50);

    const payload = {
      order_id: input.orderId,
      order_amount: Math.round(input.orderAmount * 100) / 100,
      order_currency: input.orderCurrency || 'INR',
      customer_details: {
        customer_id: input.customerDetails.customerId,
        customer_name: cleanCustomerName,
        customer_phone: cleanPhone,
        ...(input.customerDetails.customerEmail ? { customer_email: input.customerDetails.customerEmail } : {}),
      },
      order_meta: {
        return_url: input.returnUrl,
        ...(input.notifyUrl ? { notify_url: input.notifyUrl } : {}),
      },
      ...(input.orderNote ? { order_note: input.orderNote.slice(0, 200) } : {}),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-api-version': this.getApiVersion(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new AppError(`Failed to parse Cashfree create order response (HTTP ${response.status})`, 502);
    }

    if (!response.ok) {
      const errMsg = data.message || data.error?.message || `Cashfree Order API failed with HTTP ${response.status}`;
      console.error('[Cashfree:createOrder] Gateway rejected order:', {
        status: response.status,
        data,
        orderId: input.orderId,
      });
      throw new AppError(errMsg, response.status >= 500 ? 502 : 400);
    }

    return {
      cfOrderId: String(data.cf_order_id || data.order_id),
      orderId: data.order_id,
      paymentSessionId: data.payment_session_id,
      orderStatus: data.order_status,
      orderAmount: Number(data.order_amount),
      orderCurrency: data.order_currency,
    };
  }

  /**
   * Fetch an order from Cashfree to verify order status.
   */
  public static async getOrder(orderId: string): Promise<any> {
    const { clientId, clientSecret } = this.getCredentials();
    const url = `${this.getBaseUrl()}/orders/${encodeURIComponent(orderId)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-api-version': this.getApiVersion(),
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      let errBody: any;
      try {
        errBody = await response.json();
      } catch {}
      throw new AppError(errBody?.message || `Failed to fetch Cashfree order ${orderId} (HTTP ${response.status})`, 502);
    }

    return await response.json();
  }

  /**
   * Fetch all payment attempts for an order from Cashfree server-to-server.
   */
  public static async getOrderPayments(orderId: string): Promise<CashfreePaymentItem[]> {
    const { clientId, clientSecret } = this.getCredentials();
    const url = `${this.getBaseUrl()}/orders/${encodeURIComponent(orderId)}/payments`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-api-version': this.getApiVersion(),
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      let errBody: any;
      try {
        errBody = await response.json();
      } catch {}
      throw new AppError(errBody?.message || `Failed to fetch payments for order ${orderId}`, 502);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item: any) => ({
      cfPaymentId: String(item.cf_payment_id || item.payment_id || ''),
      paymentStatus: String(item.payment_status || '').toUpperCase(),
      paymentAmount: Number(item.payment_amount || 0),
      paymentCurrency: item.payment_currency || 'INR',
      paymentMessage: item.payment_message || undefined,
      paymentTime: item.payment_time || undefined,
      bankReference: item.bank_reference || undefined,
      paymentMethod: item.payment_method || undefined,
      paymentGroup: item.payment_group || undefined,
    }));
  }

  /**
   * Official Cashfree Webhook Signature Verification.
   * Specification:
   * 1. Extract `x-webhook-timestamp` and `x-webhook-signature` headers.
   * 2. signedPayload = timestamp + rawBody
   * 3. signature = Base64( HMAC-SHA256( signedPayload, clientSecret ) )
   * 4. Perform constant-time string comparison to prevent timing attacks.
   * 5. Enforce timestamp freshness (reject events older than tolerance or from future).
   */
  public static verifyWebhookSignature(params: {
    timestamp: string | undefined;
    signature: string | undefined;
    rawBody: string | undefined;
    toleranceSeconds?: number;
  }): { valid: boolean; reason?: string } {
    const { timestamp, signature, rawBody, toleranceSeconds = 300 } = params;

    if (!timestamp || typeof timestamp !== 'string') {
      return { valid: false, reason: 'Missing x-webhook-timestamp header' };
    }
    if (!signature || typeof signature !== 'string') {
      return { valid: false, reason: 'Missing x-webhook-signature header' };
    }
    if (!rawBody || typeof rawBody !== 'string') {
      return { valid: false, reason: 'Raw request body is missing or empty' };
    }

    // Check timestamp tolerance (prevent replay attacks)
    const tsNumber = Number(timestamp);
    if (isNaN(tsNumber) || tsNumber <= 0) {
      // In some versions, timestamp could be ISO-8601 or millisecond epoch or second epoch
      const parsedDate = new Date(isNaN(Number(timestamp)) ? timestamp : Number(timestamp) * (timestamp.length === 10 ? 1000 : 1));
      if (isNaN(parsedDate.getTime())) {
        return { valid: false, reason: 'Invalid x-webhook-timestamp format' };
      }
      const ageMs = Math.abs(Date.now() - parsedDate.getTime());
      if (ageMs > toleranceSeconds * 1000) {
        return { valid: false, reason: `Webhook timestamp expired (age ${Math.round(ageMs / 1000)}s > ${toleranceSeconds}s)` };
      }
    } else {
      const epochSeconds = timestamp.length > 10 ? Math.floor(tsNumber / 1000) : tsNumber;
      const currentSeconds = Math.floor(Date.now() / 1000);
      const diff = Math.abs(currentSeconds - epochSeconds);
      if (diff > toleranceSeconds) {
        return { valid: false, reason: `Webhook timestamp expired (age ${diff}s > ${toleranceSeconds}s)` };
      }
    }

    const { clientSecret } = this.getCredentials();

    const signedPayload = timestamp + rawBody;
    const computedSignature = crypto
      .createHmac('sha256', clientSecret)
      .update(signedPayload)
      .digest('base64');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const computedBuffer = Buffer.from(computedSignature, 'utf8');

    if (signatureBuffer.length !== computedBuffer.length) {
      return { valid: false, reason: 'Signature length mismatch' };
    }

    const matches = crypto.timingSafeEqual(signatureBuffer, computedBuffer);
    if (!matches) {
      return { valid: false, reason: 'Signature cryptographic mismatch' };
    }

    return { valid: true };
  }
}
