import { describe, it, expect } from 'vitest';
import type { DataConnector } from '@kaogongsi/contracts';

/**
 * 可复用的连接器契约测试（RFC-001 AC-8）。
 * 任何 DataConnector 实现都应通过——这是"可替换"的守卫。
 * 将来 LangfuseConnector / BiConnector / L5Connector 都跑这套。
 */
export function runConnectorContract(
  name: string,
  makeConnector: () => DataConnector,
): void {
  describe(`连接器契约: ${name}`, () => {
    const q = { experimentId: 'exp-001' };

    it('capabilities 自洽：metric-only ⇒ 不可下钻（D9.3）', () => {
      const c = makeConnector();
      const cap = c.capabilities();
      if (cap.evidenceLevel === 'metric-only') {
        expect(cap.drillable).toBe(false);
      }
    });

    it('fetchDecision 返回合法决策：门禁枚举 + 归因三段和为 1 + 每段有案例支撑', async () => {
      const c = makeConnector();
      const d = await c.fetchDecision(q);
      expect(['GO', 'NO_GO', 'ABSTAIN']).toContain(d.gate);
      const sum = d.attribution.distribution.reduce((a, s) => a + s.share, 0);
      expect(sum).toBeCloseTo(1, 5);
      for (const s of d.attribution.distribution) {
        expect(s.supportingCases.length).toBeGreaterThan(0); // D9.3
      }
    });

    it('fetchKpis 返回五大组，含轨迹级 5 类', async () => {
      const c = makeConnector();
      const k = await c.fetchKpis(q);
      expect(k.quality.length).toBeGreaterThan(0);
      expect(k.product.length).toBeGreaterThan(0);
      expect(k.financial.length).toBeGreaterThan(0);
      expect(k.guardrail.length).toBeGreaterThan(0);
      expect(k.trajectory.efficiency.length).toBeGreaterThan(0);
      expect(k.trajectory.decisionQuality.length).toBeGreaterThan(0);
      expect(k.trajectory.planningQuality.length).toBeGreaterThan(0);
      expect(k.trajectory.interactionQuality.length).toBeGreaterThan(0);
      expect(k.trajectory.stability.length).toBeGreaterThan(0);
    });

    it('listProjects 非空，listVersions 都归属该项目（RFC-002）', async () => {
      const c = makeConnector();
      const projects = await c.listProjects();
      expect(projects.length).toBeGreaterThan(0);
      for (const p of projects) {
        const versions = await c.listVersions(p.id);
        expect(versions.length).toBeGreaterThan(0);
        expect(versions.every((v) => v.projectId === p.id)).toBe(true);
      }
    });

    it('fetchSignals 返回归一化信号（契约⓪）：字段完整 + 携带指标观测（RFC-004）', async () => {
      const c = makeConnector();
      const projects = await c.listProjects();
      for (const p of projects) {
        const versions = await c.listVersions(p.id);
        for (const v of versions) {
          const { version, signals } = await c.fetchSignals(p.id, v.id);
          expect(version.id).toBe(v.id);
          expect(signals.length).toBeGreaterThan(0);
          for (const s of signals) {
            expect(s.source).toBeTruthy();
            expect(s.runId).toBeTruthy();
            expect(s.caseId).toBeTruthy();
            expect(s.experimentId).toBeTruthy();
            expect(s.harnessConfigVersion).toBeTruthy();
            expect(['full', 'partial', 'metric-only']).toContain(s.evidenceLevel);
          }
          // 至少覆盖若干已知指标
          const keys = new Set(signals.map((s) => s.metricKey));
          expect(keys.has('success_rate')).toBe(true);
          expect(keys.has('roi')).toBe(true);
        }
      }
    });
  });
}
