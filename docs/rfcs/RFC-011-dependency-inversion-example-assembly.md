# RFC-011：依赖倒置 —— 内核不依赖中间件/连接器，example 负责组装与启动

| | |
|---|---|
| 状态 | **✅ 已完成**：kernel 只依赖 kernel；全绿（41 typecheck/test + 14 E2E） |
| 需求序号 | 011 |
| 层 | 全局依赖治理 + 组装层拆分 |
| 关联 | RFC-009（三层定性）、RFC-010（防腐层）、RFC-008（可组装管道） |

---

## 1. 问题

RFC-009 定性了「内核 / 中间件 / 连接器」，但代码里 **内核反向依赖了上层**：
- `kernel/api` → `metrics · pipeline · compare · ingest · report-llm · plugin-core`（middleware）+ `connector-mock · connector-example`（connectors）
- `kernel/web` → `metrics · report · compare · report-llm`（middleware）+ `connector-mock`
- `kernel/persistence` → `plugin-core`（middleware，为取 DocumentStore/KvStore 类型）
- `kernel/aisdk` → `plugin-core`（为返回 `Plugin`）
- 且**组装与启动散落在内核**（api 里 new MockConnector / 注册插件 / 起监听；web 里 connectors 注册表 + 浏览器内管道）

## 2. 目标（用户）

1. **内核不依赖 middleware 和 plugin(connectors)**。
2. **example 负责组装和启动**（单独文件夹）。
3. 文档补**架构依赖图**。

## 3. 依赖规则（本 RFC 确立）

```
kernel/  ←  middleware/  ←  connectors/  ←  example/        （箭头 = 依赖方向）
```
- **kernel** 只依赖 kernel 内部（含 `contracts` 共享契约）。
- **middleware** 可依赖 kernel（用其端口/契约），不依赖 connectors/example。
- **connectors** 可依赖 kernel + middleware。
- **example** 依赖全部，负责**装配**与**启动**。

> 与"数据流方向"正交：依赖是**向下**的（编译期），而分层管道的组装/数据流是**自下而上**的 L1→L6（RFC-008）。

## 4. 改动

### 4.1 `contracts` 与存储端口归内核
- `middleware/contracts` → **`kernel/contracts`**：契约是全局共享词汇（零依赖），内核可用；middleware/connectors 改引 `kernel/contracts`。
- `DocumentStore`/`KvStore` 端口 + 内存实现 从 `plugin-core` 移入 **`kernel/persistence`**（存储属内核防腐层）；`plugin-core` 反向依赖内核端口。
- `kernel/aisdk` 去掉 `Plugin` 包装，只留 `AiSdkProvider`（实现内核 `LlmProvider`）；包名 → `@tengxiaohtx/aisdk`。

### 4.2 `kernel/api` 端口化
只剩：**HTTP 外壳 + 账号权限（认证/RBAC/管理端）+ 溯源端点 + 插件配置端点**；领域能力经端口注入（`src/ports.ts`）：
```ts
interface ProjectDirectory { listProjects(); listVersions(projectId) }
interface ReportService  { versionReport(p,v,actor); compare(input,actor); retryRun(runId) }
interface PluginDirectory{ list(): PluginSummary[]; loadData(c,id); saveData(c,id,input) }
interface ServerServices { projects; reports; plugins? }
```
依赖仅 `contracts/auth-core/persistence/run-store` + fastify。10 单测用**桩 services** 独立验证内核（不碰 middleware）。

### 4.3 `kernel/web` 变 UI 库
组件 + `AuthProvider(api 注入)` + api 模式 `ApiAuthApi/ApiDataClient` + `configureWeb()` 运行配置 + 桶导出；
`App/Site` 接收注入的 `createDataClient/authApi`；**移除 Vite 入口与 env 读取**。

### 4.4 `example/` 组装 + 启动（新增，单独文件夹）
```
example/app                 组装后端整机：connectors(数据源) + middleware(管道/插件宿主/LLM)
  src/assemble.ts             → PipelineReportService / ConnectorProjectDirectory /
                                HostPluginDirectory / resolveIngestConnector / llmProviderPlugin
  src/main.ts                 → 启动监听
  src/app.test.ts             → 10 集成测试（整机）
  Dockerfile
example/web                 Vite 应用：main.tsx 注入 authApi/DataClient；
  src/local-auth.ts           演示账号（local 模式）
  src/local-client.ts         浏览器内装配分层管道（LocalDataClient）
  src/connectors.ts           连接器注册表  src/dataSource.ts 管道调用
  index.css(+@source 扫内核 UI) · vite.config.ts · index.html · Dockerfile · nginx.conf
example/docker-compose.yml  一键起 Postgres + Redis + app + web
example/.env.example
```
根脚本 `pnpm stack:up|down|clean` 指向 `example/docker-compose.yml`；Pages 工作流与 Playwright 指向 `example-web`。

## 5. 验收标准

| # | 验收 | 状态 |
|---|---|---|
| AC-1 | kernel 只依赖 kernel（脚本可校验） | ✅ |
| AC-2 | example 单独文件夹，负责组装 + 启动 | ✅ example/app · example/web · compose |
| AC-3 | 内核可独立测试（桩 services，不引 middleware） | ✅ kernel/api 10 单测 |
| AC-4 | 整机行为不回归 | ✅ example/app 10 集成 + 14 E2E |
| AC-5 | 文档含架构依赖图 | ✅ ARCHITECTURE §0 |

## 6. 诚实标注
- docker/PG/Redis 仍未在本沙箱实跑（无 daemon）；`example-web` 构建、`example-app` 集成测试、E2E 均已验证。
- `kernel/web` 现为库（`build` 即 typecheck，无 dist 产物）——turbo 会提示该任务无 outputs，属预期。

## 7. 后续

- ✅ **已落地**：依赖方向已固化为门禁 `scripts/check-architecture.mjs`（零依赖，校验 package.json 声明 + 源码 import），
  接入 `pnpm lint:arch` / `pnpm verify` 与 `.github/workflows/ci.yml`；已用注入违规验证其确实会失败（exit 1）。
- 待做：example 增更多装配样例（不同层切片 / 不同连接器组合）；把 e2e 也纳入 PR 必过门禁的时长优化。
