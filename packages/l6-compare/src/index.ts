import type {
  ComparisonGroup,
  ComparisonView,
  DeltaDirection,
  Kpi,
  KpiSet,
  MetricDelta,
  ProjectSummary,
  VersionReport,
} from '@tengxiaohtx/contracts';

/**
 * L6：把两个版本的评测结果算成 ComparisonView（逐指标 delta + 方向 + 显著性）。
 * 纯函数，无 IO。呼应 A4（对比必带方向与不确定性，不做裸分对比）。
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 缺省 betterWhen 推断：命中「越低越好」关键词则 lower，否则 higher。 */
const LOWER_IS_BETTER = new Set([
  'regressions',
  'cost_of_pass',
  'cost_quality',
  'hallucination',
  'refusal',
  'safety_violation',
  'latency_p95',
  'steps_to_success',
  'token_efficiency',
  'redundant_call_rate',
  'user_effort',
  'variance_across_runs',
  'failure_cascade',
]);

function betterWhenOf(baseline: Kpi, candidate: Kpi): 'higher' | 'lower' {
  return (
    candidate.betterWhen ??
    baseline.betterWhen ??
    (LOWER_IS_BETTER.has(candidate.key) ? 'lower' : 'higher')
  );
}

function directionOf(delta: number, betterWhen: 'higher' | 'lower'): DeltaDirection {
  if (delta === 0) return 'flat';
  const up = delta > 0;
  return (up && betterWhen === 'higher') || (!up && betterWhen === 'lower')
    ? 'improved'
    : 'regressed';
}

/**
 * 显著性近似：两版本各带 stdDev 时，|delta| 是否超过两个 1σ 之和（区间不重叠）。
 * A4：无标准差 ⇒ 不下显著性结论（undefined）。
 */
function significanceOf(baseline: Kpi, candidate: Kpi, delta: number): boolean | undefined {
  if (baseline.stdDev === undefined || candidate.stdDev === undefined) return undefined;
  return Math.abs(delta) > baseline.stdDev + candidate.stdDev;
}

function diffKpi(baseline: Kpi, candidate: Kpi): MetricDelta {
  const delta = round2(candidate.value - baseline.value);
  const betterWhen = betterWhenOf(baseline, candidate);
  return {
    key: candidate.key,
    label: candidate.label,
    unit: candidate.unit,
    baseline: baseline.value,
    candidate: candidate.value,
    delta,
    deltaPct: baseline.value === 0 ? null : round2((delta / baseline.value) * 100),
    betterWhen,
    direction: directionOf(delta, betterWhen),
    significant: significanceOf(baseline, candidate, delta),
    guardrailBreached: candidate.guardrailBreached,
    diagnostic: candidate.diagnostic,
    signalOnly: candidate.signalOnly,
  };
}

/** 按 key 配对两组 KPI（以候选版本为准，缺失基线时跳过）。 */
function diffGroup(base: Kpi[], cand: Kpi[]): MetricDelta[] {
  const baseByKey = new Map(base.map((k) => [k.key, k]));
  const deltas: MetricDelta[] = [];
  for (const c of cand) {
    const b = baseByKey.get(c.key);
    if (b) deltas.push(diffKpi(b, c));
  }
  return deltas;
}

interface GroupSpec {
  key: string;
  title: string;
  pick: (k: KpiSet) => Kpi[];
}

const GROUP_SPECS: GroupSpec[] = [
  { key: 'quality', title: '质量（成败结果）', pick: (k) => k.quality },
  { key: 'product', title: '业务 / 产品', pick: (k) => k.product },
  { key: 'financial', title: '财务', pick: (k) => k.financial },
  { key: 'guardrail', title: '护栏（不能变差）', pick: (k) => k.guardrail },
  { key: 'traj-efficiency', title: '过程质量 · 效率（诊断）', pick: (k) => k.trajectory.efficiency },
  { key: 'traj-decisionQuality', title: '过程质量 · 决策质量（诊断）', pick: (k) => k.trajectory.decisionQuality },
  { key: 'traj-planningQuality', title: '过程质量 · 规划质量（诊断）', pick: (k) => k.trajectory.planningQuality },
  { key: 'traj-interactionQuality', title: '过程质量 · 交互质量（诊断）', pick: (k) => k.trajectory.interactionQuality },
  { key: 'traj-stability', title: '过程质量 · 稳定性（诊断）', pick: (k) => k.trajectory.stability },
];

/**
 * 构建版本对比视图。
 * @param project 项目摘要（对比头部展示）
 * @param baseline 基线版本报告（相对于 xx 版本的 “xx”）
 * @param candidate 候选版本报告（本轮评测）
 */
export function buildComparison(
  project: ProjectSummary,
  baseline: VersionReport,
  candidate: VersionReport,
): ComparisonView {
  const groups: ComparisonGroup[] = GROUP_SPECS.map((spec) => ({
    key: spec.key,
    title: spec.title,
    deltas: diffGroup(spec.pick(baseline.kpis), spec.pick(candidate.kpis)),
  })).filter((g) => g.deltas.length > 0);

  return {
    project,
    baseline: baseline.version,
    candidate: candidate.version,
    groups,
    gateBaseline: baseline.decision.gate,
    gateCandidate: candidate.decision.gate,
  };
}

/** 汇总一份对比的统计（供报告生成/摘要使用）。 */
export interface ComparisonSummary {
  improved: MetricDelta[];
  regressed: MetricDelta[];
  breached: MetricDelta[];
  significantImproved: MetricDelta[];
  significantRegressed: MetricDelta[];
}

export function summarizeComparison(view: ComparisonView): ComparisonSummary {
  const all = view.groups.flatMap((g) => g.deltas);
  const scoring = all.filter((d) => !d.diagnostic); // 诊断指标不参与门禁判断（D11/A1）
  return {
    improved: scoring.filter((d) => d.direction === 'improved'),
    regressed: scoring.filter((d) => d.direction === 'regressed'),
    breached: all.filter((d) => d.guardrailBreached === true),
    significantImproved: scoring.filter((d) => d.direction === 'improved' && d.significant === true),
    significantRegressed: scoring.filter((d) => d.direction === 'regressed' && d.significant === true),
  };
}
