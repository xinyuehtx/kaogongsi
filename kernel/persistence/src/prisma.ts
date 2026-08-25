import { PrismaClient } from '@prisma/client';
import type { ProjectGrant, Role, StoragePort, User } from '@tengxiaohtx/auth-core';
import type { DocumentStore } from '@tengxiaohtx/plugin-core';
import type {
  ConnectorVersionRecord,
  RunLayerRecord,
  RunMeta,
  RunStore,
} from '@tengxiaohtx/run-store';

/**
 * 防腐层 · Postgres/Prisma 适配器：把领域端口映射到 Prisma。
 * 领域只依赖端口（StoragePort/DocumentStore/RunStore），不依赖 Prisma——DB 细节不泄漏进内核。
 */

let singleton: PrismaClient | undefined;
/** 惰性单例 PrismaClient（避免重复连接）。 */
export function getPrisma(url?: string): PrismaClient {
  if (!singleton) {
    singleton = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();
  }
  return singleton;
}

// ── 账号/授权（StoragePort）──────────────────────────────────
export class PrismaAuthStorage implements StoragePort {
  constructor(private readonly prisma: PrismaClient) {}
  async listUsers(): Promise<User[]> {
    return (await this.prisma.user.findMany()) as User[];
  }
  async getUserById(id: string): Promise<User | undefined> {
    return (await this.prisma.user.findUnique({ where: { id } })) as User | null ?? undefined;
  }
  async getUserByEmail(email: string): Promise<User | undefined> {
    return (await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } })) as User | null ?? undefined;
  }
  async createUser(user: User): Promise<void> {
    await this.prisma.user.create({ data: user });
  }
  async updateUserRole(id: string, role: Role): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { role } });
  }
  async listGrantsByUser(userId: string): Promise<ProjectGrant[]> {
    return (await this.prisma.grant.findMany({ where: { userId } })).map((g) => ({ userId: g.userId, projectId: g.projectId }));
  }
  async listAllGrants(): Promise<ProjectGrant[]> {
    return (await this.prisma.grant.findMany()).map((g) => ({ userId: g.userId, projectId: g.projectId }));
  }
  async addGrant(grant: ProjectGrant): Promise<void> {
    await this.prisma.grant.upsert({
      where: { userId_projectId: { userId: grant.userId, projectId: grant.projectId } },
      create: grant,
      update: {},
    });
  }
  async removeGrant(userId: string, projectId: string): Promise<void> {
    await this.prisma.grant.deleteMany({ where: { userId, projectId } });
  }
}

// ── 插件用户输入文档（DocumentStore）────────────────────────
export class PrismaDocumentStore implements DocumentStore {
  constructor(private readonly prisma: PrismaClient) {}
  async put(collection: string, id: string, doc: Record<string, unknown>): Promise<void> {
    const json = JSON.stringify(doc);
    const updatedAt = new Date().toISOString();
    await this.prisma.pluginDoc.upsert({
      where: { collection_key: { collection, key: id } },
      create: { collection, key: id, json, updatedAt },
      update: { json, updatedAt },
    });
  }
  async get(collection: string, id: string): Promise<Record<string, unknown> | undefined> {
    const row = await this.prisma.pluginDoc.findUnique({ where: { collection_key: { collection, key: id } } });
    return row ? (JSON.parse(row.json) as Record<string, unknown>) : undefined;
  }
  async list(collection: string): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.pluginDoc.findMany({ where: { collection } });
    return rows.map((r) => JSON.parse(r.json) as Record<string, unknown>);
  }
  async delete(collection: string, id: string): Promise<void> {
    await this.prisma.pluginDoc.deleteMany({ where: { collection, key: id } });
  }
}

// ── 运行溯源（RunStore）─────────────────────────────────────
export class PrismaRunStore implements RunStore {
  constructor(private readonly prisma: PrismaClient) {}
  async putConnectorVersion(rec: ConnectorVersionRecord): Promise<void> {
    const dup = await this.prisma.connectorVersionRow.findFirst({
      where: { connectorId: rec.connectorId, packageVersion: rec.packageVersion ?? null, configVersion: rec.configVersion ?? null },
    });
    if (!dup) {
      await this.prisma.connectorVersionRow.create({
        data: { connectorId: rec.connectorId, packageVersion: rec.packageVersion ?? null, configVersion: rec.configVersion ?? null, at: rec.at, meta: rec.meta ? JSON.stringify(rec.meta) : null },
      });
    }
  }
  async listConnectorVersions(connectorId?: string): Promise<ConnectorVersionRecord[]> {
    const rows = await this.prisma.connectorVersionRow.findMany({ where: connectorId ? { connectorId } : undefined });
    return rows.map((r) => ({ connectorId: r.connectorId, packageVersion: r.packageVersion ?? undefined, configVersion: r.configVersion ?? undefined, at: r.at, meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : undefined }));
  }
  async startRun(meta: RunMeta): Promise<void> {
    await this.prisma.runMetaRow.create({
      data: { runId: meta.runId, at: meta.at, connectorId: meta.connectorId, packageVersion: meta.packageVersion ?? null, configVersion: meta.configVersion ?? null, projectId: meta.projectId, versionId: meta.versionId, actor: meta.actor ?? null },
    });
  }
  async putLayer(rec: RunLayerRecord): Promise<void> {
    await this.prisma.runLayerRow.create({
      data: { runId: rec.runId, seq: rec.seq, layer: rec.layer, stageId: rec.stageId, input: JSON.stringify(rec.input), at: rec.at },
    });
  }
  async getRun(runId: string): Promise<{ meta?: RunMeta; layers: RunLayerRecord[] }> {
    const m = await this.prisma.runMetaRow.findUnique({ where: { runId } });
    const rows = await this.prisma.runLayerRow.findMany({ where: { runId }, orderBy: { seq: 'asc' } });
    return {
      meta: m ? { runId: m.runId, at: m.at, connectorId: m.connectorId, packageVersion: m.packageVersion ?? undefined, configVersion: m.configVersion ?? undefined, projectId: m.projectId, versionId: m.versionId, actor: m.actor ?? undefined } : undefined,
      layers: rows.map((r) => ({ runId: r.runId, seq: r.seq, layer: r.layer as RunLayerRecord['layer'], stageId: r.stageId, input: JSON.parse(r.input) as unknown, at: r.at })),
    };
  }
  async listRuns(filter?: { projectId?: string }): Promise<RunMeta[]> {
    const rows = await this.prisma.runMetaRow.findMany({ where: filter?.projectId ? { projectId: filter.projectId } : undefined });
    return rows.map((m) => ({ runId: m.runId, at: m.at, connectorId: m.connectorId, packageVersion: m.packageVersion ?? undefined, configVersion: m.configVersion ?? undefined, projectId: m.projectId, versionId: m.versionId, actor: m.actor ?? undefined }));
  }
}
