import type { CanonicalSignal, VersionSummary } from '@tengxiaohtx/contracts';
import type { ParsedTrajectory } from './types.js';

/**
 * 把归一化轨迹（一条=一个"案例"）映射为 CanonicalSignal（契约⓪）。
 * 有结果(verdict)的轨迹 → success_rate 逐案例 0/1；护栏命中 → 逐案例 0/1；
 * 成本/步数/工具成功率 → 版本级聚合读数。只映射轨迹能给出的指标，其余留空（诚实）。
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface IngestMapping {
  projectFrom?: (t: ParsedTrajectory) => string;
  versionFrom?: (t: ParsedTrajectory) => string;
  projectName?: (projectId: string) => string;
}

const basename = (p: string): string => p.split(/[/\\]/).filter(Boolean).pop() ?? p;

export const defaultProjectFrom = (t: ParsedTrajectory): string => (t.projectHint ? basename(t.projectHint) : 'default');
export const defaultVersionFrom = (t: ParsedTrajectory): string => t.versionHint ?? 'v0';

function baseSignal(version: VersionSummary, t: ParsedTrajectory) {
  return {
    source: t.format,
    sourceLineage: [`${t.format}:${t.id}`],
    runId: t.id,
    experimentId: version.projectId,
    harnessConfigVersion: version.harnessConfigVersion,
    evidenceLevel: version.evidenceLevel,
  };
}

/** 一个版本的一批轨迹 → CanonicalSignal[]。 */
export function trajectoriesToSignals(version: VersionSummary, trajectories: ParsedTrajectory[]): CanonicalSignal[] {
  const signals: CanonicalSignal[] = [];

  // 1) success_rate：逐案例（仅有结果的轨迹）
  for (const t of trajectories) {
    if (t.verdict === 'unknown') continue;
    signals.push({
      ...baseSignal(version, t),
      caseId: `${t.id}:success_rate`,
      metricKey: 'success_rate',
      observation: t.verdict === 'pass' ? 1 : 0,
      verdict: t.verdict,
      evidence: { costUsd: t.costUsd, tokens: t.tokens, trajectoryEvents: t.steps },
    });
  }

  // 2) 护栏：仅当有任一轨迹带护栏信号时才映射（否则不臆造指标）
  const guardrailKeys: { key: string; match: RegExp }[] = [
    { key: 'hallucination', match: /halluc/ },
    { key: 'refusal', match: /refus/ },
    { key: 'safety_violation', match: /safety|toxic|pii/ },
  ];
  for (const g of guardrailKeys) {
    const anyHit = trajectories.some((t) => (t.guardrailHits ?? []).some((h) => g.match.test(h)));
    if (!anyHit) continue;
    for (const t of trajectories) {
      const hit = (t.guardrailHits ?? []).some((h) => g.match.test(h));
      signals.push({
        ...baseSignal(version, t),
        caseId: `${t.id}:${g.key}`,
        metricKey: g.key,
        observation: hit ? 1 : 0,
        verdict: hit ? 'fail' : 'pass',
        evidence: {},
      });
    }
  }

  // 3) 聚合读数（版本级，单条信号）
  const aggSignal = (metricKey: string, value: number): CanonicalSignal => ({
    source: version.harnessConfigVersion,
    sourceLineage: [`ingest:${version.projectId}:${version.id}`],
    runId: version.id,
    caseId: `${version.id}:${metricKey}:agg`,
    experimentId: version.projectId,
    harnessConfigVersion: version.harnessConfigVersion,
    evidenceLevel: version.evidenceLevel,
    metricKey,
    observation: value,
    verdict: 'unknown',
    evidence: {},
  });

  const costs = trajectories.map((t) => t.costUsd).filter((c): c is number => typeof c === 'number');
  const passes = trajectories.filter((t) => t.verdict === 'pass').length;
  if (costs.length > 0 && passes > 0) {
    signals.push(aggSignal('cost_of_pass', round2(costs.reduce((a, b) => a + b, 0) / passes)));
  }
  const toks = trajectories.map((t) => t.tokens).filter((x): x is number => typeof x === 'number');
  if (toks.length > 0) signals.push(aggSignal('token_efficiency', Math.round(toks.reduce((a, b) => a + b, 0) / toks.length)));

  const stepCounts = trajectories.map((t) => t.steps.length).filter((n) => n > 0);
  if (stepCounts.length > 0) signals.push(aggSignal('steps_to_success', round2(stepCounts.reduce((a, b) => a + b, 0) / stepCounts.length)));

  const toolResults = trajectories.flatMap((t) => t.steps.filter((s) => s.kind === 'tool_result'));
  if (toolResults.length > 0) {
    const okRate = toolResults.filter((s) => s.ok !== false).length / toolResults.length;
    signals.push(aggSignal('tool_utilization', round2(okRate * 100)));
  }

  return signals;
}
