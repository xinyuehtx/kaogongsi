import type { CanonicalSignal, Kpi, LlmProvider, MetricDef, SkillTemplate } from '@tengxiaohtx/contracts';
import type {
  DataSourceContribution,
  ExternalDataContribution,
  ExternalDataQuery,
  MetricContribution,
  Plugin,
  StorageSchema,
  UiForm,
} from './types.js';

/**
 * 插件宿主：注册插件、按能力聚合各层贡献、供管道消费。
 * 一个插件可同时贡献 L1-L6 能力；宿主把它们分类暴露。
 */
export class PluginHost {
  private readonly _plugins: Plugin[] = [];

  register(p: Plugin): void {
    if (this._plugins.some((x) => x.id === p.id)) throw new Error(`插件 id 重复: ${p.id}`);
    this._plugins.push(p);
  }
  registerAll(ps: Plugin[]): void {
    ps.forEach((p) => this.register(p));
  }
  plugins(): Plugin[] {
    return [...this._plugins];
  }

  private collect<T>(pick: (p: Plugin) => T[] | undefined): T[] {
    return this._plugins.flatMap((p) => pick(p) ?? []);
  }

  dataSources(): DataSourceContribution[] {
    return this.collect((p) => p.dataSources);
  }
  dataSource(id: string): DataSourceContribution | undefined {
    return this.dataSources().find((d) => d.id === id);
  }
  llmProviders(): LlmProvider[] {
    return this.collect((p) => p.llmProviders);
  }
  /** 取 LLM provider：给 id 取指定；否则取第一个（默认）。 */
  llmProvider(id?: string): LlmProvider | undefined {
    const all = this.llmProviders();
    return id ? all.find((x) => x.id === id) : all[0];
  }
  metricContributions(): MetricContribution[] {
    return this.collect((p) => p.metrics);
  }
  metricDefs(): MetricDef[] {
    return this.metricContributions().map((m) => m.def);
  }
  externalData(): ExternalDataContribution[] {
    return this.collect((p) => p.externalData);
  }
  skills(): SkillTemplate[] {
    return this.collect((p) => p.skills);
  }
  skill(id: string): SkillTemplate | undefined {
    return this.skills().find((s) => s.id === id);
  }
  forms(): UiForm[] {
    return this.collect((p) => p.forms);
  }
  storageSchemas(): StorageSchema[] {
    return this.collect((p) => p.storage);
  }
  storageSchema(collection: string): StorageSchema | undefined {
    return this.storageSchemas().find((s) => s.collection === collection);
  }

  /** 基础指标目录 + 插件指标（同 key 保留基础，忽略重复）。供 L3 使用。 */
  mergedCatalog(base: MetricDef[]): MetricDef[] {
    const keys = new Set(base.map((d) => d.key));
    return [...base, ...this.metricDefs().filter((d) => !keys.has(d.key))];
  }

  /** 应用全部插件的派生，追加派生信号。 */
  applyDerivations(signals: CanonicalSignal[]): CanonicalSignal[] {
    let out = [...signals];
    for (const m of this.metricContributions()) if (m.derive) out = [...out, ...m.derive(signals)];
    return out;
  }

  /** 汇总外部数据（财务/BI）为 Kpi[]。config 按贡献 id 分桶。 */
  async fetchExternalData(query: ExternalDataQuery, config: Record<string, Record<string, unknown>> = {}): Promise<Kpi[]> {
    const out: Kpi[] = [];
    for (const e of this.externalData()) out.push(...(await e.fetch(query, config[e.id] ?? {})));
    return out;
  }
}
