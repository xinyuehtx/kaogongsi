import type {
  DecisionRecord,
  Kpi,
  KpiSet,
  ReportSection,
  ReportView,
  TrajectoryKpis,
  VersionEvaluation,
  VersionReport,
} from '@tengxiaohtx/contracts';
import { buildAttribution } from '@tengxiaohtx/attribution';
import { decide } from '@tengxiaohtx/decision';

/**
 * 组合管道（RFC-003）：原始证据 → 归因(L4) → 决策(L5) → VersionReport。
 * 连接器只给证据；这里把「归因」与「决策」两步显式串起来（L4/L5 边界物理可见）。
 */
export function assembleVersionReport(evaluation: VersionEvaluation): VersionReport {
  const attribution = buildAttribution(evaluation);
  const decision = decide(attribution, evaluation.kpis);
  return { version: evaluation.version, decision, kpis: evaluation.kpis };
}

export interface BuildExecOptions {
  drillable: boolean; // 来自连接器 capabilities().drillable（D9.3）
}

const TRAJECTORY_GROUPS: { key: keyof TrajectoryKpis; label: string }[] = [
  { key: 'efficiency', label: '效率' },
  { key: 'decisionQuality', label: '决策质量' },
  { key: 'planningQuality', label: '规划质量' },
  { key: 'interactionQuality', label: '交互质量' },
  { key: 'stability', label: '稳定性' },
];

const lineageOf = (items: { sourceLineage: string[] }[]): string[] =>
  Array.from(new Set(items.flatMap((i) => i.sourceLineage)));

/**
 * 分层指标分区（RFC-012 / T56）：只有当某指标存在多层取值时才出现，
 * 目的是让"整体值掩盖了某一层的严重问题"显式暴露（如 hard 层成功率远低于整体）。
 */
function stratifiedSection(kpis: KpiSet): ReportSection[] {
  const scoring = [...kpis.quality, ...kpis.product, ...kpis.financial, ...kpis.guardrail];
  const stratified = scoring.filter((k) => (k.strata?.length ?? 0) > 1);
  if (stratified.length === 0) return [];
  return [
    {
      title: '分层指标（诊断）',
      kind: 'matrix',
      data: {
        note: '整体值可能掩盖某一层的严重问题（T56）；分层为诊断视角，门禁仍看整体与护栏。',
        metrics: stratified.map((k) => ({
          key: k.key,
          label: k.label,
          unit: k.unit,
          overall: k.value,
          betterWhen: k.betterWhen,
          strata: k.strata ?? [],
          /** 最差层与整体的差距（正数=该层更差） */
          worstGap: worstGapOf(k),
        })),
      },
      sourceLineage: lineageOf(stratified),
    },
  ];
}

function worstGapOf(k: Kpi): number {
  const strata = k.strata ?? [];
  if (strata.length === 0) return 0;
  const lower = (k.betterWhen ?? 'higher') === 'lower';
  const worst = lower
    ? Math.max(...strata.map((s) => s.value))
    : Math.min(...strata.map((s) => s.value));
  return Math.round(Math.abs(worst - k.value) * 100) / 100;
}

/**
 * L6：把 DecisionRecord + KpiSet 重写成 exec 受众的 ReportView。
 * 证据层不变、呈现层随受众重写（T66）。纯函数，无 IO。
 *
 * 过程质量（轨迹级 5 类）为诊断，非打分（D11/A1）——强制置 diagnostic=true。
 */
export function buildExecReportView(
  decision: DecisionRecord,
  kpis: KpiSet,
  opts: BuildExecOptions,
): ReportView {
  const sections: ReportSection[] = [
    {
      title: '归因分布',
      kind: 'attribution',
      data: decision.attribution,
      sourceLineage: decision.attribution.distribution.flatMap((d) => d.supportingCases),
    },
    { title: '质量', kind: 'kpi', data: kpis.quality, sourceLineage: lineageOf(kpis.quality) },
    { title: '业务/产品', kind: 'kpi', data: kpis.product, sourceLineage: lineageOf(kpis.product) },
    { title: '财务', kind: 'kpi', data: kpis.financial, sourceLineage: lineageOf(kpis.financial) },
    { title: '护栏', kind: 'kpi', data: kpis.guardrail, sourceLineage: lineageOf(kpis.guardrail) },
    ...stratifiedSection(kpis),
    {
      title: '过程质量（诊断）',
      kind: 'matrix',
      data: {
        note: '诊断/效率用，非 pass/fail 打分（D11/A1）',
        groups: TRAJECTORY_GROUPS.map((g) => ({
          key: g.key,
          label: g.label,
          // 强制诊断标记：过程质量不得被当作门禁
          items: kpis.trajectory[g.key].map((k) => ({ ...k, diagnostic: true })),
        })),
      },
      sourceLineage: TRAJECTORY_GROUPS.flatMap((g) => lineageOf(kpis.trajectory[g.key])),
    },
    {
      title: '决策依据',
      kind: 'drilldown',
      data: {
        recommendation: decision.recommendation,
        rationale: decision.rationale,
        sensitivity: decision.sensitivity,
        counterEvidence: decision.counterEvidence,
        assumptions: decision.assumptions,
      },
      sourceLineage: [],
    },
  ];

  return { audience: 'exec', decision, drillable: opts.drillable, sections };
}
