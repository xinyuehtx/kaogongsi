import type { ComparisonGroup, ComparisonView, MetricDelta } from '@tengxiaohtx/contracts';
import { useState } from 'react';
import { Card, DirectionChip, GateBadge, MiniBars, SectionTitle } from './ui.js';

function MetricRow({ d }: { d: MetricDelta }) {
  return (
    <div
      data-testid={`delta-${d.key}`}
      data-direction={d.direction}
      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-hairline py-2 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-primary">
          <span className="truncate">{d.label}</span>
          {d.guardrailBreached ? (
            <span className="rounded-pill bg-critical/15 px-1.5 text-[10px] font-semibold text-critical">
              ⚠️ 护栏破线
            </span>
          ) : null}
          {d.significant === true ? (
            <span className="rounded-pill border border-hairline px-1.5 text-[10px] text-secondary">显著</span>
          ) : null}
          {d.signalOnly ? (
            <span className="rounded-pill bg-warning/20 px-1.5 text-[10px] text-[#7a5200]">信号非门禁</span>
          ) : null}
        </div>
        <div className="mt-0.5 tnum text-xs text-muted">
          {d.baseline}
          {d.unit} → <span className="text-secondary">{d.candidate}{d.unit}</span>
        </div>
      </div>
      <MiniBars baseline={d.baseline} candidate={d.candidate} />
      <div className="justify-self-end">
        <DirectionChip delta={d} />
      </div>
    </div>
  );
}

function Group({ group, defaultOpen }: { group: ComparisonGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const diagnostic = group.key.startsWith('traj-');
  return (
    <Card className="p-4" >
      <button
        data-testid={`cmp-group-${group.key}`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <SectionTitle hint={diagnostic ? '诊断非打分（D11/A1）' : undefined}>{group.title}</SectionTitle>
        <span className="text-muted">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1">
          {group.deltas.map((d) => (
            <MetricRow key={d.key} d={d} />
          ))}
        </div>
      )}
    </Card>
  );
}

function NarrativePanel({ view }: { view: ComparisonView }) {
  const n = view.narrative;
  if (!n) return null;
  return (
    <Card className="p-5" >
      <div data-testid="narrative-panel" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-secondary">LLM 对比报告</span>
          <span data-testid="narrative-verdict">
            <GateBadge gate={n.verdict} size="sm" />
          </span>
          <span className="rounded-pill border border-hairline px-2 py-0.5 text-[10px] text-muted">
            {n.generatedBy === 'llm' ? `模型：${n.model ?? 'LLM'}` : '离线模板生成'}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-primary">{n.summary}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <SectionTitle>改善</SectionTitle>
            <ul className="space-y-1 text-sm text-secondary">
              {n.highlights.map((h, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-good-text" aria-hidden>↑</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SectionTitle>回退 / 风险</SectionTitle>
            <ul className="space-y-1 text-sm text-secondary">
              {n.regressions.map((r, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-critical" aria-hidden>↓</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-secondary">
          <b className="text-primary">决策建议：</b>
          {n.recommendation}
          <div className="mt-1 text-xs text-muted">决策支持、人工拍板（D8.2）——本报告不替你拍板。</div>
        </div>
      </div>
    </Card>
  );
}

export function ComparisonReport({
  view,
  generating,
  onGenerate,
}: {
  view: ComparisonView;
  generating: boolean;
  onGenerate: () => void;
}) {
  const scoring = view.groups.filter((g) => !g.key.startsWith('traj-'));
  const diagnostic = view.groups.filter((g) => g.key.startsWith('traj-'));

  return (
    <div data-testid="comparison-view" className="flex flex-col gap-4">
      {/* 头部：项目 + 版本对比 + 门禁迁移 */}
      <Card className="p-5">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted">
          考功司 · 版本对比报告
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold text-primary">{view.project.name}</span>
          <span className="inline-flex items-center gap-2 tnum text-secondary">
            <span className="rounded-pill border border-hairline px-2 py-0.5 text-sm">基线 {view.baseline.label}</span>
            <span className="text-muted">→</span>
            <span className="rounded-pill border border-tech px-2 py-0.5 text-sm text-tech">候选 {view.candidate.label}</span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-secondary">
          门禁：<GateBadge gate={view.gateBaseline} size="sm" />
          <span className="text-muted">→</span>
          <GateBadge gate={view.gateCandidate} size="sm" />
        </div>
      </Card>

      {/* 生成对比报告 / 报告面板 */}
      {view.narrative ? (
        <NarrativePanel view={view} />
      ) : (
        <Card className="flex flex-col items-start gap-2 p-5">
          <SectionTitle hint="基于两版本 delta，经 LLM/模板生成">对比报告</SectionTitle>
          <button
            data-testid="compare-generate-btn"
            onClick={onGenerate}
            disabled={generating}
            className="rounded-lg bg-tech px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {generating ? '生成中…' : '生成对比报告'}
          </button>
        </Card>
      )}

      {/* 逐指标 delta */}
      <div className="grid gap-4 lg:grid-cols-2">
        {scoring.map((g) => (
          <Group key={g.key} group={g} defaultOpen />
        ))}
      </div>
      {diagnostic.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {diagnostic.map((g) => (
            <Group key={g.key} group={g} defaultOpen={false} />
          ))}
        </div>
      )}
    </div>
  );
}
