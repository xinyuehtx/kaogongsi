import Redis from 'ioredis';
import type { KvStore } from '@tengxiaohtx/plugin-core';

/**
 * 防腐层 · Redis 缓存适配器：实现插件 KvStore（带 TTL）。
 * 领域只依赖 KvStore 端口，不依赖 ioredis。
 */
export class RedisKvStore implements KvStore {
  constructor(private readonly redis: Redis) {}
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) await this.redis.set(key, value, 'EX', ttlSeconds);
    else await this.redis.set(key, value);
  }
  async get(key: string): Promise<string | undefined> {
    return (await this.redis.get(key)) ?? undefined;
  }
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

/** 惰性连接的 Redis 客户端（连接错误不阻塞构建）。 */
export function createRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
}
