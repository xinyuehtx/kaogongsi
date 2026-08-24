import { describe, it, expect } from 'vitest';
import type {
  AttributionResult,
  MetricCaseBundle,
  ReportView,
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
