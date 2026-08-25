import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  ConsoleLogger,
  FileLogger,
  FileRunStore,
  InMemoryRunStore,
  type Logger,
  type RunStore,
} from '@tengxiaohtx/run-store';
import { createPersistence } from '@tengxiaohtx/persistence';
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
import type { CompareInput, ServerServices } from './ports.js';

export * from './ports.js';

/**
 * 内核 · HTTP 服务外壳：账号/权限（认证 + RBAC + 管理端）、运行溯源查询、插件配置入库端点。
 * **不依赖 middleware / connectors**：报告与项目目录经 `ServerServices` 端口注入（由 example 装配）。
 */
export interface ServerDeps {
  services: ServerServices; // 组装层注入的领域能力（必需）
  storage?: StoragePort; // 账号/授权存储端口（默认按防腐层装配：DB → 文件 → 内存）
  runStore?: RunStore; // 运行溯源存储
  logger?: Logger; // 服务端日志接口
  jwtSecret?: string;
}

function resolveStorage(deps: ServerDeps, persisted?: StoragePort): StoragePort {
  if (deps.storage) return deps.storage;
  if (persisted) return persisted; // 防腐层：Postgres/Prisma
  const dir = process.env.KAOGONGSI_DATA_DIR;
  return dir ? new FileStorage(dir) : new InMemoryStorage();
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { projects, reports, plugins } = deps.services;
  // 防腐层装配：env 配了 DATABASE_URL/REDIS_URL 则用 Postgres/Redis，否则回落内存/文件。
  const persistence = createPersistence();
  const storage = resolveStorage(deps, persistence.authStorage);
  const secret = deps.jwtSecret ?? process.env.KAOGONGSI_JWT_SECRET ?? 'dev-insecure-secret';
  const dataDir = process.env.KAOGONGSI_DATA_DIR;
  const runStore: RunStore =
    deps.runStore ?? persistence.runStore ?? (dataDir ? new FileRunStore(`${dataDir}/runs`) : new InMemoryRunStore());
  const logger: Logger = deps.logger ?? (dataDir ? new FileLogger(`${dataDir}/logs`) : new ConsoleLogger());

  const currentUser = async (req: FastifyRequest): Promise<User | null> => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    return authenticate(storage, h.slice(7), secret);
  };
  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<User | null> => {
    const u = await currentUser(req);
    if (!u) {
      reply.code(401).send({ error: '未认证' });
      return null;
    }
    return u;
  };
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply): Promise<User | null> => {
    const u = await requireUser(req, reply);
    if (u && !canManageUsers(u.role)) {
      reply.code(403).send({ error: '需要管理员权限' });
      return null;
    }
    return u;
  };
  const grantedIds = async (u: User): Promise<string[]> => (await storage.listGrantsByUser(u.id)).map((g) => g.projectId);

  app.get('/health', async () => ({ status: 'ok', service: 'kaogongsi-api' }));

  // ── 认证 ────────────────────────────────────────────────
  app.post('/api/auth/register', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string; displayName?: string };
    try {
      const user = await registerUser(storage, { email: body.email ?? '', password: body.password ?? '', displayName: body.displayName });
      const { token } = await loginUser(storage, user.email, body.password ?? '', secret);
      return reply.code(201).send({ token, user });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    try {
      return await loginUser(storage, body.email ?? '', body.password ?? '', secret);
    } catch (e) {
      return reply.code(401).send({ error: (e as Error).message });
    }
  });

  app.get('/api/auth/me', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    return { user: toPublicUser(u), grants: await grantedIds(u) };
  });

  // ── 管理端（仅 admin）────────────────────────────────────
  app.get('/api/admin/users', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const users = await storage.listUsers();
    return Promise.all(users.map(async (u) => ({ ...toPublicUser(u), grants: await grantedIds(u) })));
  });

  app.post('/api/admin/users', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const body = (req.body ?? {}) as { email?: string; password?: string; displayName?: string; role?: Role };
    try {
      const user = await registerUser(
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
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const { role } = (req.body ?? {}) as { role?: Role };
    if (!role) return reply.code(400).send({ error: '缺少 role' });
    await storage.updateUserRole(id, role);
    return { ok: true };
  });

  app.post('/api/admin/grants', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { userId, projectId } = (req.body ?? {}) as { userId?: string; projectId?: string };
    if (!userId || !projectId) return reply.code(400).send({ error: '缺少 userId / projectId' });
    await storage.addGrant({ userId, projectId });
    return { ok: true };
  });

  app.post('/api/admin/grants/revoke', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { userId, projectId } = (req.body ?? {}) as { userId?: string; projectId?: string };
    if (!userId || !projectId) return reply.code(400).send({ error: '缺少 userId / projectId' });
    await storage.removeGrant(userId, projectId);
    return { ok: true };
  });

  // ── 数据（认证 + 项目授权 + 角色过滤）────────────────────
  app.get('/api/projects', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const all = await projects.listProjects();
    const allowed = authorizedProjectIds(u.role, await grantedIds(u), all.map((p) => p.id));
    return all.filter((p) => allowed.includes(p.id));
  });

  app.get('/api/projects/:id/versions', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    if (!canAccessProject(u.role, await grantedIds(u), id)) return reply.code(403).send({ error: '无此项目访问权' });
    return projects.listVersions(id);
  });

  // 单版本报告：管道由组装层实现；内核只做鉴权 + 按角色过滤分区 + 回传 runId
  app.get('/api/report/version', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const { projectId, versionId } = req.query as { projectId?: string; versionId?: string };
    if (!projectId || !versionId) return reply.code(400).send({ error: '缺少 projectId 或 versionId' });
    if (!canAccessProject(u.role, await grantedIds(u), projectId)) return reply.code(403).send({ error: '无此项目访问权' });
    const { view, runId } = await reports.versionReport(projectId, versionId, u.email);
    reply.header('x-run-id', runId);
    return filterViewForRole(view, u.role);
  });

  // 两版本对比（+ 可选 LLM/模板生成对比报告）
  app.post('/api/report/compare', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const body = (req.body ?? {}) as Partial<CompareInput>;
    const { projectId, baselineId, candidateId, generateNarrative } = body;
    if (!projectId || !baselineId || !candidateId) return reply.code(400).send({ error: '缺少 projectId / baselineId / candidateId' });
    if (!canAccessProject(u.role, await grantedIds(u), projectId)) return reply.code(403).send({ error: '无此项目访问权' });
    try {
      return await reports.compare({ projectId, baselineId, candidateId, generateNarrative }, u.email);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('未找到')) return reply.code(404).send({ error: msg });
      throw e; // 其余错误按 500 暴露，不掩盖
    }
  });

  // ── 溯源 / 重试 / 连接器版本（RFC-009）──────────────────────
  app.get('/api/runs', async (req, reply) => {
    if (!(await requireUser(req, reply))) return;
    const { projectId } = req.query as { projectId?: string };
    return runStore.listRuns(projectId ? { projectId } : undefined);
  });

  app.get('/api/runs/:runId', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const { runId } = req.params as { runId: string };
    const run = await runStore.getRun(runId);
    if (!run.meta) return reply.code(404).send({ error: '未找到运行' });
    if (!canAccessProject(u.role, await grantedIds(u), run.meta.projectId)) return reply.code(403).send({ error: '无此项目访问权' });
    return run; // { meta, layers[] } —— 每层入参可溯源
  });

  app.post('/api/runs/:runId/retry', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const { runId } = req.params as { runId: string };
    const run = await runStore.getRun(runId);
    if (!run.meta) return reply.code(404).send({ error: '未找到运行' });
    if (!canAccessProject(u.role, await grantedIds(u), run.meta.projectId)) return reply.code(403).send({ error: '无此项目访问权' });
    const view = await reports.retryRun(runId);
    if (!view) return reply.code(400).send({ error: '无可重试的入参' });
    logger.info('report.retry', { runId, projectId: run.meta.projectId, versionId: run.meta.versionId });
    return filterViewForRole(view, u.role);
  });

  app.get('/api/connector-versions', async (req, reply) => {
    if (!(await requireUser(req, reply))) return;
    const { connectorId } = req.query as { connectorId?: string };
    return runStore.listConnectorVersions(connectorId);
  });

  // ── 插件（RFC-007）：清单 / UI DSL 表单 / 用户输入入库 ──────
  app.get('/api/plugins', async (req, reply) => {
    if (!(await requireUser(req, reply))) return;
    return plugins?.list() ?? [];
  });

  app.get('/api/plugins/data/:collection/:id', async (req, reply) => {
    if (!(await requireUser(req, reply))) return;
    if (!plugins) return reply.code(404).send({ error: '未装配插件目录' });
    const { collection, id } = req.params as { collection: string; id: string };
    try {
      return { data: (await plugins.loadData(collection, id)) ?? null };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.post('/api/plugins/data/:collection/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return; // 配置入库仅管理员
    if (!plugins) return reply.code(404).send({ error: '未装配插件目录' });
    const { collection, id } = req.params as { collection: string; id: string };
    try {
      return await plugins.saveData(collection, id, (req.body ?? {}) as Record<string, unknown>);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  return app;
}
