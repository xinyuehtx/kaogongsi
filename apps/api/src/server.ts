import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { DataConnector, ReportGenerator } from '@tengxiaohtx/contracts';
import { computeEvaluation } from '@tengxiaohtx/l3-metrics';
import { assembleVersionReport, buildExecReportView } from '@tengxiaohtx/l6-report';
import { buildComparison } from '@tengxiaohtx/l6-compare';
import { MockConnector } from '@tengxiaohtx/connector-mock';
import { createReportGenerator } from '@tengxiaohtx/report-llm';
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

  const drillableOf = (evidenceLevel: string): boolean =>
    connector.capabilities().drillable && evidenceLevel !== 'metric-only';

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
    const { version, signals } = await connector.fetchSignals(projectId, versionId);
    const report = assembleVersionReport(computeEvaluation(version, signals));
    const view = buildExecReportView(report.decision, report.kpis, { drillable: drillableOf(version.evidenceLevel) });
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
    const [base, cand] = await Promise.all([
      connector.fetchSignals(projectId, baselineId),
      connector.fetchSignals(projectId, candidateId),
    ]);
    const baseline = assembleVersionReport(computeEvaluation(base.version, base.signals));
    const candidate = assembleVersionReport(computeEvaluation(cand.version, cand.signals));
    const view = buildComparison(project, baseline, candidate);
    if (generateNarrative) view.narrative = await reportGenerator.generate({ view });
    return view;
  });

  return app;
}

// 仅在直接运行时监听（被测试 import 时不监听）
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3001);
  app
    .listen({ port, host: '0.0.0.0' })
    .then(() => console.log(`api listening on :${port}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
