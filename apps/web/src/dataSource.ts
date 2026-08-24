import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@kaogongsi/contracts';
import { buildExecReportView } from '@kaogongsi/l6-report';
import { buildComparison } from '@kaogongsi/l6-compare';
import { TemplateReportGenerator } from '@kaogongsi/report-llm';
import { getConnector } from './connectors.js';

/**
 * 视图渲染时主动经连接器拉取（RFC-001/002）。视图不关心数据从哪来——只给 connectorId。
 * 换真实来源（BI/Langfuse/L5）＝换一个连接器实现，本文件与组件零改动（D9.2）。
 */

export async function loadProjects(connectorId: string): Promise<ProjectSummary[]> {
  return getConnector(connectorId).listProjects();
}

export async function loadVersions(connectorId: string, projectId: string): Promise<VersionSummary[]> {
  return getConnector(connectorId).listVersions(projectId);
}

/** 单版本报告：连接器取版本 → l6-report 重写为 exec 视图。 */
export async function loadVersionReport(
  connectorId: string,
  projectId: string,
  versionId: string,
): Promise<ReportView> {
  const connector = getConnector(connectorId);
  const report = await connector.fetchVersionReport(projectId, versionId);
  const drillable =
    connector.capabilities().drillable && report.version.evidenceLevel !== 'metric-only';
  return buildExecReportView(report.decision, report.kpis, { drillable });
}

/**
 * 两版本对比：连接器取两版本 → l6-compare 算 delta → 可选生成对比报告。
 * 对比报告默认用离线确定性模板（TemplateReportGenerator）；真实 LLM 走服务端
 * POST /api/report/compare（API key 只在服务端，见 MANUAL）。
 */
export async function loadComparison(
  connectorId: string,
  projectId: string,
  baselineId: string,
  candidateId: string,
  opts: { generateNarrative?: boolean } = {},
): Promise<ComparisonView> {
  const connector = getConnector(connectorId);
  const [projects, baseline, candidate] = await Promise.all([
    connector.listProjects(),
    connector.fetchVersionReport(projectId, baselineId),
    connector.fetchVersionReport(projectId, candidateId),
  ]);
  const project = projects.find((p) => p.id === projectId) ?? { id: projectId, name: projectId, description: '' };
  const view = buildComparison(project, baseline, candidate);
  if (opts.generateNarrative) {
    view.narrative = await new TemplateReportGenerator().generate({ view });
  }
  return view;
}

/** RFC-001 兼容：单份 exec 报告（fetchDecision+fetchKpis）。 */
export async function loadExecReport(connectorId: string, experimentId = 'exp-001'): Promise<ReportView> {
  const connector = getConnector(connectorId);
  const q = { experimentId };
  const [decision, kpis] = await Promise.all([connector.fetchDecision(q), connector.fetchKpis(q)]);
  return buildExecReportView(decision, kpis, { drillable: connector.capabilities().drillable });
}
