# US-006：接入真实轨迹（本地文件 / HTTP）+ 多格式解析插件

| | |
|---|---|
| 状态 | **✅ 已完成** |
| 关联 RFC | `docs/rfcs/RFC-006-data-ingestion-parsers.md` |
| 受众 | 平台接入方 / 部署运维 |

---

## 用户故事

> **作为**要把真实评测/线上轨迹接进考功司的接入方，
> **我想要**既能从本地文件夹收集轨迹、也能从 HTTP 拉取（按时间范围/tag/自定义 header/分批），
> 且不同 Agent 与观测平台的轨迹格式各有解析器、能按部署选配，
> **以便于**把现有 claude-code/codex/…/langfuse/langsmith 轨迹直接变成可信指标与归因决策。

## 验收标准（Given / When / Then）

### AC-1 本地文件夹接入
- **当** 我把轨迹放到一个文件夹并配置 `KAOGONGSI_INGEST=file:/trajectories`
- **那么** 系统递归收集 `.json/.jsonl`，按项目/版本归组，产出可信指标（可按时间/tag 过滤、分批）

### AC-2 HTTP 接入
- **当** 我配置 `KAOGONGSI_INGEST=https://obs/api/traces` 并给自定义 header
- **那么** 系统带**时间范围/tag/header**拉取并**分批翻页**，把 trace 变成指标

### AC-3 多格式 + 插件选配
- **假设** 我的轨迹是 claude-code / codex / langfuse / langsmith / …
- **那么** 对应解析器把它归一化；`KAOGONGSI_PARSERS` 可只启用我需要的插件（部署容器选配）

### AC-4 隔离不改上层
- **当** 我从 Mock 切到真实轨迹接入
- **那么** L2/L3/L4/L5/L6 与前端零改动（都只依赖 `DataConnector` 契约）

### AC-5 只报能给出的指标
- **那么** 轨迹能算的（成功率/成本/步数/工具成功率/护栏命中）如实产出，给不出的（如留存/ROI）留空，不臆造

## 不在本故事内
- 流式/增量与定时轮询；官方 SDK 深度分页；步级血缘下钻；专有格式逐一对齐真实 schema（已用通用抽取 + 可微调 FieldMap 覆盖）。

## 演示脚本
1. 准备 `./trajectories/<项目>/*.jsonl`（如 claude-code 会话）；`KAOGONGSI_INGEST=file:/trajectories docker compose up`。
2. 登录 → 选该项目/版本 → 看由真实轨迹算出的成功率/成本/工具成功率与归因决策。
3. `KAOGONGSI_INGEST=https://…/traces KAOGONGSI_INGEST_HEADERS='{"authorization":"Bearer …"}' KAOGONGSI_PARSERS=langfuse` 从 Langfuse 拉取。
4. `pnpm --filter @tengxiaohtx/ingest test` 全绿。
