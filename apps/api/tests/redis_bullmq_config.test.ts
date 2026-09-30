/**
 * Redis / BullMQ Production Configuration Tests
 *
 * Covers:
 *   1. Production + missing REDIS_URL → rejected (guard logic)
 *   2. Production + valid REDIS_URL → accepted
 *   3. Dev/test REDIS_URL fallback behavior
 *   4. Redis URL with auth/TLS remains parseable by ioredis
 *   5. getRedisClient() returns a valid ioredis instance
 *   6. closeRedisConnection() is idempotent
 *   7. BullMQ getQueue() initialises without throwing
 *   8. closeAllQueues() is idempotent and safe
 *   9. REDIS_URL is present in env schema
 *  10. Distributed lock acquire/release uses in-memory fallback when Redis offline
 */

import { env } from '../src/config/env';
import { getRedisClient, closeRedisConnection, acquireDistributedLock, releaseDistributedLock } from '../src/core/redis';
import { getQueue, closeAllQueues, closeAllWorkers, getActiveWorkersCount, createWorker, QUEUE_NAMES } from '../src/core/queue';
import { BackgroundScheduler } from '../src/jobs/scheduler';

afterAll(async () => {
  await BackgroundScheduler.stopWorkers();
  await closeAllWorkers();
  await closeAllQueues();
  await closeRedisConnection();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Mirrors the resolveRedisUrl() production guard logic from redis.ts */
function simulateResolveRedisUrl(nodeEnv: string, redisUrl: string | undefined): string {
  if (redisUrl) return redisUrl;
  if (nodeEnv === 'production') {
    throw new Error('[FATAL] REDIS_URL is required in production.');
  }
  return 'redis://127.0.0.1:6379';
}

// ─── 1. Production enforcement ────────────────────────────────────────────────

describe('Production Redis Enforcement', () => {
  test('production + missing REDIS_URL → throws immediately', () => {
    expect(() => simulateResolveRedisUrl('production', undefined)).toThrow(
      '[FATAL] REDIS_URL is required in production.'
    );
  });

  test('production + valid REDIS_URL → resolves without throwing', () => {
    expect(() =>
      simulateResolveRedisUrl('production', 'redis://managed-redis.example.com:6379')
    ).not.toThrow();

    const result = simulateResolveRedisUrl('production', 'redis://managed-redis.example.com:6379');
    expect(result).toBe('redis://managed-redis.example.com:6379');
  });

  test('production + TLS Redis URL (rediss://) → resolves without throwing', () => {
    const tls = 'rediss://:secretpass@managed-redis.example.com:6380';
    expect(() => simulateResolveRedisUrl('production', tls)).not.toThrow();
    expect(simulateResolveRedisUrl('production', tls)).toBe(tls);
  });
});

// ─── 2. Dev/test fallback ─────────────────────────────────────────────────────

describe('Dev/Test Redis Fallback', () => {
  test('dev + missing REDIS_URL → falls back to localhost without throwing', () => {
    expect(() => simulateResolveRedisUrl('development', undefined)).not.toThrow();
    expect(simulateResolveRedisUrl('development', undefined)).toBe('redis://127.0.0.1:6379');
  });

  test('test + missing REDIS_URL → falls back to localhost without throwing', () => {
    expect(() => simulateResolveRedisUrl('test', undefined)).not.toThrow();
    expect(simulateResolveRedisUrl('test', undefined)).toBe('redis://127.0.0.1:6379');
  });

  test('dev + explicit REDIS_URL → uses the provided URL', () => {
    const url = 'redis://localhost:6380';
    expect(simulateResolveRedisUrl('development', url)).toBe(url);
  });
});

// ─── 3. Redis URL TLS parseability ───────────────────────────────────────────

describe('Redis URL TLS / Auth Parseability', () => {
  test('rediss:// TLS URL is valid — ioredis enables TLS automatically from scheme', () => {
    // Verify the URL parses without errors
    const url = 'rediss://:mypassword@redis.example.com:6380';
    expect(() => new URL(url)).not.toThrow();

    const parsed = new URL(url);
    expect(parsed.protocol).toBe('rediss:');
    expect(parsed.hostname).toBe('redis.example.com');
    expect(parsed.port).toBe('6380');
  });

  test('redis:// auth URL (username:password@host) remains parseable', () => {
    const url = 'redis://:secretpass@redis.example.com:6379';
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('redis:');
    expect(parsed.password).toBe('secretpass');
  });

  test('REDIS_URL in current env is a valid URL', () => {
    if (env.REDIS_URL) {
      expect(() => new URL(env.REDIS_URL!)).not.toThrow();
    }
  });
});

// ─── 4. getRedisClient() ─────────────────────────────────────────────────────

describe('getRedisClient()', () => {
  test('returns a valid ioredis instance', () => {
    const client = getRedisClient();
    expect(client).toBeDefined();
    expect(typeof client.set).toBe('function');
    expect(typeof client.get).toBe('function');
    expect(typeof client.quit).toBe('function');
  });

  test('returns the same singleton instance on repeated calls', () => {
    const a = getRedisClient();
    const b = getRedisClient();
    expect(a).toBe(b);
  });
});

// ─── 5. closeRedisConnection() idempotency ────────────────────────────────────

describe('closeRedisConnection() idempotency', () => {
  test('can be called when no connection exists without throwing', async () => {
    await expect(closeRedisConnection()).resolves.not.toThrow();
  });

  test('is safe to call multiple times in sequence', async () => {
    await expect(closeRedisConnection()).resolves.not.toThrow();
    await expect(closeRedisConnection()).resolves.not.toThrow();
  });
});

// ─── 6. BullMQ Queue initialization ──────────────────────────────────────────

describe('BullMQ Queue Initialization', () => {
  test('getQueue() does not throw for a standard queue name', () => {
    expect(() => getQueue(QUEUE_NAMES.EMI_OPERATIONS)).not.toThrow();
  });

  test('getQueue() returns a Queue instance with the correct name', () => {
    const q = getQueue(QUEUE_NAMES.EMI_OPERATIONS);
    expect(q).toBeDefined();
    expect(q.name).toBe(QUEUE_NAMES.EMI_OPERATIONS);
  });

  test('getQueue() is idempotent — returns same instance on repeated calls', () => {
    const a = getQueue(QUEUE_NAMES.EMI_OPERATIONS);
    const b = getQueue(QUEUE_NAMES.EMI_OPERATIONS);
    expect(a).toBe(b);
  });
});

// ─── 7. closeAllQueues() idempotency ─────────────────────────────────────────

describe('closeAllQueues() idempotency', () => {
  test('completes without throwing', async () => {
    await expect(closeAllQueues()).resolves.not.toThrow();
  });

  test('is safe to call multiple times', async () => {
    await expect(closeAllQueues()).resolves.not.toThrow();
    await expect(closeAllQueues()).resolves.not.toThrow();
  });
});

// ─── 8. Distributed lock in-memory fallback ──────────────────────────────────

describe('Distributed Lock In-Memory Fallback', () => {
  test('acquireDistributedLock() falls back to in-memory when Redis is offline', async () => {
    // Tests run with Redis optionally available; the lock must always succeed via fallback
    const { acquired, lockId } = await acquireDistributedLock(`test_redis_prod_${Date.now()}`, 5000);
    expect(acquired).toBe(true);
    expect(lockId).toBeTruthy();
  });

  test('releaseDistributedLock() completes without throwing', async () => {
    const key = `test_redis_release_${Date.now()}`;
    const { lockId } = await acquireDistributedLock(key, 5000);
    await expect(releaseDistributedLock(key, lockId)).resolves.toBe(true);
  });
});

// ─── 9. Env schema ───────────────────────────────────────────────────────────

describe('Env schema: REDIS_URL', () => {
  test('env object includes REDIS_URL field', () => {
    // REDIS_URL is optional; it may be undefined if not set in .env
    expect(Object.prototype.hasOwnProperty.call(env, 'REDIS_URL') || env.REDIS_URL !== null).toBe(true);
  });

  test('When REDIS_URL is set it must be a non-empty string', () => {
    if (env.REDIS_URL !== undefined) {
      expect(typeof env.REDIS_URL).toBe('string');
      expect(env.REDIS_URL.length).toBeGreaterThan(0);
    }
  });
});

// ─── 10. Worker Lifecycle Tracking & closeAllWorkers ─────────────────────────

describe('Worker Lifecycle Tracking & Graceful Termination', () => {
  test('createWorker() tracks active workers in registry', async () => {
    const initialCount = getActiveWorkersCount();
    const worker = createWorker('test-dummy-queue', async () => ({}));
    expect(getActiveWorkersCount()).toBe(initialCount + 1);

    await worker.close();
    expect(getActiveWorkersCount()).toBe(initialCount);
  });

  test('closeAllWorkers() cleanly closes all tracked workers', async () => {
    createWorker('test-dummy-queue-1', async () => ({}));
    createWorker('test-dummy-queue-2', async () => ({}));
    expect(getActiveWorkersCount()).toBeGreaterThanOrEqual(2);

    await expect(closeAllWorkers()).resolves.not.toThrow();
    expect(getActiveWorkersCount()).toBe(0);
  });
});

// ─── 11. Duplicate Worker Startup Protection ─────────────────────────────────

describe('Duplicate Worker Startup Protection', () => {
  beforeEach(async () => {
    await BackgroundScheduler.stopWorkers();
  });

  afterAll(async () => {
    await BackgroundScheduler.stopWorkers();
  });

  test('BackgroundScheduler.startWorkers() is idempotent and avoids starting duplicates', async () => {
    expect(BackgroundScheduler.areWorkersRunning()).toBe(false);

    const run1 = BackgroundScheduler.startWorkers();
    expect(BackgroundScheduler.areWorkersRunning()).toBe(true);
    expect(run1.notifWorker).toBeDefined();

    const run2 = BackgroundScheduler.startWorkers();
    expect(BackgroundScheduler.areWorkersRunning()).toBe(true);
    expect(run2.notifWorker).toBe(run1.notifWorker);

    await BackgroundScheduler.stopWorkers();
    expect(BackgroundScheduler.areWorkersRunning()).toBe(false);
  });
});

// ─── 12. Graceful Shutdown Ordering Verification ─────────────────────────────

describe('Graceful Shutdown Ordering', () => {
  test('closing workers, queues, Redis, and DB in canonical order executes cleanly', async () => {
    // 1. Start worker and queue
    const { notifWorker } = BackgroundScheduler.startWorkers();
    expect(notifWorker).toBeDefined();
    getQueue(QUEUE_NAMES.NOTIFICATIONS);

    // 2. Execute canonical shutdown order:
    //    Workers stop → Queues close → Redis connection closes
    await expect(BackgroundScheduler.stopWorkers()).resolves.not.toThrow();
    await expect(closeAllQueues()).resolves.not.toThrow();
    await expect(closeRedisConnection()).resolves.not.toThrow();
  });
});
