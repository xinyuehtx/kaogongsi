# US-010：DB 级存储防腐层 + Postgres/Prisma + Redis 一键 example

| | |
|---|---|
| 状态 | **✅ 已完成** |
| 关联 RFC | `docs/rfcs/RFC-010-persistence-acl-postgres-redis.md` |
| 受众 | 部署/运维、平台架构 |

---

## 用户故事

> **作为**要把考功司落到生产的运维，
> **我想要**有真正的 DB 级存储（防腐层与存储解耦，可换 DB），并能一键拉起一个用 Postgres/Prisma 做库、
> Redis 做缓存的 example，
> **以便于**数据持久可靠、可扩展，且将来换存储不动业务。

## 验收标准（Given / When / Then）

### AC-1 防腐层独立
- **那么** 领域只依赖存储端口（StoragePort/DocumentStore/KvStore/RunStore）；Postgres/Prisma 与 Redis 适配器在独立包 `kernel/persistence`，DB 细节不进内核

### AC-2 一键起 PG+Redis 全栈
- **当** 我 `cp .env.example .env && docker compose up`
- **那么** 起 Postgres + Redis + api + web；api 启动时 `prisma db push` 建表；打开 http://localhost:8080 首个注册用户为管理员

### AC-3 数据落 DB / 缓存落 Redis
- **那么** 账号/授权/插件配置文档/运行溯源入 Postgres；插件 KV 缓存入 Redis；重启不丢

### AC-4 未配 DB 时回落
- **当** 不设 DATABASE_URL/REDIS_URL（本地 dev）
- **那么** api 自动回落内存/文件，业务零改动

## 不在本故事内
- Prisma migration 版本文件（当前用 db push）；连接池调优；生产级备份/HA。

## 演示脚本
1. `cp .env.example .env`（改 JWT 密钥）→ `docker compose up --build`。
2. 注册管理员 → 管理台建用户/授权 → 重启 compose → 数据仍在（Postgres 持久）。
3. `pnpm --filter @tengxiaohtx/persistence test`：防腐层装配单测绿。
