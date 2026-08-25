import type {
  ConnectorCapabilities,
  DataConnector,
  DecisionRecord,
  EvidenceLevel,
  KpiSet,
  ProjectSummary,
  ReportQuery,
  VersionSignals,
  VersionSummary,
} from '@tengxiaohtx/contracts';
import type { CollectQuery, ParsedTrajectory, TrajectorySource } from './types.js';
import { collectAll } from './sources.js';
import { ParserRegistry, createRegistry } from './parsers.js';
import type { IngestMapping } from './map.js';
import { defaultProjectFrom, defaultVersionFrom, trajectoriesToSignals } from './map.js';

export interface IngestConnectorConfig {
  source: TrajectorySource;
  registry?: ParserRegistry; // 默认全部插件；部署可用 createRegistry(enabledIds) 选配
  query?: CollectQuery; // 时间范围 / tag / 分批
  mapping?: IngestMapping; // 轨迹→项目/版本 映射
  evidenceLevel?: EvidenceLevel;
  format?: string; // 强制某解析器（否则自动探测）
  id?: string;
}

const mode = <T,>(xs: T[], fallback: T): T => {
  const count = new Map<T, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  let best = fallback;
  let bestN = 0;
  for (const [k, n] of count) if (n > bestN) { best = k; bestN = n; }
  return best;
};

/**
 * 从轨迹源构建 DataConnector（L1）：collect(源) → parse(插件) → 按项目/版本分组 → map 成 CanonicalSignal。
 * 眼下为**批式**：构建时一次性拉取解析（适合文件夹/离线拉取）；流式/增量后续再加。
 */
export async function createIngestConnector(config: IngestConnectorConfig): Promise<DataConnector> {
  const registry = config.registry ?? createRegistry();
  const evidenceLevel: EvidenceLevel = config.evidenceLevel ?? 'full';
  const projectFrom = config.mapping?.projectFrom ?? defaultProjectFrom;
  const versionFrom = config.mapping?.versionFrom ?? defaultVersionFrom;
  const projectName = config.mapping?.projectName ?? ((id: string) => id);

  const raws = await collectAll(config.source, config.query ?? {});
  const parsed = raws.map((r) => registry.parse(r, config.format ? { format: config.format } : undefined));

  // 分组：project → version → 轨迹
  const groups = new Map<string, Map<string, ParsedTrajectory[]>>();
  for (const t of parsed) {
    const pid = projectFrom(t);
    const vid = versionFrom(t);
    const byV = groups.get(pid) ?? new Map<string, ParsedTrajectory[]>();
    const arr = byV.get(vid) ?? [];
    arr.push(t);
    byV.set(vid, arr);
    groups.set(pid, byV);
  }

  const projects: ProjectSummary[] = [];
  const versionsByProject = new Map<string, VersionSummary[]>();
  const signalsByVersion = new Map<string, VersionSignals>();

  for (const [pid, byV] of groups) {
    projects.push({ id: pid, name: projectName(pid), description: `由轨迹接入（${[...byV.values()].flat().length} 条）` });
    const versions: VersionSummary[] = [];
    for (const [vid, trajs] of byV) {
      const createdAt = trajs.map((t) => t.createdAt).filter(Boolean).sort().at(-1) ?? new Date().toISOString();
      const version: VersionSummary = {
        id: vid,
        projectId: pid,
        label: vid,
        createdAt,
        harnessConfigVersion: mode(trajs.map((t) => t.model ?? t.agent ?? 'ingest'), 'ingest'),
        evidenceLevel,
        note: `${trajs.length} 条轨迹`,
      };
      versions.push(version);
      signalsByVersion.set(`${pid}/${vid}`, { version, signals: trajectoriesToSignals(version, trajs, config.mapping ?? {}) });
    }
    versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // 最新在前
    versionsByProject.set(pid, versions);
  }

  const notSupported = (): never => {
    throw new Error('IngestConnector 不支持 legacy exec 接口；请用 listProjects/listVersions/fetchSignals');
  };

  return {
    id: config.id ?? 'ingest',
    kind: 'ingest',
    capabilities(): ConnectorCapabilities {
      return { evidenceLevel, drillable: evidenceLevel !== 'metric-only' };
    },
    fetchDecision(_q: ReportQuery): Promise<DecisionRecord> {
      return notSupported();
    },
    fetchKpis(_q: ReportQuery): Promise<KpiSet> {
      return notSupported();
    },
    async listProjects(): Promise<ProjectSummary[]> {
      return projects;
    },
    async listVersions(projectId: string): Promise<VersionSummary[]> {
      return versionsByProject.get(projectId) ?? [];
    },
    async fetchSignals(projectId: string, versionId: string): Promise<VersionSignals> {
      const s = signalsByVersion.get(`${projectId}/${versionId}`);
      if (!s) throw new Error(`未找到版本信号: ${projectId}/${versionId}`);
      return s;
    },
  };
}
