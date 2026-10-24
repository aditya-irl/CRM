import { ComponentType, lazy, LazyExoticComponent } from 'react';

export const CHUNK_RELOAD_STORAGE_KEY = 'crm_chunk_reload_timestamp';
export const CHUNK_RELOAD_COOLDOWN_MS = 15000;

/**
 * Determines whether an error is caused by a missing, stale, or MIME-mismatched
 * JavaScript/CSS asset during dynamic module import or lazy code splitting.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;

  const msg = (
    typeof error === 'string'
      ? error
      : (error as any).message || (error as any).name || String(error)
  ).toLowerCase();

  return (
    msg.includes('text/html') ||
    msg.includes('dynamically imported module') ||
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('chunkloaderror') ||
    msg.includes('loading chunk') ||
    msg.includes('mime type') ||
    msg.includes('unable to preload css') ||
    msg.includes('failed to load module script') ||
    (msg.includes('networkerror') && msg.includes('fetch'))
  );
}

/**
 * Executes a controlled, single-time page reload to fetch the latest application
 * assets from the current deployment, strictly guarding against reload loops.
 */
export function handleStaleChunkRecovery(error?: unknown): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return false;
  }

  const lastReload = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
  const now = Date.now();

  if (lastReload) {
    const elapsed = now - parseInt(lastReload, 10);
    // If a reload was already attempted within the cooldown window, do not loop
    if (elapsed < CHUNK_RELOAD_COOLDOWN_MS) {
      console.warn(
        `[lazyWithRetry] Stale chunk recovery reload already attempted ${elapsed}ms ago. Suppressing reload loop.`
      );
      return false;
    }
  }

  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
  } catch {
    // Ignore storage quota or security errors
  }

  console.info('[lazyWithRetry] Stale deployment chunk detected. Performing guarded page reload...');
  if (typeof window.location?.reload === 'function') {
    window.location.reload();
    return true;
  }

  return false;
}

/**
 * Clears the recovery reload timestamp after the application has mounted cleanly,
 * allowing future genuine deployments to auto-recover without impediment.
 */
export function resetStaleChunkRecovery(): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

/**
 * Global listener for Vite preload failures (`vite:preloadError`), which Vite
 * dispatches whenever a preloaded dynamic import fails to load.
 */
export function setupVitePreloadErrorHandler(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('vite:preloadError', (event: any) => {
    console.warn('[vite:preloadError] Caught dynamic import preload failure:', event);
    const didReload = handleStaleChunkRecovery(event?.payload);
    if (didReload && typeof event?.preventDefault === 'function') {
      event.preventDefault();
    }
  });

  // Automatically reset the recovery guard after 10 seconds of stable operation
  setTimeout(() => {
    resetStaleChunkRecovery();
  }, 10000);
}

/**
 * Resilient wrapper around `React.lazy()` that intercepts chunk load failures,
 * performs a guarded one-time page reload for stale deployments, and presents
 * a clear update message if the reload cannot resolve the issue.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err: unknown) {
      if (isChunkLoadError(err)) {
        console.warn('[lazyWithRetry] Intercepted chunk load error:', err);
        const didReload = handleStaleChunkRecovery(err);
        if (didReload) {
          // Keep React in suspense state while the browser completes page reload
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw err;
    }
  });
}
