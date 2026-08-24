import type { AttributionResult, Kpi, ReportView } from '@kaogongsi/contracts';
import { useState } from 'react';

const GATE_STYLE: Record<string, { bg: string; label: string }> = {
  GO: { bg: '#16a34a', label: 'GO · 建议继续' },
  NO_GO: { bg: '#dc2626', label: 'NO-GO · 建议放弃' },
  ABSTAIN: { bg: '#d97706', label: 'ABSTAIN · 再等等' },
};

function KpiCard({ kpi }: { kpi: Kpi }) {
  const breached = kpi.guardrailBreached === true;
  return (
    <div
      data-testid={`kpi-${kpi.key}`}
      data-breached={breached ? 'true' : 'false'}
      style={{
        border: `1px solid ${breached ? '#dc2626' : '#e5e7eb'}`,
        background: breached ? '#fef2f2' : '#fff',
        borderRadius: 8,
        padding: '10px 14px',
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        {kpi.label}
        {kpi.signalOnly ? <span data-testid="signal-only-tag"> · 信号非门禁</span> : null}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: breached ? '#dc2626' : '#111' }}>
        {kpi.value}
        <span style={{ fontSize: 12, marginLeft: 2 }}>{kpi.unit}</span>
      </div>
    </div>
  );
}

function KpiGroup({ name, title, items }: { name: string; title: string; items: Kpi[] }) {
  return (
    <section data-testid={`kpi-group-${name}`} style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, margin: '8px 0' }}>{title}</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {items.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>
    </section>
  );
}

function AttributionBar({ attribution }: { attribution: AttributionResult }) {
  const color: Record<string, string> = { tech: '#2563eb', product: '#7c3aed', ops: '#0891b2' };
  const zh: Record<string, string> = { tech: '技术', product: '产品', ops: '运营' };
  return (
    <section data-testid="attribution" style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, margin: '8px 0' }}>
        归因分布 · 置信度 <span data-testid="attr-confidence">{attribution.confidence}</span>
      </h3>
      <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden' }}>
        {attribution.distribution.map((s) => (
          <div
            key={s.party}
            data-testid={`attr-${s.party}`}
            style={{ width: `${s.share * 100}%`, background: color[s.party], color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {zh[s.party]} {Math.round(s.share * 100)}%
          </div>
        ))}
      </div>
    </section>
  );
}

export function ExecDashboard({ view }: { view: ReportView }) {
  const [open, setOpen] = useState(false);
  const gate = view.decision?.gate ?? 'ABSTAIN';
  const style = GATE_STYLE[gate]!;
  const section = (title: string) => view.sections.find((s) => s.title === title);

  const kpi = (t: string) => (section(t)?.data as Kpi[]) ?? [];
  const traj = section('过程质量（诊断）')?.data as
    | { note: string; groups: { key: string; label: string; items: Kpi[] }[] }
    | undefined;
  const rationale = section('决策依据')?.data as
    | { recommendation: string; rationale: string; sensitivity: string; counterEvidence: string; assumptions: string[] }
    | undefined;

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <h1 data-testid="app-title" style={{ fontSize: 20 }}>考公司 · 对上高管 Dashboard</h1>

      <div
        data-testid="gate-badge"
        data-gate={gate}
        style={{ background: style.bg, color: '#fff', padding: '12px 18px', borderRadius: 10, fontSize: 18, fontWeight: 700, display: 'inline-block', margin: '8px 0' }}
      >
        {style.label}
      </div>
      <p data-testid="recommendation" style={{ color: '#374151' }}>{view.decision?.recommendation}</p>

      {!view.drillable && (
        <div data-testid="not-drillable-notice" style={{ background: '#fffbeb', border: '1px solid #f59e0b', padding: '8px 12px', borderRadius: 8, color: '#92400e', margin: '8px 0' }}>
          ⚠️ 低证据级（metric-only）：不可下钻，不可作为拍板唯一依据
        </div>
      )}

      {view.decision && <AttributionBar attribution={view.decision.attribution} />}

      <KpiGroup name="quality" title="质量（成败结果）" items={kpi('质量')} />
      <KpiGroup name="product" title="业务 / 产品" items={kpi('业务/产品')} />
      <KpiGroup name="financial" title="财务" items={kpi('财务')} />
      <KpiGroup name="guardrail" title="护栏（不能变差）" items={kpi('护栏')} />

      {traj && (
        <section data-testid="trajectory-section" style={{ marginBottom: 16 }}>
          <button data-testid="trajectory-toggle" onClick={() => setOpen((v) => !v)} style={{ cursor: 'pointer', padding: '6px 10px' }}>
            过程质量（诊断，非打分） {open ? '▲' : '▼'}
          </button>
          <p style={{ fontSize: 12, color: '#6b7280' }}>{traj.note}</p>
          {open &&
            traj.groups.map((g) => <KpiGroup key={g.key} name={`traj-${g.key}`} title={g.label} items={g.items} />)}
        </section>
      )}

      <section style={{ marginTop: 16 }}>
        <button data-testid="rationale-toggle" onClick={() => setOpen((v) => !v)} style={{ display: 'none' }} />
        <details data-testid="decision-rationale">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>决策依据（assurance case）</summary>
          {rationale && (
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, marginTop: 6 }}>
              <div><b>推荐：</b>{rationale.recommendation}</div>
              <div><b>理由：</b>{rationale.rationale}</div>
              <div><b>敏感性：</b>{rationale.sensitivity}</div>
              <div data-testid="counter-evidence"><b>反对证据：</b>{rationale.counterEvidence}</div>
              <div><b>假设：</b>{rationale.assumptions.join('；')}</div>
            </div>
          )}
        </details>
      </section>

      <div style={{ marginTop: 12 }}>
        <button
          data-testid="drilldown-btn"
          disabled={!view.drillable}
          style={{ padding: '6px 12px', cursor: view.drillable ? 'pointer' : 'not-allowed', opacity: view.drillable ? 1 : 0.5 }}
        >
          查看证据（下钻）
        </button>
      </div>
    </main>
  );
}
