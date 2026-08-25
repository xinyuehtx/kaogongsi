import type { CanonicalSignal, ProvenanceCase, ProvenanceQuery } from '@tengxiaohtx/contracts';

/**
 * L2 证据/血缘层：把归一化信号（契约⓪）建成 typed provenance 图，并暴露投影查询（契约①）。
 * 图形态：Source ──collected──> Case ──backs──> Metric。
 * 报告任一数字的下钻 = 沿 backs/collected 反向投影（T30）。纯函数，无 IO。
 */

class ProvenanceGraph implements ProvenanceQuery {
  private readonly byMetric = new Map<string, ProvenanceCase[]>();
  private readonly byCase = new Map<string, ProvenanceCase>();

  add(c: ProvenanceCase): void {
    const list = this.byMetric.get(c.metricKey) ?? [];
    list.push(c);
    this.byMetric.set(c.metricKey, list);
    this.byCase.set(c.caseId, c);
  }

  metricKeys(): string[] {
    return Array.from(this.byMetric.keys());
  }

  casesForMetric(metricKey: string): ProvenanceCase[] {
    return this.byMetric.get(metricKey) ?? [];
  }

  drilldown(caseId: string): ProvenanceCase | undefined {
    return this.byCase.get(caseId);
  }
}

/** 从一批归一化信号构建血缘图。仅带 metricKey 的信号进入图（其余为非指标性上下文）。 */
export function buildProvenance(signals: CanonicalSignal[]): ProvenanceQuery {
  const graph = new ProvenanceGraph();
  for (const s of signals) {
    if (s.metricKey === undefined) continue;
    graph.add({
      caseId: s.caseId,
      metricKey: s.metricKey,
      verdict: s.verdict ?? 'unknown',
      observation: s.observation ?? 0,
      evidenceRef: `ev:${s.caseId}`,
      lineage: s.sourceLineage,
      source: s.source,
      runId: s.runId,
      stratum: s.stratum,
    });
  }
  return graph;
}
