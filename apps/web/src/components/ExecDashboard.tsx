import type { Kpi, ReportView } from '@tengxiaohtx/contracts';
import { useState } from 'react';
import { AttributionBar, Card, GateBadge, SectionTitle } from './ui.js';

const TREND: Record<string, string> = { up: '↑', down: '↓', flat: '→' };

function KpiCard({ kpi }: { kpi: Kpi }) {
  const breached = kpi.guardrailBreached === true;
  return (
    <div
      data-testid={`kpi-${kpi.key}`}
      data-breached={breached ? 'true' : 'false'}
      className={`min-w-36 flex-1 rounded-xl border px-3.5 py-3 ${
        breached ? 'border-critical bg-critical/10' : 'border-hairline bg-surface'
      }`}
    >
      <div className="flex items-center gap-1 text-xs text-secondary">
        <span>{kpi.label}</span>
        {kpi.signalOnly ? (
          <span data-testid="signal-only-tag" className="rounded-pill bg-warning/20 px-1.5 text-[10px] text-[#7a5200]">
            信号非门禁
          </span>
        ) : null}
      </div>
      <div className={`mt-1 flex items-baseline gap-1 tnum ${breached ? 'text-critical' : 'text-primary'}`}>
        <span className="text-2xl font-semibold">{kpi.value}</span>
        <span className="text-xs text-muted">{kpi.unit}</span>
        {kpi.trend ? <span className="ml-auto text-xs text-muted">{TREND[kpi.trend]}</span> : null}
      </div>
    </div>
  );
}

function KpiGroup({ name, title, items, hint }: { name: string; title: string; items: Kpi[]; hint?: string }) {
  if (items.length === 0) return null;
  return (
    <section data-testid={`kpi-group-${name}`} className="mb-4">
      <SectionTitle hint={hint}>{title}</SectionTitle>
      <div className="flex flex-wrap gap-2.5">
        {items.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>
    </section>
  );
}

export function ExecDashboard({ view }: { view: ReportView }) {
  const [trajOpen, setTrajOpen] = useState(false);
  const gate = view.decision?.gate ?? 'ABSTAIN';
  const section = (title: string) => view.sections.find((s) => s.title === title);
  const kpi = (t: string) => (section(t)?.data as Kpi[]) ?? [];
  const traj = section('过程质量（诊断）')?.data as
    | { note: string; groups: { key: string; label: string; items: Kpi[] }[] }
    | undefined;
  const rationale = section('决策依据')?.data as
    | { recommendation: string; rationale: string; sensitivity: string; counterEvidence: string; assumptions: string[] }
    | undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* 结论头部 */}
      <Card className="p-5">
        <h2 data-testid="app-title" className="text-xs font-medium uppercase tracking-widest text-muted">
          考功司 · 对上高管 Dashboard
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <GateBadge gate={gate} />
          <p data-testid="recommendation" className="text-secondary">
            {view.decision?.recommendation}
          </p>
        </div>

        {!view.drillable && (
          <div
            data-testid="not-drillable-notice"
            className="mt-3 rounded-lg border border-warning bg-warning/10 px-3 py-2 text-sm text-[#7a5200]"
          >
            ⚠️ 低证据级（metric-only）：不可下钻，不可作为拍板唯一依据
          </div>
        )}

        {view.decision && (
          <div className="mt-4">
            <AttributionBar attribution={view.decision.attribution} />
          </div>
        )}
      </Card>

      {/* KPI 三本账 + 护栏 */}
      <Card className="p-5">
        <KpiGroup name="quality" title="质量（成败结果）" items={kpi('质量')} />
        <KpiGroup name="product" title="业务 / 产品" items={kpi('业务/产品')} />
        <KpiGroup name="financial" title="财务" items={kpi('财务')} />
        <KpiGroup name="guardrail" title="护栏（不能变差）" items={kpi('护栏')} hint="破线标红即刻可见" />
      </Card>

      {/* 过程质量（诊断，可折叠） */}
      {traj && (
        <Card className="p-5">
          <section data-testid="trajectory-section">
            <button
              data-testid="trajectory-toggle"
              onClick={() => setTrajOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-sm font-semibold text-secondary hover:text-primary"
            >
              <span>过程质量（诊断，非打分）</span>
              <span className="text-muted">{trajOpen ? '▲' : '▼'}</span>
            </button>
            <p className="mt-1 text-xs text-muted">{traj.note}</p>
            {trajOpen && (
              <div className="mt-3">
                {traj.groups.map((g) => (
                  <KpiGroup key={g.key} name={`traj-${g.key}`} title={g.label} items={g.items} />
                ))}
              </div>
            )}
          </section>
        </Card>
      )}

      {/* 决策依据（assurance case）+ 下钻 */}
      <Card className="p-5">
        <details data-testid="decision-rationale" open>
          <summary className="cursor-pointer text-sm font-semibold text-secondary">
            决策依据（assurance case）
          </summary>
          {rationale && (
            <div className="mt-3 space-y-1.5 text-sm leading-relaxed text-secondary">
              <div>
                <b className="text-primary">推荐：</b>
                {rationale.recommendation}
              </div>
              <div>
                <b className="text-primary">理由：</b>
                {rationale.rationale}
              </div>
              <div>
                <b className="text-primary">敏感性：</b>
                {rationale.sensitivity}
              </div>
              <div data-testid="counter-evidence">
                <b className="text-primary">反对证据：</b>
                {rationale.counterEvidence}
              </div>
              <div>
                <b className="text-primary">假设：</b>
                {rationale.assumptions.join('；')}
              </div>
            </div>
          )}
        </details>

        <div className="mt-4">
          <button
            data-testid="drilldown-btn"
            disabled={!view.drillable}
            className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-sm text-secondary enabled:hover:border-tech enabled:hover:text-tech disabled:cursor-not-allowed disabled:opacity-50"
          >
            查看证据（下钻）
          </button>
        </div>
      </Card>
    </div>
  );
}
