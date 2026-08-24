import { describe, it, expect } from 'vitest';
import type { AttributionResult, Kpi, KpiSet } from '@kaogongsi/contracts';
import { decide } from './index.js';

const attribution = (confidence: AttributionResult['confidence'] = 'medium'): AttributionResult => ({
  distribution: [
    { party: 'tech', share: 0.6, supportingMetrics: ['success_rate'], supportingCases: ['c1'] },
    { party: 'product', share: 0.3, supportingMetrics: ['retention_30d'], supportingCases: ['c2'] },
    { party: 'ops', share: 0.1, supportingMetrics: ['roi'], supportingCases: ['c3'] },
  ],
  confidence,
  drillable: confidence !== 'low',
});

const k = (key: string, value: number, extra: Partial<Kpi> = {}): Kpi => ({ key, label: key, value, unit: '%', sourceLineage: ['t'], ...extra });
const emptyTraj = (): KpiSet['trajectory'] => ({ efficiency: [], decisionQuality: [], planningQuality: [], interactionQuality: [], stability: [] });
const kset = (over: Partial<KpiSet>): KpiSet => ({ quality: [], product: [], financial: [], guardrail: [], trajectory: emptyTraj(), ...over });

const healthy = (): KpiSet =>
  kset({
    quality: [k('success_rate', 72, { betterWhen: 'higher' })],
    product: [k('retention_30d', 41, { label: '30 日留存', betterWhen: 'higher' }), k('adoption', 38, { betterWhen: 'higher' })],
    guardrail: [k('hallucination', 3, { betterWhen: 'lower', guardrailBreached: false })],
  });

describe('l5-decision: decide（TDD）', () => {
  it('健康 + 达阈 + 非低置信 ⇒ GO，推荐含「建议继续」，反对证据用留存锚点', () => {
    const d = decide(attribution('medium'), healthy());
    expect(d.gate).toBe('GO');
    expect(d.recommendation).toContain('建议继续');
    expect(d.counterEvidence).toContain('留存'); // A8 长期锚
    expect(d.attribution.distribution).toHaveLength(3);
  });

  it('护栏破线 ⇒ NO_GO，推荐点名破线指标', () => {
    const kpis = healthy();
    kpis.guardrail = [k('hallucination', 15, { label: '幻觉率', betterWhen: 'lower', guardrailBreached: true })];
    const d = decide(attribution('high'), kpis);
    expect(d.gate).toBe('NO_GO');
    expect(d.recommendation).toContain('幻觉率');
  });

  it('低置信（证据不足）⇒ ABSTAIN', () => {
    const d = decide(attribution('low'), healthy());
    expect(d.gate).toBe('ABSTAIN');
  });

  it('任务成功率未达阈 ⇒ ABSTAIN', () => {
    const kpis = healthy();
    kpis.quality = [k('success_rate', 45, { betterWhen: 'higher' })];
    const d = decide(attribution('medium'), kpis);
    expect(d.gate).toBe('ABSTAIN');
  });

  it('决策依据齐全：rationale/敏感性/反对证据/假设 + 内嵌归因', () => {
    const d = decide(attribution('medium'), healthy());
    expect(d.rationale).toContain('主要归因');
    expect(d.sensitivity).toContain('置信度');
    expect(d.assumptions.length).toBeGreaterThan(0);
    expect(d.attribution.confidence).toBe('medium');
  });
});
