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

每层是独立包，只依赖下层的**稳定契约**（`@kaogongsi/contracts`），可独立测试、独立存活。换实现不换契约、上层无感。

| 层 | 包 | 契约（上缘） |
|---|---|---|
| L6 呈现/路由 | `apps/web` · `packages/l6-report` · `packages/l6-compare` · `packages/report-llm` | ReportView / DecisionRecord / ComparisonView / ComparativeNarrative |
| L5 决策 | *(待建)* | AttributionResult |
| L4 归因 | *(待建)* | MetricCaseBundle |
| L3 计算 | *(待建)* | Provenance 查询 |
| L2 证据/血缘 | *(待建)* | CanonicalSignal |
| L1 接入/适配 | `packages/connector-mock`（+ 未来 BI/Langfuse/L5） | — |
| 契约（贯穿） | `packages/contracts` | 五道缝的类型定义 |

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

pnpm --filter @kaogongsi/api dev     # 起后端 :3001
pnpm --filter @kaogongsi/web dev     # 起前端 :5173
```

打开 `http://localhost:5173`：顶栏选**项目**，切「单版本报告 / 双版本对比」；对比模式下选**基线**与**候选**版本，点「生成对比报告」。深浅色可切。

### 接真实 LLM（可选）

```bash
export KAOGONGSI_LLM_BASE_URL=http://localhost:4000/v1   # OpenAI 兼容 / LiteLLM 代理
export KAOGONGSI_LLM_API_KEY=sk-xxx
export KAOGONGSI_LLM_MODEL=gpt-4o-mini
# 服务端 POST /api/report/compare { generateNarrative:true } 即用真实模型；未配置则用离线模板
```

## 文档

- `AGENTS.md` — 协作工作流与不可违反的约定（先读这个）
- `docs/rfcs/` — 每个需求的独立 RFC；`docs/stories/` — 用户故事
- `docs/ARCHITECTURE.md` — 项目架构（随迭代更新）
- `docs/MANUAL.md` — 使用手册（随迭代更新）
