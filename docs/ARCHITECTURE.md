# 项目架构文档（L2，随迭代更新）

> 归因决策机的实现架构。对应总 RFC：`~/Documents/docs/e2e-evals/rfc/RFC.md`。
> 本文档随每个需求迭代更新。最后更新：需求 001 完成（2026-08-24）。

## 1. 六层 + 五契约（层间隔离）

每层是独立包，**只依赖下层的稳定契约**（`@kaogongsi/contracts`），可独立测试、独立存活。契约缝 = 换实现不换契约、上层无感（D9.2 / A6 / D3）。

```
L6 呈现/路由   apps/web (ExecDashboard) + packages/l6-report
      ▲ 契约④ ReportView / DecisionRecord
L5 决策        (待建)
      ▲ 契约③ AttributionResult
L4 归因        (待建)
      ▲ 契约② MetricCaseBundle
L3 计算        (待建)
      ▲ 契约① Provenance 查询
L2 证据/血缘   (待建)
      ▲ 契约⓪ CanonicalSignal / DataConnector
L1 接入/适配   packages/connector-mock (MockConnector) + 未来 BI/Langfuse/L5 连接器
```

## 2. 已实现（截至需求 001）

| 包 | 角色 | 状态 |
|---|---|---|
| `@kaogongsi/contracts` | 五道契约缝 + KPI 目录 + `DataConnector` 标准接口 | ✅ |
| `@kaogongsi/connector-mock` | `MockConnector`（本阶段数据源实现）+ 可复用连接器契约测试 | ✅ |
| `@kaogongsi/l6-report` | `buildExecReportView`：DecisionRecord+KpiSet → exec ReportView | ✅ |
| `apps/api` | Fastify；`GET /api/report/exec`（经注入连接器） | ✅ |
| `apps/web` | 对上高管 Dashboard（连接器注册表 + 渲染时主动拉取） | ✅ |
| `e2e` | Playwright；exec-dashboard 5 场景 | ✅ |

**待建**：L1 真实连接器（BI/Langfuse/L5）、L2 血缘、L3 计算、L4 归因、L5 决策。

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
