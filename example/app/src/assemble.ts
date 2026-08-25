import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  ComparisonView,
  DataConnector,
  LayerContext,
  LlmProvider,
  ProjectSummary,
  ReportGenerator,
  ReportView,
  VersionSummary,
} from '@tengxiaohtx/contracts';
import { METRIC_CATALOG } from '@tengxiaohtx/contracts';
import {
  buildServer,
  type CompareInput,
  type PluginDirectory,
  type PluginSummary,
  type ProjectDirectory,
  type ReportService,
} from '@tengxiaohtx/api';
import type { StoragePort } from '@tengxiaohtx/auth-core';
import {
  ConsoleLogger,
  FileLogger,
  FileRunStore,
  InMemoryRunStore,
  type Logger,
  type RunStore,
} from '@tengxiaohtx/run-store';
import { InMemoryDocumentStore, InMemoryKvStore, createPersistence } from '@tengxiaohtx/persistence';
import { computeEvaluation } from '@tengxiaohtx/metrics';
import { buildStages, runPipeline } from '@tengxiaohtx/pipeline';
import { buildComparison } from '@tengxiaohtx/compare';
import { LlmProviderReportGenerator, createReportGenerator } from '@tengxiaohtx/report-llm';
import { PluginDataService, PluginHost, type Plugin } from '@tengxiaohtx/plugin-core';
import { FileSource, HttpSource, createIngestConnector, createRegistry } from '@tengxiaohtx/ingest';
import { MockConnector } from '@tengxiaohtx/connector-mock';
import { defaultPlugins } from '@tengxiaohtx/connector-example';

/**
 * example · 组装层（RFC-011）。
 *
 * 依赖方向：**kernel ← middleware ← connectors ← example**。
 * 内核（kernel/api）只声明端口；这里把 connectors（数据源）+ middleware（分层管道/插件宿主）
 * 装配成内核所需的 `ServerServices` 并启动。内核不知道 L1-L6 与任何具体连接器。
 */

export interface CreateAppOptions {
  connector?: DataConnector; // 默认：按 env 选轨迹接入，否则 MockConnector
  reportGenerator?: ReportGenerator; // 默认：按 env 选真实 LLM，否则离线模板
  llmProvider?: LlmProvider; // 注入内核 LLM 适配器（如 aisdk）时改用 provider 生成
  storage?: StoragePort; // 账号存储（默认交内核按防腐层装配）
  runStore?: RunStore;
  logger?: Logger;
  plugins?: Plugin[]; // 默认注册 connectors/example 的插件
  jwtSecret?: string;
}

// ── 分层管道实现的 ReportService（middleware 装配）────────────
class PipelineReportService implements ReportService {
  constructor(
    private readonly connector: DataConnector,
    private readonly host: PluginHost,
    private readonly runStore: RunStore,
    private readonly logger: Logger,
    private readonly generator: ReportGenerator,
  ) {}

  private static readonly LAYERS = ['attribution', 'decision', 'report'] as const;
  private now(): string {
    return new Date().toISOString();
  }
  private drillableOf(evidenceLevel: string): boolean {
    return this.connector.capabilities().drillable && evidenceLevel !== 'metric-only';
  }
  private stages() {
    return buildStages({ layers: [...PipelineReportService.LAYERS], resolve: (l) => this.host.stageFor(l) });
  }

  /** 信号(L1) → 血缘/指标(L2/L3) + 插件目录/派生/外部数据 → 归因/决策/报告(L4-L6)，每层入参落库。 */
  private async run(projectId: string, versionId: string, actor?: string): Promise<{ ctx: LayerContext; runId: string }> {
    const { version, signals } = await this.connector.fetchSignals(projectId, versionId);
    const ev = computeEvaluation(version, this.host.applyDerivations(signals), this.host.mergedCatalog(METRIC_CATALOG));
    for (const e of this.host.externalData()) {
      try {
        ev.kpis[e.group].push(...(await e.fetch({ projectId, versionId }, {})));
      } catch {
        /* 外部数据源不可用不阻断报告 */
      }
    }
    const runId = randomUUID();
    await this.runStore.putConnectorVersion({
      connectorId: this.connector.id,
      packageVersion: this.connector.kind,
      at: this.now(),
      meta: { versionId },
    });
    await this.runStore.startRun({
      runId,
      at: this.now(),
      connectorId: this.connector.id,
      packageVersion: this.connector.kind,
      projectId,
      versionId,
      actor,
    });
    let seq = 0;
    const ctx = await runPipeline(
      this.stages(),
      { version, evaluation: ev, drillable: this.drillableOf(version.evidenceLevel) },
      {
        onStage: async (stage, inputCtx) => {
          // 落库该层入参（合并前 ctx；不含 L1 signals —— L1 大数据按连接器接口按需查）
          await this.runStore.putLayer({ runId, seq: seq++, layer: stage.layer, stageId: stage.id, input: inputCtx, at: this.now() });
        },
      },
    );
    this.logger.info('report.run', { runId, projectId, versionId, actor, connector: this.connector.id });
    return { ctx, runId };
  }

  async versionReport(projectId: string, versionId: string, actor?: string): Promise<{ view: ReportView; runId: string }> {
    const { ctx, runId } = await this.run(projectId, versionId, actor);
    return { view: ctx.view!, runId };
  }

  async compare(input: CompareInput, actor?: string): Promise<ComparisonView> {
    const projects = await this.connector.listProjects();
    const project = projects.find((p) => p.id === input.projectId);
    if (!project) throw new Error(`未找到项目: ${input.projectId}`);
    const [base, cand] = await Promise.all([
      this.run(input.projectId, input.baselineId, actor),
      this.run(input.projectId, input.candidateId, actor),
    ]);
    const toReport = (ctx: LayerContext) => ({ version: ctx.version!, decision: ctx.decision!, kpis: ctx.evaluation!.kpis });
    const view = buildComparison(project, toReport(base.ctx), toReport(cand.ctx));
    if (input.generateNarrative) view.narrative = await this.generator.generate({ view });
    return view;
  }

  async retryRun(runId: string): Promise<ReportView | undefined> {
    const { meta, layers } = await this.runStore.getRun(runId);
    const first = layers[0];
    if (!meta || !first) return undefined;
    const ctx = await runPipeline(this.stages(), first.input as LayerContext);
    return ctx.view;
  }
}

// ── 连接器目录（connectors 装配）────────────────────────────
class ConnectorProjectDirectory implements ProjectDirectory {
  constructor(private readonly connector: DataConnector) {}
  listProjects(): Promise<ProjectSummary[]> {
    return this.connector.listProjects();
  }
  listVersions(projectId: string): Promise<VersionSummary[]> {
    return this.connector.listVersions(projectId);
  }
}

// ── 插件目录（plugin 宿主 + 存储装配）───────────────────────
class HostPluginDirectory implements PluginDirectory {
  constructor(private readonly host: PluginHost, private readonly data: PluginDataService) {}
  list(): PluginSummary[] {
    return this.host.plugins().map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      layers: p.layers,
      forms: p.forms ?? [],
      storage: (p.storage ?? []).map((s) => s.collection),
      skills: (p.skills ?? []).map((s) => ({ id: s.id, label: s.label })),
    }));
  }
  loadData(collection: string, id: string): Promise<Record<string, unknown> | undefined> {
    return this.data.load(collection, id);
  }
  saveData(collection: string, id: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.data.save(collection, id, input);
  }
}

/**
 * 按部署环境构建轨迹接入连接器（RFC-006）。未配置 KAOGONGSI_INGEST 则返回 undefined（用 Mock）。
 *  - KAOGONGSI_INGEST=file:/path | http(s)://host/api/traces
 *  - KAOGONGSI_PARSERS=claude-code,langfuse,…（选配解析器插件；空=全部）
 *  - KAOGONGSI_INGEST_HEADERS（JSON）/ _TAGS / _FROM / _TO / _FORMAT
 */
export async function resolveIngestConnector(): Promise<DataConnector | undefined> {
  const spec = process.env.KAOGONGSI_INGEST;
  if (!spec) return undefined;
  const parsers = process.env.KAOGONGSI_PARSERS?.split(',').map((s) => s.trim()).filter(Boolean);
  const registry = createRegistry(parsers);
  const query = {
    timeFrom: process.env.KAOGONGSI_INGEST_FROM,
    timeTo: process.env.KAOGONGSI_INGEST_TO,
    tags: process.env.KAOGONGSI_INGEST_TAGS?.split(',').map((s) => s.trim()).filter(Boolean),
  };
  const format = process.env.KAOGONGSI_INGEST_FORMAT;
  const source = /^https?:/.test(spec)
    ? new HttpSource(spec, {
        headers: process.env.KAOGONGSI_INGEST_HEADERS ? (JSON.parse(process.env.KAOGONGSI_INGEST_HEADERS) as Record<string, string>) : undefined,
      })
    : new FileSource(spec.startsWith('file:') ? spec.slice('file:'.length) : spec);
  return createIngestConnector({ source, registry, query, format });
}

/** 把内核 LLM provider 包装成 L2 插件（组装层职责，内核不做）。 */
export function llmProviderPlugin(provider: LlmProvider): Plugin {
  return {
    id: `llm:${provider.id}`,
    name: `LLM Provider (${provider.id})`,
    version: '1.0.0',
    layers: ['L2'],
    llmProviders: [provider],
  };
}

/** 组装并返回可监听的 Fastify 实例。 */
export async function createApp(opts: CreateAppOptions = {}): Promise<FastifyInstance> {
  const connector = opts.connector ?? (await resolveIngestConnector()) ?? new MockConnector();

  const host = new PluginHost();
  host.registerAll(opts.plugins ?? defaultPlugins);
  if (opts.llmProvider) host.register(llmProviderPlugin(opts.llmProvider));

  const persistence = createPersistence();
  const dataDir = process.env.KAOGONGSI_DATA_DIR;
  const runStore: RunStore =
    opts.runStore ?? persistence.runStore ?? (dataDir ? new FileRunStore(`${dataDir}/runs`) : new InMemoryRunStore());
  const logger: Logger = opts.logger ?? (dataDir ? new FileLogger(`${dataDir}/logs`) : new ConsoleLogger());

  const pluginData = new PluginDataService(
    () => host.storageSchemas(),
    persistence.documentStore ?? new InMemoryDocumentStore(),
    persistence.kvStore ?? new InMemoryKvStore(),
  );

  const generator: ReportGenerator =
    opts.reportGenerator ??
    (opts.llmProvider ? new LlmProviderReportGenerator(opts.llmProvider, host.skills()[0]) : createReportGenerator());

  return buildServer({
    services: {
      projects: new ConnectorProjectDirectory(connector),
      reports: new PipelineReportService(connector, host, runStore, logger, generator),
      plugins: new HostPluginDirectory(host, pluginData),
    },
    storage: opts.storage,
    runStore,
    logger,
    jwtSecret: opts.jwtSecret,
  });
}
