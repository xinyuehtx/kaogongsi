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
}

