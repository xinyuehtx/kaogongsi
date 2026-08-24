import { useEffect, useState } from 'react';
import type { ReportView } from '@kaogongsi/contracts';
import { ExecDashboard } from './components/ExecDashboard.js';
import { loadExecReport } from './dataSource.js';
import { dataSourceConfig } from './connectors.js';

/**
 * 对上高管 Dashboard 入口。
 * 渲染时主动经连接器拉取（RFC-001）。connectorId 可用 ?connector= 覆盖，供演示/E2E 切场景。
 */
export function App() {
  const [view, setView] = useState<ReportView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectorId = params.get('connector') ?? dataSourceConfig.execView.connectorId;
    loadExecReport(connectorId)
      .then(setView)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p data-testid="error">{error}</p>;
  if (!view) return <p data-testid="loading">加载中…</p>;
  return <ExecDashboard view={view} />;
}
