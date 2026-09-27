import dotenv from 'dotenv';
dotenv.config();

import { env } from './config/env';
import { getPostgresPool, closePostgresPool } from './database/postgres';
import { getRedisClient, closeRedisConnection } from './core/redis';
import { closeAllQueues } from './core/queue';
import { BackgroundScheduler } from './jobs/scheduler';
import { initDatabase } from './database/db';
import { seedDatabase } from './database/seed';

let isStarting = false;
let isStarted = false;

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Graceful shutdown for the background worker process.
 * Shutdown order:
 *   1. Stop BullMQ workers and background maintenance timers.
 *   2. Close BullMQ queues (while Redis is still connected).
 *   3. Close shared Redis connection.
 *   4. Close PostgreSQL pool.
 *   5. Exit cleanly.
 */
export async function stopWorkerProcess(signal: string, exitCode = 0): Promise<void> {
  console.log(`\n[Worker] Received ${signal}. Starting graceful shutdown...`);

  const forcedExit = setTimeout(() => {
    console.error('[Worker] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forcedExit.unref();

  try {
    // 1. Stop background workers and timers
    await BackgroundScheduler.stopWorkers();
    console.log('[Worker] Background workers and schedulers stopped.');

    // 2. Close BullMQ queues before closing Redis connection
    await closeAllQueues();
    console.log('[Worker] BullMQ queues closed.');

    // 3. Close shared Redis connection
    await closeRedisConnection();
    console.log('[Worker] Redis connection closed.');

    // 4. Close PostgreSQL pool
    await closePostgresPool();
    console.log('[Worker] PostgreSQL pool closed.');

    console.log('[Worker] Graceful shutdown complete.');
    isStarted = false;
    clearTimeout(forcedExit);
    process.exit(exitCode);
  } catch (err) {
    console.error('[Worker] Error during graceful shutdown:', (err as Error).message);
    clearTimeout(forcedExit);
    process.exit(1);
  }
}

/**
 * Start the standalone background worker process.
 * Guards against duplicate startup if invoked or imported more than once.
 */
export async function startWorkerProcess(): Promise<void> {
  if (isStarted || isStarting) {
    console.warn('[Worker] Worker process is already running or starting. Skipping duplicate startup.');
    return;
  }

  isStarting = true;

  try {
    console.log(`====================================================`);
    console.log(`👷 Finance & EMI Collection CRM Background Worker`);
    console.log(`🌍 Environment: ${env.NODE_ENV}`);
    console.log(`⏱️ Business Timezone: ${env.BUSINESS_TIMEZONE}`);
    console.log(`====================================================`);

    // 1. Initialize DB if SQLite fallback in dev
    if (env.DATABASE_DRIVER === 'sqlite') {
      initDatabase();
      seedDatabase();
    }

    // 2. Verify database connection
    getPostgresPool();
    console.log('[Worker] PostgreSQL connection initialized.');

    // 3. Verify Redis connection
    getRedisClient();
    console.log('[Worker] Redis connection initialized.');

    // 4. Start BullMQ workers
    BackgroundScheduler.startWorkers();

    // 5. Start periodic maintenance scheduler
    BackgroundScheduler.startMaintenanceScheduler();

    isStarted = true;
    isStarting = false;
    console.log('🚀 [Worker] All background workers & schedulers started successfully. Waiting for jobs...');
  } catch (err: any) {
    isStarting = false;
    console.error('[Worker] Fatal startup error:', err.message);
    await stopWorkerProcess('STARTUP_FAILURE', 1);
  }
}

// Attach process signals only when executed directly as entry point
if (require.main === module) {
  process.on('SIGTERM', () => stopWorkerProcess('SIGTERM', 0));
  process.on('SIGINT', () => stopWorkerProcess('SIGINT', 0));

  process.on('unhandledRejection', (reason) => {
    console.error('[Worker] Unhandled Promise Rejection:', reason);
    stopWorkerProcess('unhandledRejection', 1);
  });

  process.on('uncaughtException', (err) => {
    console.error('[Worker] Uncaught Exception:', err.message);
    stopWorkerProcess('uncaughtException', 1);
  });

  startWorkerProcess().catch((err) => {
    console.error('[Worker] Fatal startup rejection:', err);
    process.exit(1);
  });
}
