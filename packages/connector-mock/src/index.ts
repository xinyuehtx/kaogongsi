import type {
  ConnectorCapabilities,
  DataConnector,
  DecisionRecord,
  EvidenceLevel,
  Kpi,
  KpiSet,
  ProjectSummary,
  ReportQuery,
  VersionReport,
  VersionSummary,
} from '@kaogongsi/contracts';

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
  private readonly decision: DecisionRecord;
  private readonly kpis: KpiSet;
  private readonly projects: ProjectSummary[];
  private readonly versionsByProject: Map<string, VersionSummary[]>;
  private readonly reports: Map<string, VersionReport>;

  constructor(opts: MockConnectorOptions = {}) {
    this.id = opts.id ?? 'mock';
    this.evidenceLevel = opts.evidenceLevel ?? 'full';
    this.decision = opts.decision ?? defaultDecision();
    this.kpis = opts.kpis ?? defaultKpis();

    // 前序流程为每个项目的每个版本产出一轮评测结果（VersionReport）。
    // 默认项目的最新版本 = 注入/默认的 decision + kpis（保持 RFC-001 行为）。
    const fixture = buildFixture({
      decision: this.decision,
      kpis: this.kpis,
      evidenceLevel: this.evidenceLevel,
    });
    this.projects = fixture.projects;
    this.versionsByProject = fixture.versionsByProject;
    this.reports = fixture.reports;
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

  async listProjects(): Promise<ProjectSummary[]> {
    return this.projects;
  }

  async listVersions(projectId: string): Promise<VersionSummary[]> {
    return this.versionsByProject.get(projectId) ?? [];
  }

  async fetchVersionReport(projectId: string, versionId: string): Promise<VersionReport> {
    const r = this.reports.get(`${projectId}/${versionId}`);
    if (!r) throw new Error(`未找到版本报告: ${projectId}/${versionId}`);
    return r;
  }
}

// ─────────────────────────────────────────────────────────────
// 默认单份报告（RFC-001 exec 视图直接消费）
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
// 多项目 / 多版本 fixture（RFC-002）
// ─────────────────────────────────────────────────────────────

/** 克隆 KpiSet 并对指定 key 施加增量（负数=更差的旧版本）。 */
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

/** 在 KpiSet 中把某个护栏指标置为破线（用于回退版本演示）。 */
function breachGuardrail(kpis: KpiSet, key: string, value: number): KpiSet {
  return {
    ...kpis,
    guardrail: kpis.guardrail.map((k) =>
      k.key === key ? { ...k, value, guardrailBreached: true, trend: 'up' } : k,
    ),
  };
}

function mkDecision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return { ...defaultDecision(), ...over };
}

interface FixtureInput {
  decision: DecisionRecord;
  kpis: KpiSet;
  evidenceLevel: EvidenceLevel;
}

interface Fixture {
  projects: ProjectSummary[];
  versionsByProject: Map<string, VersionSummary[]>;
  reports: Map<string, VersionReport>;
}

/** 默认项目列表（供无 fixture 时直接读取）。 */
export function defaultProjects(): ProjectSummary[] {
  return [
    { id: 'dt-sheet', name: '钉钉 AI 表格 Agent', description: '表格自动填充 / 公式生成 / 数据洞察' },
    { id: 'fs-doc', name: '飞书文档助手 Agent', description: '长文写作 / 摘要 / 结构化改写' },
  ];
}

function buildFixture(input: FixtureInput): Fixture {
  const projects = defaultProjects();
  const versionsByProject = new Map<string, VersionSummary[]>();
  const reports = new Map<string, VersionReport>();

  const add = (v: VersionSummary, decision: DecisionRecord, kpis: KpiSet): void => {
    const list = versionsByProject.get(v.projectId) ?? [];
    list.push(v);
    versionsByProject.set(v.projectId, list);
    reports.set(`${v.projectId}/${v.id}`, { version: v, decision, kpis });
  };

  // ── 项目一 dt-sheet：最新版承载注入/默认报告（RFC-001 兼容），旧版本递减。
  add(
    {
      id: 'v2.0',
      projectId: 'dt-sheet',
      label: 'v2.0',
      createdAt: '2026-08-20',
      harnessConfigVersion: 'inspect@0.3.9+claude-sonnet',
      evidenceLevel: input.evidenceLevel,
      note: '最新版（当前候选）',
    },
    input.decision,
    input.kpis,
  );
  add(
    {
      id: 'v1.1',
      projectId: 'dt-sheet',
      label: 'v1.1',
      createdAt: '2026-07-18',
      harnessConfigVersion: 'inspect@0.3.7+claude-sonnet',
      evidenceLevel: input.evidenceLevel,
    },
    mkDecision({
      gate: 'ABSTAIN',
      recommendation: '再观察：质量提升但样本不足以确认显著',
      rationale: '任务成功率较 v1.0 上升，但置信区间仍与基线重叠',
    }),
    adjustKpis(input.kpis, {
      success_rate: -8,
      pass_hat_k: -6,
      regressions: 2,
      adoption: -6,
      retention_30d: -3,
      csat: -2,
      cost_of_pass: 0.05,
      roi: -30,
      cost_quality: 0.05,
      hallucination: 1,
      steps_to_success: 1,
    }),
  );
  add(
    {
      id: 'v1.0',
      projectId: 'dt-sheet',
      label: 'v1.0',
      createdAt: '2026-06-30',
      harnessConfigVersion: 'inspect@0.3.5+claude-sonnet',
      evidenceLevel: input.evidenceLevel,
      note: '首个可评测版本（基线）',
    },
    mkDecision({
      gate: 'ABSTAIN',
      recommendation: '基线版本：作为后续对比的锚点',
      rationale: '首次上线，指标作为 baseline',
    }),
    adjustKpis(input.kpis, {
      success_rate: -15,
      pass_hat_k: -12,
      regressions: 5,
      adoption: -12,
      retention_30d: -6,
      csat: -5,
      cost_of_pass: 0.12,
      roi: -70,
      cost_quality: 0.1,
      hallucination: 2,
      steps_to_success: 3,
    }),
  );

  // ── 项目二 fs-doc：始终 full 证据、独立于注入报告；v1.0 相对 v0.9 出现护栏回退（演示 regression）。
  const fsBase = defaultKpis();
  const fsV09 = adjustKpis(fsBase, { success_rate: -4, adoption: -8, roi: -20 });
  const fsV10 = breachGuardrail(
    adjustKpis(fsBase, { success_rate: 3, adoption: 5, roi: 15 }),
    'hallucination',
    9,
  );
  add(
    {
      id: 'v1.0',
      projectId: 'fs-doc',
      label: 'v1.0',
      createdAt: '2026-08-15',
      harnessConfigVersion: 'inspect@0.3.9+claude-sonnet',
      evidenceLevel: 'full',
      note: '质量上升但幻觉率破线（回退风险）',
    },
    mkDecision({
      gate: 'NO_GO',
      recommendation: '建议暂停放量：质量虽升，但幻觉率护栏破线',
      rationale: '任务成功率 +3pp，但幻觉率升至 9%（阈值 5%）',
      sensitivity: '多次运行一致，非噪声',
      counterEvidence: '若能修复幻觉，质量增益可保留',
      attribution: {
        distribution: [
          { party: 'tech', share: 0.7, supportingMetrics: ['hallucination'], supportingCases: ['case-901'] },
          { party: 'product', share: 0.2, supportingMetrics: ['adoption'], supportingCases: ['case-902'] },
          { party: 'ops', share: 0.1, supportingMetrics: ['data_quality'], supportingCases: ['case-903'] },
        ],
        confidence: 'high',
        drillable: true,
      },
    }),
    fsV10,
  );
  add(
    {
      id: 'v0.9',
      projectId: 'fs-doc',
      label: 'v0.9',
      createdAt: '2026-07-10',
      harnessConfigVersion: 'inspect@0.3.7+claude-sonnet',
      evidenceLevel: 'full',
      note: '公测版本（基线）',
    },
    mkDecision({
      gate: 'GO',
      recommendation: '可继续放量：护栏健康、质量稳步',
      rationale: '各护栏指标在阈值内',
    }),
    fsV09,
  );

  return { projects, versionsByProject, reports };
}
