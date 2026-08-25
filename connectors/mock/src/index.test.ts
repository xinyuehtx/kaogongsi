import { describe, it, expect } from 'vitest';
import { MockConnector, defaultKpis } from './index.js';
import { runConnectorContract } from './contract-test.js';

// AC-8: MockConnector 是 DataConnector 的合法实现，跑通用契约测试
runConnectorContract('MockConnector(full)', () => new MockConnector());

describe('MockConnector 能力开关', () => {
  it('full ⇒ drillable=true', () => {
    expect(new MockConnector({ evidenceLevel: 'full' }).capabilities().drillable).toBe(true);
  });

  it('metric-only ⇒ drillable=false（D9.3，纯 BI 场景）', () => {
    expect(new MockConnector({ evidenceLevel: 'metric-only' }).capabilities().drillable).toBe(false);
  });

  it('可注入护栏破线的 KPI（构造 NO-GO/告警场景）', async () => {
    const kpis = defaultKpis();
    kpis.guardrail = [
      { key: 'hallucination', label: '幻觉率', value: 15, unit: '%', guardrailBreached: true, sourceLineage: ['mock'] },
    ];
    const c = new MockConnector({ kpis });
    const k = await c.fetchKpis({ experimentId: 'x' });
    expect(k.guardrail[0]?.guardrailBreached).toBe(true);
  });
});
