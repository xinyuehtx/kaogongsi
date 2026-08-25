import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComparisonView, DataConnector, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';
import { InMemoryStorage } from '@tengxiaohtx/auth-core';
import { InMemoryRunStore } from '@tengxiaohtx/run-store';
import { MockConnector } from '@tengxiaohtx/connector-mock';
import { FileSource, createIngestConnector } from '@tengxiaohtx/ingest';
import { createApp } from './assemble.js';

/**
 * example/app 集成测试：验证**装配后的整机**（内核 + 中间件分层管道 + 连接器 + 插件）。
 * 内核自身的鉴权/RBAC 单测在 kernel/api（用桩 services，不依赖 middleware）。
 */

function freshApp(over: Parameters<typeof createApp>[0] = {}) {
  return createApp({ storage: new InMemoryStorage(), runStore: new InMemoryRunStore(), jwtSecret: 'test', ...over });
}

async function registerAndToken(app: Awaited<ReturnType<typeof createApp>>, email = 'admin@x.com'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'pw' } });
  return (res.json() as { token: string }).token;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('example/app: 装配整机 —— 报告（六层管道）', () => {
  it('GET /api/projects 返回 Mock 连接器项目；单版本报告经管道出 exec 视图', async () => {
    const app = await freshApp();
    const token = await registerAndToken(app);
    const projects = (await app.inject({ method: 'GET', url: '/api/projects', headers: auth(token) })).json() as ProjectSummary[];
    expect(projects.map((p) => p.id)).toContain('dt-sheet');

    const versions = (await app.inject({ method: 'GET', url: '/api/projects/dt-sheet/versions', headers: auth(token) })).json() as VersionSummary[];
    expect(versions.length).toBeGreaterThan(1);

    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ReportView;
    expect(view.audience).toBe('exec');
    expect(view.decision?.gate).toBe('GO');
    expect(view.sections.map((s) => s.title)).toContain('决策依据');
  });

  it('finance 角色只见财务/归因/依据分区（内核 RBAC + 装配管道）', async () => {
    const app = await freshApp();
    const adminToken = await registerAndToken(app);
    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'fin@x.com', password: 'pw', role: 'finance' } });
    const finId = ((await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(adminToken) })).json() as { id: string; email: string }[]).find((u) => u.email === 'fin@x.com')!.id;
    await app.inject({ method: 'POST', url: '/api/admin/grants', headers: auth(adminToken), payload: { userId: finId, projectId: 'dt-sheet' } });
    const finToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'fin@x.com', password: 'pw' } })).json() as { token: string }).token;
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(finToken) });
    expect((res.json() as ReportView).sections.map((s) => s.title)).toEqual(['归因分布', '财务', '决策依据']);
  });

  it('POST /api/report/compare 返回对比视图（+ 生成叙述）；未知项目 404', async () => {
    const app = await freshApp();
    const token = await registerAndToken(app);
    const res = await app.inject({ method: 'POST', url: '/api/report/compare', headers: auth(token), payload: { projectId: 'dt-sheet', baselineId: 'v1.0', candidateId: 'v2.0', generateNarrative: true } });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ComparisonView;
    expect(view.baseline.id).toBe('v1.0');
    expect(view.narrative).toBeDefined();

    const missing = await app.inject({ method: 'POST', url: '/api/report/compare', headers: auth(token), payload: { projectId: 'nope', baselineId: 'a', candidateId: 'b' } });
    expect(missing.statusCode).toBe(404);
  });

  it('AC-7 隔离性：换连接器（假 L5，同接口）装配零改动', async () => {
    class FakeL5Connector extends MockConnector {
      override readonly kind = 'l5-decision';
    }
    const app = await freshApp({ connector: new FakeL5Connector({ id: 'fake-l5' }) as DataConnector });
    const token = await registerAndToken(app);
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) });
    expect((res.json() as ReportView).audience).toBe('exec');
  });
});

describe('example/app: 插件（RFC-007）', () => {
  it('列出示例连接器插件（含 UI DSL 表单）', async () => {
    const app = await freshApp();
    const token = await registerAndToken(app);
    const plugins = (await app.inject({ method: 'GET', url: '/api/plugins', headers: auth(token) })).json() as { id: string; forms: unknown[] }[];
    const example = plugins.find((p) => p.id === 'example');
    expect(example).toBeDefined();
    expect(example?.forms.length).toBeGreaterThan(0);
  });

  it('管理员按 UI DSL 入库，读回一致；非管理员不可写', async () => {
    const app = await freshApp();
    const adminToken = await registerAndToken(app);
    const save = await app.inject({ method: 'POST', url: '/api/plugins/data/finance_config/default', headers: auth(adminToken), payload: { endpoint: 'https://fin', apiKey: 'sk', currency: 'CNY' } });
    expect(save.statusCode).toBe(200);
    const loaded = (await app.inject({ method: 'GET', url: '/api/plugins/data/finance_config/default', headers: auth(adminToken) })).json() as { data: { endpoint: string } };
    expect(loaded.data.endpoint).toBe('https://fin');

    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'bi@x.com', password: 'pw', role: 'bi' } });
    const biToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bi@x.com', password: 'pw' } })).json() as { token: string }).token;
    expect((await app.inject({ method: 'POST', url: '/api/plugins/data/finance_config/default', headers: auth(biToken), payload: { endpoint: 'x' } })).statusCode).toBe(403);
  });

  it('外部数据（财务）经插件并入报告财务分区', async () => {
    const app = await freshApp();
    const token = await registerAndToken(app);
    const view = (await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) })).json() as ReportView;
    const financial = view.sections.find((s) => s.title === '财务')?.data as { key: string }[];
    expect(financial.some((k) => k.key === 'gross_margin')).toBe(true);
  });
});

describe('example/app: 运行溯源 / 重试 / 连接器版本（RFC-009）', () => {
  it('出报告后按 runId 溯源每层入参，并重试重放', async () => {
    const app = await freshApp();
    const token = await registerAndToken(app);
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) });
    const runId = res.headers['x-run-id'] as string;
    expect(runId).toBeTruthy();

    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: auth(token) })).json() as { meta: { versionId: string }; layers: { layer: string }[] };
    expect(run.meta.versionId).toBe('v2.0');
    expect(run.layers.map((l) => l.layer)).toEqual(['attribution', 'decision', 'report']);

    const retry = await app.inject({ method: 'POST', url: `/api/runs/${runId}/retry`, headers: auth(token) });
    expect(retry.statusCode).toBe(200);
    expect((retry.json() as ReportView).audience).toBe('exec');
  });

  it('记录连接器版本；/api/connector-versions 可查', async () => {
    const app = await freshApp();
    const token = await registerAndToken(app);
    await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) });
    const versions = (await app.inject({ method: 'GET', url: '/api/connector-versions', headers: auth(token) })).json() as { connectorId: string }[];
    expect(versions.length).toBeGreaterThan(0);
  });
});

describe('example/app: 轨迹接入连接器（RFC-006，端到端）', () => {
  function claudeRun(version: string, verdict: 'pass' | 'fail'): unknown {
    return [
      { type: 'user', sessionId: 's', cwd: '/work/dt-sheet', gitBranch: version, message: { role: 'user', content: 'x' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'bash', input: {} }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', name: 'bash', content: 'ok', is_error: false }] } },
      { type: 'result', verdict, costUsd: 0.02, usage: { total_tokens: 900 } },
    ];
  }

  it('文件夹轨迹 → /api/projects + 单版本报告（成功率 50%）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-ingest-'));
    try {
      mkdirSync(join(dir, 'dt-sheet'), { recursive: true });
      writeFileSync(join(dir, 'dt-sheet', 'r1.json'), JSON.stringify(claudeRun('v2.0', 'pass')));
      writeFileSync(join(dir, 'dt-sheet', 'r2.json'), JSON.stringify(claudeRun('v2.0', 'fail')));
      const connector = await createIngestConnector({ source: new FileSource(dir) });
      const app = await freshApp({ connector });
      const token = await registerAndToken(app);

      const projects = (await app.inject({ method: 'GET', url: '/api/projects', headers: auth(token) })).json() as ProjectSummary[];
      expect(projects.map((p) => p.id)).toContain('dt-sheet');

      const view = (await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) })).json() as ReportView;
      const kpis = view.sections.find((s) => s.title === '质量')?.data as { key: string; value: number }[];
      expect(kpis.find((k) => k.key === 'success_rate')?.value).toBe(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
