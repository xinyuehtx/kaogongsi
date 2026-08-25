# US-011：内核干净、example 组装启动、架构依赖图

| | |
|---|---|
| 状态 | **✅ 已完成** |
| 关联 RFC | `docs/rfcs/RFC-011-dependency-inversion-example-assembly.md` |
| 受众 | 平台架构 / 二次开发者 / 部署 |

---

## 用户故事

> **作为**要基于考功司做二次开发或裁剪的开发者，
> **我想要**内核是干净的（不依赖中间件与连接器）、由一个独立的 `example/` 负责组装与启动，
> 并有一张清晰的架构依赖图，
> **以便于**我能只取内核 + 自己挑的层与连接器，拼出自己的应用，而不被示例装配绑住。

## 验收标准（Given / When / Then）

### AC-1 内核干净
- **当** 我检查 `kernel/*/package.json`
- **那么** 只出现 kernel 内部包（contracts/auth-core/persistence/run-store/agent-loop/aisdk/api/web），没有 middleware/connectors

### AC-2 example 单独启动
- **当** 我在 `example/` 一键起（`pnpm stack:up` → `example/docker-compose.yml`）
- **那么** Postgres + Redis + 后端(example/app) + 前端(example/web) 起来，功能与之前一致

### AC-3 组装在 example
- **那么** 「用哪个连接器 / 跑哪些层 / 注册哪些插件 / 用哪个 LLM」都在 `example/app/src/assemble.ts` 与 `example/web/src/main.tsx`，内核只声明端口

### AC-4 内核可独立验证
- **当** 我跑 `pnpm --filter @tengxiaohtx/api test`
- **那么** 用桩 services 就能验证认证/RBAC/溯源，不需要任何中间件

### AC-5 文档有依赖图
- **那么** `docs/ARCHITECTURE.md` 首节给出 `kernel ← middleware ← connectors ← example` 依赖图与规则

## 不在本故事内
- 用 CI lint（dependency-cruiser）把依赖方向做成硬门禁（RFC-011 §7）。

## 演示脚本
1. `bash -c 'grep -h "@tengxiaohtx/" kernel/*/package.json | grep -oE "@tengxiaohtx/[a-z-]+" | sort -u'` → 只有内核包。
2. `pnpm --filter @tengxiaohtx/api test`（内核独立）+ `pnpm --filter @tengxiaohtx/example-app test`（整机）。
3. `pnpm stack:up` 起 example 全栈；`pnpm e2e` 14 场景绿。
