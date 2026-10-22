import React, { useState } from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { AddCustomerWizard, useBodyScrollLock } from '../src/components/AddCustomerWizard';
import { ApiClient } from '../src/services/api';
import { UserRole } from '@crm/shared';

// Mock localStorage and sessionStorage
const storageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storageStore[key] || null,
  setItem: (key: string, val: string) => {
    storageStore[key] = val;
  },
  removeItem: (key: string) => {
    delete storageStore[key];
  },
  clear: () => {
    Object.keys(storageStore).forEach((k) => delete storageStore[k]);
  },
};

(global as any).localStorage = mockLocalStorage;
(global as any).sessionStorage = mockLocalStorage;

describe('Onboarding Wizard Scroll & Layout Regressions', () => {
  let originalDocument: any;

  beforeEach(() => {
    mockLocalStorage.clear();
    ApiClient.setAuth(
      {
        id: 'admin-001',
        email: 'admin@financecrm.com',
        phone: '9999999999',
        fullName: 'Super Administrator',
        role: UserRole.SUPER_ADMIN,
        status: 'ACTIVE' as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'admin-token-123'
    );
    originalDocument = (global as any).document;
  });

  afterEach(() => {
    (global as any).document = originalDocument;
    jest.restoreAllMocks();
  });

  describe('1. Modal Layout, Viewport Constraints & Reachable Controls', () => {
    test('renders modal content with viewport constraint and flex column layout', () => {
      const html = renderToString(
        <AddCustomerWizard isOpen={true} onClose={() => {}} onSuccess={() => {}} />
      );

      // Modal container has constrained height and flex styling
      expect(html).toContain('wizard-modal-container');
      expect(html).toContain('max-height:min(90vh, 920px)');
      expect(html).toContain('display:flex');
      expect(html).toContain('flex-direction:column');
      expect(html).toContain('overflow:hidden');
    });

    test('renders header and step indicator with flex-shrink:0 to stay visible while scrolling', () => {
      const html = renderToString(
        <AddCustomerWizard isOpen={true} onClose={() => {}} onSuccess={() => {}} />
      );

      // Header is fixed/non-shrinking
      expect(html).toContain('New Borrower &amp; Financed Product Onboarding');
      expect(html).toContain('flex-shrink:0');

      // Step Progress Bar is non-shrinking and horizontally scrollable
      expect(html).toContain('overflow-x:auto');
    });

    test('renders intermediate flex wrapper with min-height:0 and flex:1', () => {
      const html = renderToString(
        <AddCustomerWizard isOpen={true} onClose={() => {}} onSuccess={() => {}} />
      );

      // Intermediate child must use flex: 1 and min-height: 0
      expect(html).toContain('min-height:0');
      expect(html).toContain('flex:1');
    });

    test('renders main content area with wizard-step-content and overflow-y:auto', () => {
      const html = renderToString(
        <AddCustomerWizard isOpen={true} onClose={() => {}} onSuccess={() => {}} />
      );

      // Main content is vertically scrollable with dedicated class
      expect(html).toContain('wizard-step-content');
      expect(html).toContain('overflow-y:auto');
    });

    test('footer navigation actions are anchored with flex-shrink:0 and border-top', () => {
      const html = renderToString(
        <AddCustomerWizard isOpen={true} onClose={() => {}} onSuccess={() => {}} />
      );

      // Footer is non-shrinking and contains Cancel + Continue buttons
      expect(html).toContain('Cancel');
      expect(html).toMatch(/Continue to Step.*2/);
      expect(html).toContain('border-top:1px solid var(--border-subtle)');
      expect(html).toContain('flex-shrink:0');
    });

    test('all initial Step 1 form fields and photo uploaders are contained inside the scrollable container', () => {
      const html = renderToString(
        <AddCustomerWizard isOpen={true} onClose={() => {}} onSuccess={() => {}} />
      );

      // All Step 1 fields are rendered
      expect(html).toContain('Borrower Full Name');
      expect(html).toContain('Primary Phone (WhatsApp)');
      expect(html).toContain('Shop / Street Address Line 1');
      expect(html).toContain('Pincode');
      expect(html).toContain('Collection Area / Route');
      expect(html).toContain('Customer Main Photo / Avatar');
      expect(html).toContain('Capture customer live photo or selfie with camera');
    });

    test('returns null when isOpen is false', () => {
      const html = renderToString(
        <AddCustomerWizard isOpen={false} onClose={() => {}} onSuccess={() => {}} />
      );

      expect(html).toBe('');
    });
  });

  describe('2. Background Scroll Locking (useBodyScrollLock Hook)', () => {
    test('locks body overflow to hidden when modal is opened', () => {
      const mockDocument = {
        body: {
          style: {
            overflow: '',
          },
        },
      };
      (global as any).document = mockDocument;

      // Simulate hook execution directly to test effect and cleanup
      let cleanupFn: (() => void) | undefined;
      const mockUseEffect = jest.spyOn(React, 'useEffect').mockImplementation((fn: any) => {
        cleanupFn = fn();
      });

      function TestComponent({ isOpen }: { isOpen: boolean }) {
        useBodyScrollLock(isOpen);
        return null;
      }

      renderToString(<TestComponent isOpen={true} />);

      expect(mockDocument.body.style.overflow).toBe('hidden');

      mockUseEffect.mockRestore();
    });

    test('restores original body overflow style when modal is closed', () => {
      const mockDocument = {
        body: {
          style: {
            overflow: 'auto',
          },
        },
      };
      (global as any).document = mockDocument;

      let cleanupFn: (() => void) | undefined;
      const mockUseEffect = jest.spyOn(React, 'useEffect').mockImplementation((fn: any) => {
        cleanupFn = fn();
      });

      function TestComponent({ isOpen }: { isOpen: boolean }) {
        useBodyScrollLock(isOpen);
        return null;
      }

      renderToString(<TestComponent isOpen={true} />);
      expect(mockDocument.body.style.overflow).toBe('hidden');

      // Trigger cleanup (closing or unmounting)
      if (cleanupFn) cleanupFn();
      expect(mockDocument.body.style.overflow).toBe('auto');

      mockUseEffect.mockRestore();
    });

    test('reopening and closing modal does not leave a stale scroll lock', () => {
      const mockDocument = {
        body: {
          style: {
            overflow: '',
          },
        },
      };
      (global as any).document = mockDocument;

      let cleanups: (() => void)[] = [];
      const mockUseEffect = jest.spyOn(React, 'useEffect').mockImplementation((fn: any) => {
        const res = fn();
        if (typeof res === 'function') cleanups.push(res);
      });

      function TestComponent({ isOpen }: { isOpen: boolean }) {
        useBodyScrollLock(isOpen);
        return null;
      }

      // First open
      renderToString(<TestComponent isOpen={true} />);
      expect(mockDocument.body.style.overflow).toBe('hidden');

      // First close (cleanup runs)
      cleanups.pop()?.();
      expect(mockDocument.body.style.overflow).toBe('');

      // Second open (reopen)
      renderToString(<TestComponent isOpen={true} />);
      expect(mockDocument.body.style.overflow).toBe('hidden');

      // Second close
      cleanups.pop()?.();
      expect(mockDocument.body.style.overflow).toBe('');

      mockUseEffect.mockRestore();
    });
  });

  describe('3. CSS Design System and Responsive Rules Verification', () => {
    test('index.css includes wizard modal layout and touch scrolling rules', () => {
      const cssPath = path.resolve(__dirname, '../src/index.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Wizard modal container rules
      expect(cssContent).toContain('.modal-content.wizard-modal-container');
      expect(cssContent).toContain('padding: 0 !important;');
      expect(cssContent).toContain('max-height: 90vh;');
      expect(cssContent).toContain('display: flex;');
      expect(cssContent).toContain('flex-direction: column;');
      expect(cssContent).toContain('overflow: hidden;');

      // Wizard step content rules
      expect(cssContent).toContain('.wizard-step-content');
      expect(cssContent).toContain('flex: 1;');
      expect(cssContent).toContain('min-height: 0;');
      expect(cssContent).toContain('overflow-y: auto;');
      expect(cssContent).toContain('-webkit-overflow-scrolling: touch;');

      // Responsive media query overrides (<= 768px and <= 480px)
      expect(cssContent).toContain('max-height: 94vh !important;');
      expect(cssContent).toContain('padding: 16px !important;');
    });
  });
});
