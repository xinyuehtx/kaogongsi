import type {
  ConnectorCapabilities,
  DataConnector,
  DecisionRecord,
  EvidenceLevel,
  Kpi,
  KpiSet,
  ReportQuery,
} from '@kaogongsi/contracts';

const kpi = (
  key: string,
  label: string,
  value: number,
  unit: string,
  extra: Partial<Kpi> = {},
): Kpi => ({ key, label, value, unit, sourceLineage: [`mock:${key}`], ...extra });

/** 本阶段的连接器实现：返回一组自洽的 fixture。将来 BI/Langfuse/L5 连接器实现同接口即替换。 */
export interface MockConnectorOptions {
  id?: string;
  evidenceLevel?: EvidenceLevel; // metric-only 时 drillable=false（D9.3）
  /** 覆盖 fixture，便于测试构造 metric-only / 破线 / NO-GO 等场景 */
  decision?: DecisionRecord;
  kpis?: KpiSet;
}

export class MockConnector implements DataConnector {
  readonly id: string;
  readonly kind: DataConnector['kind'] = 'mock';
  private readonly evidenceLevel: EvidenceLevel;
  private readonly decision: DecisionRecord;
  private readonly kpis: KpiSet;

  constructor(opts: MockConnectorOptions = {}) {
    this.id = opts.id ?? 'mock';
    this.evidenceLevel = opts.evidenceLevel ?? 'full';
    this.decision = opts.decision ?? defaultDecision();
    this.kpis = opts.kpis ?? defaultKpis();
  }

  capabilities(): ConnectorCapabilities {
    return {
      evidenceLevel: this.evidenceLevel,
      drillable: this.evidenceLevel !== 'metric-only',
    };
  }

  async fetchDecision(_query: ReportQuery): Promise<DecisionRecord> {
    return this.decision;
  }

  async fetchKpis(_query: ReportQuery): Promise<KpiSet> {
    return this.kpis;
  }
}

export function defaultDecision(): DecisionRecord {
  return {
    gate: 'GO',
    recommendation: '建议继续投入：质量升、成本降，差距主要在可修的技术侧',
    rationale: '任务成功率环比 +8pp（配对显著 p<0.05）；Cost-of-Pass 下降 20%',
    sensitivity: '对作弊处置策略稳健：记失败/成功/丢弃三口径结论一致',
    counterEvidence: '30 日留存偏低（41%），产品侧价值需持续验证',
    assumptions: ['harness 配置已锁定并公示', '同模型 noise floor 已建立', '样本量满足统计功效'],
    attribution: {
      distribution: [
        { party: 'tech', share: 0.6, supportingMetrics: ['success_rate'], supportingCases: ['case-101'] },
        { party: 'product', share: 0.3, supportingMetrics: ['retention'], supportingCases: ['case-207'] },
        { party: 'ops', share: 0.1, supportingMetrics: ['data_quality'], supportingCases: ['case-312'] },
      ],
      confidence: 'medium',
      drillable: true,
    },
  };
}

export function defaultKpis(): KpiSet {
  return {
    quality: [
      kpi('success_rate', '任务成功率', 72, '%', { trend: 'up' }),
      kpi('pass_hat_k', 'pass^k 可靠性', 25, '%', { trend: 'up' }),
      kpi('regressions', '回归掉的用例', 3, '个', { trend: 'down' }),
    ],
    product: [
      kpi('adoption', '采用率', 38, '%', { trend: 'up' }),
      kpi('retention_30d', '30 日留存', 41, '%', { trend: 'flat' }),
      kpi('csat', '满意度(点赞率)', 86, '%', { trend: 'up' }),
      kpi('task_volume', '任务量', 12400, '次/日', { trend: 'up' }),
      kpi('containment', '自足完成率', 78, '%', { trend: 'up' }),
    ],
    financial: [
      kpi('cost_of_pass', 'Cost-of-Pass', 0.18, 'USD', { trend: 'down' }),
      kpi('roi', 'ROI', 140, '%', { trend: 'up' }),
      kpi('cost_quality', '成本-质量比', 0.25, 'USD/%', { trend: 'down' }),
    ],
    guardrail: [
      kpi('hallucination', '幻觉率', 3, '%', { guardrailBreached: false }),
      kpi('refusal', '拒答率', 5, '%', { guardrailBreached: false }),
      kpi('safety_violation', '安全违规率', 0.4, '%', { guardrailBreached: false }),
      kpi('latency_p95', 'P95 延迟', 28, 'min', { guardrailBreached: false }),
    ],
    trajectory: {
      efficiency: [
        kpi('steps_to_success', 'Steps to Success', 7, '步', { diagnostic: true }),
        kpi('token_efficiency', 'Token Efficiency', 18000, 'tok/任务', { diagnostic: true }),
        kpi('tool_utilization', 'Tool Utilization(成功率)', 91, '%', { diagnostic: true }),
      ],
      decisionQuality: [
        kpi('right_tool_rate', 'Right Tool Rate', 85, '%', { diagnostic: true, signalOnly: true }),
        kpi('redundant_call_rate', 'Redundant Call Rate', 6, '%', { diagnostic: true }),
        kpi('recovery_rate', 'Recovery Rate', 73, '%', { diagnostic: true }),
      ],
      planningQuality: [
        kpi('plan_coherence', 'Plan Coherence', 82, '%', { diagnostic: true }),
        kpi('plan_adaptation', 'Plan Adaptation', 70, '%', { diagnostic: true }),
        kpi('goal_preservation', 'Goal Preservation', 90, '%', { diagnostic: true }),
      ],
      interactionQuality: [
        kpi('clarification_necessity', 'Clarification Necessity', 65, '%', { diagnostic: true }),
        kpi('information_density', 'Information Density', 0.7, '比', { diagnostic: true }),
        kpi('user_effort', 'User Effort', 3, '次', { diagnostic: true }),
      ],
      stability: [
        kpi('variance_across_runs', 'Variance across Runs', 0.04, 'σ', { diagnostic: true }),
        kpi('failure_cascade', 'Failure Cascade', 12, '%', { diagnostic: true }),
      ],
    },
  };
}
