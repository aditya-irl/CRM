import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_FILE || path.join(__dirname, '../../../data/crm.db');

// Ensure parent data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(DB_PATH);

// Enable WAL mode for high performance and concurrency; enable Foreign Key constraints
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize database tables and indexes from schema.sql
 */
export function initDatabase() {
  let schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(__dirname, '../src/database/schema.sql');
  }
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(process.cwd(), 'src/database/schema.sql');
  }
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
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
