import {
  WHATSAPP_SUPPORT_CONFIG,
  normalizeWhatsAppDestination,
  buildWhatsAppUrl,
  buildWhatsAppSupportUrl,
} from './whatsapp';

describe('WhatsApp Centralized Support Configuration & Helpers', () => {
  test('1. Validates standard Indian mobile destination for Sparse Aggrawal', () => {
    expect(WHATSAPP_SUPPORT_CONFIG.displayName).toBe('Sparse Aggrawal');
    expect(WHATSAPP_SUPPORT_CONFIG.rawNumber).toBe('7252040782');
    expect(WHATSAPP_SUPPORT_CONFIG.countryCode).toBe('91');
    expect(WHATSAPP_SUPPORT_CONFIG.destination).toBe('917252040782');
    expect(WHATSAPP_SUPPORT_CONFIG.destination.length).toBe(12);
    expect(WHATSAPP_SUPPORT_CONFIG.formattedPhone).toBe('+91 72520 40782');
  });

  test('2. normalizeWhatsAppDestination handles 10-digit, prefixed, and spaced numbers', () => {
    expect(normalizeWhatsAppDestination('7252040782')).toBe('917252040782');
    expect(normalizeWhatsAppDestination('+91 72520 40782')).toBe('917252040782');
    expect(normalizeWhatsAppDestination('917252040782')).toBe('917252040782');
    expect(normalizeWhatsAppDestination('')).toBe('');
  });

  test('3. buildWhatsAppUrl generates valid wa.me URLs with safe URL encoding', () => {
    const urlWithoutMsg = buildWhatsAppUrl('917252040782');
    expect(urlWithoutMsg).toBe('https://wa.me/917252040782');

    const msg = 'Hello Sparse Aggrawal, I need assistance regarding my CRM account/loan. My query is: ';
    const urlWithMsg = buildWhatsAppUrl('917252040782', msg);
    expect(urlWithMsg).toBe(`https://wa.me/917252040782?text=${encodeURIComponent(msg)}`);
  });

  test('4. buildWhatsAppSupportUrl produces standardized, privacy-safe support link', () => {
    const defaultUrl = buildWhatsAppSupportUrl();
    expect(defaultUrl).toContain('https://wa.me/917252040782?text=');
    expect(defaultUrl).toContain(encodeURIComponent('Hello Sparse Aggrawal, I need assistance regarding my CRM account/loan. My query is: '));

    // Must NOT leak sensitive customer data by default
    expect(defaultUrl).not.toContain('loanAccountNo');
    expect(defaultUrl).not.toContain('cpt_');
    expect(defaultUrl).not.toContain('aadhaar');

    // Custom message
    const customUrl = buildWhatsAppSupportUrl('Custom support question');
    expect(customUrl).toBe('https://wa.me/917252040782?text=Custom%20support%20question');
  });
});
