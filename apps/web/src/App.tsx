import { useCallback, useEffect, useState } from 'react';
import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';
import { AppShell, Field, Select } from './components/AppShell.js';
import { ExecDashboard } from './components/ExecDashboard.js';
import { ComparisonReport } from './components/ComparisonReport.js';
import { loadComparison, loadProjects, loadVersionReport, loadVersions } from './dataSource.js';
import { dataSourceConfig } from './connectors.js';

type Mode = 'single' | 'compare';

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
const CONNECTOR_ID = params.get('connector') ?? dataSourceConfig.execView.connectorId;
const INITIAL_MODE: Mode = params.get('mode') === 'compare' ? 'compare' : 'single';

/**
 * 考功司 · 评测归因决策机入口。
 * 用户流程：选项目 → 选「单版本报告」或「双版本对比」→（对比）生成 LLM 对比报告。
 * 全程经连接器拉取（D9.2）；?connector= 覆盖数据源用于演示/E2E。
 */
export function App() {
  const [dark, setDark] = useState(false);
  const [mode, setMode] = useState<Mode>(INITIAL_MODE);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  const [versions, setVersions] = useState<VersionSummary[]>([]);

  const [versionId, setVersionId] = useState('');
  const [baselineId, setBaselineId] = useState('');
  const [candidateId, setCandidateId] = useState('');

  const [view, setView] = useState<ReportView | null>(null);
  const [comparison, setComparison] = useState<ComparisonView | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  // 1) 载入项目
  useEffect(() => {
    loadProjects(CONNECTOR_ID)
      .then((ps) => {
        setProjects(ps);
        setProjectId((cur) => cur || ps[0]?.id || '');
      })
      .catch((e) => setError(String(e)));
  }, []);

  // 2) 项目变化 → 载入版本 + 设默认选择（候选=最新，基线=最旧）
  useEffect(() => {
    if (!projectId) return;
    setError(null);
    loadVersions(CONNECTOR_ID, projectId)
      .then((vs) => {
        setVersions(vs);
        setVersionId(vs[0]?.id ?? '');
        setCandidateId(vs[0]?.id ?? '');
        setBaselineId(vs[vs.length - 1]?.id ?? vs[0]?.id ?? '');
      })
      .catch((e) => setError(String(e)));
  }, [projectId]);

  // 版本列表是否已属于当前项目（避免项目切换瞬间用旧版本 id 拉取，造成竞态错误）
  const versionsReady = versions.length > 0 && versions[0]?.projectId === projectId;
  const has = (id: string) => versions.some((v) => v.id === id);

  // 3) 单版本报告
  useEffect(() => {
    if (mode !== 'single' || !versionsReady || !has(versionId)) return;
    setView(null);
    setError(null);
    loadVersionReport(CONNECTOR_ID, projectId, versionId)
      .then(setView)
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, versionsReady, projectId, versionId]);

  // 4) 对比（选择变化即重算，清空旧叙述）
  useEffect(() => {
    if (mode !== 'compare' || !versionsReady || !has(baselineId) || !has(candidateId)) return;
    setComparison(null);
    setError(null);
    loadComparison(CONNECTOR_ID, projectId, baselineId, candidateId)
      .then(setComparison)
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, versionsReady, projectId, baselineId, candidateId]);

  // 5) 生成对比报告（LLM/模板）
  const handleGenerate = useCallback(() => {
    if (!projectId || !baselineId || !candidateId) return;
    setGenerating(true);
    loadComparison(CONNECTOR_ID, projectId, baselineId, candidateId, { generateNarrative: true })
      .then(setComparison)
      .catch((e) => setError(String(e)))
      .finally(() => setGenerating(false));
  }, [projectId, baselineId, candidateId]);

  const controls = (
    <>
      <Field label="项目">
        <Select testid="project-select" value={projectId} onChange={setProjectId}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="inline-flex overflow-hidden rounded-lg border border-hairline">
        <button
          data-testid="mode-single"
          onClick={() => setMode('single')}
          className={`px-3 py-1.5 text-sm ${mode === 'single' ? 'bg-tech text-white' : 'bg-card text-secondary'}`}
        >
          单版本报告
        </button>
        <button
          data-testid="mode-compare"
          onClick={() => setMode('compare')}
          className={`px-3 py-1.5 text-sm ${mode === 'compare' ? 'bg-tech text-white' : 'bg-card text-secondary'}`}
        >
          双版本对比
        </button>
      </div>

      {mode === 'single' ? (
        <Field label="版本">
          <Select testid="version-select" value={versionId} onChange={setVersionId}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <Field label="基线">
            <Select testid="baseline-select" value={baselineId} onChange={setBaselineId}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="候选">
            <Select testid="candidate-select" value={candidateId} onChange={setCandidateId}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </>
  );

  let content: React.ReactNode;
  if (error) {
    content = <p data-testid="error" className="text-critical">{error}</p>;
  } else if (mode === 'single') {
    content = view ? <ExecDashboard view={view} /> : <p data-testid="loading" className="text-muted">加载中…</p>;
  } else {
    content = comparison ? (
      <ComparisonReport view={comparison} generating={generating} onGenerate={handleGenerate} />
    ) : (
      <p data-testid="loading" className="text-muted">加载中…</p>
    );
  }

  return (
    <AppShell controls={controls} dark={dark} onToggleDark={() => setDark((v) => !v)}>
      {content}
    </AppShell>
  );
}
