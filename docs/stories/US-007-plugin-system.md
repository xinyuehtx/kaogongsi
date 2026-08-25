# US-007：全链路插件系统（跨层扩展 + UI DSL 入库）

| | |
|---|---|
| 状态 | **✅ 已完成** |
| 关联 RFC | `docs/rfcs/RFC-007-plugin-system.md` |
| 受众 | 平台扩展方 / 集成商 / 管理员 |

---

## 用户故事

> **作为**要把考功司接进自家体系的扩展方，
> **我想要**用一个插件同时补齐「数据源(L1)/LLM Provider(L2)/指标(L3)/外部财务·BI 数据(L4-L5)/
> LLM 生成 Skill(L4-L6)」，并能用 DSL 声明配置界面、把用户填的对接信息入库（NoSQL+Redis），
> **以便于**不改内核就把平台适配到我的数据与流程。

## 验收标准（Given / When / Then）

### AC-1 一个插件跨多层
- **当** 我注册一个插件
- **那么** 它可同时贡献 L1 数据源、L2 LLMProvider、L3 指标、L4-L5 外部数据、L4-L6 Skill，宿主按能力分类暴露

### AC-2 L1 HTTP 源
- **那么** 插件的数据源能创建 HTTP 轨迹源（时间/tag/header/分批）供接入

### AC-3 L2 LLMProvider（Vercel AI SDK）
- **那么** 插件可提供 LlmProvider；`plugin-aisdk` 用 Vercel AI SDK 注入模型即可驱动对比报告生成

### AC-4 L3 指标
- **那么** 插件声明的指标并入指标目录，随信号被计算并进入报告

### AC-5 L4-L5 外部数据
- **当** 我配置财务/BI 插件
- **那么** 其拉取的毛利率/ARR/周活等并入报告对应分区

### AC-6 L4-L6 Skill
- **那么** 插件的 Skill 模板（{{占位符}}）指导 LLM 生成对比/诊断/决策文本

### AC-7 UI DSL + 入库
- **当** 管理员在「插件」页按 DSL 表单填对接信息并保存
- **那么** 数据按声明写入 NoSQL 文档 +（配了 TTL）Redis 缓存，读回一致；非管理员不可写

## 不在本故事内
- 动态插件加载/沙箱/权限；Mongo/Redis 生产适配器（端口就绪，默认内存）；AI SDK 在线联调；图表型 DSL。

## 演示脚本
1. 自托管全栈（api 模式）→ 管理台「插件」→ 见示例插件的「财务系统对接」DSL 表单 → 填写保存（入库）。
2. 打开某项目版本报告 → 财务分区出现插件提供的毛利率/ARR。
3. `plugin-aisdk`：`aiSdkPlugin(openai('gpt-4o-mini'))` 注册后，对比报告由真实模型生成。
4. `pnpm --filter @tengxiaohtx/plugin-core test` 全绿。
