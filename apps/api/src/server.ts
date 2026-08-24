import Fastify, { type FastifyInstance } from 'fastify';
import type { DataConnector } from '@kaogongsi/contracts';
import { buildExecReportView } from '@kaogongsi/l6-report';
import { MockConnector } from '@kaogongsi/connector-mock';

export interface ServerDeps {
  /** 注入连接器——换实现即换数据源（D9.2 / AC-7）。默认 MockConnector。 */
  connector?: DataConnector;
}

/** 构建 app（可测：不 listen，直接 inject）。 */
export function buildServer(deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const connector: DataConnector = deps.connector ?? new MockConnector();

  app.get('/health', async () => ({ status: 'ok', service: 'kaogongsi-api' }));

  // 对上高管视图：视图经连接器拉取 → l6-report 重写 → 返回 ReportView
  app.get('/api/report/exec', async (req) => {
    const experimentId = (req.query as { experimentId?: string })?.experimentId ?? 'exp-001';
    const q = { experimentId };
    const [decision, kpis] = await Promise.all([
      connector.fetchDecision(q),
      connector.fetchKpis(q),
    ]);
    const view = buildExecReportView(decision, kpis, {
      drillable: connector.capabilities().drillable,
    });
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
