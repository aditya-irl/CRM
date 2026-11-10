import React from 'react';
import { renderToString } from 'react-dom/server';
import { PortalFooter } from '../src/components/portal/PortalFooter';
import { CustomerPortalComplianceView } from '../src/views/CustomerPortalComplianceView';
import { CustomerPortalView } from '../src/views/CustomerPortalView';
import { getCompliancePageFromLocation } from '../src/App';
import { WHATSAPP_SUPPORT_CONFIG } from '@crm/shared';

describe('Cashfree Production Website Whitelisting Compliance Tests', () => {
  describe('PortalFooter Component', () => {
    it('renders all required policy and compliance links', () => {
      const html = renderToString(<PortalFooter />);
      expect(html).toContain('Contact Us');
      expect(html).toContain('Terms &amp; Conditions');
      expect(html).toContain('Refunds &amp; Cancellations');
      expect(html).toContain('Privacy Policy');
      expect(html).toContain('Products &amp; Pricing');

      expect(html).toContain('href="/customer-portal/contact"');
      expect(html).toContain('href="/customer-portal/terms"');
      expect(html).toContain('href="/customer-portal/refunds"');
      expect(html).toContain('href="/customer-portal/privacy"');
      expect(html).toContain('href="/customer-portal/services"');
    });

    it('renders verified corporate entity and trade brand names', () => {
      const html = renderToString(<PortalFooter />);
      expect(html).toContain('Alpha Mobile Gallery');
      expect(html).toContain('Shubh Pvt Ltd');
    });

    it('displays official support email and phone from configuration', () => {
      const html = renderToString(<PortalFooter />);
      expect(html).toContain(WHATSAPP_SUPPORT_CONFIG.email);
      expect(html).toContain(WHATSAPP_SUPPORT_CONFIG.formattedPhone);
      expect(html).toContain('Support Hours: Mon–Sat 10:00 AM – 7:00 PM IST');
    });

    it('displays Cashfree trust badges and currency disclosure in INR', () => {
      const html = renderToString(<PortalFooter />);
      expect(html).toContain('Cashfree Payments');
      expect(html).toContain('RBI-Authorized Payment Aggregator');
      expect(html).toContain('256-Bit Bank-Grade TLS Encryption');
      expect(html).toContain('Indian Rupees (INR / ₹)');
    });

    it('does not expose secret tokens in public footer link hrefs', () => {
      const secretToken = 'cpt_secret_token_12345';
      const html = renderToString(<PortalFooter token={secretToken} />);
      expect(html).not.toContain(secretToken);
    });
  });

  describe('CustomerPortalComplianceView Pages', () => {
    it('renders Contact Us page with official support contact and discrepancy instructions', () => {
      const html = renderToString(<CustomerPortalComplianceView initialPage="contact" />);
      expect(html).toContain('Contact Customer Support');
      expect(html).toContain('Alpha Mobile Gallery');
      expect(html).toContain('Shubh Pvt Ltd');
      expect(html).toContain(WHATSAPP_SUPPORT_CONFIG.displayName);
      expect(html).toContain(WHATSAPP_SUPPORT_CONFIG.email);
      expect(html).toContain(WHATSAPP_SUPPORT_CONFIG.formattedPhone);
      expect(html).toContain('Money Debited but Transaction Shows &#x27;Failed&#x27; or &#x27;Pending&#x27;');
      expect(html).toContain('Do not initiate an immediate duplicate payment');
      expect(html).toContain('3 to 5 banking business days');
      expect(html).toContain('Pending Final Corporate Registry Records Update');
    });

    it('renders Terms & Conditions with governing loan agreement notice and Cashfree details', () => {
      const html = renderToString(<CustomerPortalComplianceView initialPage="terms" />);
      expect(html).toContain('Customer Payment Portal Terms &amp; Conditions');
      expect(html).toContain('Governing Loan Agreement Notice');
      expect(html).toContain('signed by the borrower govern the underlying loan facility');
      expect(html).toContain('Cashfree Payments India Private Limited');
      expect(html).toContain('Failed, Pending, and Successful');
      expect(html).toContain('A failed transaction does not constitute an EMI repayment');
      expect(html).toContain('Late Payment Charges and Penalties');
    });

    it('renders Refunds & Cancellations with strict financial rules and zero instant refund promises', () => {
      const html = renderToString(<CustomerPortalComplianceView initialPage="refunds" />);
      expect(html).toContain('Refunds &amp; Cancellations Policy');
      expect(html).toContain('Strict Financial Governance Rules');
      expect(html).toContain('A failed transaction is');
      expect(html).toContain('never');
      expect(html).toContain('treated as a successful EMI payment');
      expect(html).toContain('No instant cash refunds are provided');
      expect(html).toContain('Duplicate Payments for the Same Installment');
      expect(html).toContain('5 to 7 business banking days');
    });

    it('renders Privacy Policy with Zero Payment Card Data Storage and Cashfree PCI-DSS standards', () => {
      const html = renderToString(<CustomerPortalComplianceView initialPage="privacy" />);
      expect(html).toContain('Customer Payment Portal Privacy Policy');
      expect(html).toContain('Zero Payment Card Data Storage Guarantee');
      expect(html).toContain('We do not collect, view, or store customer credit/debit card numbers');
      expect(html).toContain('Cashfree Payments India Private Limited');
      expect(html).toContain('TLS 1.3 Encryption');
      expect(html).toContain(WHATSAPP_SUPPORT_CONFIG.displayName);
    });

    it('renders Products, Services & Pricing in INR with ₹0 portal fee confirmation', () => {
      const html = renderToString(<CustomerPortalComplianceView initialPage="services" />);
      expect(html).toContain('Products, Services &amp; Pricing Information');
      expect(html).toContain('Currency Disclosure: Indian Rupees (INR / ₹)');
      expect(html).toContain('Portal Platform Usage Fee: ₹0 (Zero / Nil)');
      expect(html).toContain('Down Payment (Upfront)');
      expect(html).toContain('Principal &amp; Interest EMI');
      expect(html).toContain('Overdue Late Penalty');
    });
  });

  describe('URL Location and Routing Detection', () => {
    const originalWindow = global.window;

    afterEach(() => {
      global.window = originalWindow;
    });

    it('resolves direct compliance routes correctly', () => {
      delete (global as any).window;
      (global as any).window = {
        location: { pathname: '/customer-portal/contact', search: '', hash: '' },
      };
      expect(getCompliancePageFromLocation()).toBe('contact');

      (global as any).window.location.pathname = '/customer-portal/terms';
      expect(getCompliancePageFromLocation()).toBe('terms');

      (global as any).window.location.pathname = '/customer-portal/refunds';
      expect(getCompliancePageFromLocation()).toBe('refunds');

      (global as any).window.location.pathname = '/customer-portal/privacy';
      expect(getCompliancePageFromLocation()).toBe('privacy');

      (global as any).window.location.pathname = '/customer-portal/services';
      expect(getCompliancePageFromLocation()).toBe('services');
    });

    it('resolves /portal/* subpath aliases', () => {
      delete (global as any).window;
      (global as any).window = {
        location: { pathname: '/portal/terms', search: '', hash: '' },
      };
      expect(getCompliancePageFromLocation()).toBe('terms');

      (global as any).window.location.pathname = '/portal/contact';
      expect(getCompliancePageFromLocation()).toBe('contact');
    });

    it('resolves query parameters and hash routing fallbacks', () => {
      delete (global as any).window;
      (global as any).window = {
        location: { pathname: '/portal', search: '?page=refunds', hash: '' },
      };
      expect(getCompliancePageFromLocation()).toBe('refunds');

      (global as any).window.location.search = '';
      (global as any).window.location.hash = '#/privacy';
      expect(getCompliancePageFromLocation()).toBe('privacy');
    });

    it('returns null for standard portal link with token', () => {
      delete (global as any).window;
      (global as any).window = {
        location: { pathname: '/portal', search: '?token=abc123xyz', hash: '' },
      };
      expect(getCompliancePageFromLocation()).toBeNull();
    });
  });

  describe('Customer Payment Portal Integration', () => {
    const sampleData: any = {
      customerName: 'Rohit Sharma',
      customerPhone: '+919876543210',
      loanAccountNo: 'LN-2026-9999',
      financedAmount: 30000,
      emiAmount: 3000,
      totalInstallments: 10,
      paidInstallments: 2,
      pendingInstallments: 8,
      overdueInstallments: 0,
      nextDueDate: '2026-12-10',
      outstandingBalance: 24000,
      totalPaid: 6000,
      status: 'ACTIVE',
      installments: [
        {
          installmentNumber: 3,
          dueDate: '2026-12-10',
          expectedAmount: 3000,
          paidAmount: 0,
          remainingAmount: 3000,
          status: 'UPCOMING',
        },
      ],
    };

    it('displays the compliance acknowledgement notice near the checkout payment section', () => {
      const html = renderToString(<CustomerPortalView token="mock_token" initialData={sampleData} />);
      expect(html).toContain('By proceeding with this payment, you acknowledge our');
      expect(html).toContain('href="/customer-portal/terms"');
      expect(html).toContain('href="/customer-portal/refunds"');
      expect(html).toContain('Terms &amp; Conditions');
      expect(html).toContain('Refunds &amp; Cancellations Policy');
    });

    it('embeds the global compliance footer in the customer payment portal', () => {
      const html = renderToString(<CustomerPortalView token="mock_token" initialData={sampleData} />);
      expect(html).toContain('portal-global-footer');
      expect(html).toContain('Legal &amp; Compliance');
      expect(html).toContain('Payment Gateway &amp; Trust');
      expect(html).toContain('Cashfree Payments');
    });
  });
});
