import { describe, it, expect } from 'vitest';
import type { DecisionRecord, Kpi, KpiSet, ProjectSummary, VersionReport, VersionSummary } from '@tengxiaohtx/contracts';
import { buildComparison, summarizeComparison } from './index.js';

const project: ProjectSummary = { id: 'p1', name: '项目一', description: '' };

const version = (id: string): VersionSummary => ({
  id,
  projectId: 'p1',
  label: id,
  createdAt: '2026-08-01',
  harnessConfigVersion: 'h@1',
  evidenceLevel: 'full',
});

const decision = (gate: DecisionRecord['gate']): DecisionRecord => ({
  gate,
  recommendation: '',
  rationale: '',
  sensitivity: '',
  counterEvidence: '',
  assumptions: [],
  attribution: {
    distribution: [{ party: 'tech', share: 1, supportingMetrics: ['m'], supportingCases: ['c'] }],
    confidence: 'medium',
    drillable: true,
  },
});

const emptyTraj = (): KpiSet['trajectory'] => ({
  efficiency: [],
  decisionQuality: [],
  planningQuality: [],
  interactionQuality: [],
  stability: [],
});

function kset(over: Partial<KpiSet>): KpiSet {
  return { quality: [], product: [], financial: [], guardrail: [], trajectory: emptyTraj(), ...over };
}

function report(id: string, gate: DecisionRecord['gate'], kpis: KpiSet): VersionReport {
  return { version: version(id), decision: decision(gate), kpis };
}

const k = (key: string, value: number, extra: Partial<Kpi> = {}): Kpi => ({
  key,
  label: key,
  value,
  unit: '%',
  sourceLineage: ['t'],
  ...extra,
});

describe('l6-compare: buildComparison（TDD）', () => {
  it('higher-better 指标上升 = improved；显著性依 stdDev 判定（A4）', () => {
    const base = report('v1', 'ABSTAIN', kset({ quality: [k('success_rate', 60, { betterWhen: 'higher', stdDev: 2 })] }));
    const cand = report('v2', 'GO', kset({ quality: [k('success_rate', 72, { betterWhen: 'higher', stdDev: 2 })] }));
    const view = buildComparison(project, base, cand);
    const d = view.groups[0]?.deltas[0];
    expect(d?.direction).toBe('improved');
    expect(d?.delta).toBe(12);
    expect(d?.deltaPct).toBe(20);
    expect(d?.significant).toBe(true); // 12 > 2+2
    expect(view.gateBaseline).toBe('ABSTAIN');
    expect(view.gateCandidate).toBe('GO');
  });

  it('lower-better 指标上升 = regressed（如成本/幻觉率）', () => {
    const base = report('v1', 'GO', kset({ financial: [k('cost_of_pass', 0.18, { betterWhen: 'lower', unit: 'USD' })] }));
    const cand = report('v2', 'GO', kset({ financial: [k('cost_of_pass', 0.24, { betterWhen: 'lower', unit: 'USD' })] }));
    const d = buildComparison(project, base, cand).groups[0]?.deltas[0];
    expect(d?.direction).toBe('regressed');
  });

  it('缺省 betterWhen 用关键词启发式（hallucination=lower）', () => {
    const base = report('v1', 'GO', kset({ guardrail: [k('hallucination', 3)] }));
    const cand = report('v2', 'GO', kset({ guardrail: [k('hallucination', 9, { guardrailBreached: true })] }));
    const d = buildComparison(project, base, cand).groups[0]?.deltas[0];
    expect(d?.direction).toBe('regressed');
    expect(d?.guardrailBreached).toBe(true);
  });

  it('相等 = flat；基线为 0 时 deltaPct=null；无 stdDev 时 significant=undefined', () => {
    const base = report('v1', 'GO', kset({ quality: [k('regressions', 0, { unit: '个', betterWhen: 'lower' })] }));
    const cand = report('v2', 'GO', kset({ quality: [k('regressions', 0, { unit: '个', betterWhen: 'lower' })] }));
    const d = buildComparison(project, base, cand).groups[0]?.deltas[0];
    expect(d?.direction).toBe('flat');
    expect(d?.deltaPct).toBeNull();
    expect(d?.significant).toBeUndefined();
  });

  it('只对齐两版本都有的 key；空组被过滤', () => {
    const base = report('v1', 'GO', kset({ quality: [k('a', 1), k('b', 2)] }));
    const cand = report('v2', 'GO', kset({ quality: [k('a', 3)] }));
    const view = buildComparison(project, base, cand);
    expect(view.groups[0]?.deltas.map((d) => d.key)).toEqual(['a']);
    expect(view.groups.every((g) => g.deltas.length > 0)).toBe(true);
  });
});

describe('l6-compare: summarizeComparison', () => {
  it('诊断指标不计入门禁 improved/regressed；破线单列', () => {
    const base = report('v1', 'GO', kset({
      quality: [k('success_rate', 60, { betterWhen: 'higher' })],
      guardrail: [k('hallucination', 3)],
      trajectory: { ...emptyTraj(), efficiency: [k('steps_to_success', 10, { betterWhen: 'lower', diagnostic: true, unit: '步' })] },
    }));
    const cand = report('v2', 'NO_GO', kset({
      quality: [k('success_rate', 72, { betterWhen: 'higher' })],
      guardrail: [k('hallucination', 9, { guardrailBreached: true })],
      trajectory: { ...emptyTraj(), efficiency: [k('steps_to_success', 4, { betterWhen: 'lower', diagnostic: true, unit: '步' })] },
    }));
    const s = summarizeComparison(buildComparison(project, base, cand));
    expect(s.improved.map((d) => d.key)).toEqual(['success_rate']); // 诊断的 steps_to_success 不计入
    expect(s.regressed.map((d) => d.key)).toEqual(['hallucination']);
    expect(s.breached.map((d) => d.key)).toEqual(['hallucination']);
  });
});
