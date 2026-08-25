import { describe, it, expect } from 'vitest';
import type { CanonicalSignal, VersionSummary } from '@tengxiaohtx/contracts';
import { bootstrapStd, computeEvaluation, costOfPass, passHatK, passHatKFromRuns, percentile } from './index.js';

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

// ── RFC-012：真实分布 / 分层 / pass^k 实测 ──────────────────────
describe('metrics(RFC-012): 分位数与真实成本分布', () => {
  it('percentile 线性插值；单值/空数组稳健', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1, 5);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBe(0);
  });

  it('latency_p95 从逐案例分布算 p95，并给出 p50/p95/p99', () => {
    // 100 个延迟观测：0..99 分钟
    const latency: CanonicalSignal[] = Array.from({ length: 100 }, (_, i) => ({
      ...base, caseId: `lat:${i}`, evidenceLevel: 'full' as const, metricKey: 'latency_p95', observation: i, verdict: 'unknown' as const,
    }));
    const ev = computeEvaluation(version(), latency);
    const k = ev.kpis.guardrail.find((x) => x.key === 'latency_p95');
    expect(k?.value).toBeCloseTo(94.05, 1); // p95 of 0..99
    expect(k?.distribution?.p50).toBeCloseTo(49.5, 1);
    expect(k?.distribution?.p99).toBeGreaterThan(k!.distribution!.p95!);
    expect(k?.guardrailBreached).toBe(true); // 94 > 阈值 35
  });

  it('cost_of_pass 用真实成本分布：总成本 / 通过数', () => {
    // 4 个案例：成本 1/1/1/1，其中 2 个 pass ⇒ Cost-of-Pass = 4/2 = 2
    const costs: CanonicalSignal[] = Array.from({ length: 4 }, (_, i) => ({
      ...base, caseId: `c:${i}`, evidenceLevel: 'full' as const, metricKey: 'cost_of_pass', observation: 1,
      verdict: (i < 2 ? 'pass' : 'fail') as CanonicalSignal['verdict'],
    }));
    const ev = computeEvaluation(version(), costs);
    expect(ev.kpis.financial.find((x) => x.key === 'cost_of_pass')?.value).toBe(2);
  });

  it('单读数聚合不受影响（BI/metric-only 回落 mean）', () => {
    const ev = computeEvaluation(version(), [aggSignal('cost_of_pass', 0.18), aggSignal('latency_p95', 28)]);
    expect(ev.kpis.financial.find((x) => x.key === 'cost_of_pass')?.value).toBe(0.18);
    expect(ev.kpis.guardrail.find((x) => x.key === 'latency_p95')?.value).toBe(28);
    expect(ev.kpis.guardrail.find((x) => x.key === 'latency_p95')?.guardrailBreached).toBe(false);
  });
});

describe('metrics(RFC-012): pass^k 实测（多次重复运行）', () => {
  it('passHatKFromRuns：只有 k 次全过才计入；无重复运行返回 undefined', () => {
    // c1 两次全过；c2 一过一败 ⇒ pass^2 = 1/2
    const cases = [
      { caseId: 'c1', runId: 'r1', verdict: 'pass' }, { caseId: 'c1', runId: 'r2', verdict: 'pass' },
      { caseId: 'c2', runId: 'r1', verdict: 'pass' }, { caseId: 'c2', runId: 'r2', verdict: 'fail' },
    ];
    const m = passHatKFromRuns(cases);
    expect(m).toEqual({ value01: 0.5, k: 2, nCases: 2 });
    expect(passHatKFromRuns([{ caseId: 'c1', runId: 'r1', verdict: 'pass' }])).toBeUndefined();
  });

  it('computeEvaluation：有重复运行 ⇒ 用实测值并标 passHatKFromRuns', () => {
    const mk = (caseId: string, runId: string, pass: boolean): CanonicalSignal => ({
      ...base, runId, caseId, evidenceLevel: 'full', metricKey: 'success_rate',
      observation: pass ? 1 : 0, verdict: pass ? 'pass' : 'fail',
    });
    // 4 个 case × 2 次运行；仅 1 个 case 两次全过 ⇒ 实测 pass^2 = 25%
    const signals = [
      mk('a', 'r1', true), mk('a', 'r2', true),
      mk('b', 'r1', true), mk('b', 'r2', false),
      mk('c', 'r1', false), mk('c', 'r2', false),
      mk('d', 'r1', true), mk('d', 'r2', false),
    ];
    const k = computeEvaluation(version(), signals).kpis.quality.find((x) => x.key === 'success_rate');
    expect(k?.value).toBe(25);
    expect(k?.passHatKFromRuns).toBe(true);
  });

  it('无重复运行 ⇒ 保持通过率口径，不标实测', () => {
    const k = computeEvaluation(version(), caseSignals('success_rate', 100, 72)).kpis.quality.find((x) => x.key === 'success_rate');
    expect(k?.value).toBe(72);
    expect(k?.passHatKFromRuns).toBeUndefined();
  });
});

describe('metrics(RFC-012): 分层指标（T56 整体值掩盖某层问题）', () => {
  it('按 stratum 分层给出各层取值与样本量', () => {
    const mk = (i: number, stratum: string, pass: boolean): CanonicalSignal => ({
      ...base, caseId: `${stratum}:${i}`, evidenceLevel: 'full', metricKey: 'success_rate',
      observation: pass ? 1 : 0, verdict: pass ? 'pass' : 'fail', stratum,
    });
    // easy 10/10 全过；hard 10 个仅 2 过 ⇒ 整体 60%，但 hard 只有 20%
    const signals = [
      ...Array.from({ length: 10 }, (_, i) => mk(i, 'easy', true)),
      ...Array.from({ length: 10 }, (_, i) => mk(i, 'hard', i < 2)),
    ];
    const k = computeEvaluation(version(), signals).kpis.quality.find((x) => x.key === 'success_rate');
    expect(k?.value).toBe(60);
    expect(k?.strata).toEqual([
      { key: 'easy', value: 100, nSamples: 10 },
      { key: 'hard', value: 20, nSamples: 10 },
    ]);
  });

  it('无 stratum 标签 ⇒ 不给 strata（单层无意义）', () => {
    const k = computeEvaluation(version(), caseSignals('success_rate', 10, 5)).kpis.quality.find((x) => x.key === 'success_rate');
    expect(k?.strata).toBeUndefined();
  });
});
