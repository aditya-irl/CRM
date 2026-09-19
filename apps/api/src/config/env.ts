import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from root or local app dir
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  
  // Database Configuration
  DATABASE_DRIVER: z.enum(['postgres', 'sqlite']).default('sqlite'),
  DATABASE_URL: z.string().optional(),
  DATABASE_FILE: z.string().optional(),
  
  // Redis Configuration
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  
  // JWT Configuration
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long').default('crm_production_super_secret_jwt_key_2026_finance'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters long').default('crm_production_super_secret_refresh_key_2026_finance'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  
  // Storage & KYC Vault Configuration
  STORAGE_PROVIDER: z.enum(['s3', 'local']).default('local'),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().default('crm-kyc-vault-private'),
  AWS_S3_ENDPOINT: z.string().optional(), // For Cloudflare R2 or MinIO
  
  // Timezone & Localization
  BUSINESS_TIMEZONE: z.string().default('Asia/Kolkata'),
  
  // Logging & CORS
  CORS_ORIGIN: z.string().default('*'),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (data.DATABASE_DRIVER === 'postgres' && !data.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required in production when using PostgreSQL',
      });
    }
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
