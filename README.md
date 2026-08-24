# 考公司 · 端到端 Agent 评测框架（归因决策机）

> monorepo 实现，对应 RFC：`~/Documents/docs/e2e-evals/rfc/RFC.md`

## 是什么

一台**归因决策机**：输入各类 Agent 的评测/线上信号 → 按指标权重计算 → 归因到技术/产品/运营 → 为高管产出「值不值得继续 + 顶层归因」，为下游产出「按责任方路由的排查建议」。全程决策支持、人工拍板。

## 架构：六层 + 五契约（层间隔离）

每层是独立包，只依赖下层的**稳定契约**（`@kaogongsi/contracts`），可独立测试、独立存活。

| 层 | 包 | 契约（上缘） |
|---|---|---|
| L6 呈现/路由 | `apps/web` + `packages/l6-report`(待建) | ReportView / DecisionRecord |
| L5 决策 | `packages/l5-decision`(待建) | AttributionResult |
| L4 归因 | `packages/l4-attribution`(待建) | MetricCaseBundle |
| L3 计算 | `packages/l3-metrics`(待建) | Provenance 查询 |
| L2 证据/血缘 | `packages/l2-provenance`(待建) | Canonical Signal |
| L1 接入/适配 | `packages/l1-ingest`(待建) | — |
| 契约（贯穿） | `packages/contracts` | 五道缝的类型定义 |

> 实现顺序：**自顶向下**——先做 L6（对上报告/可视化），逐步往下接传统 evals。每层落地前先出独立 RFC + user story 评审。

## 技术栈（全热门 OSS）

pnpm workspaces + Turborepo · TypeScript(strict) · Fastify(api) · React+Vite(web) · Vitest(单测/BDD) · Playwright(E2E)

## 开发

```bash
pnpm install
pnpm build          # turbo 构建全部
pnpm test           # vitest 全部
pnpm typecheck
pnpm --filter @kaogongsi/api dev     # 起后端
pnpm --filter @kaogongsi/web dev     # 起前端
pnpm e2e            # Playwright E2E
```

## 文档

- `docs/rfcs/` — 每个需求的独立 RFC
- `docs/stories/` — 每个需求的 user story
- `docs/ARCHITECTURE.md` — 项目架构文档（L2，随迭代更新）
- `docs/MANUAL.md` — 使用手册（L2，随迭代更新）
