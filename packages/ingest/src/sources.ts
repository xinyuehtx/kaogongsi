import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { CollectQuery, CollectResult, RawTrajectory, TrajectorySource } from './types.js';

const inTimeRange = (iso: string | undefined, q?: CollectQuery): boolean => {
  if (!q?.timeFrom && !q?.timeTo) return true;
  if (!iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  if (q.timeFrom && t < Date.parse(q.timeFrom)) return false;
  if (q.timeTo && t > Date.parse(q.timeTo)) return false;
  return true;
};

const tagMatch = (tags: string[], q?: CollectQuery): boolean => {
  if (!q?.tags || q.tags.length === 0) return true;
  return q.tags.some((t) => tags.includes(t));
};

function parseContent(text: string, ext: string): unknown {
  const trimmed = text.trim();
  if (ext === '.jsonl' || (trimmed.includes('\n') && !trimmed.startsWith('['))) {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((l) => {
      try {
        return JSON.parse(l) as unknown;
      } catch {
        return l;
      }
    });
    // 单行 JSON 也回退为对象
    if (rows.length === 1 && ext !== '.jsonl') return rows[0];
    return rows;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export interface FileSourceOptions {
  extensions?: string[]; // 默认 .json/.jsonl
  formatHint?: string; // 覆盖格式提示（否则从路径推断）
  baseTags?: string[]; // 追加到每条的 tag
}

/** 本地文件源：递归遍历文件夹收集轨迹（每个文件一条 RawTrajectory）。 */
export class FileSource implements TrajectorySource {
  readonly kind = 'file';
  private readonly exts: string[];

  constructor(private readonly dir: string, private readonly opts: FileSourceOptions = {}) {
    this.exts = opts.extensions ?? ['.json', '.jsonl'];
  }

  private list(): string[] {
    let entries: string[] = [];
    try {
      entries = readdirSync(this.dir, { recursive: true }) as string[];
    } catch {
      return [];
    }
    return entries
      .filter((rel) => this.exts.some((e) => rel.endsWith(e)))
      .map((rel) => join(this.dir, rel))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  }

  async collect(query?: CollectQuery): Promise<CollectResult> {
    const all = this.list();
    const collected: RawTrajectory[] = [];
    for (const path of all) {
      const st = statSync(path);
      const createdAt = st.mtime.toISOString();
      const relParts = relative(this.dir, path).split(sep);
      const tags = [...(this.opts.baseTags ?? []), ...relParts.slice(0, -1)];
      if (!inTimeRange(createdAt, query) || !tagMatch(tags, query)) continue;
      const ext = path.slice(path.lastIndexOf('.'));
      const content = parseContent(readFileSync(path, 'utf8'), ext);
      collected.push({
        id: relative(this.dir, path),
        source: 'file',
        content,
        formatHint: this.opts.formatHint ?? inferFormatFromPath(path),
        path,
        tags,
        createdAt,
      });
    }
    // 分批
    const start = query?.cursor ? Number(query.cursor) || 0 : 0;
    const limit = query?.limit ?? collected.length;
    const items = collected.slice(start, start + limit);
    const next = start + limit;
    return { items, nextCursor: next < collected.length ? String(next) : undefined };
  }
}

const KNOWN_FORMATS = ['claude-code', 'codex', 'deepseek', 'opencode', 'qoder', 'traework', 'qwenwork', 'workbuddy', 'trae', 'langfuse', 'langsmith', 'harbor'];
function inferFormatFromPath(path: string): string | undefined {
  const lower = path.toLowerCase();
  return KNOWN_FORMATS.find((f) => lower.includes(f));
}

// ── HTTP 源 ───────────────────────────────────────────────────
export interface HttpSourceOptions {
  headers?: Record<string, string>; // 自定义 header（鉴权等）
  formatHint?: string;
  param?: { from?: string; to?: string; tag?: string; limit?: string; cursor?: string }; // 查询参数名映射
  itemsPath?: string; // 响应中列表字段（默认自动：数组根或 items/data/traces）
  cursorPath?: string; // 响应中下一页游标字段（默认 nextCursor/next_cursor/cursor）
  idPath?: string; // 每条 id 字段（默认 id）
  timePath?: string; // 每条时间字段（默认 createdAt/timestamp）
  fetchImpl?: typeof fetch; // 便于注入测试
}

const getPath = (obj: unknown, path?: string): unknown => {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
};

function firstArray(body: unknown, itemsPath?: string): unknown[] {
  if (itemsPath) {
    const v = getPath(body, itemsPath);
    return Array.isArray(v) ? v : [];
  }
  if (Array.isArray(body)) return body;
  for (const k of ['items', 'data', 'traces', 'runs', 'results']) {
    const v = (body as Record<string, unknown>)?.[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** HTTP 源：分批拉取轨迹，支持时间范围 / tag / 自定义 header。 */
export class HttpSource implements TrajectorySource {
  readonly kind = 'http';

  constructor(private readonly endpoint: string, private readonly opts: HttpSourceOptions = {}) {}

  async collect(query?: CollectQuery): Promise<CollectResult> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const p = this.opts.param ?? {};
    const url = new URL(this.endpoint);
    if (query?.timeFrom) url.searchParams.set(p.from ?? 'from', query.timeFrom);
    if (query?.timeTo) url.searchParams.set(p.to ?? 'to', query.timeTo);
    if (query?.tags?.length) url.searchParams.set(p.tag ?? 'tag', query.tags.join(','));
    if (query?.limit) url.searchParams.set(p.limit ?? 'limit', String(query.limit));
    if (query?.cursor) url.searchParams.set(p.cursor ?? 'cursor', query.cursor);

    const res = await doFetch(url.toString(), { headers: { accept: 'application/json', ...(this.opts.headers ?? {}) } });
    if (!res.ok) throw new Error(`HTTP 源拉取失败: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as unknown;

    const rows = firstArray(body, this.opts.itemsPath);
    const host = url.host;
    const items: RawTrajectory[] = rows.map((row, i) => ({
      id: String(getPath(row, this.opts.idPath ?? 'id') ?? `${host}:${i}`),
      source: `http:${host}`,
      content: row,
      formatHint: this.opts.formatHint,
      tags: (getPath(row, 'tags') as string[] | undefined) ?? [],
      createdAt: (getPath(row, this.opts.timePath ?? 'createdAt') as string | undefined) ?? (getPath(row, 'timestamp') as string | undefined),
    }));

    const cursorPath = this.opts.cursorPath;
    const nextCursor = cursorPath
      ? (getPath(body, cursorPath) as string | undefined)
      : ((body as Record<string, unknown>)?.nextCursor ?? (body as Record<string, unknown>)?.next_cursor ?? (body as Record<string, unknown>)?.cursor) as string | undefined;

    return { items, nextCursor: nextCursor ? String(nextCursor) : undefined };
  }
}

/** 便捷：把一个源分批拉尽（自动翻页），返回全部 RawTrajectory。 */
export async function collectAll(source: TrajectorySource, query: CollectQuery = {}, maxBatches = 1000): Promise<RawTrajectory[]> {
  const out: RawTrajectory[] = [];
  let cursor = query.cursor;
  for (let b = 0; b < maxBatches; b++) {
    const { items, nextCursor } = await source.collect({ ...query, cursor });
    out.push(...items);
    if (!nextCursor || items.length === 0) break;
    cursor = nextCursor;
  }
  return out;
}
