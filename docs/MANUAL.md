# 使用手册（L2，随迭代更新）

> 考功司使用手册。最后更新：需求 005 完成（企业化：账号/角色/授权 + 全栈 + Pages）。

## 0. 本地自包含全栈（企业版，一键起）

参考 Langfuse 自托管思路，一条命令拉起「Postgres + Redis + 后端 api + 前端 web」；
账号/授权/插件配置/运行溯源入 **Postgres/Prisma**，插件 KV 缓存入 **Redis**（存储防腐层，RFC-010）：

```bash
cp example/.env.example example/.env   # 改 KAOGONGSI_JWT_SECRET
pnpm stack:up                          # = docker compose -f example/docker-compose.yml up --build
# 打开 http://localhost:8080 —— 首个注册用户自动成为管理员（数据持久在 Postgres）
pnpm stack:down                        # 停；pnpm stack:clean 连数据卷一起清
```

- 前端 :8080（nginx + `/api` 反代），后端 :3001，Postgres :5432，Redis :6379。
- api 启动时 `prisma db push` 自动建表；`@prisma/client` 于镜像安装时生成。
- **防腐层与存储独立**：领域只依赖端口，切库只在 `kernel/persistence` 装配处；未配 `DATABASE_URL/REDIS_URL`（本地 dev）自动回落内存/文件。
- 不用 docker 也可跑：`pnpm --filter @tengxiaohtx/example-app dev`（:3001）+ `VITE_DATA_MODE=api pnpm --filter @tengxiaohtx/example-web dev`（:5173）。
- **组装位置**：后端装配在 `example/app/src/assemble.ts`，前端在 `example/web/src/main.tsx`（内核只声明端口，RFC-011）。

> 账号系统：角色 **管理员 / 技术 / 财务 / BI**。管理员在「管理台」建用户、改角色、按项目勾选授权；
> 角色决定可见报告分区，项目授权决定可见项目（RFC-005）。

### 接入真实轨迹（RFC-006，可选）

默认用内置 Mock 数据。要接真实 Agent/观测平台轨迹，配 env（连接器隔离，L2–L6 零改动）：

```bash
# 本地文件夹（递归收集 .json/.jsonl；文件夹名作 tag）
KAOGONGSI_INGEST=file:/trajectories
# 或 HTTP 拉取（分批 + 时间范围 + tag + 自定义 header）
KAOGONGSI_INGEST=https://obs.example/api/traces
KAOGONGSI_INGEST_HEADERS='{"authorization":"Bearer xxx"}'
KAOGONGSI_INGEST_FROM=2026-08-01  KAOGONGSI_INGEST_TO=2026-08-31  KAOGONGSI_INGEST_TAGS=prod
# 选配解析器插件（空=全部）：claude-code/codex/deepseek/opencode/qoder/trae/traework/
#   qwenwork/workbuddy/langfuse/langsmith/harbor
KAOGONGSI_PARSERS=claude-code,langfuse
```

docker-compose：放开 `./trajectories:/trajectories:ro` 卷 + `KAOGONGSI_INGEST=file:/trajectories`。
只映射轨迹能给出的指标（成功率/成本/步数/工具成功率/护栏命中），给不出的（留存/ROI 等）留空。

## 1. 环境

- Node ≥ 22（开发用 24）、pnpm 10。
- 首次装 Playwright 浏览器：`pnpm --filter @tengxiaohtx/e2e exec playwright install chromium`。

## 2. 常用命令

```bash
pnpm install          # 安装
pnpm test             # 全部单测（turbo，排除 e2e）
pnpm typecheck        # 全部类型检查
pnpm build            # 全部构建
pnpm e2e              # Playwright 端到端
pnpm lint:arch        # 架构依赖门禁（kernel ← middleware ← connectors ← example）
pnpm verify           # 门禁 + typecheck + test + build（CI 同款）

# 单层独立测试（验证隔离）
pnpm --filter @tengxiaohtx/contracts test
pnpm --filter @tengxiaohtx/provenance test
pnpm --filter @tengxiaohtx/metrics test
pnpm --filter @tengxiaohtx/attribution test
pnpm --filter @tengxiaohtx/decision test
pnpm --filter @tengxiaohtx/report test
pnpm --filter @tengxiaohtx/compare test
pnpm --filter @tengxiaohtx/report-llm test
pnpm --filter @tengxiaohtx/connector-mock test
pnpm --filter @tengxiaohtx/api test          # 内核（桩 services，不依赖中间件）
pnpm --filter @tengxiaohtx/example-app test  # 整机集成（连接器 + 分层管道 + 插件）

# 起服务
pnpm --filter @tengxiaohtx/example-app dev     # 后端（组装层）:3001
pnpm --filter @tengxiaohtx/example-web dev     # 前端（应用层）:5173
```

## 3. 对上高管 Dashboard（单版本报告）

- 打开 `http://localhost:5173`，顶栏选**项目**、模式选「单版本报告」、选**版本**。默认 `mock` 连接器。
- 用 URL 切换数据源（演示不同场景）：
  - `?connector=mock` —— 默认，GO，full 证据
  - `?connector=breach` —— 护栏破线 + NO-GO（幻觉率标红）
  - `?connector=metric-only` —— 纯 BI 指标，不可下钻
  - `?connector=fake-l5` —— 假 L5 连接器（同接口），验证换源零改动
- 页面构成：三态门禁徽标 → 归因分布(带置信度) → 质量/产品/财务/护栏 KPI → 过程质量(诊断，可折叠) → 决策依据(含反对证据) → 下钻入口(metric-only 时禁用)。
- 右上角 `☀/☾` 切换深浅色。

## 3b. 版本对比与 LLM 对比报告（RFC-002）

- 顶栏切「**双版本对比**」，选**基线**与**候选**版本。
- 对比视图：门禁迁移（基线→候选）+ 逐指标 delta（基线值→候选值、方向 ↑/↓、显著性、护栏破线红）+ 诊断组可折叠。
- 点「**生成对比报告**」→ LLM/模板产出：总结 / 改善 / 回退·风险 / 决策建议 / 建议门禁。**决策支持，人工拍板**（D8.2）。
- 也可用 URL 直达：`?mode=compare`。
- Demo 数据：`钉钉 AI 表格 Agent`（v1.0→v1.1→v2.0 稳步改善）、`飞书文档助手 Agent`（v0.9→v1.0 质量升但幻觉率破线，演示回退检出）。

### 接真实 LLM（可选，端口化 D3）

默认离线确定性模板，无需任何配置。要用真实模型（OpenAI 兼容 / LiteLLM 代理）：

```bash
export KAOGONGSI_LLM_BASE_URL=http://localhost:4000/v1
export KAOGONGSI_LLM_API_KEY=sk-xxx
export KAOGONGSI_LLM_MODEL=gpt-4o-mini
```

服务端 `POST /api/report/compare` body `{ projectId, baselineId, candidateId, generateNarrative:true }` 即用真实模型生成叙述（API key 只在服务端）；未配置则回落离线模板。前端「生成对比报告」默认走浏览器内离线模板，保证 E2E 确定性。

## 4. 如何接入一个新数据源（写连接器）

1. 新建包 `connectors/xxx`，实现 `DataConnector` 接口（`capabilities/listProjects/listVersions/fetchSignals`）。
2. 跑通用契约测试：`runConnectorContract('xxx', () => new XxxConnector())`（从 `@tengxiaohtx/connector-mock` 导入）。
3. **在组装层注册**：后端 `example/app/src/assemble.ts`（`createApp({ connector })` 或 env）；
   前端 local 演示态 `example/web/src/connectors.ts`。
4. **内核与中间件无需改动**——这是连接器模式 + 依赖倒置（RFC-011）的目的。

> metric-only 数据源（如纯 BI 导出）：`capabilities().drillable` 返回 `false`，UI 会自动标"不可下钻、不可作为拍板唯一依据"，不会伪装成完整可信报告（D9.3）。

## 5. 如何加一个新需求（流程）

1. 写 `docs/rfcs/RFC-00X-*.md` + `docs/stories/US-00X-*.md`，**先评审**。
2. 评审通过后 BDD+TDD 逐层实现（先写失败测试→实现→绿）。
3. UI 侧加 Playwright E2E 到 `e2e/tests/`。
4. 全绿后：RFC/Story 标完成，更新本手册与 `docs/ARCHITECTURE.md`。
