import { describe, it, expect } from 'vitest';
import type { CanonicalSignal, Kpi, MetricDef } from '@tengxiaohtx/contracts';
import {
  InMemoryDocumentStore,
  InMemoryKvStore,
  MockLLMProvider,
  PluginDataService,
  PluginHost,
  renderSkill,
  validateInput,
  type Plugin,
} from './index.js';

const METRIC: MetricDef = { key: 'human_rating', label: '人工评分', unit: '分', group: 'quality', betterWhen: 'higher', target: 4 };

// 一个横跨 L1-L6 的示例插件
const megaPlugin: Plugin = {
  id: 'demo-mega',
  name: '示例全链路插件',
  version: '1.0.0',
  layers: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
  dataSources: [{ id: 'demo-http', label: 'Demo HTTP', kind: 'http', create: () => ({ kind: 'http', async collect() { return { items: [] }; } }) }],
  llmProviders: [new MockLLMProvider()],
  metrics: [{
    def: METRIC,
    derive: (signals) => signals.filter((s) => s.metricKey === 'success_rate').map((s) => ({ ...s, caseId: `${s.caseId}:derived`, metricKey: 'human_rating', observation: 4 })),
  }],
  externalData: [{
    id: 'finance', label: '财务系统', group: 'financial',
    fetch: async (q): Promise<Kpi[]> => [{ key: 'gross_margin', label: '毛利率', value: 62, unit: '%', betterWhen: 'higher', sourceLineage: [`finance:${q.projectId}`] }],
  }],
  skills: [{ id: 'exec-brief', label: '高管简报', scope: 'compare', system: '你是{{role}}', template: '为 {{project}} 写一段对比简报' }],
  forms: [{ id: 'finance-cfg', title: '财务系统对接', layer: 'L4', storeTo: 'finance_config', fields: [
    { key: 'endpoint', label: '接口地址', type: 'text', required: true },
    { key: 'apiKey', label: '密钥', type: 'secret', required: true },
  ] }],
  storage: [{ collection: 'finance_config', fields: [{ key: 'endpoint', type: 'string' }, { key: 'apiKey', type: 'string' }], cache: { ttlSeconds: 60 } }],
};

describe('plugin-core: PluginHost 跨层聚合', () => {
  const host = new PluginHost();
  host.register(megaPlugin);

  it('一个插件贡献 L1-L6 能力，宿主分类暴露', () => {
    expect(host.dataSources().map((d) => d.id)).toEqual(['demo-http']);
    expect(host.llmProvider()?.id).toBe('mock-llm');
    expect(host.metricDefs().map((m) => m.key)).toEqual(['human_rating']);
    expect(host.externalData().map((e) => e.id)).toEqual(['finance']);
    expect(host.skills().map((s) => s.id)).toEqual(['exec-brief']);
    expect(host.forms().map((f) => f.id)).toEqual(['finance-cfg']);
    expect(host.storageSchemas().map((s) => s.collection)).toEqual(['finance_config']);
  });

  it('重复 id 拒绝注册', () => {
    const h = new PluginHost();
    h.register(megaPlugin);
    expect(() => h.register(megaPlugin)).toThrow();
  });

  it('mergedCatalog 合并插件指标；applyDerivations 追加派生信号', () => {
    const base: MetricDef[] = [{ key: 'success_rate', label: '成功率', unit: '%', group: 'quality', betterWhen: 'higher' }];
    expect(host.mergedCatalog(base).map((d) => d.key)).toEqual(['success_rate', 'human_rating']);
    const sig: CanonicalSignal = { source: 's', sourceLineage: [], runId: 'r', caseId: 'c', experimentId: 'e', harnessConfigVersion: 'h', evidenceLevel: 'full', metricKey: 'success_rate', observation: 1, evidence: {} };
    const out = host.applyDerivations([sig]);
    expect(out.some((s) => s.metricKey === 'human_rating')).toBe(true);
  });

  it('fetchExternalData 汇总财务/BI 指标', async () => {
    const kpis = await host.fetchExternalData({ projectId: 'p', versionId: 'v' });
    expect(kpis[0]?.key).toBe('gross_margin');
    expect(kpis[0]?.value).toBe(62);
  });
});

describe('plugin-core: 存储（NoSQL + Redis）', () => {
  it('save 写文档 + 缓存；load 命中缓存；仅保留声明字段', async () => {
    const host = new PluginHost();
    host.register(megaPlugin);
    const doc = new InMemoryDocumentStore();
    const kv = new InMemoryKvStore();
    const svc = new PluginDataService(() => host.storageSchemas(), doc, kv);
    const saved = await svc.save('finance_config', 'default', { endpoint: 'https://x', apiKey: 'k', junk: 'drop' });
    expect(saved.endpoint).toBe('https://x');
    expect(saved.junk).toBeUndefined(); // 未声明字段被丢弃
    expect(await kv.get('finance_config:default')).toBeTruthy(); // 已缓存
    const loaded = await svc.load('finance_config', 'default');
    expect(loaded?.apiKey).toBe('k');
  });

  it('未声明集合报错', async () => {
    const host = new PluginHost();
    const svc = new PluginDataService(() => host.storageSchemas(), new InMemoryDocumentStore(), new InMemoryKvStore());
    await expect(svc.save('nope', 'x', {})).rejects.toThrow();
  });
});

describe('plugin-core: LLM/Skill/校验', () => {
  it('renderSkill 填充占位符', () => {
    const r = renderSkill(megaPlugin.skills![0]!, { role: '报告官', project: '钉钉表格' });
    expect(r.system).toBe('你是报告官');
    expect(r.prompt).toContain('钉钉表格');
  });
  it('MockLLMProvider 确定性', async () => {
    const p = new MockLLMProvider();
    expect(await p.generateText({ prompt: 'hi' })).toContain('mock-llm');
    expect(await p.generateText({ prompt: 'hi', json: true })).toContain('generatedBy');
  });
  it('validateInput 校验必填/数字', () => {
    const errs = validateInput(megaPlugin.forms![0]!.fields, { endpoint: '', apiKey: 'k' });
    expect(errs.some((e) => e.includes('接口地址'))).toBe(true);
  });
});
