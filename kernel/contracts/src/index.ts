/**
 * 五道契约（= 层间隔离缝）的类型定义。
 * 对应 RFC ARCHITECTURE.md §6。每层只依赖下层的契约类型，不依赖其实现。
 *
 * 本包只放**类型与不变量**，不含任何一层的业务逻辑——这是"上下游隔离"的根基。
 */

/** 证据级别（D9.3）：决定归因粒度与置信度上限。metric-only 不可下钻。 */
export type EvidenceLevel = 'full' | 'partial' | 'metric-only';

/** 三个组织责任方（D7 / T67）。 */
export type ResponsibleParty = 'tech' | 'product' | 'ops';

/** 三态门禁（T67 / D8）。 */
export type Gate = 'GO' | 'NO_GO' | 'ABSTAIN';

/** 报告受众（D6.2）。 */
export type Audience = 'exec' | 'product' | 'engineer';

// ─────────────────────────────────────────────────────────────
// 可组装分层管道（RFC-008）—— 插件组装方向自下而上，与内核依赖方向相反。
// 内核依赖：上层包 import 下层契约（自上而下）。
// 管道组装：下层输出 → 上层输入（自下而上）；App 选层切片，插件按所选层贡献 stage。
// ─────────────────────────────────────────────────────────────
export type LayerId = 'ingest' | 'provenance' | 'metrics' | 'attribution' | 'decision' | 'report';

/** 层的自下而上顺序（数据流方向；组装即按此串联）。 */
export const LAYER_ORDER: LayerId[] = ['ingest', 'provenance', 'metrics', 'attribution', 'decision', 'report'];

/**
 * 管道上下文：随层自下而上累积。上层 stage 可读下层 stage 的产出
 * （如 decision(L5) 读 attribution(L4) 产出）。
 */
export interface LayerContext {
  version?: VersionSummary;
  signals?: CanonicalSignal[];
  evaluation?: VersionEvaluation; // metrics(L3) 产出
  attribution?: AttributionResult; // attribution(L4) 产出
  decision?: DecisionRecord; // decision(L5) 产出
  view?: ReportView; // report(L6) 产出
  drillable?: boolean;
  [key: string]: unknown; // 插件自定义产出（跨层组装）
}

/** 一个层的可组装组件：读 ctx（含下层产出）→ 产出本层结果（合并回 ctx）。 */
export interface LayerStage {
  layer: LayerId;
  id: string;
  run(ctx: LayerContext): Partial<LayerContext> | Promise<Partial<LayerContext>>;
}

// ─────────────────────────────────────────────────────────────
// 契约⓪ Canonical Signal Model —— L1→L2，采集隔离边界
// 任何来源（我方执行器 / BI / 现有平台 / 人工评价）都归一化到此。
// ─────────────────────────────────────────────────────────────
export interface CanonicalSignal {
  source: string;
  sourceLineage: string[]; // 血缘：可追溯到原始来源
  runId: string;
  caseId: string;
  experimentId: string;
  harnessConfigVersion: string; // A2：harness 一等公民，版本化
  evidenceLevel: EvidenceLevel;
  // 归一化观测（RFC-004）：任何来源都把"某指标的一次观测"归一到此。
  metricKey?: string; // 该信号归属的指标
  observation?: number; // 数值观测（case-based：1/0；成本/延迟：原值；aggregate：指标值）
  verdict?: 'pass' | 'partial' | 'fail' | 'unknown'; // case-based 判定
  stratum?: string; // 分层标签（难度/场景/租户…）——用于分层指标（RFC-012）
  evidence: {
    trajectoryEvents?: unknown[]; // 轨迹事件（带 parentId 因果链），L2 细化
    artifacts?: unknown[];
    worldState?: unknown;
    costUsd?: number;
    tokens?: number;
  };
}

// ─────────────────────────────────────────────────────────────
// 契约② MetricCaseBundle —— L3→L4，"BI 数据也能归因"的关键缝
// 归因层只消费此契约，不关心数据来自沙箱还是 BI。
// ─────────────────────────────────────────────────────────────
export interface SupportingCase {
  caseId: string;
  verdict: 'pass' | 'partial' | 'fail' | 'unknown';
  evidenceRef: string; // 指向 Provenance 图节点
  lineage: string[];
}

export interface MetricValue {
  name: string;
  mean: number;
  nSamples: number;
  bootstrapStd?: number; // A4：指标必带不确定性
}

export interface MetricCaseBundle {
  metric: MetricValue;
  supportingCases: SupportingCase[]; // D9.3：产出必带案例，禁止 metric-only 报告
  evidenceLevel: EvidenceLevel;
}

// ─────────────────────────────────────────────────────────────
// 契约③ AttributionResult —— L4→L5
// 每项归因必须挂支撑指标 + 案例 + 血缘（D9.3 硬约束）。
// ─────────────────────────────────────────────────────────────
export interface AttributionShare {
  party: ResponsibleParty;
  share: number; // 0..1，三方之和 = 1
  supportingMetrics: string[];
  supportingCases: string[]; // 无 case 支撑则该归因非法（D9.3）
  counterfactualVerified?: boolean; // REFLECT 反事实（T57）
}

export interface AttributionResult {
  distribution: AttributionShare[];
  confidence: 'low' | 'medium' | 'high';
  drillable: boolean; // evidenceLevel=metric-only 时为 false
  /** 反事实验证方法说明（RFC-012）：当前为**数据级充分性检验**，非重跑执行器。 */
  counterfactualMethod?: string;
}

// ─────────────────────────────────────────────────────────────
// 契约④ ReportView / DecisionRecord —— L5→L6
// 呈现层随受众重写，证据层不变（T66）。
// ─────────────────────────────────────────────────────────────
export interface DecisionRecord {
  gate: Gate;
  recommendation: string;
  rationale: string;
  sensitivity: string; // 敏感性/置信度
  counterEvidence: string; // 反对证据（assurance case，D8.2）
  assumptions: string[];
  attribution: AttributionResult;
}

export interface ReportView {
  audience: Audience;
  decision?: DecisionRecord; // exec 视角带决策
  drillable: boolean; // 连接器能力=metric-only 时为 false（D9.3）
  sections: ReportSection[];
}

export interface ReportSection {
  title: string;
  kind: 'kpi' | 'trend' | 'pareto' | 'matrix' | 'attribution' | 'drilldown';
  data: unknown;
  sourceLineage: string[]; // 每个数字可下钻带血缘（T66）
}

// ─────────────────────────────────────────────────────────────
// KPI 目录（RFC-001 §3.3）—— 从常见 Agent 产品 + evals 提炼
// ─────────────────────────────────────────────────────────────
export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: string;
  trend?: 'up' | 'down' | 'flat';
  guardrailBreached?: boolean; // 护栏破线（A8）
  diagnostic?: boolean; // 诊断/效率用，非 pass/fail 打分（D11/A1）
  signalOnly?: boolean; // 仅排查信号，不作门禁（如 Right Tool Rate）
  betterWhen?: 'higher' | 'lower'; // 变好的方向；缺省按启发式推断
  stdDev?: number; // A4：重复采样标准差（用于显著性/置信区间）
  nSamples?: number; // 样本量
  /** 观测分布分位数（RFC-012，如延迟）：有原始分布时才给。 */
  distribution?: { p50?: number; p95?: number; p99?: number };
  /** 分层取值（RFC-012 / T56 分层报告）：整体值可能掩盖某层的严重问题。 */
  strata?: MetricStratum[];
  /** pass^k 由**多次重复运行**实测得出（而非独立性假设外推）——A4/P1。 */
  passHatKFromRuns?: boolean;
  sourceLineage: string[];
}

/** 过程质量：轨迹级 5 类（诊断，非打分 —— D11/A1）。 */
export interface TrajectoryKpis {
  efficiency: Kpi[]; // Steps to Success / Token Efficiency / Tool Utilization
  decisionQuality: Kpi[]; // Right Tool Rate(signalOnly) / Redundant Call Rate / Recovery Rate
  planningQuality: Kpi[]; // Plan Coherence / Plan Adaptation / Goal Preservation
  interactionQuality: Kpi[]; // Clarification Necessity / Information Density / User Effort
  stability: Kpi[]; // Variance across Runs / Failure Cascade
}

export interface KpiSet {
  quality: Kpi[]; // 成败结果：任务成功率 / pass^k / 回归数
  product: Kpi[]; // 采用率 / 留存 / 满意度 / 任务量 / 自足完成率
  financial: Kpi[]; // Cost-of-Pass / ROI / 成本-质量
  guardrail: Kpi[]; // 幻觉率 / 拒答率 / 安全违规率 / P95 延迟
  trajectory: TrajectoryKpis; // 过程质量五类（诊断）
}

// ─────────────────────────────────────────────────────────────
// 项目 / 版本模型（RFC-002）—— 评测报告按「项目 → 版本」组织
// 前序流程为每个项目的每个版本产出一轮评测结果（VersionReport）。
// ─────────────────────────────────────────────────────────────
export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
}

export interface VersionSummary {
  id: string;
  projectId: string;
  label: string; // 展示用版本号，如 v1.0 / v1.1
  createdAt: string; // ISO 日期，血缘/可复现（A2）
  harnessConfigVersion: string; // A2：harness 一等公民，版本化
  evidenceLevel: EvidenceLevel;
  note?: string;
}

/** 单个版本的完整评测结果（一轮评测的产物）。 */
export interface VersionReport {
  version: VersionSummary;
  decision: DecisionRecord;
  kpis: KpiSet;
}

/**
 * 单个版本的**原始评测证据**（RFC-003）——连接器的真实产物（契约②级）。
 * 归因引擎(L4)消费 bundles，决策引擎(L5)据归因产出 DecisionRecord。
 * 连接器只负责"取证据"，不负责"归因/决策"（层间隔离）。
 */
export interface VersionEvaluation {
  version: VersionSummary;
  kpis: KpiSet;
  bundles: MetricCaseBundle[]; // 指标 + 支撑案例 + 血缘（D9.3）
}

/**
 * 单个版本的**原始归一化信号**（契约⓪ Canonical Signal Model）——连接器(L1)的真实产物。
 * L2 据此建血缘图、L3 据此算指标。任何来源（执行器/BI/评测平台）都归一到 CanonicalSignal。
 */
export interface VersionSignals {
  version: VersionSummary;
  signals: CanonicalSignal[];
}

// ─────────────────────────────────────────────────────────────
// 指标目录（共享词汇，RFC-004）—— 各层对"指标是什么"的单一事实源。
// L3 据此把计算值归位到 KpiSet；连接器据此生成信号；L4 据此归责。
// ─────────────────────────────────────────────────────────────
export type MetricGroup =
  | 'quality'
  | 'product'
  | 'financial'
  | 'guardrail'
  | 'efficiency'
  | 'decisionQuality'
  | 'planningQuality'
  | 'interactionQuality'
  | 'stability';

/**
 * 指标聚合方式（RFC-012）：决定 L3 如何把一批观测折成一个值。
 *  - rate         逐实例 0/1 → 通过率×100（case-based 默认）
 *  - mean         观测均值（聚合读数默认；单读数即该值）
 *  - cost_per_pass 总成本 / 通过数（Cost-of-Pass，真实成本分布）
 *  - p50 / p95 / p99  观测分布的分位数（延迟等）
 */
export type MetricAggregation = 'rate' | 'mean' | 'cost_per_pass' | 'p50' | 'p95' | 'p99';

/** 分层指标的一层（RFC-012）：同一指标在某个切片上的取值。 */
export interface MetricStratum {
  key: string; // 层标签（如 hard / tenant-a）
  value: number;
  nSamples: number;
}

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  group: MetricGroup;
  betterWhen: 'higher' | 'lower';
  aggregation?: MetricAggregation; // 缺省：caseBased→rate，否则 mean
  caseBased?: boolean; // true=逐实例判定（可下钻到案例），false=聚合读数（BI 式）
  diagnostic?: boolean; // 过程质量：诊断非门禁（D11/A1）
  signalOnly?: boolean;
  guardrailThreshold?: number; // 护栏阈值：越界即破线（A8）
  target?: number; // 归因用目标线：低于/高于目标即视为欠缺
  nSamples?: number; // case-based 默认样本量
}

const TRAJ_GROUPS: MetricGroup[] = [
  'efficiency',
  'decisionQuality',
  'planningQuality',
  'interactionQuality',
  'stability',
];

/** 该指标是否属于过程质量（轨迹级五类）。 */
export function isTrajectoryGroup(g: MetricGroup): boolean {
  return TRAJ_GROUPS.includes(g);
}

export const METRIC_CATALOG: MetricDef[] = [
  // 质量（成败结果）
  { key: 'success_rate', label: '任务成功率', unit: '%', group: 'quality', betterWhen: 'higher', caseBased: true, target: 70, nSamples: 100 },
  { key: 'pass_hat_k', label: 'pass^k 可靠性', unit: '%', group: 'quality', betterWhen: 'higher', caseBased: true, target: 20, nSamples: 100 },
  { key: 'regressions', label: '回归掉的用例', unit: '个', group: 'quality', betterWhen: 'lower', target: 3 },
  // 业务 / 产品
  { key: 'adoption', label: '采用率', unit: '%', group: 'product', betterWhen: 'higher', target: 35 },
  { key: 'retention_30d', label: '30 日留存', unit: '%', group: 'product', betterWhen: 'higher', target: 45 },
  { key: 'csat', label: '满意度(点赞率)', unit: '%', group: 'product', betterWhen: 'higher', target: 85 },
  { key: 'task_volume', label: '任务量', unit: '次/日', group: 'product', betterWhen: 'higher', target: 10000 },
  { key: 'containment', label: '自足完成率', unit: '%', group: 'product', betterWhen: 'higher', target: 75 },
  // 财务
  { key: 'cost_of_pass', label: 'Cost-of-Pass', unit: 'USD', group: 'financial', betterWhen: 'lower', aggregation: 'cost_per_pass', target: 0.2 },
  { key: 'roi', label: 'ROI', unit: '%', group: 'financial', betterWhen: 'higher', target: 120 },
  { key: 'cost_quality', label: '成本-质量比', unit: 'USD/%', group: 'financial', betterWhen: 'lower', target: 0.28 },
  // 护栏（含阈值）
  { key: 'hallucination', label: '幻觉率', unit: '%', group: 'guardrail', betterWhen: 'lower', caseBased: true, target: 5, guardrailThreshold: 5, nSamples: 100 },
  { key: 'refusal', label: '拒答率', unit: '%', group: 'guardrail', betterWhen: 'lower', caseBased: true, target: 8, guardrailThreshold: 10, nSamples: 100 },
  { key: 'safety_violation', label: '安全违规率', unit: '%', group: 'guardrail', betterWhen: 'lower', target: 1, guardrailThreshold: 1 },
  { key: 'latency_p95', label: 'P95 延迟', unit: 'min', group: 'guardrail', betterWhen: 'lower', aggregation: 'p95', target: 30, guardrailThreshold: 35 },
  // 过程质量 · 效率（诊断）
  { key: 'steps_to_success', label: 'Steps to Success', unit: '步', group: 'efficiency', betterWhen: 'lower', diagnostic: true },
  { key: 'token_efficiency', label: 'Token Efficiency', unit: 'tok/任务', group: 'efficiency', betterWhen: 'lower', diagnostic: true },
  { key: 'tool_utilization', label: 'Tool Utilization(成功率)', unit: '%', group: 'efficiency', betterWhen: 'higher', diagnostic: true },
  // 过程质量 · 决策质量（诊断）
  { key: 'right_tool_rate', label: 'Right Tool Rate', unit: '%', group: 'decisionQuality', betterWhen: 'higher', diagnostic: true, signalOnly: true },
  { key: 'redundant_call_rate', label: 'Redundant Call Rate', unit: '%', group: 'decisionQuality', betterWhen: 'lower', diagnostic: true },
  { key: 'recovery_rate', label: 'Recovery Rate', unit: '%', group: 'decisionQuality', betterWhen: 'higher', diagnostic: true },
  // 过程质量 · 规划质量（诊断）
  { key: 'plan_coherence', label: 'Plan Coherence', unit: '%', group: 'planningQuality', betterWhen: 'higher', diagnostic: true },
  { key: 'plan_adaptation', label: 'Plan Adaptation', unit: '%', group: 'planningQuality', betterWhen: 'higher', diagnostic: true },
  { key: 'goal_preservation', label: 'Goal Preservation', unit: '%', group: 'planningQuality', betterWhen: 'higher', diagnostic: true },
  // 过程质量 · 交互质量（诊断）
  { key: 'clarification_necessity', label: 'Clarification Necessity', unit: '%', group: 'interactionQuality', betterWhen: 'higher', diagnostic: true },
  { key: 'information_density', label: 'Information Density', unit: '比', group: 'interactionQuality', betterWhen: 'higher', diagnostic: true },
  { key: 'user_effort', label: 'User Effort', unit: '次', group: 'interactionQuality', betterWhen: 'lower', diagnostic: true },
  // 过程质量 · 稳定性（诊断）
  { key: 'variance_across_runs', label: 'Variance across Runs', unit: 'σ', group: 'stability', betterWhen: 'lower', diagnostic: true },
  { key: 'failure_cascade', label: 'Failure Cascade', unit: '%', group: 'stability', betterWhen: 'lower', diagnostic: true },
];

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(
  METRIC_CATALOG.map((m) => [m.key, m]),
);

// ─────────────────────────────────────────────────────────────
// 契约① Provenance 查询 API —— L2→L3，证据图投影（可按指标/案例下钻）
// ─────────────────────────────────────────────────────────────
export interface ProvenanceCase {
  caseId: string;
  metricKey: string;
  verdict: 'pass' | 'partial' | 'fail' | 'unknown';
  observation: number;
  evidenceRef: string;
  lineage: string[];
  source: string;
  runId: string; // 同一 caseId 的多个 runId = 重复运行（pass^k 实测，RFC-012）
  stratum?: string; // 分层标签（RFC-012）
}

export interface ProvenanceQuery {
  metricKeys(): string[];
  casesForMetric(metricKey: string): ProvenanceCase[];
  drilldown(caseId: string): ProvenanceCase | undefined;
}

// ─────────────────────────────────────────────────────────────
// 版本对比契约（RFC-002）—— L6 对比视图
// A4：对比必带方向 + 显著性，不做裸分对比。
// ─────────────────────────────────────────────────────────────
export type DeltaDirection = 'improved' | 'regressed' | 'flat';

export interface MetricDelta {
  key: string;
  label: string;
  unit: string;
  baseline: number;
  candidate: number;
  delta: number; // candidate - baseline
  deltaPct: number | null; // 相对基线百分比；基线为 0 时为 null
  betterWhen: 'higher' | 'lower'; // 成功率/采用率=higher；护栏/成本/步数=lower
  direction: DeltaDirection;
  significant?: boolean; // A4：基于 bootstrapStd 区间是否重叠的近似判定
  guardrailBreached?: boolean; // 候选版本破线（A8）
  diagnostic?: boolean; // 诊断/效率用，非 pass/fail 打分（D11/A1）
  signalOnly?: boolean; // 仅排查信号，不作门禁
}

export interface ComparisonGroup {
  key: string;
  title: string;
  deltas: MetricDelta[];
}

export interface ComparisonView {
  project: ProjectSummary;
  baseline: VersionSummary;
  candidate: VersionSummary;
  groups: ComparisonGroup[];
  gateBaseline: Gate;
  gateCandidate: Gate;
  narrative?: ComparativeNarrative; // LLM/模板生成的对比报告（按需）
}

// ─────────────────────────────────────────────────────────────
// LLM 对比报告端口（D3 ModelGateway 落地）—— 端口化、可换实现
// 默认离线确定性模板；可选真实 OpenAI 兼容模型（LiteLLM 可代理，D10）。
// 决策支持、人工拍板（D8.2）：narrative 只给建议，不替人拍板。
// ─────────────────────────────────────────────────────────────
export interface ComparativeNarrative {
  summary: string; // 一句话总结
  highlights: string[]; // 改善点
  regressions: string[]; // 回退点（含护栏破线）
  recommendation: string; // 决策建议（人工拍板）
  verdict: Gate; // 建议门禁 GO/NO_GO/ABSTAIN
  generatedBy: 'template' | 'llm';
  model?: string; // 真实 LLM 时记录模型名（可复现）
}

export interface GenerateComparisonInput {
  view: ComparisonView;
}

export interface ReportGenerator {
  id: string;
  generate(input: GenerateComparisonInput): Promise<ComparativeNarrative>;
}

// ─────────────────────────────────────────────────────────────
// LLM Provider 端口（RFC-007，插件系统 L2 能力）——被 report-llm / skill 消费。
// 由插件提供实现（如 Vercel AI SDK）；默认离线 Mock。
// ─────────────────────────────────────────────────────────────
export interface LlmGenerateOptions {
  prompt: string;
  system?: string;
  temperature?: number;
  json?: boolean; // 要求返回 JSON
}

export interface LlmProvider {
  id: string;
  model?: string;
  generateText(opts: LlmGenerateOptions): Promise<string>;
}

/**
 * Skill 模板（RFC-007，L4-L6 LLM 生成指导）：用占位符 {{key}} 描述提示词模板，
 * 由插件提供，供报告/诊断/决策生成时套用。
 */
export interface SkillTemplate {
  id: string;
  label: string;
  scope: 'compare' | 'decision' | 'diagnosis' | (string & {});
  system?: string;
  template: string; // 含 {{var}} 占位符
  inputs?: string[]; // 需要的变量名
}

// ─────────────────────────────────────────────────────────────
// 连接器标准接口（RFC-001 §3.1）—— D9.2 读侧落地
// 视图只依赖此接口，不关心数据来自 mock / BI / Langfuse / L5。
// ─────────────────────────────────────────────────────────────
export interface ConnectorCapabilities {
  evidenceLevel: EvidenceLevel; // 该连接器能提供的最高证据级
  drillable: boolean; // 能否下钻（metric-only → false，D9.3）
}

export interface ReportQuery {
  experimentId: string;
  // 时间窗 / 切片维度等后续扩展
}

export interface DataConnector {
  id: string;
  kind: 'mock' | 'langfuse' | 'bi' | 'l5-decision' | (string & {});
  capabilities(): ConnectorCapabilities;
  fetchDecision(query: ReportQuery): Promise<DecisionRecord>;
  fetchKpis(query: ReportQuery): Promise<KpiSet>;
  // RFC-002/003/004：按「项目 → 版本」组织。连接器只取**原始信号**（契约⓪），
  // 血缘(L2)/指标(L3)/归因(L4)/决策(L5) 由各自引擎从信号计算。
  listProjects(): Promise<ProjectSummary[]>;
  listVersions(projectId: string): Promise<VersionSummary[]>;
  fetchSignals(projectId: string, versionId: string): Promise<VersionSignals>;
}

