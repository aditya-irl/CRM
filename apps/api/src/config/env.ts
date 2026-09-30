import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from root or local app dir
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Database Configuration
  DATABASE_DRIVER: z.enum(['postgres', 'sqlite']).default('sqlite'),
  DATABASE_URL: z.string().optional(),
  DATABASE_URL_TEST: z.string().optional(),
  DATABASE_FILE: z.string().optional(),
  // SSL mode for PostgreSQL connections:
  //   'true'      → require SSL with full certificate verification (recommended for production)
  //   'no-verify' → require SSL but skip certificate verification (some managed providers)
  //   'false'     → no SSL (local / docker dev/test only)
  DATABASE_SSL: z.enum(['true', 'no-verify', 'false']).default('false'),

  // Redis Configuration
  // No localhost default — production requires an explicit REDIS_URL.
  // Dev/test falls back to localhost only when the value is explicitly set in .env.
  REDIS_URL: z.string().optional(),

  // JWT Configuration — no in-source defaults; required in production via superRefine
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long').optional(),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters long').optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Storage & KYC Vault Configuration
  STORAGE_PROVIDER: z.enum(['s3', 'local']).optional(),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().default('crm-kyc-vault-private'),
  AWS_S3_ENDPOINT: z.string().optional(), // For Cloudflare R2 or MinIO

  // Timezone & Localization
  BUSINESS_TIMEZONE: z.string().default('Asia/Kolkata'),

  // Customer Portal Base URL (for generated customer payment links)
  PORTAL_BASE_URL: z.string().optional(),

  // Google Sheets Export Configuration (Task 9)
  GOOGLE_SHEETS_ENABLED: z.string().default('false'),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),

  // CORS — must be explicitly set to '*' or a domain list; empty = locked down
  CORS_ORIGIN: z.string().default(''),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    // Blocker 2: Force PostgreSQL in production
    if (data.DATABASE_DRIVER !== 'postgres') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_DRIVER'],
        message: 'DATABASE_DRIVER must be "postgres" in production. SQLite is not supported in production.',
      });
    }
    if (!data.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required in production.',
      });
    }

    // Blocker 3: Require JWT secrets in production — no in-source fallbacks allowed
    if (!data.JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET is required in production. Set a cryptographically secure value (min 32 chars recommended).',
      });
    }
    if (!data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET is required in production. Set a cryptographically secure value (min 32 chars recommended).',
      });
    }

    // Production Redis enforcement — no silent localhost fallback
    if (!data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required in production. Set a managed Redis URL (e.g. rediss://:<password>@host:6380).',
      });
    }

    // Production Storage Provider enforcement: must explicitly equal "s3"
    if (!data.STORAGE_PROVIDER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PROVIDER'],
        message: 'STORAGE_PROVIDER is required in production and must explicitly equal "s3".',
      });
    } else if (data.STORAGE_PROVIDER !== 's3') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PROVIDER'],
        message: 'STORAGE_PROVIDER must explicitly equal "s3" in production. Local storage is not permitted in production.',
      });
    }

    // S3 storage credentials
    if (data.STORAGE_PROVIDER === 's3') {
      if (!data.AWS_ACCESS_KEY_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AWS_ACCESS_KEY_ID'],
          message: 'AWS_ACCESS_KEY_ID is required in production when STORAGE_PROVIDER=s3',
        });
      }
      if (!data.AWS_SECRET_ACCESS_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AWS_SECRET_ACCESS_KEY'],
          message: 'AWS_SECRET_ACCESS_KEY is required in production when STORAGE_PROVIDER=s3',
        });
      }
    }

    // Production Customer Portal Base URL enforcement
    if (!data.PORTAL_BASE_URL || data.PORTAL_BASE_URL.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PORTAL_BASE_URL'],
        message: 'PORTAL_BASE_URL is required in production. Set a valid absolute HTTP or HTTPS URL (e.g. https://crm.yourcompany.com/portal).',
      });
    } else {
      try {
        const parsedUrl = new URL(data.PORTAL_BASE_URL);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['PORTAL_BASE_URL'],
            message: 'PORTAL_BASE_URL must be a valid absolute HTTP or HTTPS URL in production.',
          });
        }
        if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['PORTAL_BASE_URL'],
            message: 'PORTAL_BASE_URL cannot use localhost or 127.0.0.1 in production.',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PORTAL_BASE_URL'],
          message: 'PORTAL_BASE_URL must be a valid absolute HTTP or HTTPS URL in production.',
        });
      }
    }
  } else {
    // Non-production (development & test) defaults
    if (!data.STORAGE_PROVIDER) {
      data.STORAGE_PROVIDER = 'local';
    }
    if (!data.PORTAL_BASE_URL || data.PORTAL_BASE_URL.trim() === '') {
      data.PORTAL_BASE_URL = 'http://localhost:5173/portal';
    }
  }
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadAndValidateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ [FATAL] Environment Configuration Validation Failed:');
    result.error.issues.forEach((issue) => {
      console.error(`  - Field "${issue.path.join('.')}": ${issue.message}`);
    });
    // In production or test with invalid config, fail fast
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid environment configuration');
    }
    // In development, throw to ensure errors are not hidden
    throw new Error(`Environment validation failed: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

export const env = loadAndValidateEnv();
