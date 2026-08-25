# 项目架构文档（L2，随迭代更新）

> 考功司（户部下属评定官员绩效之司→隐喻 Agent 绩效考评）的实现架构。对应总 RFC：`.context/rfc/RFC.md`。
> 本文档随每个需求迭代更新。最后更新：需求 011 完成（依赖倒置 + example 组装）。

## 0. 三层架构与**依赖图**（RFC-009 / RFC-011）

**依赖规则（唯一方向）**：`kernel/ ← middleware/ ← connectors/ ← example/`
——内核**不依赖**中间件与连接器；组装与启动全在 `example/`。

```
┌──────────────────── example/  组装 + 启动（依赖全部）────────────────────────┐
│ app/  assemble.ts 装配 ServerServices（连接器+管道+插件+LLM）· main.ts 监听    │
│ web/  Vite 应用：注入 authApi / DataClient（local 演示态在浏览器内装配管道）     │
│ docker-compose.yml  一键起 Postgres + Redis + app + web · .env.example       │
└───────────────┬─────────────────────────────────────────┬───────────────────┘
                │ 依赖                                     │ 依赖
                ▼                                         ▼
┌──── connectors/  外部数据源/配置(+DSL) ────┐   ┌──── middleware/  L1-L6 可组装能力 ────┐
│ mock      内置 fixture 连接器             │──▶│ ingest provenance metrics attribution │
│ example   财务/BI 外部数据 · skill · DSL   │   │ decision report compare              │
│           · 存储声明 · L1 HTTP 源          │   │ pipeline(组装) plugin-core(插件宿主)   │
└───────────────┬───────────────────────────┘   │ report-llm                            │
                │ 依赖                           └──────────────┬───────────────────────┘
                └────────────────┬─────────────────────────────┘ 依赖
                                 ▼
┌──────────────── kernel/  内核（只依赖内核自身）──────────────────────────────┐
│ contracts   全局共享契约/词汇（零依赖：五道缝 + 指标目录 + 端口类型）           │
│ api         HTTP 外壳：认证/RBAC/管理端/溯源/插件端点 + **领域端口**(ports.ts) │
│ web         UI 库：组件 + AuthProvider + api 模式客户端（注入式）             │
│ auth-core   账号/角色/项目授权 + JWT/scrypt + RBAC                          │
│ persistence 存储防腐层：端口 + 内存 / Prisma(Postgres) / Redis 适配           │
│ run-store   日志接口 + 运行溯源（连接器双版本 + 每层入参）                     │
│ agent-loop  LLMProvider + skill + 最小 Agent Loop     aisdk  AI SDK 适配器   │
└─────────────────────────────────────────────────────────────────────────────┘
```

> **门禁**：`pnpm lint:arch`（`scripts/check-architecture.mjs`）在 CI 校验上述方向——同时检查 package.json 声明与源码 import，违规即失败。
> **两个正交方向**：**依赖**向下（编译期，上表箭头）；**数据流/管道组装**自下而上 L1→L6（RFC-008）。
> 内核只声明端口（`ProjectDirectory / ReportService / PluginDirectory`），example 用 middleware + connectors 实现并注入。

- **中间件(层)**：层越多，分析溯源能力越强；层间靠固定契约约束，可按需切片组装（App 可只选 L4-L6）。
- **连接器(plugin)**：中间件的外部数据源/配置（Langfuse 等），可带 **DSL** 让用户非部署式注入配置/skill。
- **存储溯源**：连接器**两种版本**（安装包/配置）落库；每次运行**每层入参**落库（除 L1，L1 大数据按接口按需查）；可 runId 溯源 + 重试。

## 1. 中间件六层 + 五契约（层间隔离）

每层是独立包，**只依赖下层的稳定契约**（`@tengxiaohtx/contracts`，位于 kernel），可独立测试、独立存活。契约缝 = 换实现不换契约、上层无感（D9.2 / A6 / D3）。

```
L6 呈现/路由   kernel/web(UI 库) + example/web(应用)
               + middleware/report + middleware/compare + middleware/report-llm
      ▲ 契约④ ReportView / DecisionRecord / ComparisonView / ComparativeNarrative
L5 决策        middleware/decision（门禁政策 + assurance case）
      ▲ 契约③ AttributionResult
L4 归因        middleware/attribution（案例驱动三责任方分布）
      ▲ 契约② MetricCaseBundle
L3 计算        middleware/metrics（bootstrap CI / pass^k / Cost-of-Pass）
      ▲ 契约① Provenance 查询
L2 证据/血缘   middleware/provenance（Source→Case→Metric 图 + 投影下钻）
      ▲ 契约⓪ CanonicalSignal / VersionSignals
L1 接入/适配   connectors/mock（内置 fixture）· middleware/ingest（真实轨迹：文件/HTTP + 解析器插件）
```

> **六层贯通**：`fetchSignals(L1)` → `buildProvenance(L2)` → `computeEvaluation(L3)` → `buildAttribution(L4)` → `decide(L5)` → `buildExecReportView/buildComparison(L6)`。
> 指标目录 `METRIC_CATALOG`（contracts）是各层共享的指标词汇。
> **L1 真实接入**（RFC-006）：`ingest` 提供 File/HTTP 源 + 12 种轨迹解析器插件（claude-code/codex/…/langfuse/langsmith/harbor），部署容器按 `KAOGONGSI_PARSERS` 选配；`IngestConnector` 与 `MockConnector` 同实现 `DataConnector`，上层零改动。

## 2. 已实现（截至需求 011）

| 包 | 角色 | 状态 |
|---|---|---|
| `@tengxiaohtx/contracts` | 五道契约缝 + KPI 目录 + 指标目录 METRIC_CATALOG + 项目/版本 + 信号/血缘/对比 + `DataConnector`/`ReportGenerator` 端口 | ✅ |
| `@tengxiaohtx/connector-mock` | `MockConnector`（多项目/多版本；只吐 CanonicalSignal 信号）+ 可复用连接器契约测试 | ✅ |
| `@tengxiaohtx/ingest` | 真实轨迹接入：File/HTTP 源（分批/时间/tag/header）+ 12 种解析器插件 + IngestConnector（RFC-006） | ✅ |
| `@tengxiaohtx/provenance` | `buildProvenance`：signals → Source→Case→Metric 血缘图 + 投影下钻（契约①） | ✅ |
| `@tengxiaohtx/metrics` | `computeEvaluation`：血缘 → 可信指标（bootstrap CI/pass^k/Cost-of-Pass）+ bundles | ✅ |
| `@tengxiaohtx/attribution` | `buildAttribution`：MetricCaseBundle → AttributionResult（案例驱动，铁律） | ✅ |
| `@tengxiaohtx/decision` | `decide`：AttributionResult+KpiSet → DecisionRecord（门禁政策 + assurance case） | ✅ |
| `@tengxiaohtx/report` | `buildExecReportView` + `assembleVersionReport`（串 L4→L5） | ✅ |
| `@tengxiaohtx/compare` | `buildComparison`/`summarizeComparison`：两 VersionReport → ComparisonView | ✅ |
| `@tengxiaohtx/pipeline` | 可组装分层管道：内核默认 stage + buildStages/runPipeline（自下而上组装，RFC-008） | ✅ |
| `@tengxiaohtx/report-llm` | `ReportGenerator` 端口：Template（离线默认）+ OpenAI 兼容（可选真实）+ 工厂 | ✅ |
| `@tengxiaohtx/auth-core` | 账号/角色/项目授权 + StoragePort（内存/文件）+ JWT/scrypt + RBAC（RFC-005） | ✅ |
| `@tengxiaohtx/agent-loop` | 内核 LLMProvider + skill + 最小 Agent Loop（RFC-009） | ✅ |
| `@tengxiaohtx/run-store` | 内核日志接口 + 运行溯源（连接器两版本 + 每层入参，除 L1）（RFC-009） | ✅ |
| `@tengxiaohtx/persistence` | 存储防腐层：Prisma(Postgres) + ioredis 适配 StoragePort/DocumentStore/RunStore/KvStore（RFC-010） | ✅ |
| `@tengxiaohtx/api`(kernel) | Fastify 外壳：认证 + RBAC + 管理端 + 溯源/插件端点 + **领域端口**（不依赖 middleware） | ✅ |
| `@tengxiaohtx/web`(kernel) | UI 库：登录/角色门禁/管理台/报告/对比/插件面板 + api 模式客户端（注入式） | ✅ |
| `@tengxiaohtx/example-app` | **组装层**：装配连接器+分层管道+插件宿主+LLM → 内核 ServerServices；启动入口 | ✅ |
| `@tengxiaohtx/example-web` | **应用层**：Vite 应用（api/local 双模式装配、Pages 站点、Tailwind） | ✅ |
| `@tengxiaohtx/plugin-core` | 全链路插件宿主：L1-L6 跨层贡献 + UI DSL + NoSQL/Redis 存储端口（RFC-007） | ✅ |
| `@tengxiaohtx/connector-example` · `@tengxiaohtx/aisdk` | 跨层示例连接器（财务/BI/skill/DSL/存储） · 内核 AI SDK LLM 适配器 | ✅ |
| `e2e` | Playwright；exec(5) + compare(4) + auth-rbac(5) 共 14 场景 | ✅ |

**六层全部落地**。**待深化**：L1 真实连接器（BI/Langfuse/Inspect `.eval`）；L3 真实成本/延迟分布、分层指标、pass^k 多 run 估计；L2 大 payload 外置 + 跨 run baggage 关联；反事实验证（REFLECT）。

## 2b. 新增契约缝（RFC-002）

- **项目/版本**：`ProjectSummary` / `VersionSummary` / `VersionReport`；`DataConnector` 增 `listProjects/listVersions/fetchVersionReport`。
- **对比（L6）**：`MetricDelta` / `ComparisonGroup` / `ComparisonView`（A4：带方向+显著性；诊断非门禁）。
- **LLM 出口端口（D3）**：`ReportGenerator` + `ComparativeNarrative`；默认离线模板，env 配齐切真实模型（`KAOGONGSI_LLM_*`）。

## 3. 连接器模式（D9.2 的读侧落地）

- **标准接口** `DataConnector`：`capabilities()` / `fetchDecision()` / `fetchKpis()`。
- **视图只依赖接口**，经 `connectors.ts` 注册表按 `connectorId` 取连接器，渲染时主动拉取。
- **可替换硬保证**：任何连接器跑 `runConnectorContract` 通用契约测试；换连接器视图零改动（api 测试 AC-7 + e2e 场景4 守卫）。
- **证据分级**：连接器 `capabilities().drillable=false`（metric-only，如纯 BI）→ ReportView.drillable=false → UI 标"不可下钻"（D9.3）。

## 4. KPI 目录（exec 视图，RFC-001 §3.3）

- **成败结果层**（可作门禁）：质量 / 产品 / 财务 / 护栏
- **过程质量层**（轨迹级 5 类，**诊断非打分** D11/A1）：效率 / 决策质量 / 规划质量 / 交互质量 / 稳定性；Right Tool Rate 标 `signalOnly`。

## 5. 隔离性验证方式（每层"可独立存活"如何被守住）

- **架构依赖门禁**：`pnpm lint:arch` 校验 `kernel ← middleware ← connectors ← example`（CI 必过；已验证能拦住注入的违规）。
- 每包独立 `pnpm --filter <pkg> test` 可绿，互不依赖运行时。
- 连接器契约测试 = 可替换的守卫。
- api 注入假连接器、e2e 切 `?connector=` = 端到端换源零改动的守卫。

## 6. 需求与文档索引

| 需求 | RFC | Story | 状态 |
|---|---|---|---|
| 001 对上高管 Dashboard | `docs/rfcs/RFC-001-exec-dashboard.md` | `docs/stories/US-001-exec-dashboard.md` | ✅ 完成 |
| 002 项目-版本评测报告与对比 | `docs/rfcs/RFC-002-project-version-compare.md` | `docs/stories/US-002-project-version-compare.md` | ✅ 完成 |
| 003 归因引擎 + 决策引擎（做实 L4/L5） | `docs/rfcs/RFC-003-attribution-decision-engines.md` | `docs/stories/US-003-attribution-decision-engines.md` | ✅ 完成 |
| 004 贯通 L1→L3（信号/血缘/可信指标） | `docs/rfcs/RFC-004-ingest-provenance-metrics.md` | `docs/stories/US-004-ingest-provenance-metrics.md` | ✅ 完成 |
| 005 企业化（账号/角色/授权 + 全栈 + Pages） | `docs/rfcs/RFC-005-enterprise-auth-stack-pages.md` | `docs/stories/US-005-enterprise-auth-stack-pages.md` | ✅ 完成 |
| 006 数据接入（本地文件/HTTP + 解析器插件） | `docs/rfcs/RFC-006-data-ingestion-parsers.md` | `docs/stories/US-006-data-ingestion-parsers.md` | ✅ 完成 |
| 007 全链路插件系统（跨层 + DSL + NoSQL/Redis） | `docs/rfcs/RFC-007-plugin-system.md` | `docs/stories/US-007-plugin-system.md` | ✅ 完成 |
| 008 可组装分层管道 + 内核/插件分离 | `docs/rfcs/RFC-008-composable-pipeline.md` | `docs/stories/US-008-composable-pipeline.md` | ✅ 完成 |
| 009 三层架构 + 内核 Agent Loop + 运行溯源 | `docs/rfcs/RFC-009-three-tier-kernel-runstore.md` | `docs/stories/US-009-three-tier-kernel-runstore.md` | ✅ 完成 |
| 010 存储防腐层 + Postgres/Prisma + Redis example | `docs/rfcs/RFC-010-persistence-acl-postgres-redis.md` | `docs/stories/US-010-persistence-acl-postgres-redis.md` | ✅ 完成 |
| 011 依赖倒置（内核干净）+ example 组装启动 | `docs/rfcs/RFC-011-dependency-inversion-example-assembly.md` | `docs/stories/US-011-dependency-inversion-example-assembly.md` | ✅ 完成 |
