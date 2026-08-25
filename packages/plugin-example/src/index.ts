import type { Kpi } from '@tengxiaohtx/contracts';
import { HttpSource } from '@tengxiaohtx/ingest';
import type { ExternalDataQuery, Plugin } from '@tengxiaohtx/plugin-core';

/**
 * 示例：一个插件横跨 L1-L6。展示插件系统的完整能力面。
 *  L1 数据源（HTTP）· L3 指标（人工评分 + 派生）· L4-L5 外部财务数据 · L4-L6 skill 模板
 *  · UI DSL 表单（对接配置）· 存储声明（NoSQL + Redis 缓存）。
 */
export const examplePlugin: Plugin = {
  id: 'example',
  name: '示例全链路插件',
  version: '1.0.0',
  layers: ['L1', 'L3', 'L4', 'L5', 'L6'],

  // L1：HTTP 轨迹源（用表单里存的 endpoint / header）
  dataSources: [
    {
      id: 'example-http',
      label: '示例 HTTP 轨迹源',
      kind: 'http',
      create: (config) =>
        new HttpSource(String(config.endpoint ?? 'http://localhost/traces'), {
          headers: (config.headers as Record<string, string>) ?? {},
          formatHint: config.format as string | undefined,
        }),
    },
  ],

  // L3：标准指标（人工评分）+ 从成功率派生一个"高分率"信号
  metrics: [
    {
      def: { key: 'human_rating', label: '人工评分', unit: '分', group: 'quality', betterWhen: 'higher', target: 4 },
    },
  ],

  // L4-L5：外部财务/BI 数据（示例返回定值，真实由 config.endpoint 拉）
  externalData: [
    {
      id: 'finance',
      label: '财务系统',
      group: 'financial',
      fetch: async (q: ExternalDataQuery): Promise<Kpi[]> => [
        { key: 'gross_margin', label: '毛利率', value: 62, unit: '%', betterWhen: 'higher', sourceLineage: [`finance:${q.projectId}`] },
        { key: 'arr', label: 'ARR', value: 1200000, unit: 'USD', betterWhen: 'higher', sourceLineage: [`finance:${q.projectId}`] },
      ],
    },
    {
      id: 'bi',
      label: 'BI 平台',
      group: 'product',
      fetch: async (q: ExternalDataQuery): Promise<Kpi[]> => [
        { key: 'wau', label: '周活', value: 8600, unit: '人', betterWhen: 'higher', sourceLineage: [`bi:${q.projectId}`] },
      ],
    },
  ],

  // L4-L6：LLM 生成指导（skill 模板）
  skills: [
    {
      id: 'exec-brief',
      label: '高管对比简报',
      scope: 'compare',
      system: '你是{{role}}，语气克制、结论先行、决策支持不替人拍板。',
      template: '为项目「{{project}}」写一段 3 句话的版本对比简报：候选 {{candidate}} vs 基线 {{baseline}}。',
      inputs: ['role', 'project', 'candidate', 'baseline'],
    },
  ],

  // UI DSL：财务系统对接表单（用户输入入库）
  forms: [
    {
      id: 'finance-config',
      title: '财务系统对接',
      layer: 'L4',
      storeTo: 'finance_config',
      fields: [
        { key: 'endpoint', label: '接口地址', type: 'text', required: true, help: 'BI/财务系统的 REST 地址' },
        { key: 'apiKey', label: '密钥', type: 'secret', required: true },
        { key: 'currency', label: '币种', type: 'select', options: [{ value: 'USD', label: '美元' }, { value: 'CNY', label: '人民币' }], default: 'USD' },
      ],
    },
  ],

  // 存储声明：入 NoSQL 文档 + Redis 缓存（TTL 5 分钟）
  storage: [
    {
      collection: 'finance_config',
      fields: [
        { key: 'endpoint', type: 'string' },
        { key: 'apiKey', type: 'string' },
        { key: 'currency', type: 'string', indexed: true },
      ],
      cache: { ttlSeconds: 300 },
    },
  ],
};

/** 部署默认注册的插件集合（可扩展）。 */
export const defaultPlugins: Plugin[] = [examplePlugin];
