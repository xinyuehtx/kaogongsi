import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@kaogongsi/contracts';
import { computeEvaluation } from '@kaogongsi/l3-metrics';
import { assembleVersionReport, buildExecReportView } from '@kaogongsi/l6-report';
import { buildComparison } from '@kaogongsi/l6-compare';
import { TemplateReportGenerator } from '@kaogongsi/report-llm';
import { getConnector } from './connectors.js';

/**
 * 视图渲染时主动经连接器拉取（RFC-001~004）。视图不关心数据从哪来——只给 connectorId。
 * 全管道：连接器取原始信号(L1) → 血缘(L2)+指标(L3) → 归因(L4) → 决策(L5) → 报告(L6)。
 * 换真实来源（BI/Langfuse/L5）＝换一个连接器实现，本文件与组件零改动（D9.2）。
 */

export async function loadProjects(connectorId: string): Promise<ProjectSummary[]> {
  return getConnector(connectorId).listProjects();
}

export async function loadVersions(connectorId: string, projectId: string): Promise<VersionSummary[]> {
  return getConnector(connectorId).listVersions(projectId);
}

/** 单版本报告：信号 → 指标 → 归因 → 决策 → exec 视图。 */
export async function loadVersionReport(
  connectorId: string,
  projectId: string,
  versionId: string,
): Promise<ReportView> {
  const connector = getConnector(connectorId);
  const { version, signals } = await connector.fetchSignals(projectId, versionId);
  const report = assembleVersionReport(computeEvaluation(version, signals));
  const drillable = connector.capabilities().drillable && version.evidenceLevel !== 'metric-only';
  return buildExecReportView(report.decision, report.kpis, { drillable });
}

/**
 * 两版本对比：信号×2 → 指标/归因/决策 → l6-compare 算 delta → 可选生成对比报告。
 * 对比报告默认离线确定性模板；真实 LLM 走服务端 POST /api/report/compare（key 只在服务端）。
 */
export async function loadComparison(
  connectorId: string,
  projectId: string,
  baselineId: string,
  candidateId: string,
  opts: { generateNarrative?: boolean } = {},
): Promise<ComparisonView> {
  const connector = getConnector(connectorId);
  const [projects, base, cand] = await Promise.all([
    connector.listProjects(),
    connector.fetchSignals(projectId, baselineId),
    connector.fetchSignals(projectId, candidateId),
  ]);
  const project = projects.find((p) => p.id === projectId) ?? { id: projectId, name: projectId, description: '' };
  const baseline = assembleVersionReport(computeEvaluation(base.version, base.signals));
  const candidate = assembleVersionReport(computeEvaluation(cand.version, cand.signals));
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
