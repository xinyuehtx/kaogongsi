# RFC-008：可组装分层管道 + 内核/插件目录分离（组装方向与内核依赖相反）

| | |
|---|---|
| 状态 | **✅ 已完成**：pipeline 3 + plugin-core 9 + api 15 单测；E2E 14；全绿 |
| 需求序号 | 008 |
| 层 | 横切（重构内核结构 + 组装式管道） |
| 关联 | RFC-007（插件系统）；D3 端口化、D9.2 隔离 |

---

## 1. 目标（用户）

1. 文件夹命名去掉 `lN-` 前缀。
2. 内核与插件目录结构分开。
3. 自上而下每层都可抽取插件；**插件的可组装定义方向与内核依赖方向相反**。
4. App 选择某层切片（如 L4-L6）内核，插件接口即支持到该切片；**L5 插件入参可含 L4 插件出参**。

## 2. 结构调整（点 1、2）

- 分层包去 `lN-`：`provenance / metrics / attribution / decision / report / compare`（文件夹 + 包名）。
- **内核 `packages/*`，插件 `plugins/*`**（`plugins/example`、`plugins/aisdk`）；`pnpm-workspace` 增 `plugins/*`。
- 插件框架 `plugin-core`、`pipeline` 属内核（在 `packages/*`）。

## 3. 两个相反的方向（点 3 —— 核心）

- **内核依赖方向（自上而下）**：上层包 `import` 下层的**契约**。`report` 依赖 `decision`/`attribution`；`metrics` 依赖 `provenance`……编译期依赖箭头向下。
- **插件组装方向（自下而上）**：数据流 `下层输出 → 上层输入`。`attribution(L4)` 产出喂 `decision(L5)`，再喂 `report(L6)`。**组装即按数据流自下而上串联，与内核依赖箭头相反**。

契约（`contracts`）新增：
```ts
type LayerId = 'ingest'|'provenance'|'metrics'|'attribution'|'decision'|'report'
const LAYER_ORDER: LayerId[]                 // 自下而上
interface LayerContext { version?; signals?; evaluation?; attribution?; decision?; view?; drillable?; [k]:unknown }
interface LayerStage { layer: LayerId; id; run(ctx: LayerContext): Partial<LayerContext> }  // 读 ctx（含下层产出）→ 产本层
```

## 4. 可组装管道 `packages/pipeline`（点 4）

- 内核默认 stage：`metricsStage / attributionStage / decisionStage / reportStage`，各自包裹 `computeEvaluation/buildAttribution/decide/buildExecReportView`。
- `buildStages({ layers, resolve })`：按 `LAYER_ORDER` 取所选层，每层 `resolve(layer) ?? 内核默认`（插件可覆盖）。
- `runPipeline(stages, seed)`：逐层把产出合并回 `ctx`，**上层 stage 读得到下层 stage 产出**。
- **App 选层切片**：`layers:['attribution','decision','report']` + `seed={evaluation}` 即只跑 L4-L6；`decision(L5)` 的 `run(ctx)` 读 `ctx.attribution`（L4 出参）✅。

插件贡献 stage（`plugin-core`）：
```ts
interface Plugin { …; stages?: LayerStage[] }   // 向任一层贡献可组装组件
host.stageFor(layer): LayerStage | undefined     // 供 pipeline resolve 覆盖内核默认
```

## 5. 接线（api）
报告管道改走 `pipeline`：`computeEvaluation`（合并插件目录 + 派生 + 外部数据）得 `evaluation` →
`runPipeline(buildStages({layers:['attribution','decision','report'], resolve:host.stageFor}), {version, evaluation, drillable})` →
`ctx.view`（单版本）/ `{version,decision,kpis}`（对比）。插件注册 `decision` stage 即可替换 L5，且读到 L4 归因出参。

## 6. 验收标准

| # | 验收 | 状态 |
|---|---|---|
| AC-1 | 文件夹/包名去 lN- | ✅ |
| AC-2 | 内核 packages/* 与插件 plugins/* 分离 | ✅ |
| AC-3 | 每层可由插件 stage 替换；组装自下而上 | ✅ pipeline |
| AC-4 | App 选层切片（L4-L6），L5 stage 入参含 L4 出参 | ✅ pipeline 测试 |
| AC-5 | api 报告经组装管道，插件 stage 生效 | ✅ api 集成 |
| AC-6 | 全绿不回归 | ✅ 31 test + 14 E2E |

## 7. 交付物
- 重命名 6 个分层包；`plugins/*` 目录；`contracts` 新增 LayerId/LAYER_ORDER/LayerContext/LayerStage。
- `packages/pipeline`（默认 stage + buildStages/runPipeline）；`plugin-core` 增 `stages`/`stageFor`；api 接线。

## 8. 后续
- 类型更强的分层 stage（编译期校验相邻层输入=下层输出）；跨切片校验（选层不连续时报错）；插件 stage 优先级/组合（同层多插件链式）。
