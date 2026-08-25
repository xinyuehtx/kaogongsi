import { describe, it, expect } from 'vitest';
import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';
import { InMemoryStorage } from '@tengxiaohtx/auth-core';
import { InMemoryRunStore } from '@tengxiaohtx/run-store';
import { buildServer, type ServerServices } from './server.js';

/**
 * 内核 api 的独立测试：**不依赖 middleware/connectors**，用桩 services 验证
 * 认证 / 管理端 / 项目授权 / 角色分区过滤 / 溯源端点。
 * 真实装配（连接器 + 分层管道 + 插件）的集成测试在 example/app。
 */

const project: ProjectSummary = { id: 'p1', name: '项目一', description: '' };
const otherProject: ProjectSummary = { id: 'p2', name: '项目二', description: '' };
const version: VersionSummary = { id: 'v1', projectId: 'p1', label: 'v1', createdAt: '2026-08-01', harnessConfigVersion: 'h', evidenceLevel: 'full' };

const stubView = (): ReportView => ({
  audience: 'exec',
  drillable: true,
  sections: [
    { title: '归因分布', kind: 'attribution', data: {}, sourceLineage: [] },
    { title: '质量', kind: 'kpi', data: [], sourceLineage: [] },
    { title: '财务', kind: 'kpi', data: [], sourceLineage: [] },
    { title: '决策依据', kind: 'drilldown', data: {}, sourceLineage: [] },
  ],
});

function stubServices(runStore: InMemoryRunStore): ServerServices {
  return {
    projects: {
      async listProjects() {
        return [project, otherProject];
      },
      async listVersions() {
        return [version];
      },
    },
    reports: {
      async versionReport(projectId, versionId, actor) {
        const runId = `run-${projectId}-${versionId}`;
        await runStore.startRun({ runId, at: 't', connectorId: 'stub', projectId, versionId, actor });
        await runStore.putLayer({ runId, seq: 0, layer: 'attribution', stageId: 'stub', input: { seeded: true }, at: 't' });
        return { view: stubView(), runId };
      },
      async compare(input) {
        return { project, baseline: version, candidate: version, groups: [], gateBaseline: 'GO', gateCandidate: 'GO', narrative: input.generateNarrative ? { summary: 's', highlights: [], regressions: [], recommendation: '', verdict: 'GO', generatedBy: 'template' } : undefined } as ComparisonView;
      },
      async retryRun() {
        return stubView();
      },
    },
    plugins: {
      list: () => [{ id: 'stub-plugin', name: '桩插件', version: '1.0.0', layers: ['L4'], forms: [], storage: ['cfg'], skills: [] }],
      async loadData() {
        return { id: 'default' };
      },
      async saveData(_c, id, input) {
        return { id, ...input };
      },
    },
  };
}

function freshServer() {
  const runStore = new InMemoryRunStore();
  return buildServer({ services: stubServices(runStore), storage: new InMemoryStorage(), runStore, jwtSecret: 'test' });
}

async function registerAndToken(app: ReturnType<typeof buildServer>, email = 'admin@x.com'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'pw' } });
  return (res.json() as { token: string }).token;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('kernel/api: 健康 + 认证', () => {
  it('GET /health 返回 ok', async () => {
    const res = await freshServer().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('首个注册用户为 admin，register 直接返回 token', async () => {
    const app = freshServer();
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'boss@x.com', password: 'pw' } });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { user: { role: string } }).user.role).toBe('admin');
  });

  it('未认证访问数据端点 ⇒ 401', async () => {
    const app = freshServer();
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
  });
});

describe('kernel/api: 项目授权 + 角色分区（RBAC）', () => {
  it('非 admin 仅见被授权项目；越权访问版本 ⇒ 403', async () => {
    const app = freshServer();
    const adminToken = await registerAndToken(app);
    const created = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'bi@x.com', password: 'pw', role: 'bi' } });
    const biId = (created.json() as { id: string }).id;
    await app.inject({ method: 'POST', url: '/api/admin/grants', headers: auth(adminToken), payload: { userId: biId, projectId: 'p1' } });
    const biToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bi@x.com', password: 'pw' } })).json() as { token: string }).token;

    const visible = (await app.inject({ method: 'GET', url: '/api/projects', headers: auth(biToken) })).json() as ProjectSummary[];
    expect(visible.map((p) => p.id)).toEqual(['p1']);
    expect((await app.inject({ method: 'GET', url: '/api/projects/p2/versions', headers: auth(biToken) })).statusCode).toBe(403);
  });

  it('管理端仅 admin（bi ⇒ 403）', async () => {
    const app = freshServer();
    const adminToken = await registerAndToken(app);
    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'bi@x.com', password: 'pw', role: 'bi' } });
    const biToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bi@x.com', password: 'pw' } })).json() as { token: string }).token;
    expect((await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(biToken) })).statusCode).toBe(403);
  });

  it('finance 角色只见财务/归因/依据分区（内核按角色过滤）', async () => {
    const app = freshServer();
    const adminToken = await registerAndToken(app);
    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'fin@x.com', password: 'pw', role: 'finance' } });
    const finId = ((await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(adminToken) })).json() as { id: string; email: string }[]).find((u) => u.email === 'fin@x.com')!.id;
    await app.inject({ method: 'POST', url: '/api/admin/grants', headers: auth(adminToken), payload: { userId: finId, projectId: 'p1' } });
    const finToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'fin@x.com', password: 'pw' } })).json() as { token: string }).token;
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=p1&versionId=v1', headers: auth(finToken) });
    expect((res.json() as ReportView).sections.map((s) => s.title)).toEqual(['归因分布', '财务', '决策依据']);
  });
});

describe('kernel/api: 报告/溯源端点（经注入的 ReportService）', () => {
  it('单版本报告回传 x-run-id；缺参 400', async () => {
    const app = freshServer();
    const token = await registerAndToken(app);
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=p1&versionId=v1', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-run-id']).toBe('run-p1-v1');
    expect((await app.inject({ method: 'GET', url: '/api/report/version?projectId=p1', headers: auth(token) })).statusCode).toBe(400);
  });

  it('对比端点：缺参 400，带 generateNarrative 透传', async () => {
    const app = freshServer();
    const token = await registerAndToken(app);
    expect((await app.inject({ method: 'POST', url: '/api/report/compare', headers: auth(token), payload: { projectId: 'p1' } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/report/compare', headers: auth(token), payload: { projectId: 'p1', baselineId: 'v1', candidateId: 'v1', generateNarrative: true } });
    expect((ok.json() as ComparisonView).narrative).toBeDefined();
  });

  it('溯源：/api/runs/:id 返回每层入参；retry 重放', async () => {
    const app = freshServer();
    const token = await registerAndToken(app);
    await app.inject({ method: 'GET', url: '/api/report/version?projectId=p1&versionId=v1', headers: auth(token) });
    const run = (await app.inject({ method: 'GET', url: '/api/runs/run-p1-v1', headers: auth(token) })).json() as { layers: { layer: string }[] };
    expect(run.layers.map((l) => l.layer)).toEqual(['attribution']);
    expect((await app.inject({ method: 'POST', url: '/api/runs/run-p1-v1/retry', headers: auth(token) })).statusCode).toBe(200);
  });
});

describe('kernel/api: 插件端点（经注入的 PluginDirectory）', () => {
  it('列插件；写配置仅 admin', async () => {
    const app = freshServer();
    const adminToken = await registerAndToken(app);
    expect(((await app.inject({ method: 'GET', url: '/api/plugins', headers: auth(adminToken) })).json() as { id: string }[])[0]?.id).toBe('stub-plugin');
    await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { email: 'bi@x.com', password: 'pw', role: 'bi' } });
    const biToken = ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bi@x.com', password: 'pw' } })).json() as { token: string }).token;
    expect((await app.inject({ method: 'POST', url: '/api/plugins/data/cfg/default', headers: auth(biToken), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/plugins/data/cfg/default', headers: auth(adminToken), payload: { a: 1 } })).statusCode).toBe(200);
  });
});
