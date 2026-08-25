import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';
import { authorizedProjectIds, filterViewForRole } from '@tengxiaohtx/auth-core/rbac';
import { API_BASE, DATA_MODE, connectorIdFromUrl } from '../config.js';
import type { Session } from '../auth/api.js';
import { getToken } from '../auth/remote.js';
import { loadComparison, loadProjects, loadVersionReport, loadVersions } from '../dataSource.js';

/** 视图消费的数据面（与鉴权模式解耦）。 */
export interface DataClient {
  listProjects(): Promise<ProjectSummary[]>;
  listVersions(projectId: string): Promise<VersionSummary[]>;
  getVersionReport(projectId: string, versionId: string): Promise<ReportView>;
  compare(projectId: string, baselineId: string, candidateId: string, generateNarrative: boolean): Promise<ComparisonView>;
}

/** local：浏览器内经连接器 + 六层管道计算，按当前会话的角色/授权做客户端过滤。 */
class LocalDataClient implements DataClient {
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

/** api：数据从后端拉取，后端已做鉴权 + 项目授权 + 角色过滤。 */
class ApiDataClient implements DataClient {
  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
    if (!res.ok) throw new Error((await res.json().then((b) => (b as { error?: string }).error).catch(() => '')) || `请求失败 ${res.status}`);
    return (await res.json()) as T;
  }
  listProjects(): Promise<ProjectSummary[]> {
    return this.get('/projects');
  }
  listVersions(projectId: string): Promise<VersionSummary[]> {
    return this.get(`/projects/${projectId}/versions`);
  }
  getVersionReport(projectId: string, versionId: string): Promise<ReportView> {
    return this.get(`/report/version?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(versionId)}`);
  }
  async compare(projectId: string, baselineId: string, candidateId: string, generateNarrative: boolean): Promise<ComparisonView> {
    const res = await fetch(`${API_BASE}/report/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken() ?? ''}` },
      body: JSON.stringify({ projectId, baselineId, candidateId, generateNarrative }),
    });
    if (!res.ok) throw new Error(`请求失败 ${res.status}`);
    return (await res.json()) as ComparisonView;
  }
}

export function createDataClient(session: Session): DataClient {
  return DATA_MODE === 'api' ? new ApiDataClient() : new LocalDataClient(session);
}
