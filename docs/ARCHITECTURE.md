# 项目架构文档（L2，随迭代更新）

> 考功司（户部下属评定官员绩效之司→隐喻 Agent 绩效考评）的实现架构。对应总 RFC：`.context/rfc/RFC.md`。
> 本文档随每个需求迭代更新。最后更新：需求 003 完成。

## 1. 六层 + 五契约（层间隔离）

每层是独立包，**只依赖下层的稳定契约**（`@kaogongsi/contracts`），可独立测试、独立存活。契约缝 = 换实现不换契约、上层无感（D9.2 / A6 / D3）。

```
L6 呈现/路由   apps/web (AppShell/ExecDashboard/ComparisonReport)
               + packages/l6-report + packages/l6-compare + packages/report-llm
      ▲ 契约④ ReportView / DecisionRecord / ComparisonView / ComparativeNarrative
L5 决策        packages/l5-decision（门禁政策 + assurance case）
      ▲ 契约③ AttributionResult
L4 归因        packages/l4-attribution（案例驱动三责任方分布）
      ▲ 契约② MetricCaseBundle
L3 计算        (待建，当前由 connector-mock 直接合成 bundle 顶替)
      ▲ 契约① Provenance 查询
L2 证据/血缘   (待建)
      ▲ 契约⓪ CanonicalSignal / VersionEvaluation / DataConnector
L1 接入/适配   packages/connector-mock (MockConnector，只吐证据) + 未来 BI/Langfuse/L5 连接器
```

> **管道**：`connector.fetchEvaluation` → `l4.buildAttribution` → `l5.decide` → `l6-report.assembleVersionReport` → `buildExecReportView`。连接器只取证据，归因/决策由独立引擎计算（RFC-003）。

## 2. 已实现（截至需求 003）

| 包 | 角色 | 状态 |
|---|---|---|
| `@kaogongsi/contracts` | 五道契约缝 + KPI 目录 + 项目/版本 + VersionEvaluation + 对比契约 + `DataConnector`/`ReportGenerator` 端口 | ✅ |
| `@kaogongsi/connector-mock` | `MockConnector`（多项目/多版本；只吐 VersionEvaluation 证据）+ 可复用连接器契约测试 | ✅ |
| `@kaogongsi/l4-attribution` | `buildAttribution`：MetricCaseBundle → AttributionResult（案例驱动，铁律） | ✅ |
| `@kaogongsi/l5-decision` | `decide`：AttributionResult+KpiSet → DecisionRecord（门禁政策 + assurance case） | ✅ |
| `@kaogongsi/l6-report` | `buildExecReportView` + `assembleVersionReport`（串 L4→L5） | ✅ |
| `@kaogongsi/l6-compare` | `buildComparison`/`summarizeComparison`：两 VersionReport → ComparisonView | ✅ |
| `@kaogongsi/report-llm` | `ReportGenerator` 端口：Template（离线默认）+ OpenAI 兼容（可选真实）+ 工厂 | ✅ |
| `apps/api` | Fastify；exec(legacy) / projects / versions / version / compare（走计算管道 + 注入生成器） | ✅ |
| `apps/web` | Tailwind UI：项目/版本选择 + 单版本报告 + 双版本对比 + 生成对比报告 + 深浅色 | ✅ |
| `e2e` | Playwright；exec-dashboard(5) + project-version-compare(4) 共 9 场景 | ✅ |

**待建**：L3 指标计算（从原始样本算 Cost-of-Pass/pass^k/CI）、L2 血缘图、L1 真实连接器（BI/Langfuse/L5）；反事实验证、权重/映射可配置。

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
