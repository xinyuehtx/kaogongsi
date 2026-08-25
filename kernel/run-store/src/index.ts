import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LayerId } from '@tengxiaohtx/contracts';

/**
 * 内核 · 日志接口 + 运行溯源存储（RFC-009）。
 *  - Logger：服务端日志文件记录（可换实现）。
 *  - RunStore：落库「每次运行的每层入参（除 L1）」+「连接器两种版本」，供溯源/重试。
 *    L1 内容大且可能独立存储：不内联落库，溯源时按接口按需查（connector.fetchSignals）。
 */

// ── 日志接口 ──────────────────────────────────────────────────
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  info(msg: string, meta?: Record<string, unknown>): void { console.log(fmt('INFO', msg, meta)); }
  warn(msg: string, meta?: Record<string, unknown>): void { console.warn(fmt('WARN', msg, meta)); }
  error(msg: string, meta?: Record<string, unknown>): void { console.error(fmt('ERROR', msg, meta)); }
}

/** 服务端文件日志：按天追加到 <dir>/server-YYYY-MM-DD.log。 */
export class FileLogger implements Logger {
  constructor(private readonly dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  private write(level: string, msg: string, meta?: Record<string, unknown>): void {
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(this.dir, `server-${day}.log`), `${fmt(level, msg, meta)}\n`, 'utf8');
  }
  info(msg: string, meta?: Record<string, unknown>): void { this.write('INFO', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>): void { this.write('WARN', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>): void { this.write('ERROR', msg, meta); }
}

function fmt(level: string, msg: string, meta?: Record<string, unknown>): string {
  return `${new Date().toISOString()} ${level} ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
}

// ── 运行溯源存储 ──────────────────────────────────────────────
/** 连接器版本快照：两种版本都要记录。 */
export interface ConnectorVersionRecord {
  connectorId: string;
  packageVersion?: string; // 插件安装包版本
  configVersion?: string; // 配置数据版本（用户经 DSL 注入的配置版本）
  at: string;
  meta?: Record<string, unknown>;
}

/** 某次运行、某一层的入参记录（除 L1）。 */
export interface RunLayerRecord {
  runId: string;
  seq: number;
  layer: LayerId;
  stageId: string;
  input: unknown; // 该层运行入参（合并前的 ctx 快照，去除 L1 大对象）
  at: string;
}

/** 一次运行的元信息。 */
export interface RunMeta {
  runId: string;
  at: string;
  connectorId: string;
  packageVersion?: string;
  configVersion?: string;
  projectId: string;
  versionId: string;
  actor?: string; // 触发用户
}

export interface RunStore {
  putConnectorVersion(rec: ConnectorVersionRecord): void;
  listConnectorVersions(connectorId?: string): ConnectorVersionRecord[];
  startRun(meta: RunMeta): void;
  putLayer(rec: RunLayerRecord): void;
  getRun(runId: string): { meta?: RunMeta; layers: RunLayerRecord[] };
  listRuns(filter?: { projectId?: string }): RunMeta[];
}

export class InMemoryRunStore implements RunStore {
  protected connectorVersions: ConnectorVersionRecord[] = [];
  protected runMetas: RunMeta[] = [];
  protected layers: RunLayerRecord[] = [];

  putConnectorVersion(rec: ConnectorVersionRecord): void {
    const dup = this.connectorVersions.some((v) => v.connectorId === rec.connectorId && v.packageVersion === rec.packageVersion && v.configVersion === rec.configVersion);
    if (!dup) this.connectorVersions.push(rec);
    this.persist();
  }
  listConnectorVersions(connectorId?: string): ConnectorVersionRecord[] {
    return this.connectorVersions.filter((v) => !connectorId || v.connectorId === connectorId);
  }
  startRun(meta: RunMeta): void {
    this.runMetas.push(meta);
    this.persist();
  }
  putLayer(rec: RunLayerRecord): void {
    this.layers.push(rec);
    this.persist();
  }
  getRun(runId: string): { meta?: RunMeta; layers: RunLayerRecord[] } {
    return {
      meta: this.runMetas.find((m) => m.runId === runId),
      layers: this.layers.filter((l) => l.runId === runId).sort((a, b) => a.seq - b.seq),
    };
  }
  listRuns(filter?: { projectId?: string }): RunMeta[] {
    return this.runMetas.filter((m) => !filter?.projectId || m.projectId === filter.projectId);
  }
  protected persist(): void {
    /* 内存实现无副作用；文件实现覆写 */
  }
}

interface RunStoreData {
  connectorVersions: ConnectorVersionRecord[];
  runMetas: RunMeta[];
  layers: RunLayerRecord[];
}

/** 文件实现：整份 JSON 落盘（自包含持久化）。 */
export class FileRunStore extends InMemoryRunStore {
  private readonly file: string;
  constructor(dir: string) {
    super();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'runs.json');
    if (existsSync(this.file)) {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as RunStoreData;
      this.connectorVersions = d.connectorVersions ?? [];
      this.runMetas = d.runMetas ?? [];
      this.layers = d.layers ?? [];
    }
  }
  protected override persist(): void {
    const data: RunStoreData = { connectorVersions: this.connectorVersions, runMetas: this.runMetas, layers: this.layers };
    writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
  }
}
