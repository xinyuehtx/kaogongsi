import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComparisonView, ProjectSummary, ReportView, VersionSummary } from '@tengxiaohtx/contracts';
import { ROLE_LABEL } from '@tengxiaohtx/auth-core/types';
import { useAuth } from './auth/context.js';
import { createDataClient } from './data/client.js';
import { AppShell, Field, Select } from './components/AppShell.js';
import { ExecDashboard } from './components/ExecDashboard.js';
import { ComparisonReport } from './components/ComparisonReport.js';
import { AdminConsole } from './components/AdminConsole.js';
import { Login } from './components/Login.js';

type Mode = 'single' | 'compare';
type ViewName = 'report' | 'admin';

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
const INITIAL_MODE: Mode = params.get('mode') === 'compare' ? 'compare' : 'single';

export function App() {
  const { status, session, logout } = useAuth();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  if (status === 'loading') return <p data-testid="loading" className="p-6 text-muted">加载中…</p>;
  if (status === 'anon' || !session) return <Login />;
  return <Authed dark={dark} onToggleDark={() => setDark((v) => !v)} onLogout={logout} />;
}

function Authed({ dark, onToggleDark, onLogout }: { dark: boolean; onToggleDark: () => void; onLogout: () => Promise<void> }) {
  const { session } = useAuth();
  const s = session!;
  const dataClient = useMemo(() => createDataClient(s), [s]);
  const isAdmin = s.user.role === 'admin';

  const [view, setView] = useState<ViewName>('report');
  const [mode, setMode] = useState<Mode>(INITIAL_MODE);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionId, setVersionId] = useState('');
  const [baselineId, setBaselineId] = useState('');
  const [candidateId, setCandidateId] = useState('');

  const [report, setReport] = useState<ReportView | null>(null);
  const [comparison, setComparison] = useState<ComparisonView | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1) 项目（已按授权过滤）
  useEffect(() => {
    dataClient
      .listProjects()
      .then((ps) => {
        setProjects(ps);
        setProjectId((cur) => cur || ps[0]?.id || '');
      })
      .catch((e) => setError(String(e)));
  }, [dataClient]);

  // 2) 版本
  useEffect(() => {
    if (!projectId) return;
    setError(null);
    dataClient
      .listVersions(projectId)
      .then((vs) => {
        setVersions(vs);
        setVersionId(vs[0]?.id ?? '');
        setCandidateId(vs[0]?.id ?? '');
        setBaselineId(vs[vs.length - 1]?.id ?? vs[0]?.id ?? '');
      })
      .catch((e) => setError(String(e)));
  }, [dataClient, projectId]);

  const versionsReady = versions.length > 0 && versions[0]?.projectId === projectId;
  const has = (id: string) => versions.some((v) => v.id === id);

  // 3) 单版本
  useEffect(() => {
    if (view !== 'report' || mode !== 'single' || !versionsReady || !has(versionId)) return;
    setReport(null);
    setError(null);
    dataClient.getVersionReport(projectId, versionId).then(setReport).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mode, versionsReady, projectId, versionId]);

  // 4) 对比
  useEffect(() => {
    if (view !== 'report' || mode !== 'compare' || !versionsReady || !has(baselineId) || !has(candidateId)) return;
    setComparison(null);
    setError(null);
    dataClient.compare(projectId, baselineId, candidateId, false).then(setComparison).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mode, versionsReady, projectId, baselineId, candidateId]);

  const handleGenerate = useCallback(() => {
    if (!projectId || !baselineId || !candidateId) return;
    setGenerating(true);
    dataClient
      .compare(projectId, baselineId, candidateId, true)
      .then(setComparison)
      .catch((e) => setError(String(e)))
      .finally(() => setGenerating(false));
  }, [dataClient, projectId, baselineId, candidateId]);

  const brandRight = (
    <>
      <nav className="flex items-center gap-1">
        <button data-testid="nav-report" onClick={() => setView('report')} className={`rounded-lg px-2.5 py-1.5 text-sm ${view === 'report' ? 'bg-tech text-white' : 'text-secondary hover:text-primary'}`}>报告</button>
        {isAdmin && (
          <button data-testid="nav-admin" onClick={() => setView('admin')} className={`rounded-lg px-2.5 py-1.5 text-sm ${view === 'admin' ? 'bg-tech text-white' : 'text-secondary hover:text-primary'}`}>管理台</button>
        )}
      </nav>
      <span data-testid="user-badge" className="hidden items-center gap-1.5 rounded-pill border border-hairline px-2.5 py-1 text-xs text-secondary sm:inline-flex">
        {s.user.displayName}
        <b data-testid="user-role" className="text-primary">{ROLE_LABEL[s.user.role]}</b>
      </span>
      <button data-testid="logout" onClick={() => void onLogout()} className="rounded-lg border border-hairline px-2.5 py-1.5 text-sm text-secondary hover:text-critical">登出</button>
    </>
  );

  const controls = view === 'report' ? (
    <>
      <Field label="项目">
        <Select testid="project-select" value={projectId} onChange={setProjectId}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <div className="inline-flex overflow-hidden rounded-lg border border-hairline">
        <button data-testid="mode-single" onClick={() => setMode('single')} className={`px-3 py-1.5 text-sm ${mode === 'single' ? 'bg-tech text-white' : 'bg-card text-secondary'}`}>单版本报告</button>
        <button data-testid="mode-compare" onClick={() => setMode('compare')} className={`px-3 py-1.5 text-sm ${mode === 'compare' ? 'bg-tech text-white' : 'bg-card text-secondary'}`}>双版本对比</button>
      </div>
      {mode === 'single' ? (
        <Field label="版本">
          <Select testid="version-select" value={versionId} onChange={setVersionId}>
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
      ) : (
        <>
          <Field label="基线"><Select testid="baseline-select" value={baselineId} onChange={setBaselineId}>{versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select></Field>
          <Field label="候选"><Select testid="candidate-select" value={candidateId} onChange={setCandidateId}>{versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select></Field>
        </>
      )}
    </>
  ) : undefined;

  let content: React.ReactNode;
  if (view === 'admin') {
    content = <AdminConsole projects={projects} />;
  } else if (error) {
    content = <p data-testid="error" className="text-critical">{error}</p>;
  } else if (mode === 'single') {
    content = report ? <ExecDashboard view={report} /> : <p data-testid="loading" className="text-muted">加载中…</p>;
  } else {
    content = comparison ? <ComparisonReport view={comparison} generating={generating} onGenerate={handleGenerate} /> : <p data-testid="loading" className="text-muted">加载中…</p>;
  }

  return (
    <AppShell brandRight={brandRight} controls={controls} dark={dark} onToggleDark={onToggleDark}>
      {content}
    </AppShell>
  );
}
