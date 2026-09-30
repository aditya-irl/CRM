import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env';

let pgPool: Pool | null = null;

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
    return {
      connectionString: devUrl,
      databaseName: extractDatabaseName(devUrl) || '',
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

    return {
      connectionString: testUrl,
      databaseName: testDbName,
      isTest: true,
    };
  }

  // 3. Normal Development Mode (or any non-test environment)
  if (!devUrl) {
    throw new Error('DATABASE_URL is not defined in environment configuration');
  }

  return {
    connectionString: devUrl,
    databaseName: extractDatabaseName(devUrl) || '',
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
