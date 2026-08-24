import { describe, it, expect } from 'vitest';
import type { DecisionRecord, KpiSet } from '@kaogongsi/contracts';
import { buildExecReportView } from './index.js';

const decision: DecisionRecord = {
  gate: 'GO',
  recommendation: '建议继续投入',
  rationale: '质量升、成本降，差距主要在可修的技术侧',
  sensitivity: '结论对作弊处置策略稳健（三口径一致）',
  counterEvidence: '产品侧留存偏低，需持续观察',
  assumptions: ['harness 配置已锁定', '样本量满足功效'],
  attribution: {
    distribution: [
      { party: 'tech', share: 0.6, supportingMetrics: ['success_rate'], supportingCases: ['c1'] },
      { party: 'product', share: 0.3, supportingMetrics: ['retention'], supportingCases: ['c2'] },
      { party: 'ops', share: 0.1, supportingMetrics: ['data_quality'], supportingCases: ['c3'] },
    ],
    confidence: 'medium',
    drillable: true,
  },
};

const kpis: KpiSet = {
  quality: [{ key: 'success_rate', label: '任务成功率', value: 0.72, unit: '%', sourceLineage: ['run-1'] }],
  product: [{ key: 'retention', label: '30 日留存', value: 0.41, unit: '%', sourceLineage: ['bi-1'] }],
  financial: [{ key: 'cost_of_pass', label: 'Cost-of-Pass', value: 0.18, unit: 'USD', sourceLineage: ['cost-1'] }],
  guardrail: [{ key: 'hallucination', label: '幻觉率', value: 0.03, unit: '%', guardrailBreached: false, sourceLineage: ['run-1'] }],
  trajectory: {
    efficiency: [{ key: 'steps_to_success', label: 'Steps to Success', value: 7, unit: '步', diagnostic: true, sourceLineage: ['run-1'] }],
    decisionQuality: [{ key: 'right_tool_rate', label: 'Right Tool Rate', value: 0.85, unit: '%', diagnostic: true, signalOnly: true, sourceLineage: ['run-1'] }],
    planningQuality: [{ key: 'goal_preservation', label: 'Goal Preservation', value: 0.9, unit: '%', diagnostic: true, sourceLineage: ['run-1'] }],
    interactionQuality: [{ key: 'user_effort', label: 'User Effort', value: 3, unit: '次', diagnostic: true, sourceLineage: ['run-1'] }],
    stability: [{ key: 'variance_across_runs', label: 'Variance across Runs', value: 0.04, unit: 'σ', diagnostic: true, sourceLineage: ['run-1'] }],
  },
};

describe('l6-report: buildExecReportView（TDD）', () => {
  it('AC-1: 产出 exec 视角，含门禁/归因/质量/产品/财务/护栏/过程质量/依据', () => {
    const view = buildExecReportView(decision, kpis, { drillable: true });
    expect(view.audience).toBe('exec');
    expect(view.decision?.gate).toBe('GO');
    const kinds = view.sections.map((s) => s.title);
    expect(kinds).toEqual(
      expect.arrayContaining(['归因分布', '质量', '业务/产品', '财务', '护栏', '过程质量（诊断）', '决策依据']),
    );
  });

  it('AC-2: 归因三段和为 1，各带置信度', () => {
    const view = buildExecReportView(decision, kpis, { drillable: true });
    const sum = decision.attribution.distribution.reduce((a, s) => a + s.share, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(view.decision?.attribution.confidence).toBe('medium');
  });

  it('AC-4: drillable=false 时 view.drillable=false（不伪装可下钻）', () => {
    const view = buildExecReportView(decision, kpis, { drillable: false });
    expect(view.drillable).toBe(false);
  });

  it('过程质量指标标记为 diagnostic；Right Tool Rate 标 signalOnly', () => {
    const view = buildExecReportView(decision, kpis, { drillable: true });
    const proc = view.sections.find((s) => s.title === '过程质量（诊断）');
    const data = proc?.data as { groups: { key: string; items: { signalOnly?: boolean; diagnostic?: boolean }[] }[] };
    const all = data.groups.flatMap((g) => g.items);
    expect(all.every((i) => i.diagnostic)).toBe(true);
    const rtr = all.find((i) => (i as { key?: string }).key === 'right_tool_rate');
    expect(rtr?.signalOnly).toBe(true);
  });
});
