import type {
  AttributionResult,
  AttributionShare,
  MetricCaseBundle,
  ResponsibleParty,
  VersionEvaluation,
} from '@kaogongsi/contracts';

/**
 * L4 归因引擎：从原始证据（MetricCaseBundle）把结果/问题归因到 技术/产品/运营 三责任方。
 * 纯函数，无 IO。
 *
 * 铁律（D9.3 / T67）：
 *  - **归因由案例驱动**：份额 = 各责任方失败案例的加权占比（fail=1，partial=0.5）。
 *  - **每份归因必须挂支撑指标 + 案例**；无任何失败时按先验分布，仍挂通过案例作证据。
 *  - **metric-only**（纯 BI，无案例）：只出粗粒度分布 + `drillable=false` + 置信度上限 low。
 */

/** 指标 → 责任方映射（缺省归技术侧）。 */
const PARTY_OF: Record<string, ResponsibleParty> = {
  success_rate: 'tech',
  pass_hat_k: 'tech',
  regressions: 'tech',
  hallucination: 'tech',
  refusal: 'tech',
  safety_violation: 'tech',
  latency_p95: 'tech',
  adoption: 'product',
  retention_30d: 'product',
  csat: 'product',
  task_volume: 'product',
  containment: 'product',
  cost_of_pass: 'ops',
  roi: 'ops',
  cost_quality: 'ops',
};

/** 无失败时的先验分布（技术侧最可能是可修主因）。 */
const PRIOR: Record<ResponsibleParty, number> = { tech: 0.5, product: 0.3, ops: 0.1 + 0.1 };

const PARTIES: ResponsibleParty[] = ['tech', 'product', 'ops'];
const round2 = (n: number): number => Math.round(n * 100) / 100;

function partyOf(metricName: string): ResponsibleParty {
  return PARTY_OF[metricName] ?? 'tech';
}

function concernOf(cases: MetricCaseBundle['supportingCases']): number {
  let c = 0;
  for (const k of cases) {
    if (k.verdict === 'fail') c += 1;
    else if (k.verdict === 'partial') c += 0.5;
  }
  return c;
}

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

/** 归一化到和为 1，两位小数，差额并入最大份额（稳定确定）。 */
function normalize(rawShares: { party: ResponsibleParty; value: number; metrics: string[]; cases: string[] }[]): AttributionShare[] {
  const positive = rawShares.filter((s) => s.value > 0);
  const total = positive.reduce((a, s) => a + s.value, 0);
  if (total === 0) return [];
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  const shares: AttributionShare[] = sorted.map((s) => ({
    party: s.party,
    share: round2(s.value / total),
    supportingMetrics: uniq(s.metrics),
    supportingCases: uniq(s.cases).slice(0, 5),
  }));
  const sum = shares.reduce((a, s) => a + s.share, 0);
  const diff = round2(1 - sum);
  if (shares[0]) shares[0].share = round2(shares[0].share + diff);
  return shares;
}

export function buildAttribution(evaluation: VersionEvaluation): AttributionResult {
  const metricOnly = evaluation.version.evidenceLevel === 'metric-only';

  const acc: Record<ResponsibleParty, { concern: number; metrics: string[]; failCases: string[]; anyCases: string[] }> = {
    tech: { concern: 0, metrics: [], failCases: [], anyCases: [] },
    product: { concern: 0, metrics: [], failCases: [], anyCases: [] },
    ops: { concern: 0, metrics: [], failCases: [], anyCases: [] },
  };

  for (const b of evaluation.bundles) {
    const party = partyOf(b.metric.name);
    const a = acc[party];
    a.concern += concernOf(b.supportingCases);
    a.metrics.push(b.metric.name);
    for (const c of b.supportingCases) {
      a.anyCases.push(c.caseId);
      if (c.verdict !== 'pass') a.failCases.push(c.caseId);
    }
  }

  const totalConcern = PARTIES.reduce((s, p) => s + acc[p].concern, 0);

  const raw = PARTIES.map((p) => {
    const a = acc[p];
    // 有失败：按失败加权；无失败：按先验（仍需挂通过案例作证据）
    const value = totalConcern > 0 ? a.concern : PRIOR[p];
    const cases = a.failCases.length > 0 ? a.failCases : a.anyCases;
    return { party: p, value, metrics: a.metrics, cases };
  });

  const distribution = normalize(raw);

  // 置信度：metric-only 封顶 low；无失败按先验 medium；有明确集中主因 high。
  const maxShare = distribution.reduce((m, s) => Math.max(m, s.share), 0);
  const confidence: AttributionResult['confidence'] = metricOnly
    ? 'low'
    : totalConcern === 0
      ? 'medium'
      : maxShare >= 0.5
        ? 'high'
        : 'medium';

  return { distribution, confidence, drillable: !metricOnly };
}
