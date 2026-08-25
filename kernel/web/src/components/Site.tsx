import { useEffect, useState } from 'react';
import { App, type AppProps } from '../App.js';
import { AuthProvider } from '../auth/context.js';
import type { AuthApi } from '../auth/api.js';

type Tab = 'intro' | 'docs' | 'play';

function useHashTab(): [Tab, (t: Tab) => void] {
  const read = (): Tab => {
    const h = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', '');
    return h === 'docs' || h === 'play' ? h : 'intro';
  };
  const [tab, setTab] = useState<Tab>(read());
  useEffect(() => {
    const on = () => setTab(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (t: Tab) => {
    window.location.hash = t;
    setTab(t);
  };
  return [tab, go];
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-hairline bg-card p-5">
      <h3 className="mb-1.5 text-sm font-semibold text-primary">{title}</h3>
      <p className="text-sm leading-relaxed text-secondary">{children}</p>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <pre className="overflow-x-auto rounded-lg border border-hairline bg-surface p-3 text-xs leading-relaxed text-secondary">{children}</pre>;
}

function Intro({ go }: { go: (t: Tab) => void }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="pt-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-tech text-2xl font-bold text-white">考</div>
        <h1 className="text-3xl font-bold text-primary">考功司</h1>
        <p className="mx-auto mt-3 max-w-2xl text-secondary">
          借古喻今：考功司为古代户部下属、专司官员绩效考评之部门。本项目把「对官员的考评与黜陟」映射为
          对各类 <b>AI Agent</b> 的<b>评测、归因与去留决策</b>——一台六层贯通的「评测归因决策机」。
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button onClick={() => go('play')} className="rounded-lg bg-tech px-4 py-2 text-sm font-medium text-white hover:opacity-90">进入 Playground</button>
          <button onClick={() => go('docs')} className="rounded-lg border border-hairline px-4 py-2 text-sm text-secondary hover:text-primary">操作文档</button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Feature title="项目 → 版本 组织">按项目和版本组织评测报告；单版本看板 + 两版本对比（相对基线的逐指标 delta）。</Feature>
        <Feature title="可信指标（P1）">指标从原始信号经血缘图聚合，带样本量与 bootstrap 置信区间，不做裸分对比。</Feature>
        <Feature title="三方归因">把结果归因到 技术 / 产品 / 运营，案例驱动、每项挂证据（无案例即非法）。</Feature>
        <Feature title="三态门禁决策">GO / NO-GO / ABSTAIN + 推荐/依据/敏感性/反对证据；决策支持、人工拍板。</Feature>
        <Feature title="LLM 对比报告">把版本对比交给 LLM（默认离线模板，可切真实模型）产出总结/改善/回退/建议。</Feature>
        <Feature title="账号 / 角色 / 授权">管理员/技术/财务/BI 四角色；项目授权决定可见项目，角色决定可见分区。</Feature>
      </section>

      <section className="rounded-card border border-hairline bg-card p-5">
        <h3 className="mb-2 text-sm font-semibold text-primary">六层 + 五契约（层间隔离）</h3>
        <Code>{`L6 呈现   web · l6-report · l6-compare · report-llm
L5 决策   l5-decision            ▲ AttributionResult
L4 归因   l4-attribution         ▲ MetricCaseBundle
L3 计算   l3-metrics (bootstrap) ▲ Provenance 查询
L2 血缘   l2-provenance          ▲ CanonicalSignal
L1 接入   connector-mock（只吐信号）
管道: fetchSignals → 血缘 → 可信指标 → 归因 → 决策 → 报告`}</Code>
      </section>
    </div>
  );
}

function Docs({ go }: { go: (t: Tab) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-primary">操作文档</h2>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-primary">1. Playground（本页，无需后端）</h3>
        <p className="text-sm text-secondary">
          点 <button onClick={() => go('play')} className="text-tech underline">Playground</button>，用「一键角色进入」以 管理员/技术/财务/BI 身份体验：
          切项目/版本看单版本报告，切「双版本对比」选基线+候选并「生成对比报告」。
          不同角色看到的项目与分区不同（演示项目授权 + 角色门禁）。
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-primary">2. 本地自包含全栈（企业版）</h3>
        <Code>{`docker compose up --build       # 或 pnpm stack:up
# http://localhost:8080 —— 首个注册用户即管理员
docker compose down              # 停（down -v 连数据卷清空）`}</Code>
        <p className="text-sm text-secondary">前端 :8080（nginx + /api 反代），后端 :3001；账号/授权持久化到命名卷。</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-primary">3. 开发</h3>
        <Code>{`pnpm install
pnpm test        # 全部单测
pnpm e2e         # Playwright 端到端
pnpm --filter @tengxiaohtx/api dev                       # 后端 :3001
VITE_DATA_MODE=api pnpm --filter @tengxiaohtx/web dev    # 前端 :5173（连后端）`}</Code>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-primary">4. 角色与授权</h3>
        <ul className="ml-4 list-disc text-sm text-secondary">
          <li><b>管理员</b>：管理台建用户、改角色、按项目授权；看全部。</li>
          <li><b>技术</b>：质量/护栏/过程质量/归因/依据分区。</li>
          <li><b>财务</b>：财务/归因/依据分区。</li>
          <li><b>BI</b>：质量/产品/财务/护栏分区。</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-primary">5. 接真实 LLM（可选）</h3>
        <Code>{`export KAOGONGSI_LLM_BASE_URL=http://localhost:4000/v1   # OpenAI 兼容 / LiteLLM
export KAOGONGSI_LLM_API_KEY=sk-xxx
export KAOGONGSI_LLM_MODEL=gpt-4o-mini`}</Code>
      </section>
    </div>
  );
}

export interface SiteProps extends AppProps {
  authApi: AuthApi;
}

export function Site({ authApi, createDataClient }: SiteProps) {
  const [tab, go] = useHashTab();
  useEffect(() => {
    // 站点默认浅色；Playground 内可自行切换
    if (tab !== 'play') document.documentElement.dataset.theme = 'light';
  }, [tab]);

  if (tab === 'play') {
    return (
      <div className="min-h-full">
        <div className="border-b border-hairline bg-card px-4 py-1.5 text-center text-xs text-muted">
          演示态 Playground（浏览器内，无后端）·{' '}
          <a href="#intro" className="text-tech underline">返回介绍</a> ·{' '}
          <a href="#docs" className="text-tech underline">文档</a>
        </div>
        <AuthProvider api={authApi}>
          <App createDataClient={createDataClient} />
        </AuthProvider>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-plane text-primary">
      <header className="sticky top-0 z-10 border-b border-hairline bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
          <a href="#intro" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tech text-sm font-bold text-white">考</span>
            <span className="text-sm font-semibold">考功司</span>
          </a>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            {(['intro', 'docs', 'play'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => go(t)}
                className={`rounded-lg px-3 py-1.5 ${tab === t ? 'bg-tech text-white' : 'text-secondary hover:text-primary'}`}
              >
                {t === 'intro' ? '介绍' : t === 'docs' ? '文档' : 'Playground'}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{tab === 'docs' ? <Docs go={go} /> : <Intro go={go} />}</main>
      <footer className="mx-auto max-w-5xl px-6 pb-10 pt-2 text-xs text-muted">
        考功司 · 户部下属，评定官员（Agent）绩效之司 · 决策支持，人工拍板
      </footer>
    </div>
  );
}
