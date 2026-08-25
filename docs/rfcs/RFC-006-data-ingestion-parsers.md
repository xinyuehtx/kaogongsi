# RFC-006：数据接入层——本地文件 / HTTP 源 + 轨迹解析器插件

| | |
|---|---|
| 状态 | **✅ 已完成**：单测 21（ingest）+ api 集成；六层管道端到端跑通 |
| 需求序号 | 006 |
| 层 | L1 接入/适配（真实数据源 + 格式插件） |
| 上游依赖 | 契约⓪ CanonicalSignal；喂给 L2/L3…（已贯通） |
| 关联 | D9.2 连接器隔离、D3 端口化、A6 防腐窄边界 |

---

## 1. 目标（用户四点 + 追加）

1. **本地文件源**：遍历文件夹收集 trajectory。
2. **HTTP 源**：拉取 trajectory，参数含**时间范围 / tag / 自定义 header / 分批拉取**。
3. **多格式解析**：claude-code / codex / deepseek(harness) / opencode / qoder / trae / traework / qwenwork / workbuddy，**追加** langfuse / langsmith / harbor trace。
4. **解析器 = 插件**，由**部署容器选配**。

## 2. 设计（`packages/ingest`）

```
源(TrajectorySource) → RawTrajectory[] → 解析器插件(TrajectoryParser) → ParsedTrajectory[]
  → trajectoriesToSignals → CanonicalSignal[](契约⓪) → L2 血缘 → L3 指标 → L4/L5/L6
```

### 2.1 源（TrajectorySource）
- **FileSource(dir)**：递归遍历 `.json/.jsonl`（每文件一条轨迹；文件夹名作 tag，路径推断格式提示），支持**时间范围**(mtime) / **tag** 过滤 + **分批**(cursor)。
- **HttpSource(endpoint, {headers, param, itemsPath, cursorPath, …})**：分批拉取，查询参数 `from/to/tag/limit/cursor`（参数名可配），**自定义 header**（鉴权），列表/游标字段可配；`collectAll` 自动翻页。

### 2.2 解析器插件（TrajectoryParser）
- 统一 `ParsedTrajectory`：id/format/agent/model/项目·版本线索/tags/verdict/cost/tokens/steps/guardrailHits。
- 通用抽取：消息数组定位 + 候选字段路径 + block 展开（tool_use/tool_result）+ 数组全行扫描（尾部 result 行）。
- **插件清单**：`claude-code · codex · deepseek · opencode · qoder · trae · traework · qwenwork · workbuddy · langfuse · langsmith · harbor` + `generic` 兜底。每个插件 = 探测签名 + FieldMap（消息路径/项目/版本覆盖）。
- **ParserRegistry**：`detect`（自动探测）/ `get`（按 id）/ `parse`（显式格式→探测→兜底）；`createRegistry(enabledIds)` 供部署选配。

### 2.3 映射 + 连接器
- `trajectoriesToSignals`：有 verdict 的轨迹→`success_rate` 逐案例 0/1；护栏命中→逐案例；成本/步数/token/工具成功率→版本级聚合。**只映射轨迹能给出的指标，不臆造**。
- `createIngestConnector({source, registry, query, mapping, format})`：批式 collect→parse→按 `项目(项目线索)`/`版本(版本线索)` 分组→map→实现 `DataConnector`（listProjects/listVersions/fetchSignals）。

### 2.4 部署选配（api）
- `KAOGONGSI_INGEST=file:/path | http(s)://…`（未配置=内置 Mock）。
- `KAOGONGSI_PARSERS=claude-code,langfuse,…`（选配插件，空=全部）。
- `KAOGONGSI_INGEST_HEADERS`(JSON) / `_TAGS` / `_FROM` / `_TO` / `_FORMAT`。
- docker-compose：挂载 `./trajectories:/trajectories` + `KAOGONGSI_INGEST=file:/trajectories`。

## 3. 验收标准

| # | 验收 | 状态 |
|---|---|---|
| AC-1 | 本地文件夹遍历收集轨迹（含分批/时间/tag 过滤） | ✅ |
| AC-2 | HTTP 拉取含时间范围/tag/自定义 header/分批翻页 | ✅ |
| AC-3 | 覆盖 12 种格式插件 + 通用兜底 | ✅ |
| AC-4 | 解析器为插件，部署容器按 env 选配 | ✅ |
| AC-5 | 轨迹→CanonicalSignal→六层管道端到端出指标（success_rate 等） | ✅ api 集成测试 |
| AC-6 | 连接器隔离：ingest 与 mock 同实现 DataConnector，上层零改动（D9.2） | ✅ |

## 4. 交付物
- `packages/ingest`：types / sources(File·Http) / parsers(12+generic) / map / connector（含 11 单测）。
- `apps/api`：`resolveIngestConnector`（env 选配）+ 集成测试。
- `docker-compose.yml`：轨迹卷 + ingest env。

## 5. 诚实标注
- **专有工具真实导出 schema 各异/部分未公开**：采用稳健通用抽取 + 每格式探测签名/FieldMap 覆盖，覆盖常见形态；接真实数据时微调对应 FieldMap 即可，上层与契约不变。
- 眼下 ingest 为**批式**（构建时一次性拉取解析）；流式/增量、大 payload 外置、成本/延迟真实分布为后续。

## 6. 后续
- 流式/增量接入 + 定时轮询；langfuse/langsmith 官方 SDK 分页对接；按格式的评分/verdict 提取增强；轨迹→L2 真实血缘（步级下钻）。
