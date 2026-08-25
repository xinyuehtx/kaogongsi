/**
 * 内核 · 存储端口（防腐层的领域侧接口）。
 * 领域/中间件只依赖这些端口；具体实现（内存 / Prisma-Postgres / Redis）在本包内，
 * DB 细节不泄漏到上层（RFC-010/011）。
 */

/** 文档存储（NoSQL 语义）——权威存储。 */
export interface DocumentStore {
  put(collection: string, id: string, doc: Record<string, unknown>): Promise<void>;
  get(collection: string, id: string): Promise<Record<string, unknown> | undefined>;
  list(collection: string): Promise<Record<string, unknown>[]>;
  delete(collection: string, id: string): Promise<void>;
}

/** 键值存储（Redis 语义）——可带 TTL 的缓存。 */
export interface KvStore {
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  get(key: string): Promise<string | undefined>;
  del(key: string): Promise<void>;
}

export class InMemoryDocumentStore implements DocumentStore {
  private readonly cols = new Map<string, Map<string, Record<string, unknown>>>();
  private col(c: string): Map<string, Record<string, unknown>> {
    const m = this.cols.get(c) ?? new Map();
    this.cols.set(c, m);
    return m;
  }
  async put(collection: string, id: string, doc: Record<string, unknown>): Promise<void> {
    this.col(collection).set(id, doc);
  }
  async get(collection: string, id: string): Promise<Record<string, unknown> | undefined> {
    return this.col(collection).get(id);
  }
  async list(collection: string): Promise<Record<string, unknown>[]> {
    return [...this.col(collection).values()];
  }
  async delete(collection: string, id: string): Promise<void> {
    this.col(collection).delete(id);
  }
}

export class InMemoryKvStore implements KvStore {
  private readonly map = new Map<string, { v: string; exp?: number }>();
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.map.set(key, { v: value, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
  }
  async get(key: string): Promise<string | undefined> {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp !== undefined && e.exp < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.v;
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}
