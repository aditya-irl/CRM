import Redis, { RedisOptions } from 'ioredis';
import { env } from '../config/env';

let redisClient: Redis | null = null;
const inMemoryLocks: Map<string, { lockId: string; expiresAt: number }> = new Map();

/**
 * Resolve the Redis URL to use.
 *
 * - Production:  REDIS_URL must be set (enforced by env schema). Never falls back to localhost.
 * - Dev / Test:  Falls back to localhost if REDIS_URL is not set.
 *
 * Credentials and TLS are encoded in the URL (e.g. rediss://:password@host:6380).
 * ioredis automatically enables TLS when the scheme is `rediss://`.
 */
function resolveRedisUrl(): string {
  if (env.REDIS_URL) {
    return env.REDIS_URL;
  }
  if (env.NODE_ENV === 'production') {
    // env.ts superRefine already rejects this state, but fail fast as defense-in-depth
    throw new Error(
      '[FATAL] REDIS_URL is required in production. ' +
      'Set a managed Redis URL (e.g. rediss://:<password>@host:6380).'
    );
  }
  // Dev / test convenience fallback only
  return 'redis://127.0.0.1:6379';
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = resolveRedisUrl();

    const opts: RedisOptions = {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 1000,
      lazyConnect: true,
      retryStrategy(times) {
        if (env.NODE_ENV === 'test' && times > 1) return null; // Don't hang in tests if Redis not running
        return Math.min(times * 100, 2000);
      },
    };

    redisClient = new Redis(redisUrl, opts);

    redisClient.on('error', (err) => {
      if (env.NODE_ENV === 'production') {
        // In production, log Redis errors server-side — do not suppress them silently
        console.error('[Redis] Connection error:', err.message);
      }
      // In dev/test: suppress unhandled crash when Redis is not running locally
    });
  }

  return redisClient;
}

/**
 * Distributed Lock using Redis SET NX PX with in-memory fallback for local testing.
 */
export async function acquireDistributedLock(
  lockKey: string,
  ttlMs = 30000,
  client?: Redis
): Promise<{ acquired: boolean; lockId: string }> {
  const lockId = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const redis = client || getRedisClient();

  try {
    if (redis.status === 'ready' || redis.status === 'connecting') {
      const res = await redis.set(`lock:${lockKey}`, lockId, 'PX', ttlMs, 'NX');
      return { acquired: res === 'OK', lockId };
    }
  } catch (_err) {
    // Fallback to in-memory lock store
  }

  // In-Memory Lock Fallback (used during offline unit testing)
  const now = Date.now();
  const existing = inMemoryLocks.get(lockKey);
  if (existing && existing.expiresAt > now) {
    return { acquired: false, lockId: '' };
  }

  inMemoryLocks.set(lockKey, { lockId, expiresAt: now + ttlMs });
  return { acquired: true, lockId };
}

/**
 * Release Distributed Lock using Lua script with in-memory fallback.
 */
export async function releaseDistributedLock(
  lockKey: string,
  lockId: string,
  client?: Redis
): Promise<boolean> {
  const redis = client || getRedisClient();

  try {
    if (redis.status === 'ready') {
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const result = await redis.eval(luaScript, 1, `lock:${lockKey}`, lockId);
      return result === 1;
    }
  } catch (_err) {
    // Fallback to in-memory
  }

  const existing = inMemoryLocks.get(lockKey);
  if (existing && existing.lockId === lockId) {
    inMemoryLocks.delete(lockKey);
    return true;
  }
  return true;
}

/**
 * Close the Redis connection gracefully.
 * Idempotent — safe to call multiple times or when no connection exists.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    const client = redisClient;
    redisClient = null; // Null out immediately to prevent re-use during shutdown
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }
}

export default getRedisClient;
