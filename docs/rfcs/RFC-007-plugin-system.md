# RFC-007：全链路插件系统（L1-L6 跨层贡献 + UI DSL + NoSQL/Redis 存储）

| | |
|---|---|
| 状态 | **✅ 已完成**：plugin-core 9 + 示例 1 + report-llm 3 + api 15 单测；E2E 14 |
| 需求序号 | 007 |
| 层 | 横切（一个插件可向 L1-L6 任意层贡献能力） |
| 关联 | D3 端口化、D9.2 隔离、A6 防腐；RFC-006（数据源）/RFC-005（企业化） |

---

## 1. 目标（用户）

- L1：可拉取 HTTP 源的数据源。
- L2：LLMProvider 插件（可用 Vercel AI SDK）。
- L3：标准指标插件，计算并向下游输出指标。
- L4-L5：外部数据源（财务/BI 指标）设置。
- L4-L6：Skill 模板进行 LLM 生成指导。
- **一个插件可提供 L1-L6 任意层级组件**。
- 插件可提供 **UI DSL**（描述展示 + 声明存储字段），把用户输入入库（**NoSQL + Redis**）。

## 2. 设计（`packages/plugin-core`）

### 2.1 插件清单（跨层）
```ts
interface Plugin {
  id; name; version; layers: LayerTag[];
  dataSources?   // L1：create(config) → TrajectorySource（HTTP/File…）
  llmProviders?  // L2：LlmProvider（contracts 端口）
  metrics?       // L3：MetricDef(+可选 derive 派生信号)
  externalData?  // L4-L5：fetch(query) → Kpi[]（财务/BI，按 group 并入）
  skills?        // L4-L6：SkillTemplate（{{占位符}} 提示词）
  forms?         // UI DSL：表单（字段 → 用户输入）
  storage?       // 入库声明：collection + 字段 + 可选 Redis TTL
}
```

### 2.2 PluginHost
分类聚合各层贡献；`mergedCatalog(base)`（并入插件指标）、`applyDerivations(signals)`、`fetchExternalData(query)`、`llmProvider(id?)`、`skill(id)`、`forms()`、`storageSchemas()`。**一个插件同时贡献多层，宿主按能力拆分暴露**。

### 2.3 UI DSL + 存储（NoSQL + Redis）
- `UiForm/UiField`（text/textarea/number/toggle/select/secret）声明展示与输入。
- `StorageSchema`（collection + 字段 + `cache.ttlSeconds`）声明入库。
- 端口：`DocumentStore`（NoSQL，权威）+ `KvStore`（Redis，带 TTL 缓存）+ 内存实现；`PluginDataService.save/load`：写文档 +（配了 TTL 则）写缓存，仅存声明字段，load 缓存优先。生产换 Mongo/Redis 适配器，上层零改动。

### 2.4 LLM Provider（L2）+ Skill（L4-L6）
- `contracts.LlmProvider`（`generateText`）为共享端口；`MockLLMProvider`（离线默认）；`plugin-aisdk` 用 **Vercel AI SDK** 实现（注入 LanguageModel）。
- `contracts.SkillTemplate` + `renderSkill` 填充 `{{var}}`；`report-llm.LlmProviderReportGenerator` 用 provider + skill 生成对比报告。

### 2.5 管道接线
- L3 `computeEvaluation(version, signals, catalog)` 接受合并目录 → 插件指标进 KpiSet。
- api 报告管道：`host.mergedCatalog` + `applyDerivations` + `externalData` 并入 → 六层照常。
- api 端点：`GET /api/plugins`（清单 + UI DSL）、`GET/POST /api/plugins/data/:collection/:id`（入库/读回，写仅管理员）。
- web：管理台「插件」页按 UI DSL 渲染表单并保存入库（api 模式）。

## 3. 验收标准

| # | 验收 | 状态 |
|---|---|---|
| AC-1 | 插件可贡献 L1（HTTP 源） | ✅ example dataSource |
| AC-2 | L2 LLMProvider 插件（Vercel AI SDK） | ✅ plugin-aisdk（编译校验；运行需模型/网络） |
| AC-3 | L3 指标插件计算并向下游输出 | ✅ mergedCatalog + derive |
| AC-4 | L4-L5 外部财务/BI 数据设置 | ✅ externalData 并入财务/产品分区 |
| AC-5 | L4-L6 Skill 模板指导 LLM 生成 | ✅ SkillTemplate + LlmProviderReportGenerator |
| AC-6 | 一个插件跨 L1-L6 | ✅ plugin-example |
| AC-7 | UI DSL 声明展示 + 存储字段，用户输入入 NoSQL+Redis | ✅ DSL + PluginDataService + api/web |

## 4. 交付物
- `packages/plugin-core`（宿主/DSL/存储端口/Mock provider/skill）+ `plugin-example`（跨层）+ `plugin-aisdk`（AI SDK）。
- `contracts`：LlmProvider/SkillTemplate。`l3`：目录注入。`report-llm`：LlmProviderReportGenerator。
- `apps/api`：插件宿主接线 + /api/plugins(+data) 端点。`apps/web`：插件面板（DSL 渲染/入库）。

## 5. 诚实标注
- **Redis/NoSQL 生产适配器未接**：默认内存实现（DocumentStore/KvStore 端口就绪，生产换 Mongo/ioredis）。
- **AI SDK 在线调用未验证**：plugin-aisdk 仅编译校验，运行需注入模型 + 网络/密钥。
- 插件目前**编译期注册**（defaultPlugins）；动态加载/沙箱隔离/版本依赖为后续。

## 6. 后续
- 动态插件加载（从目录/包发现）+ 能力权限与沙箱；Mongo/Redis 适配器；UI DSL 扩展（展示型面板、图表 DSL）；Skill 市场。
