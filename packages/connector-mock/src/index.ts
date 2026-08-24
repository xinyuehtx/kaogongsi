import type {
  ConnectorCapabilities,
  DataConnector,
  DecisionRecord,
  EvidenceLevel,
  Kpi,
  KpiSet,
  MetricCaseBundle,
  ProjectSummary,
  ReportQuery,
  SupportingCase,
  VersionEvaluation,
  VersionSummary,
} from '@kaogongsi/contracts';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

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
  private readonly decision: DecisionRecord; // 仅供 RFC-001 legacy fetchDecision
  private readonly kpis: KpiSet;
  private readonly projects: ProjectSummary[];
  private readonly versionsByProject: Map<string, VersionSummary[]>;
  private readonly evaluations: Map<string, VersionEvaluation>;

  constructor(opts: MockConnectorOptions = {}) {
    this.id = opts.id ?? 'mock';
    this.evidenceLevel = opts.evidenceLevel ?? 'full';
    this.decision = opts.decision ?? defaultDecision();
    this.kpis = opts.kpis ?? defaultKpis();

    // 前序流程为每个项目每个版本产出**原始评测证据**（KpiSet + MetricCaseBundle）。
    // 归因(L4)/决策(L5)不在连接器里算——连接器只取证据（RFC-003 层间隔离）。
    // 默认项目最新版承载注入/默认 KPI，保持既有场景（mock/breach/metric-only）。
    const fixture = buildFixture({ kpis: this.kpis, evidenceLevel: this.evidenceLevel });
    this.projects = fixture.projects;
    this.versionsByProject = fixture.versionsByProject;
    this.evaluations = fixture.evaluations;
  }

  capabilities(): ConnectorCapabilities {
    return {
      evidenceLevel: this.evidenceLevel,
      drillable: this.evidenceLevel !== 'metric-only',
    };
  }

  // RFC-001 legacy：单份烤好的报告（/api/report/exec 仍用）
  async fetchDecision(_query: ReportQuery): Promise<DecisionRecord> {
    return this.decision;
  }
  async fetchKpis(_query: ReportQuery): Promise<KpiSet> {
    return this.kpis;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.projects;
  }
  async listVersions(projectId: string): Promise<VersionSummary[]> {
    return this.versionsByProject.get(projectId) ?? [];
  }
  async fetchEvaluation(projectId: string, versionId: string): Promise<VersionEvaluation> {
    const ev = this.evaluations.get(`${projectId}/${versionId}`);
    if (!ev) throw new Error(`未找到版本证据: ${projectId}/${versionId}`);
    return ev;
  }
}

// ─────────────────────────────────────────────────────────────
// 默认单份报告（RFC-001 legacy exec 视图直接消费）
// ─────────────────────────────────────────────────────────────
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
      kpi('success_rate', '任务成功率', 72, '%', { trend: 'up', betterWhen: 'higher', stdDev: 2, nSamples: 200 }),
      kpi('pass_hat_k', 'pass^k 可靠性', 25, '%', { trend: 'up', betterWhen: 'higher', stdDev: 2, nSamples: 200 }),
      kpi('regressions', '回归掉的用例', 3, '个', { trend: 'down', betterWhen: 'lower', stdDev: 1, nSamples: 200 }),
    ],
    product: [
      kpi('adoption', '采用率', 38, '%', { trend: 'up', betterWhen: 'higher', stdDev: 1.5 }),
      kpi('retention_30d', '30 日留存', 41, '%', { trend: 'flat', betterWhen: 'higher', stdDev: 1.5 }),
      kpi('csat', '满意度(点赞率)', 86, '%', { trend: 'up', betterWhen: 'higher', stdDev: 1 }),
      kpi('task_volume', '任务量', 12400, '次/日', { trend: 'up', betterWhen: 'higher' }),
      kpi('containment', '自足完成率', 78, '%', { trend: 'up', betterWhen: 'higher', stdDev: 1.5 }),
    ],
    financial: [
      kpi('cost_of_pass', 'Cost-of-Pass', 0.18, 'USD', { trend: 'down', betterWhen: 'lower', stdDev: 0.01 }),
      kpi('roi', 'ROI', 140, '%', { trend: 'up', betterWhen: 'higher', stdDev: 8 }),
      kpi('cost_quality', '成本-质量比', 0.25, 'USD/%', { trend: 'down', betterWhen: 'lower', stdDev: 0.02 }),
    ],
    guardrail: [
      kpi('hallucination', '幻觉率', 3, '%', { guardrailBreached: false, betterWhen: 'lower', stdDev: 0.5 }),
      kpi('refusal', '拒答率', 5, '%', { guardrailBreached: false, betterWhen: 'lower', stdDev: 0.5 }),
      kpi('safety_violation', '安全违规率', 0.4, '%', { guardrailBreached: false, betterWhen: 'lower', stdDev: 0.1 }),
      kpi('latency_p95', 'P95 延迟', 28, 'min', { guardrailBreached: false, betterWhen: 'lower', stdDev: 2 }),
    ],
    trajectory: {
      efficiency: [
        kpi('steps_to_success', 'Steps to Success', 7, '步', { diagnostic: true, betterWhen: 'lower' }),
        kpi('token_efficiency', 'Token Efficiency', 18000, 'tok/任务', { diagnostic: true, betterWhen: 'lower' }),
        kpi('tool_utilization', 'Tool Utilization(成功率)', 91, '%', { diagnostic: true, betterWhen: 'higher' }),
      ],
      decisionQuality: [
        kpi('right_tool_rate', 'Right Tool Rate', 85, '%', { diagnostic: true, signalOnly: true, betterWhen: 'higher' }),
        kpi('redundant_call_rate', 'Redundant Call Rate', 6, '%', { diagnostic: true, betterWhen: 'lower' }),
        kpi('recovery_rate', 'Recovery Rate', 73, '%', { diagnostic: true, betterWhen: 'higher' }),
      ],
      planningQuality: [
        kpi('plan_coherence', 'Plan Coherence', 82, '%', { diagnostic: true, betterWhen: 'higher' }),
        kpi('plan_adaptation', 'Plan Adaptation', 70, '%', { diagnostic: true, betterWhen: 'higher' }),
        kpi('goal_preservation', 'Goal Preservation', 90, '%', { diagnostic: true, betterWhen: 'higher' }),
      ],
      interactionQuality: [
        kpi('clarification_necessity', 'Clarification Necessity', 65, '%', { diagnostic: true, betterWhen: 'higher' }),
        kpi('information_density', 'Information Density', 0.7, '比', { diagnostic: true, betterWhen: 'higher' }),
        kpi('user_effort', 'User Effort', 3, '次', { diagnostic: true, betterWhen: 'lower' }),
      ],
      stability: [
        kpi('variance_across_runs', 'Variance across Runs', 0.04, 'σ', { diagnostic: true, betterWhen: 'lower' }),
        kpi('failure_cascade', 'Failure Cascade', 12, '%', { diagnostic: true, betterWhen: 'lower' }),
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 从 KPI 合成 MetricCaseBundle 证据（契约②）
// 每个指标按"相对目标的欠缺"确定失败案例数——让下游归因有据可依、数据驱动。
// ─────────────────────────────────────────────────────────────
const TARGET: Record<string, number> = {
  success_rate: 70,
  pass_hat_k: 20,
  regressions: 3,
  adoption: 35,
  retention_30d: 45,
  csat: 85,
  containment: 75,
  cost_of_pass: 0.2,
  roi: 120,
  cost_quality: 0.28,
  hallucination: 5,
  refusal: 8,
  safety_violation: 1,
  latency_p95: 30,
};

const CASES_PER_BUNDLE = 4;

function casesFor(
  projectId: string,
  versionId: string,
  k: Kpi,
  evidenceLevel: EvidenceLevel,
): SupportingCase[] {
  if (evidenceLevel === 'metric-only') return []; // 纯 BI：无案例血缘（D9.3）
  const t = TARGET[k.key];
  const shortfall =
    t === undefined
      ? 0
      : k.betterWhen === 'lower'
        ? clamp01((k.value - t) / t)
        : clamp01((t - k.value) / t);
  const fails = k.guardrailBreached ? CASES_PER_BUNDLE : Math.round(shortfall * CASES_PER_BUNDLE);
  return Array.from({ length: CASES_PER_BUNDLE }, (_, i) => ({
    caseId: `${versionId}:${k.key}:${i}`,
    verdict: i < fails ? 'fail' : 'pass',
    evidenceRef: `ev:${projectId}:${versionId}:${k.key}:${i}`,
    lineage: [`mock:${projectId}:${versionId}`],
  }));
}

function bundlesFromKpis(
  projectId: string,
  version: VersionSummary,
  kpis: KpiSet,
): MetricCaseBundle[] {
  const scoring: Kpi[] = [...kpis.quality, ...kpis.product, ...kpis.financial, ...kpis.guardrail];
  return scoring
    .filter((k) => k.key in TARGET)
    .map((k) => ({
      metric: { name: k.key, mean: k.value, nSamples: k.nSamples ?? 200, bootstrapStd: k.stdDev },
      supportingCases: casesFor(projectId, version.id, k, version.evidenceLevel),
      evidenceLevel: version.evidenceLevel,
    }));
}

// ─────────────────────────────────────────────────────────────
// 多项目 / 多版本 fixture（RFC-002/003）
// ─────────────────────────────────────────────────────────────
function adjustKpis(base: KpiSet, deltas: Record<string, number>): KpiSet {
  const bump = (arr: Kpi[]): Kpi[] =>
    arr.map((k) => (k.key in deltas ? { ...k, value: round2(k.value + (deltas[k.key] ?? 0)) } : { ...k }));
  return {
    quality: bump(base.quality),
    product: bump(base.product),
    financial: bump(base.financial),
    guardrail: bump(base.guardrail),
    trajectory: {
      efficiency: bump(base.trajectory.efficiency),
      decisionQuality: bump(base.trajectory.decisionQuality),
      planningQuality: bump(base.trajectory.planningQuality),
      interactionQuality: bump(base.trajectory.interactionQuality),
      stability: bump(base.trajectory.stability),
    },
  };
}

function breachGuardrail(kpis: KpiSet, key: string, value: number): KpiSet {
  return {
    ...kpis,
    guardrail: kpis.guardrail.map((k) =>
      k.key === key ? { ...k, value, guardrailBreached: true, trend: 'up' } : k,
    ),
  };
}

interface FixtureInput {
  kpis: KpiSet;
  evidenceLevel: EvidenceLevel;
}

interface Fixture {
  projects: ProjectSummary[];
  versionsByProject: Map<string, VersionSummary[]>;
  evaluations: Map<string, VersionEvaluation>;
}

export function defaultProjects(): ProjectSummary[] {
  return [
    { id: 'dt-sheet', name: '钉钉 AI 表格 Agent', description: '表格自动填充 / 公式生成 / 数据洞察' },
    { id: 'fs-doc', name: '飞书文档助手 Agent', description: '长文写作 / 摘要 / 结构化改写' },
  ];
}

function buildFixture(input: FixtureInput): Fixture {
  const projects = defaultProjects();
  const versionsByProject = new Map<string, VersionSummary[]>();
  const evaluations = new Map<string, VersionEvaluation>();

  const add = (v: VersionSummary, kpis: KpiSet): void => {
    const list = versionsByProject.get(v.projectId) ?? [];
    list.push(v);
    versionsByProject.set(v.projectId, list);
    evaluations.set(`${v.projectId}/${v.id}`, {
      version: v,
      kpis,
      bundles: bundlesFromKpis(v.projectId, v, kpis),
    });
  };

  // ── 项目一 dt-sheet：最新版承载注入/默认 KPI（保 RFC-001/002 场景），旧版本递减。
  add(
    { id: 'v2.0', projectId: 'dt-sheet', label: 'v2.0', createdAt: '2026-08-20', harnessConfigVersion: 'inspect@0.3.9+claude-sonnet', evidenceLevel: input.evidenceLevel, note: '最新版（当前候选）' },
    input.kpis,
  );
  add(
    { id: 'v1.1', projectId: 'dt-sheet', label: 'v1.1', createdAt: '2026-07-18', harnessConfigVersion: 'inspect@0.3.7+claude-sonnet', evidenceLevel: input.evidenceLevel },
    adjustKpis(input.kpis, { success_rate: -8, pass_hat_k: -6, regressions: 2, adoption: -6, retention_30d: -3, csat: -2, cost_of_pass: 0.05, roi: -30, cost_quality: 0.05, hallucination: 1, steps_to_success: 1 }),
  );
  add(
    { id: 'v1.0', projectId: 'dt-sheet', label: 'v1.0', createdAt: '2026-06-30', harnessConfigVersion: 'inspect@0.3.5+claude-sonnet', evidenceLevel: input.evidenceLevel, note: '首个可评测版本（基线）' },
    adjustKpis(input.kpis, { success_rate: -15, pass_hat_k: -12, regressions: 5, adoption: -12, retention_30d: -6, csat: -5, cost_of_pass: 0.12, roi: -70, cost_quality: 0.1, hallucination: 2, steps_to_success: 3 }),
  );

  // ── 项目二 fs-doc：始终 full 证据；v1.0 相对 v0.9 出现护栏回退（演示 regression + NO-GO）。
  const fsBase = defaultKpis();
  add(
    { id: 'v1.0', projectId: 'fs-doc', label: 'v1.0', createdAt: '2026-08-15', harnessConfigVersion: 'inspect@0.3.9+claude-sonnet', evidenceLevel: 'full', note: '质量上升但幻觉率破线（回退风险）' },
    breachGuardrail(adjustKpis(fsBase, { success_rate: 3, adoption: 5, roi: 15 }), 'hallucination', 9),
  );
  add(
    { id: 'v0.9', projectId: 'fs-doc', label: 'v0.9', createdAt: '2026-07-10', harnessConfigVersion: 'inspect@0.3.7+claude-sonnet', evidenceLevel: 'full', note: '公测版本（基线）' },
    adjustKpis(fsBase, { success_rate: -4, adoption: -8, roi: -20 }),
  );

  return { projects, versionsByProject, evaluations };
}
