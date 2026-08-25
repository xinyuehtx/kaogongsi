# US-009：三层架构 + 内核 Agent Loop + 运行溯源/重试/日志

| | |
|---|---|
| 状态 | **✅ 已完成** |
| 关联 RFC | `docs/rfcs/RFC-009-three-tier-kernel-runstore.md` |
| 受众 | 平台架构 / 运维 / 审计 |

---

## 用户故事

> **作为**平台负责人，
> **我想要**架构清晰分为「内核 / 中间件(层) / 连接器」，LLMProvider 属内核、Langfuse 等属连接器；
> 且每次运行可溯源（连接器两种版本 + 每层入参都落库，L1 大数据按需查接口）、可重试，并有服务端日志文件，
> **以便于**出问题能追到是哪层哪版本、能重放复现、能审计。

## 验收标准（Given / When / Then）

### AC-1 三层清晰
- **那么** `kernel/`（含 LLMProvider、Agent Loop、账号、存储、溯源）/ `middleware/`（L1-L6 可组装层）/ `connectors/`（外部数据源+DSL）分目录

### AC-2 溯源
- **当** 我出了一份评测报告（拿到 runId）
- **那么** `GET /api/runs/:runId` 返回该次运行的连接器版本 + **每层（除 L1）的入参**；L1 大数据不内联，按连接器接口按需查

### AC-3 两种连接器版本
- **那么** 落库同时记录**插件安装包版本**与**配置数据版本**

### AC-4 重试重放
- **当** 我对某 runId 触发 `POST /api/runs/:runId/retry`
- **那么** 用落库的层入参重放上层（归因→决策→报告），不重新拉 L1，得到可复现结果

### AC-5 服务端日志
- **那么** 每次运行经 `Logger` 记录（生产写按天文件）

## 不在本故事内
- Mongo/Redis 生产适配器（端口就绪，默认内存/文件）；configVersion 与 DSL 配置保存打通；Agent Loop 多步工具循环；L1 外置证据存储实现。

## 演示脚本
1. 出报告 → 记下响应头 `x-run-id` → `GET /api/runs/<id>` 看每层入参 → `POST /api/runs/<id>/retry` 复现。
2. `GET /api/connector-versions` 看连接器版本记录。
3. `pnpm --filter @tengxiaohtx/run-store test` / `@tengxiaohtx/agent-loop test` 全绿。
