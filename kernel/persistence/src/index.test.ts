import { describe, it, expect } from 'vitest';
import { PrismaAuthStorage, PrismaDocumentStore, PrismaRunStore, RedisKvStore, createPersistence } from './index.js';

/**
 * 说明：真实 CRUD 需 Postgres/Redis（docker compose）。此处只验证防腐层**装配选择**与适配器可构造，
 * 不做在线查询（PrismaClient/ioredis 惰性连接，构造不触网）。
 */
describe('persistence: 防腐层装配（createPersistence）', () => {
  it('无 env ⇒ 不装配任何 DB 适配器（上层回落内存/文件）', () => {
    const p = createPersistence({});
    expect(p.authStorage).toBeUndefined();
    expect(p.documentStore).toBeUndefined();
    expect(p.runStore).toBeUndefined();
    expect(p.kvStore).toBeUndefined();
  });

  it('配 DATABASE_URL ⇒ Prisma 适配 StoragePort/DocumentStore/RunStore', () => {
    const p = createPersistence({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(p.authStorage).toBeInstanceOf(PrismaAuthStorage);
    expect(p.documentStore).toBeInstanceOf(PrismaDocumentStore);
    expect(p.runStore).toBeInstanceOf(PrismaRunStore);
  });

  it('配 REDIS_URL ⇒ Redis 适配 KvStore', () => {
    const p = createPersistence({ REDIS_URL: 'redis://localhost:6379' });
    expect(p.kvStore).toBeInstanceOf(RedisKvStore);
  });
});
