import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSource, HttpSource, collectAll } from './sources.js';

describe('ingest/FileSource', () => {
  it('递归收集 json/jsonl，文件夹名作 tag，支持 tag 过滤与分批', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingest-'));
    try {
      mkdirSync(join(dir, 'claude-code'), { recursive: true });
      mkdirSync(join(dir, 'codex'), { recursive: true });
      writeFileSync(join(dir, 'claude-code', 'a.json'), JSON.stringify({ hello: 1 }));
      writeFileSync(join(dir, 'claude-code', 'b.jsonl'), '{"type":"user"}\n{"type":"assistant"}');
      writeFileSync(join(dir, 'codex', 'c.json'), JSON.stringify({ hi: 2 }));

      const src = new FileSource(dir);
      const all = await src.collect();
      expect(all.items).toHaveLength(3);
      // 路径推断格式提示
      expect(all.items.find((i) => i.id.includes('a.json'))?.formatHint).toBe('claude-code');
      // jsonl → 数组内容
      expect(Array.isArray(all.items.find((i) => i.id.includes('b.jsonl'))?.content)).toBe(true);

      // tag 过滤（文件夹名）
      const onlyCodex = await src.collect({ tags: ['codex'] });
      expect(onlyCodex.items).toHaveLength(1);
      expect(onlyCodex.items[0]?.id).toContain('c.json');

      // 分批
      const batch = await src.collect({ limit: 2 });
      expect(batch.items).toHaveLength(2);
      expect(batch.nextCursor).toBe('2');
      const rest = await src.collect({ limit: 2, cursor: batch.nextCursor });
      expect(rest.items).toHaveLength(1);
      expect(rest.nextCursor).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('未来时间范围过滤掉全部', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingest-'));
    try {
      writeFileSync(join(dir, 'x.json'), '{}');
      const src = new FileSource(dir);
      const r = await src.collect({ timeFrom: '2999-01-01T00:00:00Z' });
      expect(r.items).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ingest/HttpSource', () => {
  it('带时间/tag/自定义 header 拉取，解析 items + 游标分批', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      const u = new URL(url);
      expect((init?.headers as Record<string, string>)?.authorization).toBe('Bearer k');
      if (!u.searchParams.get('cursor')) {
        return new Response(JSON.stringify({ items: [{ id: 't1', tags: ['x'] }], nextCursor: 'c2' }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [{ id: 't2' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const src = new HttpSource('https://obs.example/api/traces', { headers: { authorization: 'Bearer k' }, fetchImpl: fakeFetch });
    const first = await src.collect({ timeFrom: '2026-01-01', tags: ['x'], limit: 1 });
    expect(first.items.map((i) => i.id)).toEqual(['t1']);
    expect(first.nextCursor).toBe('c2');
    expect(calls[0]).toContain('from=2026-01-01');
    expect(calls[0]).toContain('tag=x');
    expect(calls[0]).toContain('limit=1');

    const all = await collectAll(src, { limit: 1 });
    expect(all.map((i) => i.id)).toEqual(['t1', 't2']);
  });

  it('响应为根数组也能解析', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify([{ id: 'a' }, { id: 'b' }]), { status: 200 })) as unknown as typeof fetch;
    const src = new HttpSource('https://x/y', { fetchImpl: fakeFetch });
    const r = await src.collect();
    expect(r.items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
