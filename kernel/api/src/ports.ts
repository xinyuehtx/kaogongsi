import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';

/**
 * 内核 · api 端口（RFC-011）。
 *
 * 内核只定义"需要什么能力"，**不知道** middleware 的层实现与 connectors 的数据源；
 * 具体装配（连接器 + 分层管道 + 插件）由 `example/app` 提供并注入 —— 依赖倒置：
 *   kernel ← middleware ← connectors ← example（箭头 = 依赖方向）
 */

/** 项目/版本目录（由连接器装配实现）。 */
export interface ProjectDirectory {
  listProjects(): Promise<ProjectSummary[]>;
  listVersions(projectId: string): Promise<VersionSummary[]>;
}

export interface CompareInput {
  projectId: string;
  baselineId: string;
  candidateId: string;
  generateNarrative?: boolean;
}

/** 评测报告服务（由分层管道装配实现）。 */
export interface ReportService {
  /** 单版本：跑管道出 exec 视图，并返回本次运行 id（溯源）。 */
  versionReport(projectId: string, versionId: string, actor?: string): Promise<{ view: ReportView; runId: string }>;
  /** 两版本对比（可选生成叙述）。 */
  compare(input: CompareInput, actor?: string): Promise<ComparisonView>;
  /** 用已落库的层入参重放（溯源重试）；无入参返回 undefined。 */
  retryRun(runId: string): Promise<ReportView | undefined>;
}

/** 插件清单 DTO：内核只按此结构对外暴露，不依赖 plugin-core 的类型。 */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  layers: string[];
  forms: unknown[]; // UI DSL（由前端按 DSL 渲染）
  storage: string[];
  skills: { id: string; label: string }[];
}

/** 插件目录与配置入库（由插件宿主 + 存储装配实现）。 */
export interface PluginDirectory {
  list(): PluginSummary[];
  loadData(collection: string, id: string): Promise<Record<string, unknown> | undefined>;
  saveData(collection: string, id: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** 内核 api 所需的全部领域能力（由 example 装配注入）。 */
export interface ServerServices {
  projects: ProjectDirectory;
  reports: ReportService;
  plugins?: PluginDirectory;
}
