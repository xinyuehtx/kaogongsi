# 项目架构文档（L2，随迭代更新）

> 考功司（户部下属评定官员绩效之司→隐喻 Agent 绩效考评）的实现架构。对应总 RFC：`.context/rfc/RFC.md`。
> 本文档随每个需求迭代更新。最后更新：需求 004 完成（六层贯通）。

## 1. 六层 + 五契约（层间隔离）

每层是独立包，**只依赖下层的稳定契约**（`@tengxiaohtx/contracts`），可独立测试、独立存活。契约缝 = 换实现不换契约、上层无感（D9.2 / A6 / D3）。

```
L6 呈现/路由   apps/web (AppShell/ExecDashboard/ComparisonReport)
               + packages/l6-report + packages/l6-compare + packages/report-llm
      ▲ 契约④ ReportView / DecisionRecord / ComparisonView / ComparativeNarrative
L5 决策        packages/l5-decision（门禁政策 + assurance case）
      ▲ 契约③ AttributionResult
L4 归因        packages/l4-attribution（案例驱动三责任方分布）
      ▲ 契约② MetricCaseBundle
L3 计算        packages/l3-metrics（bootstrap CI / pass^k / Cost-of-Pass）
      ▲ 契约① Provenance 查询
L2 证据/血缘   packages/l2-provenance（Source→Case→Metric 图 + 投影下钻）
      ▲ 契约⓪ CanonicalSignal / VersionSignals
L1 接入/适配   packages/connector-mock（内置 fixture）· packages/ingest（真实轨迹：文件/HTTP + 解析器插件）
```

> **六层贯通**：`fetchSignals(L1)` → `buildProvenance(L2)` → `computeEvaluation(L3)` → `buildAttribution(L4)` → `decide(L5)` → `buildExecReportView/buildComparison(L6)`。
> 指标目录 `METRIC_CATALOG`（contracts）是各层共享的指标词汇。
> **L1 真实接入**（RFC-006）：`ingest` 提供 File/HTTP 源 + 12 种轨迹解析器插件（claude-code/codex/…/langfuse/langsmith/harbor），部署容器按 `KAOGONGSI_PARSERS` 选配；`IngestConnector` 与 `MockConnector` 同实现 `DataConnector`，上层零改动。

## 2. 已实现（截至需求 004：六层贯通）

| 包 | 角色 | 状态 |
|---|---|---|
| `@tengxiaohtx/contracts` | 五道契约缝 + KPI 目录 + 指标目录 METRIC_CATALOG + 项目/版本 + 信号/血缘/对比 + `DataConnector`/`ReportGenerator` 端口 | ✅ |
| `@tengxiaohtx/connector-mock` | `MockConnector`（多项目/多版本；只吐 CanonicalSignal 信号）+ 可复用连接器契约测试 | ✅ |
| `@tengxiaohtx/ingest` | 真实轨迹接入：File/HTTP 源（分批/时间/tag/header）+ 12 种解析器插件 + IngestConnector（RFC-006） | ✅ |
| `@tengxiaohtx/l2-provenance` | `buildProvenance`：signals → Source→Case→Metric 血缘图 + 投影下钻（契约①） | ✅ |
| `@tengxiaohtx/l3-metrics` | `computeEvaluation`：血缘 → 可信指标（bootstrap CI/pass^k/Cost-of-Pass）+ bundles | ✅ |
| `@tengxiaohtx/l4-attribution` | `buildAttribution`：MetricCaseBundle → AttributionResult（案例驱动，铁律） | ✅ |
| `@tengxiaohtx/l5-decision` | `decide`：AttributionResult+KpiSet → DecisionRecord（门禁政策 + assurance case） | ✅ |
| `@tengxiaohtx/l6-report` | `buildExecReportView` + `assembleVersionReport`（串 L4→L5） | ✅ |
| `@tengxiaohtx/l6-compare` | `buildComparison`/`summarizeComparison`：两 VersionReport → ComparisonView | ✅ |
| `@tengxiaohtx/report-llm` | `ReportGenerator` 端口：Template（离线默认）+ OpenAI 兼容（可选真实）+ 工厂 | ✅ |
| `@tengxiaohtx/auth-core` | 账号/角色/项目授权 + StoragePort（内存/文件）+ JWT/scrypt + RBAC（RFC-005） | ✅ |
| `apps/api` | Fastify；认证 + RBAC 守卫 + 管理端 + 六层报告管道（tsx 运行，存储/密钥注入） | ✅ |
| `apps/web` | Tailwind UI：登录/角色门禁/管理台 + 项目/版本报告/对比 + api·local 双数据源 + Pages 站点 + 插件面板 | ✅ |
| `@tengxiaohtx/plugin-core` | 全链路插件宿主：L1-L6 跨层贡献 + UI DSL + NoSQL/Redis 存储端口（RFC-007） | ✅ |
| `@tengxiaohtx/plugin-example` · `@tengxiaohtx/plugin-aisdk` | 跨层示例插件 · Vercel AI SDK LLM Provider | ✅ |
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
