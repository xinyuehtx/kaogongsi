import type { ReportView } from '@kaogongsi/contracts';
import { buildExecReportView } from '@kaogongsi/l6-report';
import { getConnector } from './connectors.js';

/**
 * 视图渲染时主动经连接器拉取（RFC-001 §3.2）。
 * 视图不关心数据从哪来——只给 connectorId。
 */
export async function loadExecReport(
  connectorId: string,
  experimentId = 'exp-001',
): Promise<ReportView> {
  const connector = getConnector(connectorId);
  const q = { experimentId };
  const [decision, kpis] = await Promise.all([
    connector.fetchDecision(q),
    connector.fetchKpis(q),
  ]);
  return buildExecReportView(decision, kpis, {
    drillable: connector.capabilities().drillable,
  });
}
