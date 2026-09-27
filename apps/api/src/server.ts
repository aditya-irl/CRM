import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import app from './app';
import { initDatabase } from './database/db';
import { seedDatabase } from './database/seed';
import { closePostgresPool } from './database/postgres';
import { closeRedisConnection } from './core/redis';
import { closeAllQueues } from './core/queue';
import { BackgroundScheduler } from './jobs/scheduler';

import { env } from './config/env';

const PORT = env.PORT || 4000;

// ─── Startup ─────────────────────────────────────────────────────────────────

// Initialize database schema and seed initial demo data ONLY when using SQLite driver
if (env.DATABASE_DRIVER === 'sqlite') {
  initDatabase();
  seedDatabase();
}

const httpServer = http.createServer(app);

httpServer.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Finance & EMI Collection CRM API is running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🩺 Health: http://localhost:${PORT}/health`);
  console.log(`====================================================`);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

/**
 * Cleanly close all server resources in order:
 *   1. Stop accepting new HTTP connections.
 *   2. Wait for in-flight requests to finish (or timeout).
 *   3. Close PostgreSQL pool.
 *   4. Close Redis connection.
 *   5. Close BullMQ queues.
 *   6. Exit with the provided code.
 *
 * A forced exit fires after SHUTDOWN_TIMEOUT_MS to prevent hanging indefinitely.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  // Force-exit after timeout to prevent indefinite hang
  const forcedExit = setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forcedExit.unref(); // Don't let this timer keep the event loop alive

  try {
    // 1. Stop accepting new HTTP requests
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    console.log('[Server] HTTP server closed.');

    // 2. Stop any active background workers
    await BackgroundScheduler.stopWorkers();
    console.log('[Server] Background workers stopped.');

    // 3. Close BullMQ queues while Redis is still open
    await closeAllQueues();
    console.log('[Server] BullMQ queues closed.');

    // 4. Close Redis connection
    await closeRedisConnection();
    console.log('[Server] Redis connection closed.');

    // 5. Close PostgreSQL pool
    await closePostgresPool();
    console.log('[Server] PostgreSQL pool closed.');

    console.log('[Server] Graceful shutdown complete.');
    clearTimeout(forcedExit);
    process.exit(exitCode);
  } catch (err) {
    // Log server-side only — do not expose internal details to callers
    console.error('[Server] Error during graceful shutdown:', (err as Error).message);
    clearTimeout(forcedExit);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT',  () => shutdown('SIGINT',  0));

// ─── Process-Level Safety ─────────────────────────────────────────────────────

/**
 * Catch unhandled promise rejections.
 * Logs the error server-side and triggers graceful shutdown (exit 1).
 * Does NOT expose internals to HTTP clients — the existing errorHandler handles that.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Promise Rejection:', reason);
  shutdown('unhandledRejection', 1);
});

/**
 * Catch uncaught synchronous exceptions.
 * Logs the error server-side and triggers graceful shutdown (exit 1).
 */
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
  shutdown('uncaughtException', 1);
});
