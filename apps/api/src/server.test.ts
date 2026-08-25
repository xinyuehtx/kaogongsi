import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComparisonView, DataConnector, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';
import { InMemoryStorage } from '@tengxiaohtx/auth-core';
import { MockConnector } from '@tengxiaohtx/connector-mock';
import { FileSource, createIngestConnector } from '@tengxiaohtx/ingest';
import { buildServer } from './server.js';

/** 每个测试用独立 storage，避免"首用户=admin"跨测试串味。 */
function freshServer(extra: Parameters<typeof buildServer>[0] = {}) {
  return buildServer({ storage: new InMemoryStorage(), jwtSecret: 'test', ...extra });
}

async function registerAndToken(app: ReturnType<typeof buildServer>, email = 'admin@x.com'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'pw' } });
  return (res.json() as { token: string }).token;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('api: 健康 + 认证', () => {
  it('GET /health 返回 ok', async () => {
    const res = await freshServer().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('首个注册用户为 admin，register 直接返回 token', async () => {
    const app = freshServer();
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'boss@x.com', password: 'pw' } });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; user: { role: string } };
    expect(body.token).toBeTruthy();
    expect(body.user.role).toBe('admin');
  });

  it('/api/auth/me 需要 Bearer 令牌', async () => {
    const app = freshServer();
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    const token = await registerAndToken(app);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { role: string } }).user.role).toBe('admin');
  });
});

describe('api: 数据端点需认证 + 授权', () => {
  it('未认证访问 /api/projects ⇒ 401', async () => {
    const res = await freshServer().inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('admin 看到全部项目', async () => {
    const app = freshServer();
    const token = await registerAndToken(app);
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ProjectSummary[]).length).toBeGreaterThan(0);
  });

  it('非 admin 只看到被授权的项目；越权访问版本 ⇒ 403', async () => {
    const app = freshServer();
    const adminToken = await registerAndToken(app); // 首个=admin
    // 管理员建一个 bi 用户并只授权 dt-sheet
    const created = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'bi@x.com', password: 'pw', role: 'bi' } });
    const biId = (created.json() as { id: string }).id;
    await app.inject({ method: 'POST', url: '/api/admin/grants', headers: auth(adminToken), payload: { userId: biId, projectId: 'dt-sheet' } });
    const biToken = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bi@x.com', password: 'pw' } }).then((r) => r.json())) as { token: string };

    const projects = await app.inject({ method: 'GET', url: '/api/projects', headers: auth(biToken.token) });
    expect((projects.json() as ProjectSummary[]).map((p) => p.id)).toEqual(['dt-sheet']);

    const denied = await app.inject({ method: 'GET', url: '/api/projects/fs-doc/versions', headers: auth(biToken.token) });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/projects/dt-sheet/versions', headers: auth(biToken.token) });
    expect((ok.json() as VersionSummary[]).length).toBeGreaterThan(0);
  });

  it('管理端仅 admin 可用（bi ⇒ 403）', async () => {
    const app = freshServer();
    const adminToken = await registerAndToken(app);
    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'bi@x.com', password: 'pw', role: 'bi' } });
    const biToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bi@x.com', password: 'pw' } })).json() as { token: string }).token;
    expect((await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(biToken) })).statusCode).toBe(403);
  });
});

describe('api: 报告（六层管道）+ 角色过滤', () => {
  it('GET /api/report/version 返回 exec 视图（admin 全分区）', async () => {
    const app = freshServer();
    const token = await registerAndToken(app);
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ReportView;
    expect(view.audience).toBe('exec');
    expect(view.decision?.gate).toBeDefined();
    expect(view.sections.map((s) => s.title)).toContain('决策依据');
  });

  it('finance 角色只见财务/归因/依据分区', async () => {
    const app = freshServer();
    const adminToken = await registerAndToken(app);
    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'fin@x.com', password: 'pw', role: 'finance' } });
    const finId = ((await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(adminToken) })).json() as { id: string; email: string }[]).find((u) => u.email === 'fin@x.com')!.id;
    await app.inject({ method: 'POST', url: '/api/admin/grants', headers: auth(adminToken), payload: { userId: finId, projectId: 'dt-sheet' } });
    const finToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'fin@x.com', password: 'pw' } })).json() as { token: string }).token;
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(finToken) });
    const titles = (res.json() as ReportView).sections.map((s) => s.title);
    expect(titles).toEqual(['归因分布', '财务', '决策依据']);
  });

  it('POST /api/report/compare 返回对比视图（+ 生成叙述）', async () => {
    const app = freshServer();
    const token = await registerAndToken(app);
    const res = await app.inject({ method: 'POST', url: '/api/report/compare', headers: auth(token), payload: { projectId: 'dt-sheet', baselineId: 'v1.0', candidateId: 'v2.0', generateNarrative: true } });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ComparisonView;
    expect(view.baseline.id).toBe('v1.0');
    expect(view.narrative).toBeDefined();
  });

  it('AC-7 隔离性：换连接器（假 L5，同接口）路由零改动', async () => {
    class FakeL5Connector extends MockConnector {
      override readonly kind = 'l5-decision';
    }
    const app = freshServer({ connector: new FakeL5Connector({ id: 'fake-l5' }) as DataConnector });
    const token = await registerAndToken(app);
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) });
    expect((res.json() as ReportView).audience).toBe('exec');
  });
});

describe('api: 插件系统（RFC-007）', () => {
  it('GET /api/plugins 列出示例插件（含 UI DSL 表单）', async () => {
    const app = freshServer();
    const token = await registerAndToken(app);
    const plugins = (await app.inject({ method: 'GET', url: '/api/plugins', headers: auth(token) })).json() as { id: string; forms: unknown[] }[];
    const example = plugins.find((p) => p.id === 'example');
    expect(example).toBeDefined();
    expect(example?.forms.length).toBeGreaterThan(0);
  });

  it('管理员按 UI DSL 存储用户输入，读回一致；非管理员不可写', async () => {
    const app = freshServer();
    const adminToken = await registerAndToken(app);
    const save = await app.inject({ method: 'POST', url: '/api/plugins/data/finance_config/default', headers: auth(adminToken), payload: { endpoint: 'https://fin', apiKey: 'sk', currency: 'CNY' } });
    expect(save.statusCode).toBe(200);
    const loaded = (await app.inject({ method: 'GET', url: '/api/plugins/data/finance_config/default', headers: auth(adminToken) })).json() as { data: { endpoint: string } };
    expect(loaded.data.endpoint).toBe('https://fin');

    // bi 用户不可写配置
    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'bi@x.com', password: 'pw', role: 'bi' } });
    const biToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bi@x.com', password: 'pw' } })).json() as { token: string }).token;
    const denied = await app.inject({ method: 'POST', url: '/api/plugins/data/finance_config/default', headers: auth(biToken), payload: { endpoint: 'x' } });
    expect(denied.statusCode).toBe(403);
  });

  it('外部数据（财务）经插件并入报告财务分区', async () => {
    const app = freshServer();
    const token = await registerAndToken(app);
    const view = (await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) })).json() as ReportView;
    const financial = view.sections.find((s) => s.title === '财务')?.data as { key: string }[];
    expect(financial.some((k) => k.key === 'gross_margin')).toBe(true); // 来自 example 插件外部数据
  });
});

describe('api: 轨迹接入连接器（RFC-006，端到端）', () => {
  function claudeRun(version: string, verdict: 'pass' | 'fail'): unknown {
    return [
      { type: 'user', sessionId: 's', cwd: '/work/dt-sheet', gitBranch: version, message: { role: 'user', content: 'x' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'bash', input: {} }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', name: 'bash', content: 'ok', is_error: false }] } },
      { type: 'result', verdict, costUsd: 0.02, usage: { total_tokens: 900 } },
    ];
  }

  it('注入 IngestConnector：文件夹轨迹 → /api/projects + /api/report/version 六层管道', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-ingest-'));
    try {
      mkdirSync(join(dir, 'dt-sheet'), { recursive: true });
      writeFileSync(join(dir, 'dt-sheet', 'r1.json'), JSON.stringify(claudeRun('v2.0', 'pass')));
      writeFileSync(join(dir, 'dt-sheet', 'r2.json'), JSON.stringify(claudeRun('v2.0', 'fail')));
      const connector = await createIngestConnector({ source: new FileSource(dir) });
      const app = freshServer({ connector });
      const token = await registerAndToken(app);

      const projects = (await app.inject({ method: 'GET', url: '/api/projects', headers: auth(token) })).json() as ProjectSummary[];
      expect(projects.map((p) => p.id)).toContain('dt-sheet');

      const view = (await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) })).json() as ReportView;
      expect(view.audience).toBe('exec');
      const quality = view.sections.find((s) => s.title === '质量');
      expect(quality).toBeDefined();
      const kpis = quality?.data as { key: string; value: number }[];
      expect(kpis.find((k) => k.key === 'success_rate')?.value).toBe(50); // 1 pass / 2
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
