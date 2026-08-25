import type { StoragePort } from '@tengxiaohtx/auth-core';
import type { DocumentStore, KvStore } from '@tengxiaohtx/plugin-core';
import type { RunStore } from '@tengxiaohtx/run-store';
import { PrismaAuthStorage, PrismaDocumentStore, PrismaRunStore, getPrisma } from './prisma.js';
import { RedisKvStore, createRedis } from './redis.js';

export * from './prisma.js';
export * from './redis.js';

export interface PersistenceEnv {
  DATABASE_URL?: string; // 配了则账号/文档/溯源走 Postgres/Prisma
  REDIS_URL?: string; // 配了则插件 KV 缓存走 Redis
}

export interface Persistence {
  authStorage?: StoragePort;
  documentStore?: DocumentStore;
  runStore?: RunStore;
  kvStore?: KvStore;
}

/**
 * 防腐层装配：按 env 选择 DB/缓存适配器；未配置的返回 undefined（上层回落内存/文件）。
 * 防腐层与存储独立：领域端口不变，切 Postgres/Redis 只在此装配处发生。
 */
export function createPersistence(env: PersistenceEnv = process.env as PersistenceEnv): Persistence {
  const out: Persistence = {};
  if (env.DATABASE_URL) {
    const prisma = getPrisma(env.DATABASE_URL);
    out.authStorage = new PrismaAuthStorage(prisma);
    out.documentStore = new PrismaDocumentStore(prisma);
    out.runStore = new PrismaRunStore(prisma);
  }
  if (env.REDIS_URL) {
    out.kvStore = new RedisKvStore(createRedis(env.REDIS_URL));
  }
  return out;
}
