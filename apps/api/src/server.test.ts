import { describe, it, expect } from 'vitest';
import type { DataConnector, ReportView } from '@kaogongsi/contracts';
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
