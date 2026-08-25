import { describe, it, expect } from 'vitest';
import type {
  AttributionResult,
  ComparisonView,
  MetricCaseBundle,
  ReportView,
  VersionReport,
} from './index.js';

/**
 * 契约包的测试只验证「类型不变量」能被表达且自洽——这是隔离缝的守卫。
 * 具体各层逻辑在各自包里 BDD/TDD。
 */
describe('契约: 归因结果', () => {
  it('三方归因份额之和应为 1（不变量，供各层实现自检）', () => {
    const attribution: AttributionResult = {
      distribution: [
        { party: 'tech', share: 0.6, supportingMetrics: ['m1'], supportingCases: ['c1'] },
        { party: 'product', share: 0.3, supportingMetrics: ['m2'], supportingCases: ['c2'] },
        { party: 'ops', share: 0.1, supportingMetrics: ['m3'], supportingCases: ['c3'] },
      ],
      confidence: 'medium',
      drillable: true,
    };
    const sum = attribution.distribution.reduce((a, s) => a + s.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('D9.3: 每项归因必须有案例支撑（无 case = 非法）', () => {
    const attribution: AttributionResult = {
      distribution: [
        { party: 'tech', share: 1, supportingMetrics: ['m1'], supportingCases: ['c1'] },
      ],
      confidence: 'high',
      drillable: true,
    };
    for (const share of attribution.distribution) {
      expect(share.supportingCases.length).toBeGreaterThan(0);
    }
  });
});

describe('契约: MetricCaseBundle', () => {
  it('metric-only 之外必须带支撑案例（D9.3）', () => {
    const bundle: MetricCaseBundle = {
      metric: { name: 'pass_rate', mean: 0.7, nSamples: 100, bootstrapStd: 0.045 },
      supportingCases: [{ caseId: 'c1', verdict: 'pass', evidenceRef: 'ev1', lineage: ['src'] }],
      evidenceLevel: 'full',
    };
    if (bundle.evidenceLevel !== 'metric-only') {
      expect(bundle.supportingCases.length).toBeGreaterThan(0);
    }
  });
});

describe('契约: ReportView 多受众', () => {
  it('exec 视角可携带决策，engineer 视角可不带', () => {
    const execView: ReportView = {
      audience: 'exec',
      drillable: true,
      sections: [{ title: 'ROI 趋势', kind: 'trend', data: [], sourceLineage: ['run-1'] }],
    };
    expect(execView.audience).toBe('exec');
  });
});

describe('契约: 项目/版本 + 对比（RFC-002）', () => {
  it('VersionReport 自洽：归因三段和为 1', () => {
    const vr: VersionReport = {
      version: {
        id: 'v2.0',
        projectId: 'p1',
        label: 'v2.0',
        createdAt: '2026-08-01',
        harnessConfigVersion: 'h@1',
        evidenceLevel: 'full',
      },
      decision: {
        gate: 'GO',
        recommendation: '继续',
        rationale: '质量升',
        sensitivity: '稳健',
        counterEvidence: '留存偏低',
        assumptions: [],
        attribution: {
          distribution: [
            { party: 'tech', share: 0.6, supportingMetrics: ['m'], supportingCases: ['c'] },
            { party: 'product', share: 0.4, supportingMetrics: ['m'], supportingCases: ['c'] },
          ],
          confidence: 'medium',
          drillable: true,
        },
      },
      kpis: {
        quality: [],
        product: [],
        financial: [],
        guardrail: [],
        trajectory: { efficiency: [], decisionQuality: [], planningQuality: [], interactionQuality: [], stability: [] },
      },
    };
    const sum = vr.decision.attribution.distribution.reduce((a, s) => a + s.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('ComparisonView: delta 方向枚举 + betterWhen 语义可表达', () => {
    const view: ComparisonView = {
      project: { id: 'p1', name: '项目一', description: '' },
      baseline: { id: 'v1.0', projectId: 'p1', label: 'v1.0', createdAt: '2026-07-01', harnessConfigVersion: 'h@1', evidenceLevel: 'full' },
      candidate: { id: 'v2.0', projectId: 'p1', label: 'v2.0', createdAt: '2026-08-01', harnessConfigVersion: 'h@1', evidenceLevel: 'full' },
      groups: [
        {
          key: 'quality',
          title: '质量',
          deltas: [
            { key: 'success_rate', label: '任务成功率', unit: '%', baseline: 64, candidate: 72, delta: 8, deltaPct: 12.5, betterWhen: 'higher', direction: 'improved', significant: true },
          ],
        },
      ],
      gateBaseline: 'ABSTAIN',
      gateCandidate: 'GO',
    };
    expect(view.groups[0]?.deltas[0]?.direction).toBe('improved');
  });
});
