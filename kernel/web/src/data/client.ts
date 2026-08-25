import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';
import { webConfig } from '../config.js';
import { getToken } from '../auth/remote.js';

/**
 * 视图消费的数据面（端口）。内核只内置 **api 模式**实现（纯 fetch）；
 * local 演示态（浏览器内跑分层管道）由应用层 example/web 实现并注入 —— 内核不依赖 middleware。
 */
export interface DataClient {
  listProjects(): Promise<ProjectSummary[]>;
  listVersions(projectId: string): Promise<VersionSummary[]>;
  getVersionReport(projectId: string, versionId: string): Promise<ReportView>;
  compare(projectId: string, baselineId: string, candidateId: string, generateNarrative: boolean): Promise<ComparisonView>;
}

/** api：数据从后端拉取，后端已做鉴权 + 项目授权 + 角色过滤。 */
export class ApiDataClient implements DataClient {
  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${webConfig().apiBase}${path}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
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
    const res = await fetch(`${webConfig().apiBase}/report/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken() ?? ''}` },
      body: JSON.stringify({ projectId, baselineId, candidateId, generateNarrative }),
    });
    if (!res.ok) throw new Error(`请求失败 ${res.status}`);
    return (await res.json()) as ComparisonView;
  }
}
