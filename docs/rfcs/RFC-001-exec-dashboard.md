# RFC-001：对上高管 Dashboard（L6 报告层，自顶向下第一层）

| | |
|---|---|
| 状态 | **✅ 已完成（2026-08-24）**：全层 BDD+TDD 通过，E2E 5 场景绿 |
| 需求序号 | 001 |
| 层 | L6 呈现/路由（对上视角）+ 连接器标准接口（L1 读侧雏形） |
| 上游依赖 | 契约④ `ReportView`/`DecisionRecord` + **连接器标准接口**（本需求提供 `MockConnector` 实现，不依赖真实 L1-L5） |
| 关联总 RFC | `~/Documents/docs/e2e-evals/rfc/RFC.md` §4.2/§7/§13；`DECISIONS.md` D6/D7/D8/D9 |
| v2 变更 | ① exec 视图增加产品/质量 KPI（不止财务）② mock 改为**标准连接器 + MockConnector 实现**；UI 配置「数据←连接器」，渲染时视图主动拉取 |

---

## 1. 为什么先做这个

按项目主轴（D7），最终要回答老板「**值不值得继续**」。自顶向下先把**对上结论呈现**做出来：
1. 先对齐"结论长什么样"，避免下层白算。
2. **验证"上下游隔离"**：L6 只依赖契约 + 连接器接口，用 `MockConnector` 就能独立存活、独立测试、独立演示。
3. **顺带把"连接器"这条 D9.2 主动脉在读侧立起来**：所有数据都经**标准连接器接口**进来，mock 只是第一个实现，将来 BI/Langfuse/L5 换实现即可，视图零改动。

## 2. 范围

### 做（In scope）
- **连接器标准接口**（`@kaogongsi/contracts` 内新增 `DataConnector`）：视图不关心数据从哪来，只经此接口拉。
- **`packages/connector-mock`**：`MockConnector` —— 本阶段的连接器实现（返回 fixture DecisionRecord + 各 KPI）。**"本阶段 mock 数据 = 连接器的一个实现"**。
- `packages/l6-report`：`buildExecReportView(decision, kpis) → ReportView(audience='exec')`（受众重写，T66）。
- `apps/web`：高管 Dashboard，**渲染时经配置的连接器主动拉数据**，展示：
  - **三态门禁**徽标 GO/NO-GO/ABSTAIN + 一句话推荐
  - **归因分布** 技术/产品/运营 三段 + 各自置信度（D8.1）
  - **质量 KPI**：任务成功率、pass^k 可靠性、回归数
  - **业务/产品 KPI**：采用率、留存、满意度、任务量、自足完成率
  - **财务 KPI**：Cost-of-Pass、ROI、成本-质量
  - **护栏 KPI**（不能变差、破线红）：幻觉率、拒答率、安全违规率、P95 延迟
  - **决策依据**折叠：rationale + 敏感性 + 反对证据（assurance case，D8.2）
  - **下钻入口**：每数字带"查看证据"；`drillable=false`（连接器能力=metric-only）时禁用并标"低证据级、不可下钻"（D9.3）
- `apps/api`：`GET /api/report/exec`（服务端也走连接器；本阶段注入 MockConnector）。
- **UI 数据源绑定配置**：声明「section/KPI ← 哪个连接器」，渲染时按配置拉取。

### 不做（Out of scope）
- 真实 L1-L5、真实 BI/Langfuse 连接器（本需求只 MockConnector）
- 产品/工程师视角 Dashboard（后续需求）
- 真实下钻到证据链（需 L2）
- 图表库高级可视化（本需求见 §7 待确认）

## 3. 设计

### 3.1 连接器标准接口（本需求的架构核心）
```ts
// @kaogongsi/contracts
export interface ConnectorCapabilities {
  evidenceLevel: EvidenceLevel;   // 该连接器能提供的最高证据级
  drillable: boolean;             // 能否下钻到证据（metric-only → false）
}
export interface ReportQuery { experimentId: string; /* 时间窗/切片等后续扩展 */ }

export interface DataConnector {
  id: string;
  kind: 'mock' | 'langfuse' | 'bi' | 'l5-decision' | string;
  capabilities(): ConnectorCapabilities;
  fetchDecision(q: ReportQuery): Promise<DecisionRecord>;
  fetchKpis(q: ReportQuery): Promise<KpiSet>;   // 见 §3.3
}
```
- **这是 D9.2 的读侧落地**：视图/`api` 只依赖 `DataConnector` 接口，不依赖任何具体来源。
- **MockConnector 是 `DataConnector` 的一个实现**；将来 `LangfuseConnector`/`BiConnector`/`L5Connector` 实现同接口即插即换，**l6-report 与 web 零改动**（AC 会验证这条）。

### 3.2 数据流（本需求）
```
UI 配置: { exec 视图 ← connectorId 'mock' }
   → 视图渲染时: connector = registry.get(config.connectorId)
   → connector.fetchDecision(q) + connector.fetchKpis(q)      # 主动拉取
   → l6-report.buildExecReportView(decision, kpis) → ReportView
   → <ExecDashboard/> 渲染；capabilities().drillable 决定下钻是否可用
```
**隔离缝 = `DataConnector` 接口**。换真实来源＝换一个实现类。

### 3.3 KPI 目录（从常见 Agent 产品 + evals 提炼，填入 exec 视图）
```ts
export interface Kpi { key: string; label: string; value: number; unit: string;
  trend?: 'up'|'down'|'flat'; guardrailBreached?: boolean;
  diagnostic?: boolean;  // true=诊断/效率用，非 pass/fail 打分（D11/A1）
  signalOnly?: boolean;  // true=仅排查信号，不作门禁（如 Right Tool Rate）
  sourceLineage: string[]; }
export interface TrajectoryKpis {           // 过程质量（诊断，非打分）
  efficiency: Kpi[];         // Steps to Success / Token Efficiency / Tool Utilization(成功率)
  decisionQuality: Kpi[];    // Right Tool Rate(signalOnly) / Redundant Call Rate / Recovery Rate
  planningQuality: Kpi[];    // Plan Coherence / Plan Adaptation / Goal Preservation(防目标漂移)
  interactionQuality: Kpi[]; // Clarification Necessity / Information Density / User Effort
  stability: Kpi[];          // Variance across Runs / Failure Cascade
}
export interface KpiSet {
  quality:   Kpi[];  // 成败结果：任务成功率 / pass^k 可靠性 / 回归数
  product:   Kpi[];  // 采用率 / 留存 / 满意度 / 任务量 / 自足完成率
  financial: Kpi[];  // Cost-of-Pass / ROI / 成本-质量
  guardrail: Kpi[];  // 幻觉率 / 拒答率 / 安全违规率 / P95 延迟（破线标红）
  trajectory: TrajectoryKpis;  // 过程质量五类（诊断，进"过程质量"折叠区）
}
```

**成败结果层（决定成败，可作门禁）**
| 组 | 指标 | 依据 |
|---|---|---|
| 质量 | 任务成功率、**pass^k**、回归数 | evals 核心 + A4/T18 |
| 产品 | 采用率、**留存**、满意度、任务量、自足完成率 | Agent 产品通用 + A8 长期锚 |
| 财务 | Cost-of-Pass、ROI、成本-质量 | T64 |
| 护栏 | 幻觉率、拒答率、安全违规率、P95 延迟 | A8 guardrail / T65 |

**过程质量层（轨迹级 5 类，⚠️ 诊断/效率用，非打分 —— D11/A1；进"过程质量"折叠区）**
| 类 | 指标 |
|---|---|
| 效率 | Steps to Success（越少越好）· Token Efficiency（单位任务 token）· Tool Utilization（调用**成功率**非次数） |
| 决策质量 | Right Tool Rate（对金标轨迹，**仅信号非门禁**：一任务多正确路径）· Redundant Call Rate · Recovery Rate（出错自恢复） |
| 规划质量 | Plan Coherence（规划↔执行一致）· Plan Adaptation（中途调整合理性）· Goal Preservation（防目标漂移） |
| 交互质量 | Clarification Necessity（追问是否必要）· Information Density（每轮信息量）· User Effort（打字量/决策次数） |
| 稳定性 | Variance across Runs（同输入多跑一致性，即 A4 noise floor）· Failure Cascade（局部错→全局失败） |

> **exec 呈现约定**：成败结果 + 归因 + 门禁 + 护栏为**头部主区**；过程质量 5 类进**可折叠的"过程质量（诊断）"区**，每项标"诊断非打分"，Right Tool Rate 额外标"信号非门禁"。避免高管被 20+ 指标淹没，又能按需下探。

### 3.4 隔离与独立存活
- `connector-mock` 只依赖 contracts；`l6-report` 只依赖 contracts。互不依赖。
- 各自 fixture + 单测，`pnpm --filter` 独立绿。

## 4. 测试策略（BDD + TDD）

### 4.1 BDD 场景
```
场景: 高管一眼看到结论 + 四组 KPI
  假设 MockConnector 提供一份 GO 决策 + 质量/产品/财务/护栏 KPI
  当 高管打开 Dashboard（视图经连接器拉取）
  那么 显示 GO 徽标、归因三段(带置信度)、四组 KPI 卡

场景: 护栏破线标红
  假设 幻觉率超阈值(guardrailBreached=true)
  当 查看护栏组
  那么 该指标显示红色告警

场景: 连接器能力=metric-only 时不伪装可信（D9.3）
  假设 连接器 capabilities().drillable=false
  当 打开 Dashboard
  那么 下钻按钮禁用 + 标"低证据级、不可下钻"

场景: 换连接器实现，视图零改动（隔离性）
  假设 用一个"假 L5 连接器"（同接口，返回不同数据）替换 MockConnector
  当 视图用新连接器渲染
  那么 l6-report 与 web 组件代码不变，页面正常显示新数据
```

### 4.2 测试分层
- **TDD**：`connector-mock` 与 `l6-report` 各自先写失败测试→实现→绿。
- **连接器契约测试**：一套针对 `DataConnector` 接口的通用测试，MockConnector 必须通过（将来任何连接器都跑这套 → 保证可替换）。
- **api**：inject `GET /api/report/exec`（注入 MockConnector）。
- **E2E/Playwright**：`exec-dashboard.spec.ts` 覆盖上面四场景。

## 5. 验收标准

| # | 验收 | 对应 |
|---|---|---|
| AC-1 | exec ReportView 含 门禁/归因/质量/产品/财务/护栏/依据 七类 section | T66 + 本次新增 |
| AC-2 | 归因三段和为 1 且各带置信度 | D8.1 |
| AC-3 | 护栏指标 guardrailBreached=true 时 UI 标红 | A8 |
| AC-4 | drillable=false 时标"不可下钻"且按钮禁用 | D9.3 |
| AC-5 | 决策依据含 rationale + 敏感性 + 反对证据 | D8.2 |
| AC-6 | **视图经 `DataConnector` 接口拉数据，不直连 fixture** | D9.2 连接器 |
| AC-7 | **换一个同接口的假连接器，l6-report 与 web 零改动即显示新数据**（隔离性证明） | 上下游隔离 |
| AC-8 | 连接器契约测试通过；MockConnector 是 `DataConnector` 的合法实现 | 可替换 |
| AC-9 | Playwright E2E 四场景全绿 | UI 硬要求 |
| AC-10 | connector-mock 与 l6-report 各自独立可测可绿，互不依赖 | 层独立存活 |

## 6. 交付物
- `@kaogongsi/contracts` 新增 `DataConnector`/`ConnectorCapabilities`/`ReportQuery`/`Kpi`/`KpiSet`
- `packages/connector-mock/`（MockConnector + fixture + 单测 + 契约测试）
- `packages/l6-report/`（buildExecReportView + 单测）
- `apps/api` 路由 + inject 测试
- `apps/web` ExecDashboard + KPI 组件 + 连接器注册/配置
- `e2e/tests/exec-dashboard.spec.ts`
- 完成后：归档本 RFC/US-001，更新 `docs/ARCHITECTURE.md`(L2)、`docs/MANUAL.md`(L2)

## 7. 评审结论（2026-08-24 已确认）
1. **KPI 目录**：✅ 确认，并**新增交互质量 + 完整轨迹级 5 类**（§3.3 过程质量层），诊断非打分。
2. **图表库**：✅ 本版用最简 DOM 条形/卡片，后续需求再引图表库。
3. **连接器接口**：✅ `fetchDecision` + `fetchKpis` 两方法。
4. **数据源绑定**：✅ 本版前端配置文件，UI 可视化配置留后续需求。
