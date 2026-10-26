import crypto from 'crypto';
import { Request } from 'express';
import rateLimit, { Options } from 'express-rate-limit';

/**
 * Safely resolves the client IP address.
 * When Express `trust proxy` is configured, `req.ip` securely reflects
 * the client address determined by trusted proxy hops (Render / Vercel),
 * avoiding blind trust in arbitrary, spoofable client-supplied headers.
 */
export function getClientIp(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

/**
 * Extracts the customer portal token from query params, custom headers, or Authorization header.
 */
export function extractPortalToken(req: Request): string | undefined {
  let token = req.query?.token as string | undefined;
  if (!token && typeof req.headers?.['x-portal-token'] === 'string') {
    token = req.headers['x-portal-token'];
  }
  if (!token && req.headers?.authorization && req.headers.authorization.startsWith('Bearer cpt_')) {
    token = req.headers.authorization.slice(7).trim();
  }
  return token?.trim();
}

/**
 * Generates a stable truncated hash of the portal token for compartmentalized rate-limiting.
 * This ensures legitimate customers sharing an IP (corporate Wi-Fi / carrier NAT)
 * do not exhaust each other's quota, while still bounding individual tokens.
 */
export function getPortalTokenHash(req: Request): string {
  const token = extractPortalToken(req);
  if (!token) return 'anonymous';
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

/**
 * Standardized rate limit breach handler that sets RFC 6585 `Retry-After`
 * and returns a structured JSON payload with code `TOO_MANY_REQUESTS`.
 */
function createRateLimitHandler(defaultMessage: string) {
  return (req: any, res: any, _next: any, options: Options) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(options.windowMs / 1000);

    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(options.statusCode).json({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message:
          typeof options.message === 'string'
            ? options.message
            : (options.message as any)?.error?.message || defaultMessage,
        retryAfter: retryAfterSeconds,
      },
      timestamp: new Date().toISOString(),
    });
  };
}

/**
 * Rate limiter for staff authentication endpoints (login, refresh).
 * Limits: 20 requests per 15 minutes per IP (100 in test).
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many authentication attempts. Please try again after 15 minutes.',
    },
    timestamp: new Date().toISOString(),
  },
  handler: createRateLimitHandler('Too many authentication attempts. Please try again after 15 minutes.'),
  keyGenerator(req) {
    return getClientIp(req);
  },
});

/**
 * 1. Portal Read & Refresh Limiter.
 *
 * Dedicated to legitimate viewing, page reloads, tab navigation, and focus events.
 * Limits:
 *   - Production / Development: 120 requests per 15 minutes per IP:token (8 req/min sustained).
 *   - Test: 300 requests per 15 minutes.
 * Keyed by client IP + token hash so distinct customers on shared NAT/Wi-Fi never lock each other out.
 */
export const portalReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 300 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many portal access attempts. Please wait a moment and try again.',
    },
    timestamp: new Date().toISOString(),
  },
  handler: createRateLimitHandler('Too many portal access attempts. Please wait a moment and try again.'),
  keyGenerator(req) {
    return `${getClientIp(req)}:read:${getPortalTokenHash(req)}`;
  },
});

/**
 * 2. Invalid / Expired Token Brute-Force Limiter.
 *
 * Strictly guards against token enumeration / guessing attacks.
 * Uses `skipSuccessfulRequests: true` so requests with VALID tokens (status < 400)
 * NEVER count against this limiter.
 * Limits:
 *   - Production / Development: 15 failed token attempts per 15 minutes per IP.
 *   - Test: 100 failed token attempts per 15 minutes per IP.
 */
export const portalInvalidTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100 : 15,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many invalid portal access attempts. Please try again after 15 minutes.',
    },
    timestamp: new Date().toISOString(),
  },
  handler: createRateLimitHandler('Too many invalid portal access attempts. Please try again after 15 minutes.'),
  keyGenerator(req) {
    return `${getClientIp(req)}:invalid_token`;
  },
});

/**
 * 3. Sensitive Payment Order Creation Limiter.
 *
 * Protects against rapid session spam while permitting legitimate checkout attempts.
 * Limits:
 *   - Production / Development: 15 order creation attempts per 15 minutes per IP:token.
 *   - Test: 50 order creation attempts per 15 minutes.
 */
export const portalPaymentOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 50 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many payment order attempts. Please wait a few minutes before trying again.',
    },
    timestamp: new Date().toISOString(),
  },
  handler: createRateLimitHandler('Too many payment order attempts. Please wait a few minutes before trying again.'),
  keyGenerator(req) {
    return `${getClientIp(req)}:order:${getPortalTokenHash(req)}`;
  },
});

/**
 * 4. Sensitive Payment Verification Limiter.
 *
 * Accommodates checkout redirect returns, network hiccups, and short polling verification.
 * Limits:
 *   - Production / Development: 60 verification attempts per 15 minutes per IP:token.
 *   - Test: 150 verification attempts per 15 minutes.
 */
export const portalPaymentVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 150 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many payment verification attempts. Please wait a moment and try again.',
    },
    timestamp: new Date().toISOString(),
  },
  handler: createRateLimitHandler('Too many payment verification attempts. Please wait a moment and try again.'),
  keyGenerator(req) {
    return `${getClientIp(req)}:verify:${getPortalTokenHash(req)}`;
  },
});

/**
 * Backward compatibility alias for any existing imports.
 */
export const portalRateLimiter = portalReadLimiter;
