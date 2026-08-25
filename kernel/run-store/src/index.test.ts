import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLogger, FileRunStore, InMemoryRunStore } from './index.js';

describe('run-store: RunStore（连接器两版本 + 每层入参 + 溯源）', () => {
  it('记录连接器两种版本；startRun + putLayer；getRun 按序返回', async () => {
    const s = new InMemoryRunStore();
    await s.putConnectorVersion({ connectorId: 'ingest', packageVersion: '1.2.0', configVersion: 'cfg-3', at: '2026-08-01' });
    await s.putConnectorVersion({ connectorId: 'ingest', packageVersion: '1.2.0', configVersion: 'cfg-3', at: '2026-08-01' }); // 去重
    expect(await s.listConnectorVersions('ingest')).toHaveLength(1);
    expect((await s.listConnectorVersions('ingest'))[0]).toMatchObject({ packageVersion: '1.2.0', configVersion: 'cfg-3' });

    await s.startRun({ runId: 'r1', at: '2026-08-02', connectorId: 'ingest', projectId: 'dt-sheet', versionId: 'v2.0', actor: 'a@x' });
    await s.putLayer({ runId: 'r1', seq: 1, layer: 'decision', stageId: 'kernel:decision', input: { attribution: {} }, at: '2026-08-02' });
    await s.putLayer({ runId: 'r1', seq: 0, layer: 'attribution', stageId: 'kernel:attribution', input: { evaluation: {} }, at: '2026-08-02' });
    const run = await s.getRun('r1');
    expect(run.meta?.actor).toBe('a@x');
    expect(run.layers.map((l) => l.layer)).toEqual(['attribution', 'decision']); // 按 seq 排序
    expect(await s.listRuns({ projectId: 'dt-sheet' })).toHaveLength(1);
    expect(await s.listRuns({ projectId: 'other' })).toHaveLength(0);
  });

  it('FileRunStore 落盘后新实例可读回', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runstore-'));
    try {
      const s1 = new FileRunStore(dir);
      await s1.startRun({ runId: 'r9', at: 't', connectorId: 'c', projectId: 'p', versionId: 'v' });
      await s1.putLayer({ runId: 'r9', seq: 0, layer: 'report', stageId: 'kernel:report', input: {}, at: 't' });
      const s2 = new FileRunStore(dir);
      expect((await s2.getRun('r9')).layers).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run-store: FileLogger 服务端文件日志', () => {
  it('写入按天日志文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'logger-'));
    try {
      const log = new FileLogger(dir);
      log.info('report.run', { runId: 'r1' });
      log.error('boom');
      const files = readdirSync(dir).filter((f) => f.startsWith('server-') && f.endsWith('.log'));
      expect(files.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
