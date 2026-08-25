# RFC-005：企业化改造（参考 Langfuse）——账号/角色/授权 + 自包含全栈 + GitHub Pages

| | |
|---|---|
| 状态 | **✅ 已完成**：单测 + E2E(13) 全绿；docker/Pages 产出（沙箱未实跑，run 命令与构建已验证） |
| 需求序号 | 005 |
| 层 | 横切：接入层认证/授权 + 部署（全栈）+ 对外站点（Pages） |
| 关联 | 参考 Langfuse 自托管；`DECISIONS.md` D3 端口化、D6 受众三层、D8.2 人工拍板 |

---

## 1. 目标（用户三点）

1. **本地自包含全栈启动**：一条命令拉起后端 + 前端，账号/授权可持久化。
2. **账号系统**：注册 + 角色（**管理员 / 技术 / 财务 / BI**）+ **项目授权**。
3. **GitHub Pages**：项目介绍 + 操作文档 + Playground。

## 2. 设计

### 2.1 auth-core（`packages/auth-core`）
- 角色 `admin/tech/finance/bi`；`User/PublicUser/ProjectGrant/JwtPayload`。
- 密码 scrypt、令牌 HS256 JWT（`node:crypto`，零依赖、可测）。
- **StoragePort**（D3 端口化）：`InMemoryStorage`（测试/默认）+ `FileStorage`（JSON 自包含持久化）；生产可换 Postgres 适配器。
- RBAC：`ROLE_SECTIONS`（角色→可见报告分区）、`filterViewForRole`、`canAccessProject`、`authorizedProjectIds`。
- service：`registerUser`（首用户 bootstrap admin，公开注册 bi，管理员可指定角色）、`login`、`authenticate`。

### 2.2 api（认证 + RBAC）
- `/api/auth/register|login|me`；`/api/admin/users|grants(+/revoke)`（仅 admin）。
- 所有数据端点：Bearer 认证 + 项目授权校验 + `filterViewForRole` 分区过滤。
- 存储/密钥经 `ServerDeps` 注入（默认内存 / `KAOGONGSI_DATA_DIR`→文件 / `KAOGONGSI_JWT_SECRET`）。
- 运行时改 **tsx** 直跑 TS（解析 workspace .ts 图，无需预编译）。

### 2.3 web（双模式）
- **AuthContext**：`api` 模式走后端真鉴权（JWT 存 localStorage）；`local` 模式浏览器演示态（四角色预置账号）。
- 登录/注册页、用户徽标/登出、管理员「管理台」（建用户/改角色/勾选项目授权）。
- **DataClient** 双实现：`local`（连接器 + 六层管道，客户端按角色/授权过滤）/ `api`（后端已过滤）；`VITE_DATA_MODE` 切换。

### 2.4 全栈部署（自包含）
- `apps/api/Dockerfile`（tsx 运行 + `/data` 卷）、`apps/web/Dockerfile`（vite api 模式构建→nginx）+ `nginx.conf`（SPA 回退 + `/api` 反代 `api:3001`，单源无 CORS）。
- `docker-compose.yml`：`docker compose up` 一键起，命名卷持久化账号；`pnpm stack:up/down/clean`。

### 2.5 GitHub Pages
- `Site` 壳（`VITE_SITE_MODE=pages`）：介绍 + 文档 + Playground（内嵌 `local` 演示态应用），hash 路由；`VITE_BASE=/<repo>/`。
- `.github/workflows/pages.yml`：构建→`upload-pages-artifact`→`deploy-pages`；404 回退。

## 3. 验收标准

| # | 验收 | 状态 |
|---|---|---|
| AC-1 | 一键起全栈（docker compose up / stack:up），账号持久化到卷 | 产出（沙箱未跑 docker） |
| AC-2 | 注册/登录/JWT；首用户 admin；越权数据端点 401/403 | ✅ 单测 |
| AC-3 | 四角色 + 项目授权：非 admin 仅见被授权项目，角色决定可见分区 | ✅ 单测 + E2E |
| AC-4 | 管理台：建用户/改角色/授权（api 真实 / local 演示） | ✅ E2E |
| AC-5 | 存储/LLM/密钥端口化可换（D3） | ✅ StoragePort + ReportGenerator |
| AC-6 | GitHub Pages：介绍/文档/Playground + 部署工作流 | ✅ 构建验证（部署需仓库启用 Pages） |
| AC-7 | 既有六层管道 + 9 报告场景不回归 | ✅ E2E 13 全绿 |

## 4. 交付物
- `packages/auth-core`（+ `./rbac` `./types` 浏览器子路径导出）
- `apps/api`（认证/RBAC/管理端，tsx 运行）
- `apps/web`（AuthContext/登录/管理台/DataClient 双模式/Site 壳）
- `apps/api/Dockerfile`、`apps/web/Dockerfile`、`apps/web/nginx.conf`、`docker-compose.yml`、`.dockerignore`
- `.github/workflows/pages.yml`
- `e2e/tests/auth-rbac.spec.ts`；更新既有 spec 先登录

## 5. 沙箱未验证项（诚实标注）
- `docker compose up` 未在本环境实跑（无 docker daemon/compose 插件）——但 api 的 tsx 运行命令、
  文件持久化、web 的 api/pages 构建均已本地验证。
- GitHub Pages 实际部署未触发——工作流按标准 Pages Actions 编写，需在仓库 Settings→Pages 选 “GitHub Actions”。

## 6. 后续
- Postgres StoragePort 适配器；刷新令牌/登出吊销；审计日志；管理端分页。
- api 模式的对比视图按角色过滤分组；SSO/OIDC。
