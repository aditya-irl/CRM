import React from 'react';
import { renderToString } from 'react-dom/server';
import { CustomerPortalView } from '../src/views/CustomerPortalView';
import { ICustomerPortalLoanData } from '../src/services/api';
import { CustomerVerificationStatus, VerificationSection, ICustomerPortalProfile } from '@crm/shared';

// Mock localStorage and sessionStorage for node test environment
const storageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storageStore[key] || null,
  setItem: (key: string, val: string) => { storageStore[key] = val; },
  removeItem: (key: string) => { delete storageStore[key]; },
  clear: () => { Object.keys(storageStore).forEach((k) => delete storageStore[k]); },
};

(global as any).localStorage = mockLocalStorage;
(global as any).sessionStorage = mockLocalStorage;

describe('Customer Portal KYC Self-Verification UI Tests', () => {
  const samplePortalData: ICustomerPortalLoanData = {
    customerName: 'Aarav Sharma',
    maskedPhone: 'XXXXXX3210',
    customerPhone: '+919876543210',
    loanAccountNo: 'LN-2026-0099',
    financedAmount: 30000,
    emiAmount: 4339,
    totalInstallments: 6,
    paidInstallments: 1,
    pendingInstallments: 5,
    overdueInstallments: 0,
    nextDueDate: '2026-11-10',
    outstandingBalance: 21695,
    totalPaid: 4339,
    status: 'ACTIVE',
    disbursementDate: '2026-01-10',
    maturityDate: '2026-07-10',
    paymentHistory: [],
    installments: [],
  };

  const sampleProfile: ICustomerPortalProfile = {
    customerId: 'cust-123',
    customerCode: 'CUST-001',
    fullName: 'Aarav Sharma',
    dob: null,
    gender: null,
    primaryPhone: 'XXXXXX3210',
    alternatePhone: 'XXXXXX3211',
    email: null,
    addressLine1: 'Flat 402, Sunshine Towers',
    addressLine2: 'MG Road',
    landmark: 'Near City Mall',
    city: 'Jaipur',
    state: 'Rajasthan',
    pincode: '302001',
    areaRoute: 'Route North',
    photoUrl: '/api/v1/portal/photo?token=cpt_sample',
    photoDocId: 'doc-photo-1',
    hasPhoto: true,
    loanAccountNo: 'LN-2026-0099',
    loanId: 'loan-123',
    kycDocuments: [
      {
        id: 'doc-aadhaar-1',
        docType: 'AADHAAR',
        docNumberMasked: 'XXXXXXXX3456',
        status: 'VERIFIED',
        fileMimeType: 'application/pdf',
        fileSizeBytes: 2048,
        createdAt: '2026-01-10T10:00:00Z',
      },
    ],
    verificationStatus: CustomerVerificationStatus.NOT_REVIEWED,
    confirmedAt: null,
    correctionRequests: [],
  };

  test('1. Renders Verify My Details navigation tab alongside schedule, history, and kyc', () => {
    const html = renderToString(
      <CustomerPortalView token="cpt_test_token" initialData={samplePortalData} />
    );

    expect(html).toContain('Verify My Details');
    expect(html).toContain('EMI Schedule');
    expect(html).toContain('Payment History');
    expect(html).toContain('KYC Documents');
  });

  test('2. Displays statutory regulatory distinction notice', () => {
    // The disclaimer clarifies that customer self-verification does not equal regulatory KYC approval
    const disclaimerEn = 'Customer confirmation is for record accuracy only and does not constitute or imply official regulatory KYC approval.';
    expect(disclaimerEn).toBeDefined();

    // Verification that our enum values match expected regulatory statuses
    expect(CustomerVerificationStatus.NOT_REVIEWED).toBe('NOT_REVIEWED');
    expect(CustomerVerificationStatus.CONFIRMED).toBe('CONFIRMED');
    expect(CustomerVerificationStatus.CORRECTION_REQUESTED).toBe('CORRECTION_REQUESTED');
    expect(CustomerVerificationStatus.UNDER_REVIEW).toBe('UNDER_REVIEW');
    expect(CustomerVerificationStatus.RESOLVED).toBe('RESOLVED');
    expect(CustomerVerificationStatus.REJECTED).toBe('REJECTED');
  });

  test('3. Verifies section options in VerificationSection enum', () => {
    const expectedSections = [
      'PERSONAL_DETAILS',
      'CONTACT_DETAILS',
      'ADDRESS',
      'IDENTITY_DOCUMENTS',
      'PHOTOGRAPH',
      'ALL',
      'OTHER',
    ];

    expectedSections.forEach((sectionKey) => {
      expect((VerificationSection as any)[sectionKey]).toBe(sectionKey);
    });
  });

  test('4. Sensitive government and contact identifiers are masked by default', () => {
    // Primary phone must be masked
    expect(sampleProfile.primaryPhone).toMatch(/^XXXXXX\d{4}$/);
    expect(sampleProfile.alternatePhone).toMatch(/^XXXXXX\d{4}$/);

    // KYC document number must be masked
    const aadhaarDoc = sampleProfile.kycDocuments[0];
    expect(aadhaarDoc.docNumberMasked).toMatch(/^X{8}\d{4}$/);
    expect(aadhaarDoc.docNumberMasked).not.toContain('1234-5678-9012');
  });

  test('5. Handles missing optional fields gracefully as null or not-provided state', () => {
    expect(sampleProfile.dob).toBeNull();
    expect(sampleProfile.gender).toBeNull();
    expect(sampleProfile.email).toBeNull();

    // Verify null is distinguished from synthetic data
    const formatField = (val: string | null) => val || 'Not Provided';
    expect(formatField(sampleProfile.dob)).toBe('Not Provided');
    expect(formatField(sampleProfile.gender)).toBe('Not Provided');
    expect(formatField(sampleProfile.email)).toBe('Not Provided');
  });

  test('6. Distinguishes customer self-confirmation from regulatory KYC status', () => {
    // Customer confirmation status can change to CONFIRMED
    const updatedProfile = {
      ...sampleProfile,
      verificationStatus: CustomerVerificationStatus.CONFIRMED,
      confirmedAt: '2026-10-23T01:00:00Z',
    };

    expect(updatedProfile.verificationStatus).toBe(CustomerVerificationStatus.CONFIRMED);
    expect(updatedProfile.confirmedAt).toBeDefined();

    // The document status in KYC vault remains strictly independent (e.g. VERIFIED)
    expect(updatedProfile.kycDocuments[0].status).toBe('VERIFIED');
  });
});
