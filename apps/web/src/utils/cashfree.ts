/**
 * Cashfree Payments JS SDK v3 Loader & Redirect Checkout Helper
 * Official Cashfree Documentation: https://www.cashfree.com/devstudio/preview/pg/web/checkout
 * Official SDK CDN: https://sdk.cashfree.com/js/v3/cashfree.js
 */

export type CashfreeEnvironment = 'sandbox' | 'production';

export interface CashfreeCheckoutOptions {
  paymentSessionId: string;
  redirectTarget?: '_self' | '_blank' | '_top' | '_modal';
}

/**
 * Dynamically loads the official Cashfree JS SDK v3 and initializes instance.
 */
export async function loadCashfreeSDK(mode: CashfreeEnvironment = 'sandbox'): Promise<any> {
  if (typeof window === 'undefined') return null;

  if ((window as any).Cashfree) {
    return (window as any).Cashfree({ mode });
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById('cashfree-sdk-v3') as HTMLScriptElement | null;
    if (existing) {
      if ((window as any).Cashfree) {
        return resolve((window as any).Cashfree({ mode }));
      }
      existing.addEventListener('load', () => {
        if ((window as any).Cashfree) {
          resolve((window as any).Cashfree({ mode }));
        } else {
          reject(new Error('Cashfree SDK object not found after script load'));
        }
      });
      existing.addEventListener('error', () => {
        reject(new Error('Failed to load Cashfree SDK script'));
      });
      return;
    }

    const script = document.createElement('script');
    script.id = 'cashfree-sdk-v3';
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.async = true;
    script.onload = () => {
      if ((window as any).Cashfree) {
        resolve((window as any).Cashfree({ mode }));
      } else {
        reject(new Error('Cashfree SDK loaded but Cashfree constructor not found on window'));
      }
    };
    script.onerror = () => {
      reject(new Error('Failed to load Cashfree Payments JS SDK from CDN'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Triggers Cashfree Redirect Checkout.
 * In Redirect Checkout, redirectTarget: '_self' takes the borrower to Cashfree's hosted payment page.
 */
export async function launchCashfreeRedirectCheckout(params: {
  paymentSessionId: string;
  environment: CashfreeEnvironment;
  redirectTarget?: '_self' | '_blank' | '_top' | '_modal';
}): Promise<void> {
  const { paymentSessionId, environment, redirectTarget = '_self' } = params;
  const cashfree = await loadCashfreeSDK(environment);

  if (!cashfree || typeof cashfree.checkout !== 'function') {
    throw new Error('Cashfree Checkout SDK could not be initialized');
  }

  cashfree.checkout({
    paymentSessionId,
    redirectTarget,
  });
}
