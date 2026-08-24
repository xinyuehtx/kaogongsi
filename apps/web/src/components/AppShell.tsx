import type { ReactNode } from 'react';

/** 布局骨架：品牌顶栏（含深浅色切换）+ 控制条 + 内容区。 */
export function AppShell({
  controls,
  children,
  dark,
  onToggleDark,
}: {
  controls: ReactNode;
  children: ReactNode;
  dark: boolean;
  onToggleDark: () => void;
}) {
  return (
    <div className="min-h-full bg-plane text-primary">
      <header className="sticky top-0 z-10 border-b border-hairline bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tech text-sm font-bold text-white">
              考
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">考功司</div>
              <div className="text-[11px] text-muted">Agent 评测归因决策机</div>
            </div>
          </div>
          <div className="ml-auto">
            <button
              data-testid="theme-toggle"
              onClick={onToggleDark}
              className="rounded-lg border border-hairline px-2.5 py-1.5 text-sm text-secondary hover:text-primary"
              title="切换深浅色"
            >
              {dark ? '☾ 暗' : '☀ 亮'}
            </button>
          </div>
        </div>
        <div className="border-t border-hairline bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-2.5">{controls}</div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-6 pb-8 pt-2 text-xs text-muted">
        考功司 · 户部下属，评定官员（Agent）绩效之司 · 决策支持，人工拍板（D8.2）
      </footer>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Select({
  testid,
  value,
  onChange,
  children,
}: {
  testid: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-sm text-primary outline-none focus:border-tech"
    >
      {children}
    </select>
  );
}
