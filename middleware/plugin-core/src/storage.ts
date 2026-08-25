import type { StorageField, StorageSchema, UiField, UiForm } from './types.js';

/**
 * 存储端口（RFC-007）：用户经 UI DSL 输入的数据入库。
 *  - DocumentStore：文档存储（NoSQL，如 Mongo）——权威存储。
 *  - KvStore：键值（Redis）——带 TTL 的缓存。
 * 默认内存实现（测试/自包含）；生产换 Mongo/Redis 适配器，上层零改动。
 */
export interface DocumentStore {
  put(collection: string, id: string, doc: Record<string, unknown>): Promise<void>;
  get(collection: string, id: string): Promise<Record<string, unknown> | undefined>;
  list(collection: string): Promise<Record<string, unknown>[]>;
  delete(collection: string, id: string): Promise<void>;
}

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

function coerce(type: StorageField['type'], value: unknown): unknown {
  switch (type) {
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' || value === true;
    case 'json':
      return typeof value === 'string' ? safeJson(value) : value;
    default:
      return value === undefined || value === null ? '' : String(value);
  }
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** 依据插件声明的 StorageSchema，把用户输入写入 NoSQL（+ 可选 Redis 缓存）。 */
export class PluginDataService {
  constructor(
    private readonly schemas: () => StorageSchema[],
    private readonly doc: DocumentStore,
    private readonly kv: KvStore,
  ) {}

  private schema(collection: string): StorageSchema {
    const s = this.schemas().find((x) => x.collection === collection);
    if (!s) throw new Error(`未声明的存储集合: ${collection}`);
    return s;
  }

  async save(collection: string, id: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const schema = this.schema(collection);
    const record: Record<string, unknown> = { id, _updatedAt: new Date().toISOString() };
    for (const f of schema.fields) if (f.key in input) record[f.key] = coerce(f.type, input[f.key]);
    await this.doc.put(collection, id, record);
    if (schema.cache) await this.kv.set(`${collection}:${id}`, JSON.stringify(record), schema.cache.ttlSeconds);
    return record;
  }

  async load(collection: string, id: string): Promise<Record<string, unknown> | undefined> {
    const schema = this.schema(collection);
    if (schema.cache) {
      const cached = await this.kv.get(`${collection}:${id}`);
      if (cached) return JSON.parse(cached) as Record<string, unknown>;
    }
    return this.doc.get(collection, id);
  }

  async list(collection: string): Promise<Record<string, unknown>[]> {
    this.schema(collection);
    return this.doc.list(collection);
  }
}

// ── UI DSL 校验 ───────────────────────────────────────────────
export function validateForm(form: UiForm): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const f of form.fields) {
    if (seen.has(f.key)) errs.push(`字段重复: ${f.key}`);
    seen.add(f.key);
    if (f.type === 'select' && (!f.options || f.options.length === 0)) errs.push(`select 缺 options: ${f.key}`);
  }
  return errs;
}

export function validateInput(fields: UiField[], input: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const f of fields) {
    const v = input[f.key];
    if (f.required && (v === undefined || v === null || v === '')) errs.push(`必填: ${f.label}`);
    if (v !== undefined && f.type === 'number' && Number.isNaN(Number(v))) errs.push(`应为数字: ${f.label}`);
  }
  return errs;
}
