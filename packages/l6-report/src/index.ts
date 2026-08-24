import type {
  DecisionRecord,
  KpiSet,
  ReportSection,
  ReportView,
  TrajectoryKpis,
} from '@kaogongsi/contracts';

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
  const lineageOf = (items: { sourceLineage: string[] }[]): string[] =>
    Array.from(new Set(items.flatMap((i) => i.sourceLineage)));

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
