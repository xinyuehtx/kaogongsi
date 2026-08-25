import { describe, it, expect } from 'vitest';
import type { DecisionRecord, Kpi, KpiSet, ProjectSummary, VersionReport, VersionSummary } from '@tengxiaohtx/contracts';
import { buildComparison } from '@tengxiaohtx/l6-compare';
import {
  LlmProviderReportGenerator,
  OpenAiCompatibleReportGenerator,
  TemplateReportGenerator,
  createReportGenerator,
} from './index.js';

const project: ProjectSummary = { id: 'p1', name: '测试项目', description: '' };
const ver = (id: string): VersionSummary => ({ id, projectId: 'p1', label: id, createdAt: '2026-08-01', harnessConfigVersion: 'h@1', evidenceLevel: 'full' });
const dec = (gate: DecisionRecord['gate']): DecisionRecord => ({
  gate, recommendation: '', rationale: '', sensitivity: '', counterEvidence: '', assumptions: [],
  attribution: { distribution: [{ party: 'tech', share: 1, supportingMetrics: ['m'], supportingCases: ['c'] }], confidence: 'medium', drillable: true },
});
const emptyTraj = (): KpiSet['trajectory'] => ({ efficiency: [], decisionQuality: [], planningQuality: [], interactionQuality: [], stability: [] });
const kset = (over: Partial<KpiSet>): KpiSet => ({ quality: [], product: [], financial: [], guardrail: [], trajectory: emptyTraj(), ...over });
const rep = (id: string, gate: DecisionRecord['gate'], kpis: KpiSet): VersionReport => ({ version: ver(id), decision: dec(gate), kpis });
const k = (key: string, value: number, extra: Partial<Kpi> = {}): Kpi => ({ key, label: key, value, unit: '%', sourceLineage: ['t'], ...extra });

const improvedView = () =>
  buildComparison(
    project,
    rep('v1', 'ABSTAIN', kset({ quality: [k('success_rate', 60, { betterWhen: 'higher', stdDev: 2 })] })),
    rep('v2', 'GO', kset({ quality: [k('success_rate', 72, { betterWhen: 'higher', stdDev: 2 })] })),
  );

const breachView = () =>
  buildComparison(
    project,
    rep('v0.9', 'GO', kset({ guardrail: [k('hallucination', 3, { betterWhen: 'lower' })] })),
    rep('v1.0', 'NO_GO', kset({ guardrail: [k('hallucination', 9, { betterWhen: 'lower', guardrailBreached: true })] })),
  );

describe('report-llm: TemplateReportGenerator（确定性，默认）', () => {
  it('显著改善且无回退 ⇒ verdict GO', async () => {
    const n = await new TemplateReportGenerator().generate({ view: improvedView() });
    expect(n.generatedBy).toBe('template');
    expect(n.verdict).toBe('GO');
    expect(n.highlights.some((h) => h.includes('success_rate'))).toBe(true);
    expect(n.summary).toContain('测试项目');
  });

  it('护栏破线 ⇒ verdict NO_GO，回退列含破线标记', async () => {
    const n = await new TemplateReportGenerator().generate({ view: breachView() });
    expect(n.verdict).toBe('NO_GO');
    expect(n.regressions.some((r) => r.includes('护栏破线'))).toBe(true);
  });

  it('相同输入 ⇒ 相同输出（可复现）', async () => {
    const g = new TemplateReportGenerator();
    const a = await g.generate({ view: improvedView() });
    const b = await g.generate({ view: improvedView() });
    expect(a).toEqual(b);
  });
});

describe('report-llm: createReportGenerator 工厂', () => {
  it('无 env ⇒ 模板生成器', () => {
    expect(createReportGenerator({}).id).toBe('template');
  });
  it('env 配齐 ⇒ OpenAI 兼容生成器', () => {
    const g = createReportGenerator({
      KAOGONGSI_LLM_BASE_URL: 'http://localhost:4000/v1',
      KAOGONGSI_LLM_API_KEY: 'sk-test',
      KAOGONGSI_LLM_MODEL: 'gpt-4o-mini',
    });
    expect(g.id).toBe('openai-compatible');
  });
});

describe('report-llm: OpenAiCompatibleReportGenerator（注入 fetch，无网络）', () => {
  it('解析模型 JSON 返回，标记 generatedBy=llm + model', async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '候选优于基线',
                  highlights: ['成功率 +12'],
                  regressions: [],
                  recommendation: '可继续',
                  verdict: 'GO',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const g = new OpenAiCompatibleReportGenerator({
      baseUrl: 'http://localhost:4000/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      fetchImpl: fakeFetch,
    });
    const n = await g.generate({ view: improvedView() });
    expect(n.generatedBy).toBe('llm');
    expect(n.model).toBe('gpt-4o-mini');
    expect(n.verdict).toBe('GO');
    expect(n.summary).toBe('候选优于基线');
  });

  it('HTTP 失败 ⇒ 抛错', async () => {
    const failFetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const g = new OpenAiCompatibleReportGenerator({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', fetchImpl: failFetch });
    await expect(g.generate({ view: improvedView() })).rejects.toThrow();
  });
});

describe('report-llm: LlmProviderReportGenerator（插件 LLM + Skill）', () => {
  it('经 LlmProvider 生成，套用 skill 模板，解析 JSON', async () => {
    let sawSystem = '';
    let sawPrompt = '';
    const provider = {
      id: 'fake',
      model: 'fake-1',
      async generateText(o: { system?: string; prompt: string }) {
        sawSystem = o.system ?? '';
        sawPrompt = o.prompt;
        return JSON.stringify({ summary: '候选更优', highlights: ['成功率↑'], regressions: [], recommendation: '继续', verdict: 'GO' });
      },
    };
    const skill = { id: 's', label: '简报', scope: 'compare' as const, system: '你是{{role}}', template: '为 {{project}} 写简报' };
    const g = new LlmProviderReportGenerator(provider, skill);
    const n = await g.generate({ view: improvedView() });
    expect(n.generatedBy).toBe('llm');
    expect(n.model).toBe('fake-1');
    expect(n.verdict).toBe('GO');
    expect(sawSystem).toContain('考功司报告官'); // {{role}} 已填充
    expect(sawPrompt).toContain('测试项目'); // skill 模板 + 对比数据
  });

  it('provider 返回非 JSON ⇒ 退化为 summary + 派生 verdict', async () => {
    const provider = { id: 'f', async generateText() { return '一段自由文本'; } };
    const n = await new LlmProviderReportGenerator(provider).generate({ view: improvedView() });
    expect(n.summary).toContain('自由文本');
    expect(['GO', 'NO_GO', 'ABSTAIN']).toContain(n.verdict);
  });
});
