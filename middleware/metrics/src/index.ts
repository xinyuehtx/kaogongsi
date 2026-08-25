import type {
  CanonicalSignal,
  Kpi,
  KpiSet,
  MetricAggregation,
  MetricCaseBundle,
  MetricDef,
  MetricStratum,
  ProvenanceCase,
  SupportingCase,
  VersionEvaluation,
  VersionSummary,
} from '@tengxiaohtx/contracts';
import { METRIC_CATALOG, isTrajectoryGroup } from '@tengxiaohtx/contracts';
import { buildProvenance } from '@tengxiaohtx/provenance';

/**
 * L3 计算层：从血缘图(L2)的案例聚合出**可信指标**（值 + 样本量 + bootstrap 置信，A4/P1），
 * 并按指标目录归位到 KpiSet；同时产出 MetricCaseBundle（契约②，D9.3 必带案例）供归因(L4)。
 * 纯函数，无 IO；bootstrap 用可复现的种子 PRNG。
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const CASES_PER_BUNDLE = 4;

// ── 可复现随机（mulberry32 + 字符串哈希种子）────────────────────
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Bootstrap 重采样均值的标准差（可信区间宽度，A4）。确定性：seed 派生自 label。 */
export function bootstrapStd(samples: number[], seedLabel = 'seed', iters = 500): number {
  const n = samples.length;
  if (n < 2) return 0;
  const rand = mulberry32(hashSeed(seedLabel));
  const means: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += samples[Math.floor(rand() * n)] ?? 0;
    means.push(sum / n);
  }
  const m = mean(means);
  const variance = mean(means.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}

/** pass^k 可靠性：单次通过率的 k 次幂（**独立性假设**外推；仅在无重复运行数据时兜底）。 */
export function passHatK(passRate01: number, k: number): number {
  return clamp01(passRate01) ** Math.max(1, k);
}

/** Cost-of-Pass：总成本 / 通过数（无通过则 Infinity）。 */
export function costOfPass(costs: number[], verdicts: string[]): number {
  const total = costs.reduce((a, b) => a + b, 0);
  const passes = verdicts.filter((v) => v === 'pass').length;
  return passes === 0 ? Infinity : total / passes;
}

/** 分位数（线性插值，RFC-012）：p 取 0..100。空数组返回 0。 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const xs = [...values].sort((a, b) => a - b);
  if (xs.length === 1) return xs[0]!;
  const rank = (clamp01(p / 100) * (xs.length - 1));
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const w = rank - lo;
  return (xs[lo] ?? 0) * (1 - w) + (xs[hi] ?? 0) * w;
}

/**
 * pass^k 实测（RFC-012 / A4·P1）：把同一 caseId 的**多次重复运行**聚合——
 * 一个 case 只有在 **k 次运行全部通过** 时才计入分子。k 缺省 = 实际最小重复次数。
 * 与 `passHatK`（幂次外推）相对：这里不假设独立性，直接看实测一致性。
 * 返回 undefined 表示没有重复运行数据（应回落到率值或幂次外推）。
 */
export function passHatKFromRuns(
  cases: { caseId: string; runId: string; verdict: string }[],
  k?: number,
): { value01: number; k: number; nCases: number } | undefined {
  const byCase = new Map<string, Map<string, string>>();
  for (const c of cases) {
    const runs = byCase.get(c.caseId) ?? new Map<string, string>();
    runs.set(c.runId, c.verdict);
    byCase.set(c.caseId, runs);
  }
  const repeatCounts = [...byCase.values()].map((r) => r.size);
  const maxRepeat = Math.max(0, ...repeatCounts);
  if (maxRepeat < 2) return undefined; // 无重复运行
  const kk = k ?? Math.min(...repeatCounts.filter((n) => n >= 2));
  let allPass = 0;
  let counted = 0;
  for (const runs of byCase.values()) {
    if (runs.size < kk) continue; // 重复次数不足的 case 不参与
    counted += 1;
    const verdicts = [...runs.values()].slice(0, kk);
    if (verdicts.every((v) => v === 'pass')) allPass += 1;
  }
  if (counted === 0) return undefined;
  return { value01: allPass / counted, k: kk, nCases: counted };
}

// ── 主管道：signals → provenance(L2) → metrics ──────────────────
function shortfallOf(def: MetricDef, value: number): number {
  if (def.target === undefined) return 0;
  return def.betterWhen === 'lower'
    ? clamp01((value - def.target) / def.target)
    : clamp01((def.target - value) / def.target);
}

function supportingCases(
  def: MetricDef,
  value: number,
  cases: ProvenanceCase[],
  evidenceLevel: VersionSummary['evidenceLevel'],
  versionId: string,
  breached: boolean,
): SupportingCase[] {
  if (evidenceLevel === 'metric-only') return []; // 纯 BI：无案例血缘（D9.3）
  const failN = breached ? CASES_PER_BUNDLE : Math.round(shortfallOf(def, value) * CASES_PER_BUNDLE);
  const realFail = cases.filter((c) => c.verdict === 'fail');
  const realPass = cases.filter((c) => c.verdict !== 'fail');
  const out: SupportingCase[] = [];
  for (let i = 0; i < CASES_PER_BUNDLE; i++) {
    const isFail = i < failN;
    const src = isFail ? realFail[i] : realPass[i - failN];
    const caseId = src?.caseId ?? `${versionId}:${def.key}:${i}`;
    out.push({
      caseId,
      verdict: isFail ? 'fail' : 'pass',
      evidenceRef: src?.evidenceRef ?? `ev:${caseId}`,
      lineage: src?.lineage ?? [`mock:${versionId}`],
    });
  }
  return out;
}

function emptyKpiSet(): KpiSet {
  return {
    quality: [],
    product: [],
    financial: [],
    guardrail: [],
    trajectory: { efficiency: [], decisionQuality: [], planningQuality: [], interactionQuality: [], stability: [] },
  };
}

/** 按 stratum 分层聚合（同一聚合口径），无 stratum 标签则返回空。 */
function stratify(cases: ProvenanceCase[], aggregation: MetricAggregation): MetricStratum[] {
  const labelled = cases.filter((c) => c.stratum !== undefined);
  if (labelled.length === 0) return [];
  const groups = new Map<string, ProvenanceCase[]>();
  for (const c of labelled) {
    const key = c.stratum!;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: MetricStratum[] = [];
  for (const [key, cs] of groups) {
    const obs = cs.map((c) => c.observation);
    let value: number;
    if (aggregation === 'rate') value = round2(mean(obs) * 100);
    else if (aggregation === 'cost_per_pass') {
      const cop = costOfPass(obs, cs.map((c) => c.verdict));
      value = Number.isFinite(cop) ? round2(cop) : 0;
    } else if (aggregation.startsWith('p')) value = round2(percentile(obs, Number(aggregation.slice(1))));
    else value = round2(mean(obs));
    out.push({ key, value, nSamples: cs.length });
  }
  // 已知难度/等级层按自然序展示，其余字典序
  const RANK = ['easy', 'simple', 'medium', 'normal', 'hard', 'expert'];
  const rank = (k: string): number => {
    const i = RANK.indexOf(k.toLowerCase());
    return i < 0 ? RANK.length : i;
  };
  return out.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

function placeKpi(kpis: KpiSet, def: MetricDef, k: Kpi): void {
  if (isTrajectoryGroup(def.group)) {
    (kpis.trajectory as unknown as Record<string, Kpi[]>)[def.group]?.push(k);
  } else {
    (kpis as unknown as Record<string, Kpi[]>)[def.group]?.push(k);
  }
}

/**
 * 从某版本的原始信号计算完整评测结果（KpiSet + bundles）。
 * @param version 版本摘要
 * @param signals 归一化信号（契约⓪）
 * @param catalog 指标目录（默认内置；插件系统可传入合并后的目录，RFC-007）
 */
export function computeEvaluation(
  version: VersionSummary,
  signals: CanonicalSignal[],
  catalog: MetricDef[] = METRIC_CATALOG,
): VersionEvaluation {
  const graph = buildProvenance(signals);
  const kpis = emptyKpiSet();
  const bundles: MetricCaseBundle[] = [];

  for (const def of catalog) {
    const cases = graph.casesForMetric(def.key);
    if (cases.length === 0) continue; // 该来源未提供此指标
    const observations = cases.map((c) => c.observation);

    // 聚合方式（RFC-012）：缺省 case-based→rate、其余→mean；
    // cost_per_pass 用真实成本分布，p50/p95/p99 用分位数。
    const aggregation = def.aggregation ?? (def.caseBased ? 'rate' : 'mean');
    const multi = cases.length > 1;
    const caseRate = aggregation === 'rate' && multi;

    let value: number;
    let distribution: Kpi['distribution'];
    switch (multi ? aggregation : 'mean') {
      case 'rate':
        value = round2(mean(observations) * 100);
        break;
      case 'cost_per_pass': {
        const cop = costOfPass(observations, cases.map((c) => c.verdict));
        value = Number.isFinite(cop) ? round2(cop) : round2(observations.reduce((a, b) => a + b, 0));
        break;
      }
      case 'p50':
      case 'p95':
      case 'p99': {
        const p = Number(aggregation.slice(1));
        value = round2(percentile(observations, p));
        distribution = {
          p50: round2(percentile(observations, 50)),
          p95: round2(percentile(observations, 95)),
          p99: round2(percentile(observations, 99)),
        };
        break;
      }
      default:
        value = round2(mean(observations));
    }

    const std = caseRate ? round2(bootstrapStd(observations, `${version.id}:${def.key}`) * 100) : undefined;

    // pass^k 实测优先（有重复运行就不用幂次外推，A4/P1）
    let passHatKMeasured = false;
    if (aggregation === 'rate' && multi) {
      const measured = passHatKFromRuns(cases);
      if (measured) {
        value = round2(measured.value01 * 100);
        passHatKMeasured = true;
      }
    }

    // 分层指标（RFC-012 / T56）：整体值可能掩盖某层的严重问题
    const strata = stratify(cases, aggregation);

    const breached =
      def.guardrailThreshold !== undefined &&
      (def.betterWhen === 'lower' ? value > def.guardrailThreshold : value < def.guardrailThreshold);

    const lineage = Array.from(new Set(cases.flatMap((c) => c.lineage)));

    const kpi: Kpi = {
      key: def.key,
      label: def.label,
      value,
      unit: def.unit,
      betterWhen: def.betterWhen,
      diagnostic: def.diagnostic,
      signalOnly: def.signalOnly,
      guardrailBreached: def.group === 'guardrail' ? breached : undefined,
      stdDev: std,
      nSamples: cases.length,
      distribution,
      strata: strata.length > 1 ? strata : undefined, // 单层无意义
      passHatKFromRuns: passHatKMeasured || undefined,
      sourceLineage: lineage,
    };
    placeKpi(kpis, def, kpi);

    // 归因原料：仅对可门禁指标产 bundle（诊断指标不入归因，D11/A1）
    if (def.target !== undefined && !def.diagnostic) {
      bundles.push({
        metric: { name: def.key, mean: value, nSamples: cases.length, bootstrapStd: std },
        supportingCases: supportingCases(def, value, cases, version.evidenceLevel, version.id, breached),
        evidenceLevel: version.evidenceLevel,
      });
    }
  }

  return { version, kpis, bundles };
}
