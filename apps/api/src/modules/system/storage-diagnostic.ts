import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getStorageProvider } from '../../core/storage';
import { env } from '../../config/env';

let isDiagnosticRunning = false;
const DIAGNOSTIC_TIMEOUT_MS = 15000;
const CLEANUP_TIMEOUT_MS = 5000;

/**
 * Gate middleware: When the feature flag is disabled, return 404 immediately
 * so the endpoint is completely hidden/unexposed publicly.
 */
export function storageDiagnosticGate(_req: Request, res: Response, next: NextFunction) {
  const isEnabled = env.ENABLE_STORAGE_DIAGNOSTIC === 'true' || process.env.ENABLE_STORAGE_DIAGNOSTIC === 'true';
  if (!isEnabled) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Not found' },
    });
  }
  next();
}

/**
 * Sanitizes any message so storage credentials, secrets, AWS keys, or internal endpoints
 * are never leaked to callers or logs.
 */
function sanitizeMessage(msg: string | null | undefined): string {
  if (!msg) return '';
  return msg
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/[A-Za-z0-9+/]{40}/g, '[REDACTED_SECRET]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_KEY]')
    .replace(/[a-zA-Z0-9_\-.]+@backblazeb2\.com/gi, '[REDACTED_ENDPOINT]');
}

/**
 * Isolated production storage diagnostic controller.
 *
 * SAFETY INVARIANTS:
 * 1. Requires SUPER_ADMIN role & active DB user.
 * 2. Requires ENABLE_STORAGE_DIAGNOSTIC=true.
 * 3. Never touches customer, loan, payment, or audit database records.
 * 4. Only operates on unique server-generated keys under _diagnostics/.
 * 5. Deterministic upload -> readback -> SHA-256 match -> delete -> verified absent.
 * 6. Concurrency guard and active AbortController timeout.
 * 7. Never leaves background dangling operations: timeout cancels in-flight network requests.
 * 8. Never claims cleanup succeeded unless existsAfterDelete is strictly verified as false.
 */
export async function runStorageDiagnostic(_req: Request, res: Response, _next: NextFunction) {
  // Concurrency guard
  if (isDiagnosticRunning) {
    return res.status(429).json({
      success: false,
      error: { code: 'CONCURRENT_DIAGNOSTIC_RUNNING', message: 'A storage diagnostic is already in progress. Please wait.' },
    });
  }

  isDiagnosticRunning = true;

  const abortController = new AbortController();
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    abortController.abort(new Error('Storage diagnostic timed out after 15 seconds'));
  }, DIAGNOSTIC_TIMEOUT_MS);
  timeoutTimer.unref?.();

  const storage = getStorageProvider();
  const nonce = crypto.randomBytes(8).toString('hex');
  const diagnosticKey = `_diagnostics/live_ping_${Date.now()}_${nonce}.bin`;

  // 512-byte deterministic synthetic payload
  const payload = Buffer.concat([
    Buffer.from(`CRM_STORAGE_PROD_DIAGNOSTIC_${Date.now()}_${nonce}\n`, 'utf8'),
    crypto.randomBytes(450),
  ]);
  const expectedByteLength = payload.length;
  const expectedSha256 = crypto.createHash('sha256').update(payload).digest('hex');

  let uploadAttempted = false;
  let primaryError: any = null;
  let existsAfterUpload = false;
  let downloadedByteLength = 0;
  let downloadedSha256 = '';
  let cleanupAttempted = false;
  let existsAfterDelete: boolean | null = null;
  let cleanupError: any = null;

  try {
    // 1. Upload with abortSignal
    uploadAttempted = true;
    await storage.upload(
      {
        key: diagnosticKey,
        body: payload,
        mimeType: 'application/octet-stream',
        isPrivate: true,
      },
      { abortSignal: abortController.signal }
    );

    // 2. Verify existence with abortSignal
    existsAfterUpload = await storage.exists(diagnosticKey, { abortSignal: abortController.signal });
    if (!existsAfterUpload) {
      throw new Error('Object was uploaded but exists() returned false');
    }

    // 3. Read back stream & verify checksum
    if (typeof storage.getStream !== 'function') {
      throw new Error('Storage provider does not support direct read stream');
    }
    const { stream, contentLength } = await storage.getStream(diagnosticKey, { abortSignal: abortController.signal });

    // Ensure stream is destroyed if aborted
    if (abortController.signal.aborted) {
      (stream as any).destroy?.();
    } else {
      abortController.signal.addEventListener('abort', () => (stream as any).destroy?.(), { once: true });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const downloadedBytes = Buffer.concat(chunks);
    downloadedByteLength = downloadedBytes.length;
    downloadedSha256 = crypto.createHash('sha256').update(downloadedBytes).digest('hex');

    if (contentLength && contentLength !== expectedByteLength) {
      throw new Error(`Content-Length mismatch: expected ${expectedByteLength}, got ${contentLength}`);
    }
    if (downloadedByteLength !== expectedByteLength) {
      throw new Error(`Byte length mismatch: expected ${expectedByteLength}, got ${downloadedByteLength}`);
    }
    if (downloadedSha256 !== expectedSha256) {
      throw new Error(`SHA-256 checksum mismatch: expected ${expectedSha256}, got ${downloadedSha256}`);
    }
  } catch (err: any) {
    primaryError = err;
  } finally {
    clearTimeout(timeoutTimer);

    // 4. Guaranteed cleanup in finally block using a dedicated fresh un-aborted signal
    if (uploadAttempted) {
      cleanupAttempted = true;
      const cleanupAbort = new AbortController();
      const cleanupTimer = setTimeout(() => cleanupAbort.abort(), CLEANUP_TIMEOUT_MS);
      cleanupTimer.unref?.();

      try {
        await storage.delete(diagnosticKey, { abortSignal: cleanupAbort.signal });
        existsAfterDelete = await storage.exists(diagnosticKey, { abortSignal: cleanupAbort.signal });
      } catch (delErr: any) {
        cleanupError = delErr;
        try {
          existsAfterDelete = await storage.exists(diagnosticKey, { abortSignal: cleanupAbort.signal });
        } catch {}
      } finally {
        clearTimeout(cleanupTimer);
      }
    }

    isDiagnosticRunning = false;
  }

  // Never claim cleanup succeeded unless deletion was verified (strictly existsAfterDelete === false)
  const isCleanedUp = existsAfterDelete === false;

  // Handle Timeout
  if (timedOut || primaryError?.name === 'AbortError' || primaryError?.message?.includes('timed out')) {
    return res.status(504).json({
      success: false,
      diagnostic: 'DIAGNOSTIC_TIMEOUT',
      error: {
        code: 'DIAGNOSTIC_TIMEOUT',
        message: 'Storage diagnostic timed out after 15 seconds',
        step: !uploadAttempted
          ? 'UPLOAD_NOT_ATTEMPTED'
          : !existsAfterUpload
          ? 'UPLOAD_IN_PROGRESS_OR_EXISTENCE_FAILED'
          : 'READBACK_IN_PROGRESS',
      },
      cleanup: {
        attempted: cleanupAttempted,
        cleanedUp: isCleanedUp,
        diagnosticKeyPrefix: '_diagnostics/',
        residualObject: isCleanedUp ? null : diagnosticKey,
        cleanupError: cleanupError ? sanitizeMessage(cleanupError.message) : null,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Handle Execution Failure
  if (primaryError) {
    return res.status(502).json({
      success: false,
      diagnostic: 'STORAGE_PIPELINE_FAILED',
      error: {
        message: sanitizeMessage(primaryError.message) || 'Diagnostic execution failed',
        step: !uploadAttempted ? 'UPLOAD_NOT_ATTEMPTED' : !existsAfterUpload ? 'EXISTENCE_CHECK_FAILED' : 'READBACK_FAILED',
      },
      cleanup: {
        attempted: cleanupAttempted,
        cleanedUp: isCleanedUp,
        diagnosticKeyPrefix: '_diagnostics/',
        residualObject: isCleanedUp ? null : diagnosticKey,
        cleanupError: cleanupError ? sanitizeMessage(cleanupError.message) : null,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Handle Cleanup Failure
  if (!isCleanedUp) {
    return res.status(500).json({
      success: false,
      diagnostic: 'STORAGE_VERIFIED_BUT_CLEANUP_FAILED',
      error: {
        message: 'Storage upload and readback succeeded, but diagnostic object cleanup could not be verified.',
      },
      cleanup: {
        attempted: cleanupAttempted,
        cleanedUp: false,
        diagnosticKeyPrefix: '_diagnostics/',
        residualObject: diagnosticKey,
        cleanupError: cleanupError ? sanitizeMessage(cleanupError.message) : 'Object still present after delete',
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Succeeded & Cleaned up
  return res.status(200).json({
    success: true,
    diagnostic: 'STORAGE_PIPELINE_VERIFIED',
    details: {
      keyPrefix: '_diagnostics/',
      bytesUploaded: expectedByteLength,
      bytesDownloaded: downloadedByteLength,
      checksumVerified: true,
      objectDeleted: true,
    },
    timestamp: new Date().toISOString(),
  });
}
