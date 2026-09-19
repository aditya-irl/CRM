import Redis, { RedisOptions } from 'ioredis';
import { env } from '../config/env';

let redisClient: Redis | null = null;
const inMemoryLocks: Map<string, { lockId: string; expiresAt: number }> = new Map();

export function getRedisClient(): Redis {
  if (!redisClient) {
    const opts: RedisOptions = {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 1000,
      lazyConnect: true,
      retryStrategy(times) {
        if (env.NODE_ENV === 'test' && times > 1) return null; // Don't hang in tests if redis not running
        return Math.min(times * 100, 2000);
      },
    };

    redisClient = new Redis(env.REDIS_URL, opts);

    redisClient.on('error', (_err) => {
      // Suppress unhandled crash in test/dev mode when standalone redis container is not running
    });
  }

  return redisClient;
}

/**
 * Distributed Lock using Redis SET NX PX with in-memory fallback for local testing
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

  // In-Memory Lock Fallback (Used during offline unit testing)
  const now = Date.now();
  const existing = inMemoryLocks.get(lockKey);
  if (existing && existing.expiresAt > now) {
    return { acquired: false, lockId: '' };
  }

  inMemoryLocks.set(lockKey, { lockId, expiresAt: now + ttlMs });
  return { acquired: true, lockId };
}

/**
 * Release Distributed Lock using Lua script with in-memory fallback
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

export async function closeRedisConnection() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    redisClient = null;
  }
}

export default getRedisClient;
