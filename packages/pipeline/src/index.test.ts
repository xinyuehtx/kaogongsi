import { describe, it, expect } from 'vitest';
import type { DecisionRecord, KpiSet, LayerStage, VersionEvaluation, VersionSummary } from '@tengxiaohtx/contracts';
import { buildStages, runLayers } from './index.js';

const version: VersionSummary = { id: 'v2.0', projectId: 'p', label: 'v2.0', createdAt: '2026-08-01', harnessConfigVersion: 'h', evidenceLevel: 'full' };

const emptyTraj = (): KpiSet['trajectory'] => ({ efficiency: [], decisionQuality: [], planningQuality: [], interactionQuality: [], stability: [] });

const evaluation: VersionEvaluation = {
  version,
  kpis: {
    quality: [{ key: 'success_rate', label: '任务成功率', value: 72, unit: '%', betterWhen: 'higher', sourceLineage: ['t'] }],
    product: [{ key: 'retention_30d', label: '30 日留存', value: 41, unit: '%', betterWhen: 'higher', sourceLineage: ['t'] }],
    financial: [],
    guardrail: [{ key: 'hallucination', label: '幻觉率', value: 3, unit: '%', betterWhen: 'lower', guardrailBreached: false, sourceLineage: ['t'] }],
    trajectory: emptyTraj(),
  },
  bundles: [
    { metric: { name: 'success_rate', mean: 72, nSamples: 4 }, supportingCases: [{ caseId: 'c1', verdict: 'pass', evidenceRef: 'e', lineage: ['l'] }], evidenceLevel: 'full' },
  ],
};

describe('pipeline: App 选层切片 L4-L6（attribution→decision→report）', () => {
  it('自下而上组装：decision(L5) 读到 attribution(L4) 产出；report(L6) 产出视图', async () => {
    const ctx = await runLayers({ layers: ['attribution', 'decision', 'report'] }, { version, evaluation, drillable: true });
    expect(ctx.attribution).toBeDefined();
    expect(ctx.attribution!.distribution.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 5);
    expect(ctx.decision?.gate).toBe('GO'); // 健康 → GO
    expect(ctx.view?.audience).toBe('exec');
  });

  it('buildStages 按 LAYER_ORDER 排序，未选层不入列', () => {
    const stages = buildStages({ layers: ['report', 'attribution', 'decision'] });
    expect(stages.map((s) => s.layer)).toEqual(['attribution', 'decision', 'report']);
  });
});

describe('pipeline: 插件替换某层 stage（组装方向与内核依赖相反）', () => {
  it('插件 decision stage 覆盖内核，并消费 L4 attribution 出参', async () => {
    let sawAttribution = false;
    const pluginDecision: LayerStage = {
      layer: 'decision',
      id: 'plugin:decision',
      run: (ctx) => {
        sawAttribution = ctx.attribution !== undefined; // L5 入参含 L4 出参
        const decision: DecisionRecord = {
          gate: ctx.attribution ? 'ABSTAIN' : 'NO_GO',
          recommendation: '插件决策：更保守',
          rationale: `技术占比 ${Math.round((ctx.attribution!.distribution[0]?.share ?? 0) * 100)}%`,
          sensitivity: '',
          counterEvidence: '',
          assumptions: [],
          attribution: ctx.attribution!,
        };
        return { decision };
      },
    };
    const ctx = await runLayers(
      { layers: ['attribution', 'decision', 'report'], resolve: (l) => (l === 'decision' ? pluginDecision : undefined) },
      { version, evaluation, drillable: true },
    );
    expect(sawAttribution).toBe(true);
    expect(ctx.decision?.recommendation).toBe('插件决策：更保守');
    expect(ctx.decision?.gate).toBe('ABSTAIN');
    expect(ctx.view?.audience).toBe('exec'); // 下游 report 仍照常消费插件 decision
  });
});
