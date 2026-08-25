import { describe, it, expect } from 'vitest';
import type { CanonicalSignal } from '@tengxiaohtx/contracts';
import { buildProvenance } from './index.js';

const sig = (metricKey: string, caseId: string, verdict: CanonicalSignal['verdict'], observation: number): CanonicalSignal => ({
  source: 'inspect',
  sourceLineage: ['inspect:run-1'],
  runId: 'run-1',
  caseId,
  experimentId: 'exp',
  harnessConfigVersion: 'h@1',
  evidenceLevel: 'full',
  metricKey,
  observation,
  verdict,
  evidence: {},
});

describe('l2-provenance: buildProvenance（TDD）', () => {
  it('按指标聚合案例；drilldown 按 caseId 命中；metricKeys 去重', () => {
    const g = buildProvenance([
      sig('success_rate', 'c1', 'pass', 1),
      sig('success_rate', 'c2', 'fail', 0),
      sig('hallucination', 'h1', 'fail', 1),
    ]);
    expect(g.metricKeys().sort()).toEqual(['hallucination', 'success_rate']);
    expect(g.casesForMetric('success_rate').map((c) => c.caseId)).toEqual(['c1', 'c2']);
    expect(g.drilldown('c2')?.verdict).toBe('fail');
    expect(g.drilldown('h1')?.metricKey).toBe('hallucination');
    expect(g.drilldown('nope')).toBeUndefined();
  });

  it('携带血缘与来源，可供报告下钻（T30）', () => {
    const g = buildProvenance([sig('success_rate', 'c1', 'pass', 1)]);
    const c = g.drilldown('c1');
    expect(c?.lineage).toEqual(['inspect:run-1']);
    expect(c?.source).toBe('inspect');
    expect(c?.evidenceRef).toBe('ev:c1');
  });

  it('无 metricKey 的信号不入图', () => {
    const noMetric: CanonicalSignal = { ...sig('x', 'c9', 'pass', 1), metricKey: undefined };
    const g = buildProvenance([noMetric]);
    expect(g.metricKeys()).toEqual([]);
  });
});
