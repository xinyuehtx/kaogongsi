# RFC-003：做实 L4 归因引擎 + L5 决策引擎（连接器降级为证据源）

| | |
|---|---|
| 状态 | **✅ 已完成**：BDD+TDD 逐层通过，E2E 9 场景绿 |
| 需求序号 | 003 |
| 层 | L4 归因 + L5 决策（真实计算）+ L1 连接器读侧重构 |
| 上游依赖 | 契约② MetricCaseBundle（已有）→ 契约③ AttributionResult → 契约④ DecisionRecord |
| 关联 | `DECISIONS.md` D7/D8/D9；公理 A1/A4/A7 |

---

## 1. 为什么做这个（问题）

RFC-001/002 里 `MockConnector` **直接吐一份烤好的 `DecisionRecord`（内嵌 `AttributionResult`）**，跳过了 L3/L4/L5 的真实计算。后果：**L4（归因）与 L5（决策）在实现上不存在、边界不可见**，「问题归因到谁」与「据此要不要继续」糊成一团。

本需求把中间层做实的最小垂直切片:**连接器降级为纯证据源**，归因与决策交给两个独立引擎计算，让两层的职责与契约缝物理可见。

## 2. L4 vs L5 的界定（本 RFC 的核心澄清）

| | L4 归因 | L5 决策 |
|---|---|---|
| 回答 | 结果/问题**是谁的**（技术/产品/运营） | **据此要不要**继续/放量 |
| 输入 | 契约② `MetricCaseBundle`（指标+案例+血缘） | 契约③ `AttributionResult` + 护栏/结果 KPI |
| 输出 | 契约③ `AttributionResult`（分布+置信度+可下钻） | 契约④ `DecisionRecord`（门禁+推荐+依据+敏感性+反对证据） |
| 性质 | 描述性（因果解释，案例驱动，铁律） | 规范性（套门槛/redline/政策，人拍板 D8.2） |

**同一份归因可导出不同决策**：技术 60% 且护栏健康 → GO「继续修」；技术 60% 但破 redline → NO-GO「先止血」。L4 不管政策，L5 才引入门槛/财务/redline。

## 3. 设计

### 3.1 连接器降级（L1）
- 移除 `fetchVersionReport`（吐烤好的 report），改 `fetchEvaluation(p,v) → VersionEvaluation{version, kpis, bundles}`。
- `MockConnector` 从每版本 KPI **合成 MetricCaseBundle**：按「相对目标的欠缺」定失败案例数（`fail`/`pass`），护栏破线→全 fail；`metric-only`→无案例（D9.3）。
- 连接器不再产出 decision/attribution（层间隔离，D9.2）。

### 3.2 L4 归因引擎 `packages/l4-attribution`
- `buildAttribution(evaluation) → AttributionResult`。
- **案例驱动**：责任方份额 = 各方失败案例加权占比（fail=1/partial=0.5）；映射见 `PARTY_OF`（质量+护栏→技术、产品→产品、财务→运营）。
- **铁律**：每份归因挂支撑指标+案例；无失败按先验（技术 .5/产品 .3/运营 .2），仍挂通过案例作证据；`metric-only`→粗粒度+`drillable=false`+置信度封顶 low。

### 3.3 L5 决策引擎 `packages/l5-decision`
- `decide(attribution, kpis) → DecisionRecord`。门禁政策：破线→NO_GO / 低置信→ABSTAIN / 成功率<60→ABSTAIN / 否则 GO。
- 产出 assurance case：rationale（归因短语+关键指标）、敏感性（置信度）、反对证据（30 日留存长期锚 A8）、假设；**人工拍板**（D8.2）。

### 3.4 组合管道（L6）
- `l6-report.assembleVersionReport(evaluation)`：`buildAttribution → decide → VersionReport`，把 L4/L5 两步显式串起。
- api `/report/version`、`/report/compare` 与 web `dataSource` 改走 `fetchEvaluation → assembleVersionReport`。RFC-001 `/report/exec`（legacy 烤好路径）保留不动。

## 4. 验收标准

| # | 验收 | 对应 |
|---|---|---|
| AC-1 | 连接器只吐证据（VersionEvaluation），不含 decision/attribution | D9.2 |
| AC-2 | L4 按失败案例算三方分布，和为 1，每份挂案例 | D9.3 铁律 |
| AC-3 | L4 metric-only ⇒ 粗粒度 + drillable=false + 低置信 | D9.3 |
| AC-4 | L5 破线→NO_GO / 低置信或未达阈→ABSTAIN / 否则 GO | D8 |
| AC-5 | exec dashboard 的 decision 由 L4+L5 **计算**得出（非烤好）；E2E 全绿 | 本需求核心 |
| AC-6 | 各包独立可测；l4/l5 纯函数无 IO | 层独立存活 |

## 5. 交付物
- `@kaogongsi/contracts`：`VersionEvaluation` + `DataConnector.fetchEvaluation`
- `packages/l4-attribution/`、`packages/l5-decision/`（含单测）
- `packages/l6-report`：`assembleVersionReport`
- `connector-mock`：证据合成 + 契约测试更新
- `apps/api`、`apps/web`：接线计算管道
- 更新 `docs/ARCHITECTURE.md`、`docs/MANUAL.md`、`AGENTS.md`

## 6. 未做（后续）
- L3 指标计算（Cost-of-Pass/pass^k/CI 从原始样本算）、L2 真实血缘图、反事实验证（REFLECT）。
- 归因权重可配置、责任方映射可配置。
- RFC-001 legacy `/report/exec` 迁移到计算管道。
