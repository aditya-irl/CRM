import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import {
  isChunkLoadError,
  handleStaleChunkRecovery,
  resetStaleChunkRecovery,
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_COOLDOWN_MS,
} from '../src/utils/lazyWithRetry';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

describe('Lazy Chunk Resilience & Stale Deployment Recovery', () => {
  let storage: Record<string, string> = {};
  let reloadMock: jest.Mock;

  beforeEach(() => {
    storage = {};
    reloadMock = jest.fn();

    const mockStorage = {
      getItem: (k: string) => storage[k] || null,
      setItem: (k: string, v: string) => {
        storage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
      clear: () => {
        storage = {};
      },
    };

    (global as any).sessionStorage = mockStorage;
    (global as any).window = {
      sessionStorage: mockStorage,
      location: {
        reload: reloadMock,
        hash: '',
      },
    };
  });

  describe('1. Chunk Load Error Classification (isChunkLoadError)', () => {
    test('Correctly identifies "text/html" MIME type errors from stale deployment chunk requests', () => {
      const err1 = new Error("'text/html' is not a valid JavaScript MIME type.");
      const err2 = new TypeError('Failed to load module script: The server responded with a non-JavaScript MIME type of "text/html".');
      const err3 = new Error('Failed to fetch dynamically imported module: https://crm-two-orcin-18.vercel.app/assets/DashboardView-old.js');
      const err4 = new Error('error loading dynamically imported module');
      const err5 = new Error('ChunkLoadError: Loading chunk 12 failed.');
      const err6 = new Error('Unable to preload CSS for /assets/index.css');

      expect(isChunkLoadError(err1)).toBe(true);
      expect(isChunkLoadError(err2)).toBe(true);
      expect(isChunkLoadError(err3)).toBe(true);
      expect(isChunkLoadError(err4)).toBe(true);
      expect(isChunkLoadError(err5)).toBe(true);
      expect(isChunkLoadError(err6)).toBe(true);
    });

    test('Strictly distinguishes and rejects standard API, permission, validation, and runtime errors', () => {
      const apiErr = new Error('Loan LN-2026-1009 not found');
      const authErr = new Error('403 Forbidden: You are not authorized to perform this operation');
      const validationErr = new Error('Validation failed: Penalty amount must be a positive number');
      const serverErr = new Error('500 Internal Server Error: Database pool timeout');
      const runtimeErr = new TypeError("Cannot read properties of undefined (reading 'customer_name')");
      const emptyErr = new Error('');

      expect(isChunkLoadError(apiErr)).toBe(false);
      expect(isChunkLoadError(authErr)).toBe(false);
      expect(isChunkLoadError(validationErr)).toBe(false);
      expect(isChunkLoadError(serverErr)).toBe(false);
      expect(isChunkLoadError(runtimeErr)).toBe(false);
      expect(isChunkLoadError(emptyErr)).toBe(false);
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
    });
  });

  describe('2. Guarded Stale-Chunk Recovery (handleStaleChunkRecovery)', () => {
    test('Triggers guarded window.location.reload() on first stale chunk error', () => {
      expect(storage[CHUNK_RELOAD_STORAGE_KEY]).toBeUndefined();

      const didReload = handleStaleChunkRecovery(new Error("'text/html' is not a valid JavaScript MIME type."));

      expect(didReload).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(1);
      expect(storage[CHUNK_RELOAD_STORAGE_KEY]).toBeDefined();
    });

    test('Prevents infinite reload loops when called repeatedly within cooldown period', () => {
      // First attempt triggers reload
      const first = handleStaleChunkRecovery();
      expect(first).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(1);

      // Immediate second attempt within cooldown MUST be rejected (returns false)
      const second = handleStaleChunkRecovery();
      expect(second).toBe(false);
      expect(reloadMock).toHaveBeenCalledTimes(1); // Still 1

      // Third attempt within cooldown also rejected
      const third = handleStaleChunkRecovery();
      expect(third).toBe(false);
      expect(reloadMock).toHaveBeenCalledTimes(1); // Still 1
    });

    test('Allows recovery again after cooldown expires or resetStaleChunkRecovery is called', () => {
      handleStaleChunkRecovery();
      expect(reloadMock).toHaveBeenCalledTimes(1);

      // Simulate cooldown expiry
      const oldTime = Date.now() - (CHUNK_RELOAD_COOLDOWN_MS + 5000);
      storage[CHUNK_RELOAD_STORAGE_KEY] = String(oldTime);

      const afterCooldown = handleStaleChunkRecovery();
      expect(afterCooldown).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(2);

      // Reset
      resetStaleChunkRecovery();
      expect(storage[CHUNK_RELOAD_STORAGE_KEY]).toBeUndefined();
    });
  });

  describe('3. ErrorBoundary Presentation and Separation of Concerns', () => {
    test('Renders dedicated Application Update banner for chunk load errors without reload loops', () => {
      const boundary = new ErrorBoundary({ fallbackTitle: 'Workflow View Interrupted', children: null });
      const chunkError = new Error("'text/html' is not a valid JavaScript MIME type.");

      // Set error boundary state to chunk error
      boundary.state = {
        hasError: true,
        error: chunkError,
        errorInfo: null,
      };

      const renderedHtml = renderToString(boundary.render() as React.ReactElement);

      expect(renderedHtml).toContain('Application Update Available');
      expect(renderedHtml).toContain('A newer version of the CRM has been deployed');
      expect(renderedHtml).toContain('Update &amp; Reload Application');
      expect(renderedHtml).toContain('Go to Dashboard');
    });

    test('Renders standard section fallback and preserves view error for non-chunk errors', () => {
      const boundary = new ErrorBoundary({ fallbackTitle: 'Workflow View Interrupted', children: null });
      const businessError = new Error('Customer credit limit calculation failed');

      boundary.state = {
        hasError: true,
        error: businessError,
        errorInfo: null,
      };

      const renderedHtml = renderToString(boundary.render() as React.ReactElement);

      expect(renderedHtml).toContain('Workflow View Interrupted');
      expect(renderedHtml).toContain('An unexpected error occurred while rendering this view');
      expect(renderedHtml).toContain('Customer credit limit calculation failed');
      expect(renderedHtml).toContain('Reload This Section');
      expect(renderedHtml).toContain('Go to Dashboard');
      expect(renderedHtml).not.toContain('Application Update Available');
    });
  });

  describe('4. Vercel Configuration & Asset Manifest Smoke Test', () => {
    test('apps/web/vercel.json rewrite excludes file extensions (preventing HTML responses for JS chunks)', () => {
      const vercelConfigPath = path.resolve(__dirname, '../vercel.json');
      expect(fs.existsSync(vercelConfigPath)).toBe(true);

      const vercelJson = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));

      expect(vercelJson.rewrites).toBeDefined();
      const spaRewrite = vercelJson.rewrites.find((r: any) => r.destination === '/index.html');
      expect(spaRewrite).toBeDefined();

      const regexPattern = new RegExp(`^${spaRewrite.source.replace(/\(\.\*\)/g, '.*')}$`);

      // SPA routes MUST match
      expect(regexPattern.test('/portal')).toBe(true);
      expect(regexPattern.test('/dashboard')).toBe(true);
      expect(regexPattern.test('/loans')).toBe(true);
      expect(regexPattern.test('/customers')).toBe(true);

      // Asset and file routes MUST NOT match
      expect(regexPattern.test('/assets/index.js')).toBe(false);
      expect(regexPattern.test('/assets/DashboardView-DySKiEli.js')).toBe(false);
      expect(regexPattern.test('/assets/style.css')).toBe(false);
      expect(regexPattern.test('/favicon.svg')).toBe(false);
    });

    test('apps/web/vercel.json contains immutable caching for /assets/(.*) and no-cache for /index.html', () => {
      const vercelConfigPath = path.resolve(__dirname, '../vercel.json');
      const vercelJson = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));

      expect(vercelJson.headers).toBeDefined();

      const assetHeader = vercelJson.headers.find((h: any) => h.source === '/assets/(.*)');
      expect(assetHeader).toBeDefined();
      const assetCacheControl = assetHeader.headers.find((k: any) => k.key === 'Cache-Control');
      expect(assetCacheControl.value).toContain('immutable');
      expect(assetCacheControl.value).toContain('max-age=31536000');

      const indexHeader = vercelJson.headers.find((h: any) => h.source === '/index.html');
      expect(indexHeader).toBeDefined();
      const indexCacheControl = indexHeader.headers.find((k: any) => k.key === 'Cache-Control');
      expect(indexCacheControl.value).toContain('no-cache');
      expect(indexCacheControl.value).toContain('no-store');
    });

    test('Vite build output uses absolute root base "/" and generates valid JS files', () => {
      const distIndexHtmlPath = path.resolve(__dirname, '../dist/index.html');
      if (fs.existsSync(distIndexHtmlPath)) {
        const html = fs.readFileSync(distIndexHtmlPath, 'utf8');
        expect(html).toMatch(/src="\/assets\/index-[^"]+\.js"/);
        expect(html).toMatch(/href="\/assets\/index-[^"]+\.css"/);
      }
    });
  });
});
