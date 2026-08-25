import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { DataConnector, ReportGenerator } from '@tengxiaohtx/contracts';
import { METRIC_CATALOG } from '@tengxiaohtx/contracts';
import { computeEvaluation } from '@tengxiaohtx/metrics';
import { assembleVersionReport, buildExecReportView } from '@tengxiaohtx/report';
import { buildComparison } from '@tengxiaohtx/compare';
import { MockConnector } from '@tengxiaohtx/connector-mock';
import { FileSource, HttpSource, createIngestConnector, createRegistry } from '@tengxiaohtx/ingest';
import { createReportGenerator } from '@tengxiaohtx/report-llm';
import {
  InMemoryDocumentStore,
  InMemoryKvStore,
  PluginDataService,
  PluginHost,
} from '@tengxiaohtx/plugin-core';
import { defaultPlugins } from '@tengxiaohtx/plugin-example';
import {
  FileStorage,
  InMemoryStorage,
  type Role,
  type StoragePort,
  type User,
  authenticate,
  authorizedProjectIds,
  canAccessProject,
  canManageUsers,
  filterViewForRole,
  login as loginUser,
  registerUser,
  toPublicUser,
} from '@tengxiaohtx/auth-core';

export interface ServerDeps {
  connector?: DataConnector; // 换实现即换数据源（D9.2 / AC-7）
  reportGenerator?: ReportGenerator; // LLM 出口端口（D3）
  storage?: StoragePort; // 账号/授权存储端口（默认内存，KAOGONGSI_DATA_DIR→文件）
  jwtSecret?: string;
  host?: PluginHost; // 全链路插件宿主（RFC-007，默认注册示例插件）
}

interface CompareBody {
  projectId: string;
  baselineId: string;
  candidateId: string;
  generateNarrative?: boolean;
}

function resolveStorage(deps: ServerDeps): StoragePort {
  if (deps.storage) return deps.storage;
  const dir = process.env.KAOGONGSI_DATA_DIR;
  return dir ? new FileStorage(dir) : new InMemoryStorage();
}

export function buildServer(deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const connector: DataConnector = deps.connector ?? new MockConnector();
  const reportGenerator: ReportGenerator = deps.reportGenerator ?? createReportGenerator();
  const storage = resolveStorage(deps);
  const secret = deps.jwtSecret ?? process.env.KAOGONGSI_JWT_SECRET ?? 'dev-insecure-secret';
  const host = deps.host ?? new PluginHost();
  if (!deps.host) host.registerAll(defaultPlugins);
  const pluginData = new PluginDataService(() => host.storageSchemas(), new InMemoryDocumentStore(), new InMemoryKvStore());

  const drillableOf = (evidenceLevel: string): boolean =>
    connector.capabilities().drillable && evidenceLevel !== 'metric-only';

  // 六层管道 + 插件：合并指标目录 + 派生信号 + 并入外部数据（财务/BI）
  const buildVersionReport = async (projectId: string, versionId: string) => {
    const { version, signals } = await connector.fetchSignals(projectId, versionId);
    const ev = computeEvaluation(version, host.applyDerivations(signals), host.mergedCatalog(METRIC_CATALOG));
    for (const e of host.externalData()) {
      try {
        ev.kpis[e.group].push(...(await e.fetch({ projectId, versionId }, {})));
      } catch {
        /* 外部数据源不可用不阻断报告 */
      }
    }
    return assembleVersionReport(ev);
  };

  const currentUser = (req: FastifyRequest): User | null => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    return authenticate(storage, h.slice(7), secret);
  };
  const requireUser = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = currentUser(req);
    if (!u) {
      reply.code(401).send({ error: '未认证' });
      return null;
    }
    return u;
  };
  const requireAdmin = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = requireUser(req, reply);
    if (u && !canManageUsers(u.role)) {
      reply.code(403).send({ error: '需要管理员权限' });
      return null;
    }
    return u;
  };
  const grantedIds = (u: User): string[] => storage.listGrantsByUser(u.id).map((g) => g.projectId);

  app.get('/health', async () => ({ status: 'ok', service: 'kaogongsi-api' }));

  // ── 认证 ────────────────────────────────────────────────
  app.post('/api/auth/register', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string; displayName?: string };
    try {
      const user = registerUser(storage, { email: body.email ?? '', password: body.password ?? '', displayName: body.displayName });
      const { token } = loginUser(storage, user.email, body.password ?? '', secret);
      return reply.code(201).send({ token, user });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    try {
      return loginUser(storage, body.email ?? '', body.password ?? '', secret);
    } catch (e) {
      return reply.code(401).send({ error: (e as Error).message });
    }
  });

  app.get('/api/auth/me', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    return { user: toPublicUser(u), grants: grantedIds(u) };
  });

  // ── 管理端（仅 admin）────────────────────────────────────
  app.get('/api/admin/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return storage.listUsers().map((u) => ({ ...toPublicUser(u), grants: grantedIds(u) }));
  });

  app.post('/api/admin/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = (req.body ?? {}) as { email?: string; password?: string; displayName?: string; role?: Role };
    try {
      const user = registerUser(
        storage,
        { email: body.email ?? '', password: body.password ?? '', displayName: body.displayName },
        { byAdmin: true, role: body.role },
      );
      return reply.code(201).send(user);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.patch('/api/admin/users/:id/role', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const { role } = (req.body ?? {}) as { role?: Role };
    if (!role) return reply.code(400).send({ error: '缺少 role' });
    storage.updateUserRole(id, role);
    return { ok: true };
  });

  app.post('/api/admin/grants', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { userId, projectId } = (req.body ?? {}) as { userId?: string; projectId?: string };
    if (!userId || !projectId) return reply.code(400).send({ error: '缺少 userId / projectId' });
    storage.addGrant({ userId, projectId });
    return { ok: true };
  });

  app.post('/api/admin/grants/revoke', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { userId, projectId } = (req.body ?? {}) as { userId?: string; projectId?: string };
    if (!userId || !projectId) return reply.code(400).send({ error: '缺少 userId / projectId' });
    storage.removeGrant(userId, projectId);
    return { ok: true };
  });

  // ── 数据（认证 + 项目授权 + 角色过滤）────────────────────
  app.get('/api/projects', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const all = await connector.listProjects();
    const allowed = authorizedProjectIds(u.role, grantedIds(u), all.map((p) => p.id));
    return all.filter((p) => allowed.includes(p.id));
  });

  app.get('/api/projects/:id/versions', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    if (!canAccessProject(u.role, grantedIds(u), id)) return reply.code(403).send({ error: '无此项目访问权' });
    return connector.listVersions(id);
  });

  // 单版本报告：信号(L1)→血缘(L2)+指标(L3)→归因(L4)→决策(L5)→exec 视图，按角色过滤分区
  app.get('/api/report/version', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { projectId, versionId } = req.query as { projectId?: string; versionId?: string };
    if (!projectId || !versionId) return reply.code(400).send({ error: '缺少 projectId 或 versionId' });
    if (!canAccessProject(u.role, grantedIds(u), projectId)) return reply.code(403).send({ error: '无此项目访问权' });
    const report = await buildVersionReport(projectId, versionId);
    const view = buildExecReportView(report.decision, report.kpis, { drillable: drillableOf(report.version.evidenceLevel) });
    return filterViewForRole(view, u.role);
  });

  // 两版本对比（+ 可选 LLM/模板生成对比报告）
  app.post('/api/report/compare', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { projectId, baselineId, candidateId, generateNarrative } = (req.body ?? {}) as CompareBody;
    if (!projectId || !baselineId || !candidateId) return reply.code(400).send({ error: '缺少 projectId / baselineId / candidateId' });
    if (!canAccessProject(u.role, grantedIds(u), projectId)) return reply.code(403).send({ error: '无此项目访问权' });
    const projects = await connector.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) return reply.code(404).send({ error: `未找到项目: ${projectId}` });
    const [baseline, candidate] = await Promise.all([
      buildVersionReport(projectId, baselineId),
      buildVersionReport(projectId, candidateId),
    ]);
    const view = buildComparison(project, baseline, candidate);
    if (generateNarrative) view.narrative = await reportGenerator.generate({ view });
    return view;
  });

  // ── 插件（RFC-007）：清单 / UI DSL 表单 / 用户输入入库 ──────
  app.get('/api/plugins', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return host.plugins().map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      layers: p.layers,
      forms: p.forms ?? [],
      storage: (p.storage ?? []).map((s) => s.collection),
      skills: (p.skills ?? []).map((s) => ({ id: s.id, label: s.label })),
    }));
  });

  app.get('/api/plugins/data/:collection/:id', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const { collection, id } = req.params as { collection: string; id: string };
    try {
      return { data: (await pluginData.load(collection, id)) ?? null };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.post('/api/plugins/data/:collection/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return; // 配置入库仅管理员
    const { collection, id } = req.params as { collection: string; id: string };
    try {
      return await pluginData.save(collection, id, (req.body ?? {}) as Record<string, unknown>);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  return app;
}

/**
 * 按部署环境构建轨迹接入连接器（RFC-006）。未配置 KAOGONGSI_INGEST 则返回 undefined（用默认 Mock）。
 *  - KAOGONGSI_INGEST=file:/path | http(s)://host/api/traces
 *  - KAOGONGSI_PARSERS=claude-code,langfuse,…（选配解析器插件；空=全部）
 *  - KAOGONGSI_INGEST_HEADERS（JSON，http 自定义 header）/ _TAGS / _FROM / _TO / _FORMAT
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
  let source;
  if (/^https?:/.test(spec)) {
    const headers = process.env.KAOGONGSI_INGEST_HEADERS ? (JSON.parse(process.env.KAOGONGSI_INGEST_HEADERS) as Record<string, string>) : undefined;
    source = new HttpSource(spec, { headers });
  } else {
    source = new FileSource(spec.startsWith('file:') ? spec.slice('file:'.length) : spec);
  }
  return createIngestConnector({ source, registry, query, format });
}

// 仅在直接运行时监听（被测试 import 时不监听）
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 3001);
  resolveIngestConnector()
    .then((connector) => buildServer(connector ? { connector } : {}))
    .then((app) => app.listen({ port, host: '0.0.0.0' }))
    .then(() => console.log(`api listening on :${port}${process.env.KAOGONGSI_INGEST ? ` (ingest: ${process.env.KAOGONGSI_INGEST})` : ''}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
