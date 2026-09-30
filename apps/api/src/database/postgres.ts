import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env';

let pgPool: Pool | null = null;

/**
 * Normalizes a PostgreSQL connection string by replacing deprecated sslmode aliases
 * ('prefer', 'require', 'verify-ca') with the explicit 'verify-full' equivalent.
 *
 * This prevents the node-postgres / pg-connection-string v2 security deprecation warning:
 *   "The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for
 *    'verify-full'. In pg v9.0.0 these will adopt standard libpq semantics."
 *
 * The substitution preserves identical TLS behavior: pg currently treats all three
 * as 'verify-full' (rejectUnauthorized: true), so replacing them is a no-op for
 * actual connectivity and certificate verification.
 *
 * Safe for:
 *   - Neon production URLs (postgresql://...?sslmode=require)
 *   - Local dev with sslmode=disable or no sslmode param (left unchanged)
 *   - DATABASE_SSL=no-verify paths (sslmode=no-verify is not a deprecated alias)
 */
export function normalizeConnectionString(connStr?: string): string {
  if (!connStr || typeof connStr !== 'string') return connStr ?? '';
  try {
    const url = new URL(connStr);
    const mode = url.searchParams.get('sslmode');
    if (mode === 'require' || mode === 'prefer' || mode === 'verify-ca') {
      url.searchParams.set('sslmode', 'verify-full');
      return url.toString();
    }
    return connStr;
  } catch {
    // Fallback for non-URL-parseable connection strings (key=value format)
    return connStr.replace(
      /([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/g,
      '$1verify-full'
    );
  }
}

/**
 * Build PostgreSQL SSL configuration from DATABASE_SSL env var.
 *   'true'      → SSL with full certificate verification
 *   'no-verify' → SSL without certificate verification (some managed providers)
 *   'false'     → no SSL (local / docker / test)
 */
export function buildSslConfig(sslMode?: string): object | boolean | undefined {
  const mode = sslMode ?? env.DATABASE_SSL;
  switch (mode) {
    case 'true':
      return { rejectUnauthorized: true };
    case 'no-verify':
      return { rejectUnauthorized: false };
    case 'false':
    default:
      return undefined; // No SSL
  }
}

export interface EffectiveDbConfig {
  connectionString: string;
  databaseName: string;
  isTest: boolean;
}

export interface ResolveDbConfigOptions {
  nodeEnv?: string;
  databaseUrl?: string;
  databaseUrlTest?: string;
}

/**
 * Extracts database name from standard postgres connection URL.
 * Examples:
 *   postgresql://user:pass@localhost:5432/crm_db -> 'crm_db'
 *   postgresql://user:pass@localhost:5432/crm_test_db?sslmode=disable -> 'crm_test_db'
 */
export function extractDatabaseName(connectionString?: string): string | null {
  if (!connectionString || typeof connectionString !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(connectionString);
    const dbName = parsed.pathname.replace(/^\/+/, '').split('?')[0].trim();
    return dbName || null;
  } catch {
    const match = connectionString.match(/(?:\/)([a-zA-Z0-9_\-]+)(?:\?|$)/);
    return match ? match[1] : null;
  }
}

/**
 * Resolves the active database configuration and enforces strict test-database isolation.
 *
 * Rules:
 * 1. In 'production':
 *    - MUST ALWAYS use DATABASE_URL.
 *    - MUST NEVER use DATABASE_URL_TEST.
 * 2. In 'test' (NODE_ENV=test):
 *    - MUST use DATABASE_URL_TEST.
 *    - MUST NEVER use normal DATABASE_URL.
 *    - SAFETY GUARD: If DATABASE_URL_TEST is missing, throw fatal error immediately.
 *    - SAFETY GUARD: If DATABASE_URL_TEST points to 'crm_db' or matches DATABASE_URL, reject immediately.
 *    - SAFETY GUARD: If database name does not indicate a test DB (e.g. must contain 'test'), reject immediately.
 * 3. In 'development' / default:
 *    - Uses DATABASE_URL. DATABASE_URL_TEST is ignored.
 */
export function getEffectiveDatabaseConfig(options?: ResolveDbConfigOptions): EffectiveDbConfig {
  const currentEnv =
    options && 'nodeEnv' in options ? options.nodeEnv : (process.env.NODE_ENV ?? env.NODE_ENV);
  const devUrl =
    options && 'databaseUrl' in options ? options.databaseUrl : (process.env.DATABASE_URL ?? env.DATABASE_URL);
  const testUrl =
    options && 'databaseUrlTest' in options
      ? options.databaseUrlTest
      : (process.env.DATABASE_URL_TEST ?? env.DATABASE_URL_TEST);

  // 1. Production Mode: strictly uses DATABASE_URL, ignores DATABASE_URL_TEST
  if (currentEnv === 'production') {
    if (!devUrl) {
      throw new Error('[Database Config] DATABASE_URL is required in production.');
    }
    const normalizedUrl = normalizeConnectionString(devUrl);
    return {
      connectionString: normalizedUrl,
      databaseName: extractDatabaseName(normalizedUrl) || '',
      isTest: false,
    };
  }

  // 2. Test Mode: strictly enforces DATABASE_URL_TEST isolation and safety guards
  if (currentEnv === 'test') {
    // Safety Guard Check A: DATABASE_URL_TEST must be defined and non-empty
    if (!testUrl || testUrl.trim() === '') {
      throw new Error(
        '[FATAL TEST DB SAFETY GUARD] NODE_ENV is set to "test", but DATABASE_URL_TEST is missing. ' +
        'Automated tests MUST use a dedicated test database and are strictly prohibited from connecting to ' +
        'the development or production database. Please configure DATABASE_URL_TEST in .env.'
      );
    }

    const testDbName = extractDatabaseName(testUrl);
    const devDbName = extractDatabaseName(devUrl);

    // Safety Guard Check B: Target database must not be the normal development database 'crm_db'
    if (testDbName === 'crm_db') {
      throw new Error(
        '[FATAL TEST DB SAFETY GUARD] DATABASE_URL_TEST points directly to the normal development database ("crm_db"). ' +
        'Automated tests are strictly rejected to prevent modifying or polluting development data. ' +
        'Please point DATABASE_URL_TEST to a dedicated test database (e.g. crm_test_db).'
      );
    }

    // Safety Guard Check C: testUrl must not be identical to devUrl
    if (devUrl && testUrl === devUrl) {
      throw new Error(
        '[FATAL TEST DB SAFETY GUARD] DATABASE_URL_TEST is identical to normal DATABASE_URL. ' +
        'Automated tests MUST NOT run against the development/primary database. ' +
        'Please configure DATABASE_URL_TEST with a distinct test database.'
      );
    }

    // Safety Guard Check D: testDbName must not match devDbName
    if (devDbName && testDbName && devDbName === testDbName) {
      throw new Error(
        `[FATAL TEST DB SAFETY GUARD] DATABASE_URL_TEST database ("${testDbName}") matches the primary database in DATABASE_URL. ` +
        'Automated tests MUST NOT run against the development/primary database. ' +
        'Please configure DATABASE_URL_TEST with a distinct test database (e.g. crm_test_db).'
      );
    }

    // Safety Guard Check E: Database name must clearly identify as a test database (e.g. contain 'test')
    if (!testDbName || !testDbName.toLowerCase().includes('test')) {
      throw new Error(
        `[FATAL TEST DB SAFETY GUARD] DATABASE_URL_TEST database name ("${testDbName || 'unknown'}") is not clearly identified as a test database. ` +
        'The database name must contain "test" (e.g. "crm_test_db").'
      );
    }

    const normalizedTestUrl = normalizeConnectionString(testUrl);
    return {
      connectionString: normalizedTestUrl,
      databaseName: testDbName,
      isTest: true,
    };
  }

  // 3. Normal Development Mode (or any non-test environment)
  if (!devUrl) {
    throw new Error('DATABASE_URL is not defined in environment configuration');
  }

  const normalizedDevUrl = normalizeConnectionString(devUrl);
  return {
    connectionString: normalizedDevUrl,
    databaseName: extractDatabaseName(normalizedDevUrl) || '',
    isTest: false,
  };
}

export function getPostgresPool(): Pool {
  if (!pgPool) {
    const config = getEffectiveDatabaseConfig();

    pgPool = new Pool({
      connectionString: config.connectionString,
      max: 20, // Max 20 concurrent connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: buildSslConfig(),
    });

    pgPool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]', err);
    });
  }

  return pgPool;
}

export async function closePostgresPool(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}

export async function queryPostgres<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  const pool = getPostgresPool();
  const start = Date.now();
  const res = await pool.query<R>(text, params);
  const duration = Date.now() - start;
  if (env.NODE_ENV === 'development' && duration > 50) {
    console.warn(`[Slow Query ${duration}ms]: ${text.slice(0, 100)}`);
  }
  return res;
}

export async function runPostgresTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
