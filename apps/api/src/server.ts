import Fastify, { type FastifyInstance } from 'fastify';
import type { DataConnector, ReportGenerator } from '@kaogongsi/contracts';
import { buildExecReportView } from '@kaogongsi/l6-report';
import { buildComparison } from '@kaogongsi/l6-compare';
import { MockConnector } from '@kaogongsi/connector-mock';
import { createReportGenerator } from '@kaogongsi/report-llm';

export interface ServerDeps {
  /** 注入连接器——换实现即换数据源（D9.2 / AC-7）。默认 MockConnector。 */
  connector?: DataConnector;
  /** 注入报告生成器——端口化（D3）。默认按 env 选真实 LLM，否则离线模板。 */
  reportGenerator?: ReportGenerator;
}

interface CompareBody {
  projectId: string;
  baselineId: string;
  candidateId: string;
  generateNarrative?: boolean;
}

/** 构建 app（可测：不 listen，直接 inject）。 */
export function buildServer(deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const connector: DataConnector = deps.connector ?? new MockConnector();
  const reportGenerator: ReportGenerator = deps.reportGenerator ?? createReportGenerator();

  const drillableOf = (evidenceLevel: string): boolean =>
    connector.capabilities().drillable && evidenceLevel !== 'metric-only';

  app.get('/health', async () => ({ status: 'ok', service: 'kaogongsi-api' }));

  // 对上高管视图（RFC-001）：默认单份报告，兼容旧路径。
  app.get('/api/report/exec', async (req) => {
    const experimentId = (req.query as { experimentId?: string })?.experimentId ?? 'exp-001';
    const q = { experimentId };
    const [decision, kpis] = await Promise.all([connector.fetchDecision(q), connector.fetchKpis(q)]);
    return buildExecReportView(decision, kpis, { drillable: connector.capabilities().drillable });
  });

  // ── RFC-002：按「项目 → 版本」组织 ──────────────────────────
  app.get('/api/projects', async () => connector.listProjects());

  app.get('/api/projects/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    return connector.listVersions(id);
  });

  // 单版本报告（复用 exec 视图重写）
  app.get('/api/report/version', async (req, reply) => {
    const { projectId, versionId } = req.query as { projectId?: string; versionId?: string };
    if (!projectId || !versionId) return reply.code(400).send({ error: '缺少 projectId 或 versionId' });
    const report = await connector.fetchVersionReport(projectId, versionId);
    return buildExecReportView(report.decision, report.kpis, {
      drillable: drillableOf(report.version.evidenceLevel),
    });
  });

  // 两版本对比（+ 可选 LLM/模板生成对比报告）
  app.post('/api/report/compare', async (req, reply) => {
    const { projectId, baselineId, candidateId, generateNarrative } = (req.body ?? {}) as CompareBody;
    if (!projectId || !baselineId || !candidateId) {
      return reply.code(400).send({ error: '缺少 projectId / baselineId / candidateId' });
    }
    const projects = await connector.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) return reply.code(404).send({ error: `未找到项目: ${projectId}` });

    const [baseline, candidate] = await Promise.all([
      connector.fetchVersionReport(projectId, baselineId),
      connector.fetchVersionReport(projectId, candidateId),
    ]);
    const view = buildComparison(project, baseline, candidate);
    if (generateNarrative) {
      view.narrative = await reportGenerator.generate({ view });
    }
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
