import { describe, it, expect } from 'vitest';
import type { CanonicalSignal, VersionSummary } from '@tengxiaohtx/contracts';
import { bootstrapStd, computeEvaluation, costOfPass, passHatK } from './index.js';

const version = (evidenceLevel: VersionSummary['evidenceLevel'] = 'full'): VersionSummary => ({
  id: 'v2.0', projectId: 'p', label: 'v2.0', createdAt: '2026-08-01', harnessConfigVersion: 'h@1', evidenceLevel,
});

const base = { source: 'inspect', sourceLineage: ['inspect:run'], runId: 'run', experimentId: 'exp', harnessConfigVersion: 'h@1' as const, evidence: {} };

/** case-based：为某指标造 total 个案例，其中 fails 个 verdict=fail（观测 1=命中事件）。 */
function caseSignals(metricKey: string, total: number, positives: number, evidenceLevel: CanonicalSignal['evidenceLevel'] = 'full'): CanonicalSignal[] {
  return Array.from({ length: total }, (_, i) => ({
    ...base,
    caseId: `${metricKey}:${i}`,
    evidenceLevel,
    metricKey,
    observation: i < positives ? 1 : 0,
    verdict: (i < positives ? 'pass' : 'fail') as CanonicalSignal['verdict'],
  }));
}

/** aggregate：单读数。 */
function aggSignal(metricKey: string, value: number, evidenceLevel: CanonicalSignal['evidenceLevel'] = 'full'): CanonicalSignal {
  return { ...base, caseId: `${metricKey}:agg`, evidenceLevel, metricKey, observation: value, verdict: 'unknown' };
}

describe('l3-metrics: 统计原语', () => {
  it('bootstrapStd 确定性 + 对 0/1 样本给正的区间宽度', () => {
    const s = Array.from({ length: 100 }, (_, i) => (i < 72 ? 1 : 0));
    const a = bootstrapStd(s, 'seed-x');
    const b = bootstrapStd(s, 'seed-x');
    expect(a).toBe(b); // 可复现
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.1); // ~0.045
  });
  it('passHatK 与 costOfPass', () => {
    expect(passHatK(0.9, 3)).toBeCloseTo(0.729, 3);
    expect(costOfPass([1, 1, 1, 1], ['pass', 'pass', 'fail', 'fail'])).toBe(2);
    expect(costOfPass([1], ['fail'])).toBe(Infinity);
  });
});

describe('l3-metrics: computeEvaluation（signals → KpiSet + bundles）', () => {
  it('case-based 指标：值=通过率×100，带样本量与 bootstrap 区间（A4）', () => {
    const ev = computeEvaluation(version(), [
      ...caseSignals('success_rate', 100, 72),
      ...aggSignalGroup(),
    ]);
    const sr = ev.kpis.quality.find((k) => k.key === 'success_rate');
    expect(sr?.value).toBe(72);
    expect(sr?.nSamples).toBe(100);
    expect(sr?.stdDev).toBeGreaterThan(0);
    // 归因原料：success_rate 达标（72>70）⇒ 该 bundle 无失败案例（欠缺驱动）
    const bundle = ev.bundles.find((b) => b.metric.name === 'success_rate');
    expect(bundle?.supportingCases.every((c) => c.verdict === 'pass')).toBe(true);
  });

  it('护栏：幻觉率越阈 ⇒ guardrailBreached，且 bundle 全失败（欠缺满格）', () => {
    const ev = computeEvaluation(version(), [...caseSignals('hallucination', 100, 15), ...aggSignalGroup()]);
    const h = ev.kpis.guardrail.find((k) => k.key === 'hallucination');
    expect(h?.value).toBe(15);
    expect(h?.guardrailBreached).toBe(true);
    const bundle = ev.bundles.find((b) => b.metric.name === 'hallucination');
    expect(bundle?.supportingCases.every((c) => c.verdict === 'fail')).toBe(true);
  });

  it('aggregate 指标（ROI）：单读数即值，归位到 financial', () => {
    const ev = computeEvaluation(version(), [aggSignal('roi', 140), ...caseSignals('success_rate', 100, 72)]);
    expect(ev.kpis.financial.find((k) => k.key === 'roi')?.value).toBe(140);
  });

  it('metric-only 版本：bundle 无案例（D9.3 不伪装可下钻）', () => {
    const ev = computeEvaluation(version('metric-only'), [aggSignal('adoption', 30, 'metric-only'), aggSignal('roi', 100, 'metric-only')]);
    for (const b of ev.bundles) expect(b.supportingCases).toHaveLength(0);
  });
});

/** 一组最小 aggregate 信号，保证 KpiSet 各组非空、便于断言。 */
function aggSignalGroup(): CanonicalSignal[] {
  return [aggSignal('adoption', 38), aggSignal('roi', 140), aggSignal('safety_violation', 0.4)];
}
