import type {
  CanonicalSignal,
  ConnectorCapabilities,
  DataConnector,
  DecisionRecord,
  EvidenceLevel,
  Kpi,
  KpiSet,
  MetricDef,
  ProjectSummary,
  ReportQuery,
  VersionSignals,
  VersionSummary,
} from '@tengxiaohtx/contracts';
import { METRIC_CATALOG } from '@tengxiaohtx/contracts';

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
  private readonly signalsByVersion: Map<string, VersionSignals>;

  constructor(opts: MockConnectorOptions = {}) {
    this.id = opts.id ?? 'mock';
    this.evidenceLevel = opts.evidenceLevel ?? 'full';
    this.decision = opts.decision ?? defaultDecision();
    this.kpis = opts.kpis ?? defaultKpis();

    // 前序流程为每个项目每个版本产出**原始归一化信号**（契约⓪ CanonicalSignal）。
    // 血缘(L2)/指标(L3)/归因(L4)/决策(L5) 全部在下游从信号计算——连接器只取证据（RFC-004）。
    const fixture = buildFixture({ kpis: this.kpis, evidenceLevel: this.evidenceLevel });
    this.projects = fixture.projects;
    this.versionsByProject = fixture.versionsByProject;
    this.signalsByVersion = fixture.signalsByVersion;
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
  async fetchSignals(projectId: string, versionId: string): Promise<VersionSignals> {
    const s = this.signalsByVersion.get(`${projectId}/${versionId}`);
    if (!s) throw new Error(`未找到版本信号: ${projectId}/${versionId}`);
    return s;
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
      kpi('success_rate', '任务成功率', 72, '%', { trend: 'up', betterWhen: 'higher' }),
      kpi('pass_hat_k', 'pass^k 可靠性', 25, '%', { trend: 'up', betterWhen: 'higher' }),
      kpi('regressions', '回归掉的用例', 3, '个', { trend: 'down', betterWhen: 'lower' }),
    ],
    product: [
      kpi('adoption', '采用率', 38, '%', { trend: 'up', betterWhen: 'higher' }),
      kpi('retention_30d', '30 日留存', 41, '%', { trend: 'flat', betterWhen: 'higher' }),
      kpi('csat', '满意度(点赞率)', 86, '%', { trend: 'up', betterWhen: 'higher' }),
      kpi('task_volume', '任务量', 12400, '次/日', { trend: 'up', betterWhen: 'higher' }),
      kpi('containment', '自足完成率', 78, '%', { trend: 'up', betterWhen: 'higher' }),
    ],
    financial: [
      kpi('cost_of_pass', 'Cost-of-Pass', 0.18, 'USD', { trend: 'down', betterWhen: 'lower' }),
      kpi('roi', 'ROI', 140, '%', { trend: 'up', betterWhen: 'higher' }),
      kpi('cost_quality', '成本-质量比', 0.25, 'USD/%', { trend: 'down', betterWhen: 'lower' }),
    ],
    guardrail: [
      kpi('hallucination', '幻觉率', 3, '%', { guardrailBreached: false, betterWhen: 'lower' }),
      kpi('refusal', '拒答率', 5, '%', { guardrailBreached: false, betterWhen: 'lower' }),
      kpi('safety_violation', '安全违规率', 0.4, '%', { guardrailBreached: false, betterWhen: 'lower' }),
      kpi('latency_p95', 'P95 延迟', 28, 'min', { guardrailBreached: false, betterWhen: 'lower' }),
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
// 把某版本的 KpiSet 编码为归一化信号（契约⓪）——L3 会从信号重算回指标。
// case-based 指标铺成 N 个逐案例信号（带 verdict，可供 L2 建血缘 / 下钻）；
// 其余（含 metric-only 全部）铺成单条聚合读数。
// ─────────────────────────────────────────────────────────────
function flattenValues(kpis: KpiSet): Map<string, number> {
  const all: Kpi[] = [
    ...kpis.quality,
    ...kpis.product,
    ...kpis.financial,
    ...kpis.guardrail,
    ...kpis.trajectory.efficiency,
    ...kpis.trajectory.decisionQuality,
    ...kpis.trajectory.planningQuality,
    ...kpis.trajectory.interactionQuality,
    ...kpis.trajectory.stability,
  ];
  return new Map(all.map((k) => [k.key, k.value]));
}

function signalsForVersion(
  projectId: string,
  version: VersionSummary,
  kpis: KpiSet,
): CanonicalSignal[] {
  const values = flattenValues(kpis);
  const meta = {
    source: 'mock',
    sourceLineage: [`mock:${projectId}:${version.id}`],
    runId: version.id,
    experimentId: projectId,
    harnessConfigVersion: version.harnessConfigVersion,
    evidenceLevel: version.evidenceLevel,
    evidence: {},
  };
  const out: CanonicalSignal[] = [];

  const pushAgg = (def: MetricDef, value: number): void => {
    out.push({ ...meta, caseId: `${version.id}:${def.key}:agg`, metricKey: def.key, observation: value, verdict: 'unknown' });
  };
  const pushCases = (def: MetricDef, value: number): void => {
    const n = def.nSamples ?? 100;
    const positives = Math.round((value / 100) * n); // higher-better=通过数；lower-better=命中(坏)数
    for (let i = 0; i < n; i++) {
      const hit = i < positives; // observation=1 的案例
      // higher-better：hit=通过；lower-better：hit=坏事件(失败)
      const verdict: CanonicalSignal['verdict'] =
        def.betterWhen === 'higher' ? (hit ? 'pass' : 'fail') : hit ? 'fail' : 'pass';
      out.push({
        ...meta,
        caseId: `${version.id}:${def.key}:${i}`,
        metricKey: def.key,
        observation: hit ? 1 : 0,
        verdict,
      });
    }
  };

  for (const def of METRIC_CATALOG) {
    const value = values.get(def.key);
    if (value === undefined) continue;
    if (def.caseBased && version.evidenceLevel !== 'metric-only') pushCases(def, value);
    else pushAgg(def, value); // 聚合读数（含 metric-only 全部）
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 多项目 / 多版本 fixture（RFC-002/003/004）
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
    guardrail: kpis.guardrail.map((k) => (k.key === key ? { ...k, value, trend: 'up' } : k)),
  };
}

interface FixtureInput {
  kpis: KpiSet;
  evidenceLevel: EvidenceLevel;
}
interface Fixture {
  projects: ProjectSummary[];
  versionsByProject: Map<string, VersionSummary[]>;
  signalsByVersion: Map<string, VersionSignals>;
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
  const signalsByVersion = new Map<string, VersionSignals>();

  const add = (v: VersionSummary, kpis: KpiSet): void => {
    const list = versionsByProject.get(v.projectId) ?? [];
    list.push(v);
    versionsByProject.set(v.projectId, list);
    signalsByVersion.set(`${v.projectId}/${v.id}`, {
      version: v,
      signals: signalsForVersion(v.projectId, v, kpis),
    });
  };

  // ── 项目一 dt-sheet：最新版承载注入/默认 KPI，旧版本递减。
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

  return { projects, versionsByProject, signalsByVersion };
}
