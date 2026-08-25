# RFC-010：存储防腐层（DB 级支持）+ example 一键全栈（Postgres/Prisma + Redis）

| | |
|---|---|
| 状态 | **✅ 已完成**：async 端口 + Prisma/Redis 适配器；全绿（36 test + 14 E2E）。DB/Redis 运行时需 compose，本沙箱未起库 |
| 需求序号 | 010 |
| 层 | 内核 · 存储防腐层 + 部署 example |
| 关联 | RFC-009（三层）；D3 端口化 |

---

## 1. 目标（用户）
- 提供 **DB 级支持**，**防腐层与存储独立**。
- **example 一键拉起**：**Postgres/Prisma 做 DB，Redis 做缓存**。

## 2. 防腐层设计（ACL 与存储独立）
- **领域只依赖端口**（在各领域包）：`StoragePort`(账号/授权) · `DocumentStore`/`KvStore`(插件输入/缓存) · `RunStore`(溯源)。
- **端口 async 化**：DB 天然异步，故把 `StoragePort`/`RunStore` 改为 Promise（`DocumentStore`/`KvStore` 本就 async）。api 鉴权/路由随之 await。
- **适配器独立成包 `kernel/persistence`**（防腐层）：
  - Prisma(Postgres)：`PrismaAuthStorage` / `PrismaDocumentStore` / `PrismaRunStore`（`schema.prisma` 建模 User/Grant/PluginDoc/RunMeta/RunLayer/ConnectorVersion）。
  - Redis：`RedisKvStore`（ioredis，带 TTL）。
  - `createPersistence(env)`：`DATABASE_URL`→Postgres、`REDIS_URL`→Redis；**未配则上层回落内存/文件**。
- **DB 细节不泄漏进内核**：切换 Postgres/Redis 只发生在 `createPersistence` 装配处，领域端口与业务零改动。

## 3. example 一键全栈
- `docker compose up`：`db`(postgres:16) + `cache`(redis:7) + `api` + `web`，healthcheck + depends_on 就绪顺序。
- api 容器启动：若配 `DATABASE_URL` 先 `prisma db push` 同步 schema，再 tsx 启动；`@prisma/client` 于镜像 `pnpm install` 时 `postinstall` 生成。
- 账号/授权/插件文档/运行溯源 → Postgres；插件 KV 缓存 → Redis；日志 → 文件卷。
- `.env.example` 提供默认连接串。

## 4. 验收标准

| # | 验收 | 状态 |
|---|---|---|
| AC-1 | 防腐层与存储独立：领域仅依赖端口，DB 适配器独立成包 | ✅ kernel/persistence |
| AC-2 | DB 级支持：Postgres/Prisma 适配账号/文档/溯源 | ✅ 适配器 + schema（运行需 DB） |
| AC-3 | Redis 缓存：KvStore 适配 | ✅ RedisKvStore |
| AC-4 | 装配按 env 切换，未配回落内存/文件，业务零改动 | ✅ createPersistence + api |
| AC-5 | example 一键起 PG+Redis+api+web | ✅ docker-compose（本沙箱未运行 docker） |
| AC-6 | 全绿不回归 | ✅ 36 test + 14 E2E |

## 5. 交付物
- 端口 async 化（auth-core/run-store）+ api await 化。
- `kernel/persistence`（Prisma + Redis 适配 + createPersistence + postinstall generate + schema.prisma）。
- docker-compose 增 db/cache + api 迁移入口 + `.env.example` + api Dockerfile（openssl + db push）。

## 6. 诚实标注
- 本沙箱无 docker daemon/compose 插件与 Postgres/Redis：适配器 CRUD、`prisma db push`、compose 运行**未在此环境实跑**；`prisma generate` 已在沙箱验证成功，端口/装配/构造均已单测（不触网）。真实 CRUD 需 `docker compose up`。

## 7. 后续
- Prisma migration 文件（`migrate dev` 需 DB）替代 `db push`；连接池/健康检查；Redis 缓存策略细化（会话/授权缓存）；配置数据版本(configVersion)与插件 DSL 保存联动写入 RunMeta。
