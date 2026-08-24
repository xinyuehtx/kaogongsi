import { describe, it, expect } from 'vitest';
import type { EvidenceLevel, MetricCaseBundle, VersionEvaluation, VersionSummary } from '@kaogongsi/contracts';
import { buildAttribution } from './index.js';

const ver = (evidenceLevel: EvidenceLevel = 'full'): VersionSummary => ({
  id: 'v1', projectId: 'p', label: 'v1', createdAt: '2026-08-01', harnessConfigVersion: 'h@1', evidenceLevel,
});

const bundle = (name: string, verdicts: ('pass' | 'fail' | 'partial')[], evidenceLevel: EvidenceLevel = 'full'): MetricCaseBundle => ({
  metric: { name, mean: 1, nSamples: 100 },
  supportingCases: verdicts.map((v, i) => ({ caseId: `${name}:${i}`, verdict: v, evidenceRef: `ev:${name}:${i}`, lineage: ['src'] })),
  evidenceLevel,
});

const evalWith = (bundles: MetricCaseBundle[], evidenceLevel: EvidenceLevel = 'full'): VersionEvaluation => ({
  version: ver(evidenceLevel),
  kpis: { quality: [], product: [], financial: [], guardrail: [], trajectory: { efficiency: [], decisionQuality: [], planningQuality: [], interactionQuality: [], stability: [] } },
  bundles,
});

describe('l4-attribution: buildAttribution（TDD）', () => {
  it('失败驱动：技术侧失败多 ⇒ 技术份额最高；分布和为 1；每份挂案例（D9.3）', () => {
    const r = buildAttribution(
      evalWith([
        bundle('hallucination', ['fail', 'fail', 'fail', 'fail']), // tech
        bundle('adoption', ['fail', 'pass', 'pass', 'pass']), // product
        bundle('roi', ['pass', 'pass', 'pass', 'pass']), // ops, 无失败
      ]),
    );
    const sum = r.distribution.reduce((a, s) => a + s.share, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(r.distribution[0]?.party).toBe('tech'); // 份额最高
    for (const s of r.distribution) expect(s.supportingCases.length).toBeGreaterThan(0);
    // 归因由失败案例驱动：tech 4 / (4+1) = 0.8
    expect(r.distribution.find((s) => s.party === 'tech')?.share).toBeCloseTo(0.8, 2);
  });

  it('全部通过 ⇒ 按先验分布（技术 0.5 / 产品 0.3 / 运营 0.2），confidence medium，仍挂通过案例', () => {
    const r = buildAttribution(
      evalWith([
        bundle('success_rate', ['pass', 'pass']), // tech
        bundle('adoption', ['pass', 'pass']), // product
        bundle('roi', ['pass', 'pass']), // ops
      ]),
    );
    expect(r.confidence).toBe('medium');
    expect(r.distribution.find((s) => s.party === 'tech')?.share).toBeCloseTo(0.5, 2);
    expect(r.distribution.find((s) => s.party === 'product')?.share).toBeCloseTo(0.3, 2);
    expect(r.distribution.find((s) => s.party === 'ops')?.share).toBeCloseTo(0.2, 2);
    for (const s of r.distribution) expect(s.supportingCases.length).toBeGreaterThan(0);
  });

  it('集中主因（单方失败）⇒ confidence high、drillable true', () => {
    const r = buildAttribution(evalWith([bundle('hallucination', ['fail', 'fail', 'fail', 'fail'])]));
    expect(r.confidence).toBe('high');
    expect(r.drillable).toBe(true);
    expect(r.distribution).toHaveLength(1);
    expect(r.distribution[0]?.share).toBe(1);
  });

  it('metric-only：无案例 ⇒ 粗粒度分布 + drillable=false + confidence low（D9.3 不伪装）', () => {
    const r = buildAttribution(
      evalWith(
        [
          { metric: { name: 'success_rate', mean: 0.6, nSamples: 100 }, supportingCases: [], evidenceLevel: 'metric-only' },
          { metric: { name: 'adoption', mean: 0.3, nSamples: 100 }, supportingCases: [], evidenceLevel: 'metric-only' },
        ],
        'metric-only',
      ),
    );
    expect(r.drillable).toBe(false);
    expect(r.confidence).toBe('low');
    const sum = r.distribution.reduce((a, s) => a + s.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});
