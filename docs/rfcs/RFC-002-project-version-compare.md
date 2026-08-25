# RFC-002：项目-版本评测报告与对比 + LLM 对比报告（L6）

| | |
|---|---|
| 状态 | **✅ 已完成**：全层 BDD+TDD 通过，E2E 9 场景绿 |
| 需求序号 | 002 |
| 层 | L6 呈现/路由（对上视角）+ 连接器读侧扩展 + ReportGenerator 端口 |
| 上游依赖 | 契约④ ReportView/DecisionRecord（已有）；本需求新增 ComparisonView / ComparativeNarrative / ReportGenerator |
| 关联 | `DECISIONS.md` D3/D6/D7/D8/D9/D10/D11；公理 A1/A4/A8 |

---

## 1. 为什么做这个

RFC-001 只能看**单一 experimentId 的一份报告**，没有「项目/版本」概念，无法回答产品/高管最常问的两个问题：
1. 这个 Agent 项目**这一版**表现如何？
2. **相对上一版（或某个基线版本）**，是变好还是变差、值不值得放量？

因此把报告**按「项目 → 版本」组织**，并支持**两版本对比**；对比结论**交给 LLM 生成**为可读报告（决策支持，人工拍板 D8.2）。同时把 LLM 出口做成**端口**（D3），默认离线可复现，避免测试/演示依赖外部模型。

## 2. 范围

### 做（In scope）
- **契约扩展**：`ProjectSummary` / `VersionSummary` / `VersionReport`；`MetricDelta` / `ComparisonGroup` / `ComparisonView`；`ComparativeNarrative` + `GenerateComparisonInput` + `ReportGenerator` 端口；`DataConnector` 增 `listProjects/listVersions/fetchVersionReport`；`Kpi` 增 `betterWhen/stdDev/nSamples`（A4）。
- **`packages/l6-compare`**：`buildComparison(project, baseline, candidate) → ComparisonView` 纯函数（方向/显著性/护栏/诊断），`summarizeComparison`。
- **`packages/report-llm`**：`TemplateReportGenerator`（默认离线确定性）+ `OpenAiCompatibleReportGenerator`（可选真实模型）+ `createReportGenerator(env)`。
- **`packages/connector-mock`**：多项目（钉钉AI表格 / 飞书文档）多版本 fixture，含一次**护栏回退版本**；实现三个新方法；默认项目最新版承载 RFC-001 默认报告以兼容旧路径。
- **`apps/api`**：`GET /api/projects`、`GET /api/projects/:id/versions`、`GET /api/report/version`、`POST /api/report/compare`（可选生成叙述，注入 `ReportGenerator`）。
- **`apps/web`**：Tailwind v4 重做；顶栏项目选择 + 单版本/双版本模式 + 版本选择；单版本 exec 视图；对比视图（逐指标 delta + 门禁迁移 + 生成对比报告面板）；深浅色。

### 不做（Out of scope）
- 真实 L1-L5、真实 BI/Langfuse 连接器（仍 MockConnector）。
- 真实下钻到证据链（需 L2）。
- 三个以上版本的多路对比 / 趋势时间线（后续需求）。
- 前端直连真实 LLM（key 只在服务端；前端默认离线模板）。

## 3. 设计

### 3.1 项目/版本模型 + 连接器扩展（D9.2 读侧）
```ts
interface ProjectSummary { id; name; description }
interface VersionSummary { id; projectId; label; createdAt; harnessConfigVersion; evidenceLevel; note? }
interface VersionReport  { version: VersionSummary; decision: DecisionRecord; kpis: KpiSet }

interface DataConnector {
  /* …RFC-001… */
  listProjects(): Promise<ProjectSummary[]>;
  listVersions(projectId): Promise<VersionSummary[]>;
  fetchVersionReport(projectId, versionId): Promise<VersionReport>;
}
```

### 3.2 对比契约（A4：带方向与显著性）
```ts
type DeltaDirection = 'improved' | 'regressed' | 'flat';
interface MetricDelta { key; label; unit; baseline; candidate; delta; deltaPct;
  betterWhen:'higher'|'lower'; direction; significant?; guardrailBreached?; diagnostic?; signalOnly? }
interface ComparisonView { project; baseline; candidate; groups: ComparisonGroup[];
  gateBaseline; gateCandidate; narrative? }
```
- **方向**：按 `betterWhen`（成功率/采用率=higher；护栏/成本/步数=lower；缺省关键词启发式）。
- **显著性**：两版本各带 `stdDev` 时，`|delta| > stdB + stdC`（1σ 区间不重叠近似）；无标准差不下结论。
- **诊断非门禁**：轨迹级 delta 标 `diagnostic`，不计入门禁 improved/regressed（D11/A1）。

### 3.3 LLM 对比报告端口（D3 / D10）
```ts
interface ComparativeNarrative { summary; highlights[]; regressions[]; recommendation; verdict; generatedBy; model? }
interface ReportGenerator { id; generate(input): Promise<ComparativeNarrative> }
```
- **默认** `TemplateReportGenerator`：从 `ComparisonView` 确定性拼报告；verdict 派生（破线→NO_GO / 显著回退→ABSTAIN / 显著改善且无回退→GO）。
- **可选** `OpenAiCompatibleReportGenerator`：OpenAI/LiteLLM 兼容 `base_url` 协议，`temperature=0`+JSON，记录 `model` 以复现。
- `createReportGenerator(env)`：`KAOGONGSI_LLM_*` 配齐→真实；否则→模板。

### 3.4 数据流（本需求）
```
选项目 → listVersions → 选(单版本 | 基线+候选)
 单版本: fetchVersionReport → buildExecReportView → <ExecDashboard/>
 双版本: fetchVersionReport×2 → buildComparison → <ComparisonReport/>
        └─「生成对比报告」→ ReportGenerator.generate → narrative 面板
```

## 4. 验收标准

| # | 验收 | 对应 |
|---|---|---|
| AC-1 | 报告按「项目→版本」组织；可列项目、列版本、取某版本报告 | D7 |
| AC-2 | 单版本 exec 视图与 RFC-001 一致（门禁/归因/四组 KPI/依据） | RFC-001 |
| AC-3 | 两版本对比逐指标给 delta + 方向 + 显著性 | A4 |
| AC-4 | 护栏破线在对比中标红并单列；诊断指标不计入门禁判断 | A8 / D11 |
| AC-5 | 「生成对比报告」产出 summary/highlights/regressions/recommendation/verdict | D8.2 |
| AC-6 | LLM 出口为端口：默认离线模板可复现；env 配齐切真实模型 | D3 / D10 |
| AC-7 | 连接器契约测试覆盖新方法；换连接器视图零改动 | D9.2 |
| AC-8 | metric-only 版本 drillable=false，不伪装可信 | D9.3 |
| AC-9 | Playwright E2E：单版本/对比/生成报告/回退检出/项目切换无残留 全绿 | UI 硬要求 |

## 5. 交付物
- `@tengxiaohtx/contracts` 扩展类型
- `packages/l6-compare/`、`packages/report-llm/`（含单测）
- `packages/connector-mock/` 多项目版本 fixture + 契约测试增补
- `apps/api` 新路由 + inject 测试
- `apps/web` AppShell / ExecDashboard(重做) / ComparisonReport + Tailwind
- `e2e/tests/project-version-compare.spec.ts`
- 更新 `docs/ARCHITECTURE.md`、`docs/MANUAL.md`；新增 `AGENTS.md`、`README.en.md`

## 6. 评审结论
1. **LLM 落地**：端口 + 模板默认 + 可选真实 LLM（用户确认）。
2. **样式基座**：引入 Tailwind v4 + dataviz 校验调色板（用户确认）。
3. **对比语义**：本轮单版本或两版本对比（相对某基线版本）。
