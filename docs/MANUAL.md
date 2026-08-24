# 使用手册（L2，随迭代更新）

> 考功司使用手册。最后更新：需求 002 完成。

## 1. 环境

- Node ≥ 22（开发用 24）、pnpm 10。
- 首次装 Playwright 浏览器：`pnpm --filter @kaogongsi/e2e exec playwright install chromium`。

## 2. 常用命令

```bash
pnpm install          # 安装
pnpm test             # 全部单测（turbo，排除 e2e）
pnpm typecheck        # 全部类型检查
pnpm build            # 全部构建
pnpm e2e              # Playwright 端到端

# 单层独立测试（验证隔离）
pnpm --filter @kaogongsi/contracts test
pnpm --filter @kaogongsi/l2-provenance test
pnpm --filter @kaogongsi/l3-metrics test
pnpm --filter @kaogongsi/l4-attribution test
pnpm --filter @kaogongsi/l5-decision test
pnpm --filter @kaogongsi/l6-report test
pnpm --filter @kaogongsi/l6-compare test
pnpm --filter @kaogongsi/report-llm test
pnpm --filter @kaogongsi/connector-mock test
pnpm --filter @kaogongsi/api test

# 起服务
pnpm --filter @kaogongsi/api dev     # 后端 :3001
pnpm --filter @kaogongsi/web dev     # 前端 :5173
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

1. 新建包 `packages/connector-xxx`，实现 `DataConnector` 接口（`capabilities/fetchDecision/fetchKpis`）。
2. 跑通用契约测试：`runConnectorContract('xxx', () => new XxxConnector())`（从 `@kaogongsi/connector-mock` 导入）。
3. 在 `apps/web/src/connectors.ts` 注册；或在 `apps/api` 注入。
4. **l6-report 与 web 组件无需改动**——这是连接器模式的目的。

> metric-only 数据源（如纯 BI 导出）：`capabilities().drillable` 返回 `false`，UI 会自动标"不可下钻、不可作为拍板唯一依据"，不会伪装成完整可信报告（D9.3）。

## 5. 如何加一个新需求（流程）

1. 写 `docs/rfcs/RFC-00X-*.md` + `docs/stories/US-00X-*.md`，**先评审**。
2. 评审通过后 BDD+TDD 逐层实现（先写失败测试→实现→绿）。
3. UI 侧加 Playwright E2E 到 `e2e/tests/`。
4. 全绿后：RFC/Story 标完成，更新本手册与 `docs/ARCHITECTURE.md`。
