import type { DocumentStore, KvStore } from '@tengxiaohtx/persistence';
import type { StorageField, StorageSchema, UiField, UiForm } from './types.js';

/**
 * 插件输入入库服务：按插件声明的 StorageSchema 把用户经 UI DSL 输入的数据写入存储。
 * **存储端口在内核**（`@tengxiaohtx/persistence` 的 DocumentStore/KvStore）；本层只用端口，
 * 不知道背后是内存还是 Postgres/Redis（防腐层，RFC-010/011）。
 */

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

/** 依据插件声明的 StorageSchema，把用户输入写入文档存储（+ 可选 KV 缓存）。 */
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
