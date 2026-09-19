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
