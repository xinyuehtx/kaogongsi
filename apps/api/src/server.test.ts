import { describe, it, expect } from 'vitest';
import type { ComparisonView, DataConnector, ProjectSummary, ReportView, VersionSummary } from '@kaogongsi/contracts';
import { MockConnector } from '@kaogongsi/connector-mock';
import { buildServer } from './server.js';

describe('api: 独立测试闭环（inject，无需起端口）', () => {
  it('GET /health 返回 ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /api/report/exec 返回 exec ReportView（默认 MockConnector）', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/report/exec?experimentId=exp-001' });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ReportView;
    expect(view.audience).toBe('exec');
    expect(view.decision?.gate).toBeDefined();
    expect(view.sections.map((s) => s.title)).toEqual(
      expect.arrayContaining(['归因分布', '质量', '业务/产品', '财务', '护栏', '过程质量（诊断）', '决策依据']),
    );
  });

  it('AC-7 隔离性：换一个"假 L5 连接器"（同接口），路由零改动即返回新数据', async () => {
    // 一个不同于 mock 的连接器实现——证明 api/l6-report 不绑定具体来源
    class FakeL5Connector extends MockConnector {
      override readonly kind = 'l5-decision';
    }
    const fake: DataConnector = new FakeL5Connector({ id: 'fake-l5' });
    const app = buildServer({ connector: fake });
    const res = await app.inject({ method: 'GET', url: '/api/report/exec' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ReportView).audience).toBe('exec');
  });

  it('AC-4 metric-only 连接器 ⇒ ReportView.drillable=false', async () => {
    const app = buildServer({ connector: new MockConnector({ evidenceLevel: 'metric-only' }) });
    const res = await app.inject({ method: 'GET', url: '/api/report/exec' });
    expect((res.json() as ReportView).drillable).toBe(false);
  });
});

describe('api: 项目/版本 + 对比（RFC-002）', () => {
  it('GET /api/projects 返回项目列表', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const projects = res.json() as ProjectSummary[];
    expect(projects.length).toBeGreaterThan(0);
  });

  it('GET /api/projects/:id/versions 返回该项目版本', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/projects/dt-sheet/versions' });
    expect(res.statusCode).toBe(200);
    const versions = res.json() as VersionSummary[];
    expect(versions.length).toBeGreaterThan(1);
    expect(versions.every((v) => v.projectId === 'dt-sheet')).toBe(true);
  });

  it('GET /api/report/version 返回单版本 exec 视图', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0' });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ReportView;
    expect(view.audience).toBe('exec');
    expect(view.decision?.gate).toBeDefined();
  });

  it('GET /api/report/version 缺参 ⇒ 400', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/report/compare 返回对比视图（默认不带叙述）', async () => {
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/report/compare',
      payload: { projectId: 'dt-sheet', baselineId: 'v1.0', candidateId: 'v2.0' },
    });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ComparisonView;
    expect(view.baseline.id).toBe('v1.0');
    expect(view.candidate.id).toBe('v2.0');
    expect(view.groups.length).toBeGreaterThan(0);
    expect(view.narrative).toBeUndefined();
  });

  it('POST /api/report/compare?generateNarrative 附带对比报告（注入模板生成器）', async () => {
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/report/compare',
      payload: { projectId: 'dt-sheet', baselineId: 'v1.0', candidateId: 'v2.0', generateNarrative: true },
    });
    expect(res.statusCode).toBe(200);
    const view = res.json() as ComparisonView;
    expect(view.narrative).toBeDefined();
    expect(['GO', 'NO_GO', 'ABSTAIN']).toContain(view.narrative?.verdict);
  });

  it('POST /api/report/compare 缺参 ⇒ 400', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'POST', url: '/api/report/compare', payload: { projectId: 'dt-sheet' } });
    expect(res.statusCode).toBe(400);
  });
});
