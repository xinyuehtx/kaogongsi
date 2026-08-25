import type { CanonicalSignal, Kpi, LlmProvider, MetricDef, SkillTemplate } from '@tengxiaohtx/contracts';
import type { TrajectorySource } from '@tengxiaohtx/ingest';

/**
 * 全链路插件系统（RFC-007）：一个插件可向 L1-L6 任意层级贡献能力。
 * 本文件只放类型/贡献契约。
 */

export type LayerTag = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

// ── L1：数据源贡献（如 HTTP 源）────────────────────────────────
export interface DataSourceContribution {
  id: string;
  label: string;
  kind: string; // 'http' | 'file' | …
  /** 用插件配置（来自 UI DSL / 存储）创建一个轨迹源。 */
  create(config: Record<string, unknown>): TrajectorySource;
}

// ── L3：指标贡献（标准指标，计算并向下游输出）──────────────────
export interface MetricContribution {
  def: MetricDef; // 加入指标目录，L3 据此聚合其信号
  /** 可选：从已有信号派生额外指标信号（如组合指标）。 */
  derive?(signals: CanonicalSignal[]): CanonicalSignal[];
}

// ── L4-L5：外部数据源（财务 / BI 指标）─────────────────────────
export interface ExternalDataQuery {
  projectId: string;
  versionId: string;
}
export interface ExternalDataContribution {
  id: string;
  label: string;
  group: 'financial' | 'product' | 'quality' | 'guardrail';
  /** 拉取该项目/版本的外部指标（财务/BI），并入 KpiSet 对应组。 */
  fetch(query: ExternalDataQuery, config: Record<string, unknown>): Promise<Kpi[]>;
}

// ── UI DSL：声明展示表单 + 用户输入字段 ────────────────────────
export type UiFieldType = 'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'secret';
export interface UiFieldOption {
  value: string;
  label: string;
}
export interface UiField {
  key: string;
  label: string;
  type: UiFieldType;
  required?: boolean;
  options?: UiFieldOption[]; // select 用
  help?: string;
  default?: unknown;
}
export interface UiForm {
  id: string;
  title: string;
  layer: LayerTag;
  /** 提交后写入的存储集合（对应某 StorageSchema.collection）。 */
  storeTo?: string;
  fields: UiField[];
}

// ── 存储声明：用户输入入库（NoSQL 文档 + Redis 缓存）───────────
export type StorageFieldType = 'string' | 'number' | 'boolean' | 'json';
export interface StorageField {
  key: string;
  type: StorageFieldType;
  indexed?: boolean;
}
export interface StorageSchema {
  collection: string; // 文档集合名（NoSQL）
  fields: StorageField[];
  cache?: { ttlSeconds: number }; // 配了则同时写 Redis（KV）带 TTL
}

// ── 插件清单：一个插件可跨多层贡献 ────────────────────────────
export interface Plugin {
  id: string;
  name: string;
  version: string;
  layers: LayerTag[]; // 声明覆盖的层（用于展示/校验）
  dataSources?: DataSourceContribution[]; // L1
  llmProviders?: LlmProvider[]; // L2
  metrics?: MetricContribution[]; // L3
  externalData?: ExternalDataContribution[]; // L4-L5
  skills?: SkillTemplate[]; // L4-L6
  forms?: UiForm[]; // UI DSL
  storage?: StorageSchema[]; // 入库声明
}
