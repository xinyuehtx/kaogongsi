import type {
  CanonicalSignal,
  Kpi,
  KpiSet,
  MetricCaseBundle,
  MetricDef,
  ProvenanceCase,
  SupportingCase,
  VersionEvaluation,
  VersionSummary,
} from '@kaogongsi/contracts';
import { METRIC_CATALOG, isTrajectoryGroup } from '@kaogongsi/contracts';
import { buildProvenance } from '@kaogongsi/l2-provenance';

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

/** pass^k 可靠性：单次通过率的 k 次幂（k 次独立全过的概率估计）。 */
export function passHatK(passRate01: number, k: number): number {
  return clamp01(passRate01) ** Math.max(1, k);
}

/** Cost-of-Pass：总成本 / 通过数（无通过则 Infinity）。 */
export function costOfPass(costs: number[], verdicts: string[]): number {
  const total = costs.reduce((a, b) => a + b, 0);
  const passes = verdicts.filter((v) => v === 'pass').length;
  return passes === 0 ? Infinity : total / passes;
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
 */
export function computeEvaluation(version: VersionSummary, signals: CanonicalSignal[]): VersionEvaluation {
  const graph = buildProvenance(signals);
  const kpis = emptyKpiSet();
  const bundles: MetricCaseBundle[] = [];

  for (const def of METRIC_CATALOG) {
    const cases = graph.casesForMetric(def.key);
    if (cases.length === 0) continue; // 该来源未提供此指标
    const observations = cases.map((c) => c.observation);

    // case-based（多个 0/1 案例）：值=均值×100 + bootstrap 区间；
    // 单读数（BI 聚合 / metric-only）：读数即值。
    const caseRate = def.caseBased === true && cases.length > 1;
    const rawMean = mean(observations);
    const value = round2(caseRate ? rawMean * 100 : rawMean);
    const std = caseRate ? round2(bootstrapStd(observations, `${version.id}:${def.key}`) * 100) : undefined;

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
