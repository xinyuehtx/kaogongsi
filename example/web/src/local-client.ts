import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';
import { authorizedProjectIds, filterViewForRole } from '@tengxiaohtx/auth-core/rbac';
import type { DataClient, Session } from '@tengxiaohtx/web';
import { loadComparison, loadProjects, loadVersionReport, loadVersions } from './dataSource.js';

/** local 演示态下用哪个连接器 fixture（?connector= 覆盖，供演示/E2E）。 */
export function connectorIdFromUrl(): string {
  const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return p.get('connector') ?? 'mock';
}

/**
 * example · local 数据客户端：浏览器内**装配** connectors + middleware 分层管道，
 * 并按当前会话的角色/授权做客户端过滤（api 模式下这些由后端完成）。
 * 内核 UI 只依赖 `DataClient` 端口，不知道这里用了哪些中间件。
 */
export class LocalDataClient implements DataClient {
  constructor(private readonly session: Session, private readonly connectorId = connectorIdFromUrl()) {}

  async listProjects(): Promise<ProjectSummary[]> {
    const all = await loadProjects(this.connectorId);
    const allowed = authorizedProjectIds(this.session.user.role, this.session.grants, all.map((p) => p.id));
    return all.filter((p) => allowed.includes(p.id));
  }
  listVersions(projectId: string): Promise<VersionSummary[]> {
    return loadVersions(this.connectorId, projectId);
  }
  async getVersionReport(projectId: string, versionId: string): Promise<ReportView> {
    const view = await loadVersionReport(this.connectorId, projectId, versionId);
    return filterViewForRole(view, this.session.user.role);
  }
  compare(projectId: string, baselineId: string, candidateId: string, generateNarrative: boolean): Promise<ComparisonView> {
    return loadComparison(this.connectorId, projectId, baselineId, candidateId, { generateNarrative });
  }
}
