# US-008：可组装分层管道 + 内核/插件分离

| | |
|---|---|
| 状态 | **✅ 已完成** |
| 关联 RFC | `docs/rfcs/RFC-008-composable-pipeline.md` |
| 受众 | 平台/插件开发者、集成商 |

---

## 用户故事

> **作为**要把考功司裁剪/扩展到自家场景的开发者，
> **我想要**内核目录不带 lN- 前缀、内核与插件分目录，且能只选用某几层（如 L4-L6）、
> 用插件替换任一层实现，插件之间自下而上组装（L5 能拿到 L4 的产出），
> **以便于**按需拼装一个"只做归因+决策+报告"的 App，或替换某层为我自己的实现。

## 验收标准（Given / When / Then）

### AC-1 结构清爽
- **那么** 分层包为 `provenance/metrics/attribution/decision/report/compare`（无 lN-）；内核在 `packages/*`，插件在 `plugins/*`

### AC-2 选层切片
- **当** App 声明 `layers: ['attribution','decision','report']` 并提供该切片起点输入（evaluation）
- **那么** 只运行这三层，产出报告视图

### AC-3 自下而上组装
- **当** decision(L5) 运行
- **那么** 它能读到 attribution(L4) 的产出（`ctx.attribution`）——组装方向与内核依赖方向相反

### AC-4 插件替换某层
- **当** 插件贡献一个 `decision` 层 stage
- **那么** 管道用插件 stage 替换内核默认，且该 stage 仍能消费 L4 出参；下游 report 照常消费其产出

### AC-5 不回归
- **那么** 既有报告/对比/鉴权/E2E 全绿

## 演示脚本
1. `pnpm --filter @tengxiaohtx/pipeline test`：看 L4-L6 切片 + 插件覆盖 L5 且读到 L4 出参。
2. 写一个插件：`{ stages: [{ layer:'decision', id:'my', run: ctx => ({ decision: myDecide(ctx.attribution!, ctx.evaluation!.kpis) }) }] }`，注册后 api 报告即用它。
3. `pnpm test && pnpm e2e` 全绿。
