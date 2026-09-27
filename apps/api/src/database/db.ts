import type Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let DatabaseConstructor: typeof Database | null = null;
try {
  DatabaseConstructor = require('better-sqlite3');
} catch {
  DatabaseConstructor = null;
}

let sqliteDbInstance: Database.Database | null = null;

export function getSqliteDatabase(): Database.Database {
  if (!DatabaseConstructor) {
    throw new Error(
      'better-sqlite3 is not available in this environment. Production uses PostgreSQL (DATABASE_DRIVER=postgres). For local SQLite development, ensure optional dependency better-sqlite3 is installed.'
    );
  }

  if (!sqliteDbInstance) {
    const DB_PATH = process.env.DATABASE_FILE || path.join(__dirname, '../../../data/crm.db');
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    sqliteDbInstance = new DatabaseConstructor(DB_PATH);
    sqliteDbInstance.pragma('journal_mode = WAL');
    sqliteDbInstance.pragma('foreign_keys = ON');
  }

  return sqliteDbInstance;
}

export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const instance = getSqliteDatabase();
    const val = (instance as any)[prop];
    return typeof val === 'function' ? val.bind(instance) : val;
  },
});

export function initDatabase() {
  let schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(__dirname, '../src/database/schema.sql');
  }
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(process.cwd(), 'src/database/schema.sql');
  }
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Ensure dealer_id column exists in existing SQLite loans table if it was created previously
  try {
    const tableInfo = db.pragma('table_info(loans)') as Array<{ name: string }>;
    if (tableInfo && tableInfo.length > 0) {
      const hasDealerId = tableInfo.some((col) => col.name === 'dealer_id');
      if (!hasDealerId) {
        db.exec('ALTER TABLE loans ADD COLUMN dealer_id TEXT REFERENCES dealers(id);');
      }
    }
  } catch (err) {
    // Ignore if table doesn't exist yet
  }

  // Ensure collection_source, dealer_id, and agent_id columns exist in SQLite payments table
  try {
    const payTableInfo = db.pragma('table_info(payments)') as Array<{ name: string }>;
    if (payTableInfo && payTableInfo.length > 0) {
      const colNames = payTableInfo.map((c) => c.name);
      if (!colNames.includes('collection_source')) {
        db.exec("ALTER TABLE payments ADD COLUMN collection_source TEXT NOT NULL DEFAULT 'DIRECT_CUSTOMER';");
      }
      if (!colNames.includes('dealer_id')) {
        db.exec('ALTER TABLE payments ADD COLUMN dealer_id TEXT REFERENCES dealers(id);');
      }
      if (!colNames.includes('agent_id')) {
        db.exec('ALTER TABLE payments ADD COLUMN agent_id TEXT REFERENCES users(id);');
      }
    }
  } catch (err) {
    // Ignore if table doesn't exist yet
  }

  db.exec(schemaSql);
}

/**
 * Run operations inside an atomic transaction with automatic rollback on error.
 */
export function runTransaction<T>(fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}

export default db;
