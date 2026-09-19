import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { env } from '../config/env';

export async function runPostgresMigrations(connectionString?: string) {
  const connStr = connectionString || env.DATABASE_URL;
  if (!connStr) {
    console.warn('[Postgres Migrations] No DATABASE_URL provided. Skipping PostgreSQL migration.');
    return { applied: [], skipped: true };
  }

  console.log('[Postgres Migrations] Connecting to PostgreSQL database...');
  const pool = new Pool({ connectionString: connStr });
  const client = await pool.connect();

  try {
    // 1. Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Discover migration files
    let migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      migrationsDir = path.join(__dirname, '../src/database/migrations');
    }
    if (!fs.existsSync(migrationsDir)) {
      migrationsDir = path.join(process.cwd(), 'src/database/migrations');
    }

    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found at: ${migrationsDir}`);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliedRow = await client.query('SELECT name FROM _migrations');
    const appliedSet = new Set(appliedRow.rows.map((r) => r.name));

    const appliedList: string[] = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      console.log(`[Postgres Migrations] Applying migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedList.push(file);
        console.log(`[Postgres Migrations] Successfully applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[Postgres Migrations] Error executing migration ${file}:`, err);
        throw err;
      }
    }

    console.log(`[Postgres Migrations] Migration run complete. ${appliedList.length} new migrations applied.`);
    return { applied: appliedList, skipped: false };
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runPostgresMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Postgres Migrations Failed]', err);
      process.exit(1);
    });
}
