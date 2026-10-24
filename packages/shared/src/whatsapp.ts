/**
 * WhatsApp Contact Configuration and URL Builders
 * Standardized global support contact across CRM and Customer Portal.
 */

export const WHATSAPP_SUPPORT_CONFIG = {
  displayName: 'Sparsh Aggrawal',
  rawNumber: '7252040782',
  countryCode: '91',
  destination: '917252040782',
  formattedPhone: '+91 72520 40782',
  defaultCustomerMessage: 'Hello Sparsh Aggrawal, I need assistance regarding my CRM account/loan. My query is: ',
  defaultPortalMessage: 'Hello Sparsh Aggrawal, I need assistance regarding the CRM portal. My query is: ',
  defaultPaymentMessage: 'Hello Sparsh Aggrawal, I need assistance regarding my EMI payment. My query is: ',
} as const;

/**
 * Normalizes phone string to clean numeric digits.
 * If 10 digits are provided, prepends country code '91' by default.
 */
export function normalizeWhatsAppDestination(phone: string, defaultCountryCode: string = '91'): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `${defaultCountryCode}${digits}`;
  }
  return digits;
}

/**
 * Builds an official wa.me link with URL-encoded message text.
 * @param destination Numeric recipient phone in international format (e.g. 917252040782)
 * @param message Pre-filled message (will be URL-encoded)
 */
export function buildWhatsAppUrl(destination: string, message?: string): string {
  const cleanDestination = normalizeWhatsAppDestination(destination);
  const baseUrl = `https://wa.me/${cleanDestination}`;
  if (message && message.trim().length > 0) {
    return `${baseUrl}?text=${encodeURIComponent(message)}`;
  }
  return baseUrl;
}

/**
 * Builds the official WhatsApp URL for the centralized support contact (Sparsh Aggrawal).
 * Privacy Safe: does NOT automatically embed customer names, loan IDs, balances, or KYC data.
 */
export function buildWhatsAppSupportUrl(customMessage?: string): string {
  const message = customMessage !== undefined ? customMessage : WHATSAPP_SUPPORT_CONFIG.defaultCustomerMessage;
  return buildWhatsAppUrl(WHATSAPP_SUPPORT_CONFIG.destination, message);
}
