/**
 * PII Masking Utilities for Financial Compliance and Data Protection.
 */

/**
 * Mask Aadhaar number (e.g. "1234 5678 9012" -> "XXXX-XXXX-9012")
 */
export function maskAadhaar(aadhaar: string | null | undefined): string {
  if (!aadhaar) return 'XXXX-XXXX-XXXX';
  const clean = aadhaar.replace(/\D/g, '');
  if (clean.length < 4) return 'XXXX-XXXX-XXXX';
  const last4 = clean.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

/**
 * Mask PAN number (e.g. "ABCDE1234F" -> "ABCDE****F")
 */
export function maskPan(pan: string | null | undefined): string {
  if (!pan) return 'XXXXXXXXXX';
  const clean = pan.trim().toUpperCase();
  if (clean.length !== 10) return 'XXXXXXXXXX';
  return `${clean.slice(0, 5)}****${clean.slice(9)}`;
}

/**
 * Mask Phone number (e.g. "+919876543210" -> "+91 98*** **210")
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '**********';
  const clean = phone.trim();
  if (clean.length <= 5) return '**********';
  const start = clean.slice(0, clean.length - 6);
  const end = clean.slice(-3);
  return `${start}***${end}`;
}

/**
 * Format Indian Rupee currency (e.g. 150000.5 -> "₹1,50,000.50")
 */
export function formatINR(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return '₹0.00';
  }
  const num = Number(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Recursively redact sensitive keys (passwords, tokens, secrets, full Aadhaar/PAN, storage keys).
 * Operates non-destructively on a deep clone/copy of the data.
 */
export function redactSensitiveData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Check if string is a JWT token (starts with eyJ... and has 2 periods)
    if (/^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(obj.trim())) {
      return '[REDACTED]' as unknown as T;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase().replace(/[-_]/g, '');

      if (
        lower.includes('password') ||
        lower.includes('secret') ||
        lower.includes('token') ||
        lower.includes('apikey') ||
        lower.includes('privatekey') ||
        lower === 'jwt' ||
        lower === 'storagekey' ||
        lower === 'authorization'
      ) {
        result[key] = '[REDACTED]';
      } else if (lower.includes('aadhaar')) {
        if (typeof value === 'string') {
          result[key] = maskAadhaar(value);
        } else {
          result[key] = '[REDACTED]';
        }
      } else if (lower.includes('pan') && lower !== 'company' && lower !== 'span') {
        if (typeof value === 'string') {
          result[key] = maskPan(value);
        } else {
          result[key] = '[REDACTED]';
        }
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result as T;
  }

  return obj;
}

/**
 * Computes deep visual diff between previousState and newState for audit change inspection.
 */
export function computeAuditDiff(
  previousState?: Record<string, any> | null,
  newState?: Record<string, any> | null,
  prefix = ''
): Array<{ field: string; previousValue: any; newValue: any }> {
  if (!previousState && !newState) return [];

  const changes: Array<{ field: string; previousValue: any; newValue: any }> = [];
  const prev = previousState || {};
  const next = newState || {};

  const allKeys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));

  for (const key of allKeys) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const prevVal = prev[key];
    const nextVal = next[key];

    // If both are objects (not arrays, not null), recurse
    if (
      prevVal &&
      nextVal &&
      typeof prevVal === 'object' &&
      typeof nextVal === 'object' &&
      !Array.isArray(prevVal) &&
      !Array.isArray(nextVal)
    ) {
      changes.push(...computeAuditDiff(prevVal, nextVal, fieldPath));
    } else {
      // Compare equality
      const isEqual = JSON.stringify(prevVal) === JSON.stringify(nextVal);
      if (!isEqual) {
        changes.push({
          field: fieldPath,
          previousValue: prevVal !== undefined ? prevVal : null,
          newValue: nextVal !== undefined ? nextVal : null,
        });
      }
    }
  }

  return changes;
}

