# AGENTS.md — 考功司工作流与约定（固化）

> 本文件固化本仓库的**协作工作流、分层契约与不可违反的约定**。任何人（含 AI agent）在本仓库改动前先读本文件。
> 面向机器与人类协作者；随架构演进更新。最后更新：RFC-002 完成。

## 0. 项目一句话

**考功司** —— 借古喻今：考功司为古代**户部下属、专司官员绩效考评**之部门；本项目是一台面向 **Agent 的「评测归因决策机」**：
输入各类 Agent 的评测/线上信号 → 按指标×权重计算 → 归因到**技术/产品/运营** → 对上给「值不值得继续（GO/NO-GO/ABSTAIN）+ 顶层归因」，对下给「按责任方路由的排查建议」。**全程决策支持、人工拍板。**

> 显示名统一用「**考功司**」（不是「考公司」）。包名沿用拼音 `@tengxiaohtx/*`。

## 1. 架构：六层 + 五契约（层间隔离）

每层是**独立包**，只依赖下层的**稳定契约**（`@tengxiaohtx/contracts`），可独立测试、独立存活。换实现不换契约、上层无感（D9.2 / A6 / D3）。

| 层 | 包 | 上缘契约 |
|---|---|---|
| L6 呈现/路由 | `apps/web` · `packages/l6-report` · `packages/l6-compare` · `packages/report-llm` | ReportView / DecisionRecord / ComparisonView / ComparativeNarrative |
| L5 决策 | `packages/l5-decision` | AttributionResult |
| L4 归因 | `packages/l4-attribution` | MetricCaseBundle |
| L3 计算 | `packages/l3-metrics`（bootstrap CI / pass^k / Cost-of-Pass） | Provenance 查询 |
| L2 证据/血缘 | `packages/l2-provenance`（Source→Case→Metric 图） | CanonicalSignal |
| L1 接入/适配 | `packages/connector-mock`（内置 fixture）· `packages/ingest`（真实轨迹：File/HTTP 源 + 解析器插件） | — |
| 契约（贯穿） | `packages/contracts`（含指标目录 METRIC_CATALOG） | 五道缝的类型定义 |
| 横切 · 认证 | `packages/auth-core`（账号/角色/授权 + StoragePort + JWT/scrypt + RBAC） | StoragePort（内存/文件，可换 Postgres） |

**六层贯通管道**：`connector.fetchSignals(L1)` → `buildProvenance(L2)` → `computeEvaluation(L3)` → `buildAttribution(L4)` → `decide(L5)` → `l6-report.assembleVersionReport` → 视图。连接器只取原始信号，血缘/指标/归因/决策各由独立层计算。

**实现顺序**：自顶向下（先 L6 对上报告，逐步下接传统 evals）。

### 端口（D3，基建可替换，不泄漏进内核）
- `DataConnector`（读侧数据源）：`capabilities/fetchDecision/fetchKpis/listProjects/listVersions/fetchSignals`。**连接器只取原始信号（CanonicalSignal），不做血缘/指标/归因/决策**。
- `ReportGenerator`（LLM 出口）：`generate(input) → ComparativeNarrative`。默认离线模板，可切真实 OpenAI 兼容模型。

## 2. 不可违反的约定（红线，来自 RFC DECISIONS D7-D11 / 七公理）

- **D9.2 连接器隔离**：视图/服务只依赖 `DataConnector` 接口，**不直连 fixture/具体来源**。换源＝换一个实现类，L6 与 web 零改动。
- **D9.3 证据分级**：归因必带**指标+案例+血缘**；`evidenceLevel=metric-only`（纯 BI）时 `drillable=false`，UI 明确标「低证据级、不可下钻、不可作为拍板唯一依据」，**绝不伪装成完整可信报告**。
- **A4 指标带不确定性**：对比/结论必须带方向与显著性（`stdDev` 区间判定），**不做裸分对比**。
- **D11/A1 诊断非打分**：轨迹级 5 类（效率/决策/规划/交互/稳定）只做**诊断**，不作 pass/fail 门禁；`Right Tool Rate` 额外标「信号非门禁」。
- **D8.2 人工拍板**：框架给「推荐+依据+敏感性+反对证据」，**不自动执行不可逆决策**（不自动 kill/放量）。
- **归因铁律**：三方 `share` 之和 = 1，每项必有 `supportingCases`（无案例即非法）。

## 3. 加需求的流程（BDD + TDD，逐层先红后绿）

1. 写 `docs/rfcs/RFC-00X-*.md` + `docs/stories/US-00X-*.md`（用户故事 Given/When/Then + 验收标准）。
2. **逐层 TDD**：先写失败测试 → 实现 → 绿。每包 `pnpm --filter <pkg> test` 独立可绿、互不依赖运行时。
3. **连接器新实现**必须跑通用契约测试 `runConnectorContract`（`@tengxiaohtx/connector-mock`）——这是「可替换」的守卫。
4. UI 侧加 Playwright E2E 到 `e2e/tests/`；**保持既有 spec 全绿**（改 UI 时保留 `data-testid`）。
5. 全绿后：RFC/Story 标完成，更新 `docs/ARCHITECTURE.md`(L2) 与 `docs/MANUAL.md`(L2)。
6. **按 feature 提交**（每个绿色增量一个 commit）；commit message 说明层与契约变更。

## 4. 命令

```bash
pnpm install
pnpm test        # 全部单测（turbo，排除 e2e）
pnpm typecheck   # 全部类型检查
pnpm build       # 全部构建
pnpm e2e         # Playwright 端到端（自动 build+preview web）

pnpm --filter @tengxiaohtx/<pkg> test   # 单层独立测试（验证隔离）
pnpm --filter @tengxiaohtx/api dev      # 后端 :3001
pnpm --filter @tengxiaohtx/web dev      # 前端 :5173
```

首次装 E2E 浏览器：`pnpm --filter @tengxiaohtx/e2e exec playwright install chromium`。

## 5. 代码风格

- TypeScript **strict**（`noUncheckedIndexedAccess`、`verbatimModuleSyntax`、`noImplicitOverride`）。
- 计算层（l6-report / l6-compare）为**纯函数、无 IO**；副作用集中在连接器/端口/api/web。
- 契约包只放**类型与不变量**，不含业务逻辑。
- UI：Tailwind v4 + `src/index.css` 的语义设计令牌（取自 dataviz skill validated 调色板）；组件只用语义类（`bg-surface`/`text-secondary`/`text-tech`…），换肤在令牌一处完成。
- **E2E 稳定契约**：`data-testid` 是测试面，重构 UI 不得删改既有 testid。

## 6. 背景资料

- `.context/`（**不入库**）：转交自 e2e-evals 的 RFC/调研全集（先读 `.context/INDEX.md`）。
- `docs/`（入库）：本项目自己的 RFC/Story/架构/手册。
