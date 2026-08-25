# RFC-009：三层架构（内核 / 中间件 / 连接器）+ 内核 Agent Loop + 运行溯源与日志

| | |
|---|---|
| 状态 | **✅ 已完成**：agent-loop 4 + run-store 3 + api 17 单测；全绿（34 test + 14 E2E） |
| 需求序号 | 009 |
| 层 | 全局架构定性 + 内核新增 + 溯源存储 |
| 关联 | RFC-007（插件/连接器）、RFC-008（可组装管道）；D3 端口化 |

---

## 1. 架构定性（用户）

**内核 + 中间件(层) + 连接器(plugin)** 三层：
- **内核**：前后端、账号权限体系、存储防腐层、**Agent Loop + skill**、**LLMProvider**、日志、溯源存储。
- **中间件(层)**：L1-L6，经固定接口约束的**可组装能力**；层越多 → 分析溯源能力越强。
- **连接器(plugin)**：中间件的**外部配置/数据源**（如为某层配置数据源拉业务数据）；也可提供 **DSL** 让用户注入 skill/标量等（非部署式信息注入）。**Langfuse 等是连接器；LLMProvider 是内核。**

## 2. 目录落地

```
kernel/      api · web · auth-core · agent-loop · aisdk · run-store
middleware/  contracts · provenance · metrics · attribution · decision · report · compare · ingest · pipeline · plugin-core · report-llm
connectors/  mock · example
```
包名不变（`@tengxiaohtx/*`），导入零改动；仅目录 + workspace + 跨层 tsconfig 引用调整。

## 3. 内核 · Agent Loop + skill + LLMProvider（`kernel/agent-loop`）
- `LlmProvider`（contracts 端口）+ `MockLLMProvider`（离线默认）+ `createLlmProvider(inject?)`；真实模型由 `kernel/aisdk`（Vercel AI SDK）注入。
- `renderSkill`（{{占位符}}）+ `runSkill`（套 skill → 调 provider 的最小 Agent Loop；多步工具循环为扩展点）。
- LLM/skill 从 middleware/plugin-core 移出——**归内核**。

## 4. 存储与溯源（`kernel/run-store`）+ 日志接口
- **日志接口 `Logger`**：`ConsoleLogger` / `FileLogger`（服务端按天文件 `server-YYYY-MM-DD.log`）。
- **连接器两种版本都落库**（用户强调）：`ConnectorVersionRecord { connectorId, packageVersion(插件安装包版本), configVersion(配置数据版本), at, meta }`。
- **每次运行、每层入参落库（除 L1）**：`RunLayerRecord { runId, seq, layer, stageId, input, at }`——`input` 为该层合并前 ctx 快照；**L1 内容大且可能独立存储 → 不内联落库，溯源时按接口按需查**（`connector.fetchSignals`）。
- `RunMeta { runId, connectorId, packageVersion, configVersion, projectId, versionId, actor }`。
- `RunStore` 端口 + 内存/文件实现（自包含持久化）。

## 5. 接线（api）
- `runVersion`：出评测报告时生成 `runId` → 记录连接器版本 + `startRun` → 组装管道 `runPipeline(..., {onStage})`，**每层入参落库** → `logger.info('report.run')`。响应带 `x-run-id`。
- 端点：`GET /api/runs`（列）、`GET /api/runs/:runId`（**溯源**：meta + 每层入参）、`POST /api/runs/:runId/retry`（**重试**：用落库入参重放上层，不重新拉 L1）、`GET /api/connector-versions`。

## 6. 验收标准

| # | 验收 | 状态 |
|---|---|---|
| AC-1 | 三层目录 kernel/middleware/connectors | ✅ |
| AC-2 | LLMProvider/Agent Loop 归内核；Langfuse 等为连接器 | ✅ |
| AC-3 | 连接器两种版本（安装包/配置）落库 | ✅ RunStore + api |
| AC-4 | 每层运行入参落库（除 L1）；L1 按需查接口 | ✅ pipeline onStage + connector.fetchSignals |
| AC-5 | 可按 runId 溯源 + 重试重放 | ✅ /api/runs/:id (+/retry) |
| AC-6 | 服务端日志文件接口 | ✅ FileLogger |
| AC-7 | 全绿不回归 | ✅ 34 test + 14 E2E |

## 7. 交付物
- `kernel/agent-loop`、`kernel/run-store`；`middleware/pipeline` 增 onStage 钩子；api 溯源/重试/版本端点 + 日志。
- 目录三层化；plugin-core 去 LLM/skill。

## 8. 后续
- 连接器 configVersion 与插件 DSL 配置版本打通（保存配置即产生 configVersion）；RunStore 换 Mongo；日志接入结构化/采集；Agent Loop 多步工具循环；L1 证据外置存储适配器 + 按需查询实现。
