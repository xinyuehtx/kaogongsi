# 考功司 · 端到端 Agent 评测归因决策机

> **考功司**：古代**户部下属、专司官员绩效考评**之部门。本项目借此为名——把「对官员的绩效考评与黜陟」映射为「对各类 **AI Agent** 的**评测、归因与去留决策**」。
>
> monorepo 实现。English: see [README.en.md](./README.en.md)。

## 是什么

一台**评测归因决策机**：输入各类 Agent 的评测/线上信号 → 按指标权重计算 → 归因到**技术 / 产品 / 运营** → 为高管产出「**值不值得继续**（GO / NO-GO / ABSTAIN）+ 顶层归因」，为下游产出「按责任方路由的排查建议」。**全程决策支持、人工拍板。**

## 核心能力

- **按「项目 → 版本」组织评测报告**：每个 Agent 项目下有多个版本，每个版本一轮评测结果（指标 + 归因 + 决策）。
- **单版本报告**：三态门禁 + 归因分布（技术/产品/运营，带置信度）+ 质量/产品/财务/护栏 KPI + 过程质量（诊断）+ 决策依据（含反对证据）。
- **两版本对比**：相对「某个基线版本」的逐指标 delta（方向 / 显著性 / 护栏破线），门禁迁移一目了然。
- **LLM 生成对比报告**：把对比数据交给 LLM（默认离线确定性模板，可切真实 OpenAI 兼容模型）产出「总结 / 改善 / 回退 / 决策建议」。

## 用户流程

```
前序流程生成指标数据（本仓库用 MockConnector 多项目多版本 fixture）
        │
        ▼
本轮选择：单版本报告  或  选两个版本进行对比
        │
        ▼
（对比）一键「生成对比报告」→ LLM/模板产出结论与建议（人工拍板）
```

## 架构：六层 + 五契约（层间隔离）

每层是独立包，只依赖下层的**稳定契约**（`@tengxiaohtx/contracts`），可独立测试、独立存活。换实现不换契约、上层无感。

| 层 | 包 | 契约（上缘） |
|---|---|---|
| L6 呈现/路由 | `apps/web` · `packages/l6-report` · `packages/l6-compare` · `packages/report-llm` | ReportView / DecisionRecord / ComparisonView / ComparativeNarrative |
| L5 决策 | `packages/l5-decision` | AttributionResult |
| L4 归因 | `packages/l4-attribution` | MetricCaseBundle |
| L3 计算 | `packages/l3-metrics` | Provenance 查询 |
| L2 证据/血缘 | `packages/l2-provenance` | CanonicalSignal |
| L1 接入/适配 | `packages/connector-mock`（+ 未来 BI/Langfuse/L5） | — |
| 契约（贯穿） | `packages/contracts` | 五道缝的类型定义 + 指标目录 |

> **六层已贯通**：`fetchSignals(L1)` → `血缘(L2)` → `可信指标(L3，带 bootstrap 置信区间)` → `归因(L4)` → `决策(L5)` → `报告(L6)`。

> **数据源可插拔**：`DataConnector` 是读侧隔离缝，MockConnector 只是第一个实现；接入真实 BI/Langfuse/评测平台＝新增一个连接器，视图零改动。
> **LLM 可替换**：`ReportGenerator` 是模型出口端口，默认离线模板，配置 env 即切真实模型。

## 技术栈（全热门 OSS）

pnpm workspaces + Turborepo · TypeScript(strict) · Fastify(api) · React 19 + Vite + **Tailwind v4**(web) · Vitest(单测/BDD) · Playwright(E2E)。

## 开发

```bash
pnpm install
pnpm test            # vitest 全部单测
pnpm typecheck
pnpm build           # turbo 构建全部
pnpm e2e             # Playwright E2E（自动 build+preview web）

pnpm --filter @tengxiaohtx/api dev     # 起后端 :3001
pnpm --filter @tengxiaohtx/web dev     # 起前端 :5173
```

打开 `http://localhost:5173`：顶栏选**项目**，切「单版本报告 / 双版本对比」；对比模式下选**基线**与**候选**版本，点「生成对比报告」。深浅色可切。

### 接真实 LLM（可选）

```bash
export KAOGONGSI_LLM_BASE_URL=http://localhost:4000/v1   # OpenAI 兼容 / LiteLLM 代理
export KAOGONGSI_LLM_API_KEY=sk-xxx
export KAOGONGSI_LLM_MODEL=gpt-4o-mini
# 服务端 POST /api/report/compare { generateNarrative:true } 即用真实模型；未配置则用离线模板
```

## 企业化部署（账号 / 角色 / 全栈 / Pages）

参考 Langfuse 的自托管思路，提供**本地自包含全栈**与**账号系统**：

```bash
docker compose up --build     # 或 pnpm stack:up —— 一键起后端+前端
# http://localhost:8080 —— 首个注册用户自动成为管理员
```

- **账号 / 角色**：`管理员 / 技术 / 财务 / BI`。管理员在「管理台」建用户、改角色、按项目勾选授权。
- **项目授权**：非管理员只见被授权项目；**角色决定可见报告分区**（财务只见财务/归因/依据，技术见质量/护栏/过程质量…）。
- **端口化**：账号存储 `StoragePort`（默认 JSON 文件卷，可换 Postgres）；LLM 出口 `ReportGenerator`（默认离线模板，可换真实模型）——均不泄漏进内核（D3）。
- **两种运行模式**：`api`（真实后端鉴权，自托管全栈）/ `local`（浏览器演示态，无后端）——`VITE_DATA_MODE` 切换。

**GitHub Pages**（对外站点：介绍 + 操作文档 + Playground）：推送 `main` 触发 `.github/workflows/pages.yml` 自动构建部署（需在仓库 Settings → Pages 选 “GitHub Actions” 来源）。本地预览站点：

```bash
VITE_SITE_MODE=pages pnpm --filter @tengxiaohtx/web dev
```

## 文档

- `AGENTS.md` — 协作工作流与不可违反的约定（先读这个）
- `docs/rfcs/` — 每个需求的独立 RFC；`docs/stories/` — 用户故事
- `docs/ARCHITECTURE.md` — 项目架构（随迭代更新）
- `docs/MANUAL.md` — 使用手册（随迭代更新）
