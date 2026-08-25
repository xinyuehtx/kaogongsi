import type { AttributionResult, Gate, MetricDelta } from '@tengxiaohtx/contracts';
import type { ReactNode } from 'react';

// ── 门禁 ────────────────────────────────────────────────────
export const GATE_META: Record<Gate, { label: string; icon: string; bg: string; fg: string }> = {
  GO: { label: 'GO · 建议继续', icon: '✓', bg: 'bg-good', fg: 'text-white' },
  NO_GO: { label: 'NO-GO · 建议放弃', icon: '✕', bg: 'bg-critical', fg: 'text-white' },
  ABSTAIN: { label: 'ABSTAIN · 再等等', icon: '❘❘', bg: 'bg-warning', fg: 'text-[#0b0b0b]' },
};

export function GateBadge({ gate, size = 'lg' }: { gate: Gate; size?: 'sm' | 'lg' }) {
  const m = GATE_META[gate];
  const pad = size === 'lg' ? 'px-4 py-2 text-lg' : 'px-2.5 py-1 text-xs';
  return (
    <span
      data-testid="gate-badge"
      data-gate={gate}
      className={`inline-flex items-center gap-2 rounded-pill font-bold ${m.bg} ${m.fg} ${pad}`}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

export function ConfidencePill({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const zh = { low: '低', medium: '中', high: '高' } as const;
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-hairline px-2 py-0.5 text-xs text-secondary">
      置信度 <b className="text-primary" data-testid="attr-confidence">{confidence}</b>
      <span className="text-muted">（{zh[confidence]}）</span>
    </span>
  );
}

// ── 卡片 / 分区 ──────────────────────────────────────────────
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-card border border-hairline bg-card shadow-sm ${className}`}
      style={{ boxShadow: '0 1px 2px rgba(11,11,11,0.04), 0 1px 3px rgba(11,11,11,0.03)' }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h3 className="text-sm font-semibold tracking-wide text-secondary">{children}</h3>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

// ── 归因分布条 ──────────────────────────────────────────────
const PARTY = {
  tech: { zh: '技术', cls: 'bg-tech' },
  product: { zh: '产品', cls: 'bg-product' },
  ops: { zh: '运营', cls: 'bg-ops' },
} as const;

export function AttributionBar({ attribution }: { attribution: AttributionResult }) {
  return (
    <section data-testid="attribution">
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle>归因分布 · 技术 / 产品 / 运营</SectionTitle>
        <ConfidencePill confidence={attribution.confidence} />
      </div>
      <div className="flex h-8 overflow-hidden rounded-pill">
        {attribution.distribution.map((s) => (
          <div
            key={s.party}
            data-testid={`attr-${s.party}`}
            className={`flex items-center justify-center text-xs font-medium text-white ${PARTY[s.party as keyof typeof PARTY]?.cls ?? 'bg-muted'}`}
            style={{ width: `${s.share * 100}%` }}
            title={`${PARTY[s.party as keyof typeof PARTY]?.zh}: ${Math.round(s.share * 100)}%`}
          >
            {s.share >= 0.12 ? `${PARTY[s.party as keyof typeof PARTY]?.zh} ${Math.round(s.share * 100)}%` : ''}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-secondary">
        {attribution.distribution.map((s) => (
          <span key={s.party} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${PARTY[s.party as keyof typeof PARTY]?.cls}`} />
            {PARTY[s.party as keyof typeof PARTY]?.zh} · {Math.round(s.share * 100)}%
          </span>
        ))}
      </div>
    </section>
  );
}

// ── 对比方向 chip（icon + label，绝不单靠颜色）────────────────
export function DirectionChip({ delta }: { delta: MetricDelta }) {
  const meta = {
    improved: { icon: '↑', cls: 'text-good-text', word: '改善' },
    regressed: { icon: '↓', cls: 'text-critical', word: '回退' },
    flat: { icon: '→', cls: 'text-muted', word: '持平' },
  }[delta.direction];
  const pct = delta.deltaPct === null ? '' : ` · ${delta.deltaPct > 0 ? '+' : ''}${delta.deltaPct}%`;
  return (
    <span className={`inline-flex items-center gap-1 tnum text-sm font-semibold ${meta.cls}`}>
      <span aria-hidden>{meta.icon}</span>
      <span>
        {delta.delta > 0 ? '+' : ''}
        {delta.delta}
        {delta.unit}
      </span>
      <span className="text-xs font-normal text-muted">{meta.word}{pct}</span>
    </span>
  );
}

/** 基线 vs 候选 两条对比条（identity：基线弱、候选强；方向由 chip 承担）。 */
export function MiniBars({ baseline, candidate }: { baseline: number; candidate: number }) {
  const max = Math.max(Math.abs(baseline), Math.abs(candidate), 1e-9);
  const w = (v: number) => `${Math.max(2, (Math.abs(v) / max) * 100)}%`;
  return (
    <div className="flex min-w-28 flex-col gap-1">
      <div className="flex items-center gap-1.5" title={`基线 ${baseline}`}>
        <span className="h-2 rounded-sm bg-baseline" style={{ width: w(baseline) }} />
      </div>
      <div className="flex items-center gap-1.5" title={`候选 ${candidate}`}>
        <span className="h-2 rounded-sm bg-tech" style={{ width: w(candidate) }} />
      </div>
    </div>
  );
}
