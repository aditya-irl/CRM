import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints (login, refresh).
 *
 * Limits:
 *   - Production / Development: 20 requests per 15 minutes per IP
 *   - Test: 100 requests per 15 minutes per IP (to avoid breaking integration tests)
 *
 * Returns HTTP 429 with a structured JSON body on breach.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 100 : 20,
  standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers (RFC 6585)
  legacyHeaders: false,    // Disable `X-RateLimit-*` headers
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many authentication attempts. Please try again after 15 minutes.',
    },
    timestamp: new Date().toISOString(),
  },
  handler(req, res, _next, options) {
    res.status(options.statusCode).json(options.message);
  },
  // Use X-Forwarded-For when behind a reverse proxy; falls back to socket address
  keyGenerator(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  },
});

/**
 * Rate limiter for customer portal public endpoint.
 *
 * Limits:
 *   - Production / Development: 30 requests per 15 minutes per IP
 *   - Test: 200 requests per 15 minutes per IP (to allow comprehensive integration tests)
 *
 * Returns HTTP 429 with a structured JSON body on breach.
 */
export const portalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 200 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many portal access attempts. Please try again after 15 minutes.',
    },
    timestamp: new Date().toISOString(),
  },
  handler(req, res, _next, options) {
    res.status(options.statusCode).json(options.message);
  },
  keyGenerator(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  },
});

