# RFC-004：贯通 L1→L3（信号 → 血缘 → 可信指标），六层打通

| | |
|---|---|
| 状态 | **✅ 已完成**：BDD+TDD 逐层通过，E2E 9 场景绿 |
| 需求序号 | 004 |
| 层 | L1 接入（归一化信号）+ L2 证据/血缘 + L3 计算（可信指标） |
| 上游依赖 | 契约ⓠ CanonicalSignal → 契约① Provenance 查询 → 契约② MetricCaseBundle |
| 关联 | `DECISIONS.md` D9（血缘/证据级）；公理 A1/A4/A7；痛点 **P1 指标可信**/P2 可下钻 |

---

## 1. 为什么做这个

RFC-003 把 L4/L5 做实后，中间仍是空的：`MockConnector` 直接**合成 MetricCaseBundle**，跳过了「原始信号 → 血缘 → 指标」。后果：指标没有样本与置信区间（P1 指标可信无从谈起），也没有可下钻的证据图（P2）。本需求把 **L1/L2/L3 一次补齐**，让数据从原始信号一路算到指标，六层贯通。

## 2. 设计

### 2.1 契约ⓠ Canonical Signal（L1 出口）
- `CanonicalSignal` 增 `metricKey / observation / verdict`：任何来源（执行器/BI/评测平台）都把「某指标的一次观测」归一到此。
- 连接器 `fetchSignals(p,v) → VersionSignals{version, signals}`，**只取证据、不算指标/归因/决策**。
- **指标目录 `METRIC_CATALOG`**（contracts）：25 个指标的单一事实源（group/betterWhen/caseBased/target/guardrailThreshold），各层共享词汇。

### 2.2 L2 证据/血缘 `packages/l2-provenance`
- `buildProvenance(signals) → ProvenanceQuery`：建 Source→Case→Metric typed 图。
- 契约① 投影查询：`casesForMetric(key)` / `drilldown(caseId)` / `metricKeys()`——报告任一数字沿边反向下钻（T30）。

### 2.3 L3 计算 `packages/l3-metrics`
- `computeEvaluation(version, signals) → VersionEvaluation`：经 L2 血缘，按目录聚合：
  - **case-based**（多 0/1 案例）：值 = 通过/命中率 × 100 + **可复现 bootstrap 置信区间**（A4，P1）。
  - **aggregate**（BI 单读数）：读数即值。
  - 护栏按阈值判 `guardrailBreached`；产 `MetricCaseBundle`（D9.3 必带案例，metric-only 则空）供 L4。
- 统计原语：`bootstrapStd`（种子 PRNG 可复现）、`passHatK`、`costOfPass`。

### 2.4 全管道
```
connector.fetchSignals (L1)
  → buildProvenance (L2)  → computeEvaluation (L3)
  → buildAttribution (L4) → decide (L5)
  → buildExecReportView / buildComparison (L6)
```
api `/report/version`、`/report/compare` 与 web `dataSource` 均改走此管道。

## 3. 验收标准

| # | 验收 | 对应 |
|---|---|---|
| AC-1 | 连接器只吐 CanonicalSignal（含 metricKey/observation/verdict），不含指标/归因/决策 | 契约ⓠ |
| AC-2 | L2 可按指标取案例、按 caseId 下钻，携带血缘与来源 | 契约①/T30 |
| AC-3 | L3 case-based 指标带样本量 + bootstrap 置信区间；可复现 | A4/P1 |
| AC-4 | L3 护栏按阈值判破线；产出 bundle 必带案例（metric-only 除外） | D9.3 |
| AC-5 | exec/对比经 L1→L6 全管道计算；KPI 值与门禁一致，E2E 全绿 | 本需求核心 |
| AC-6 | 各层独立可测；l2/l3 纯函数无 IO（bootstrap 用种子 PRNG） | 层独立存活 |

## 4. 交付物
- `@tengxiaohtx/contracts`：CanonicalSignal 扩展 + METRIC_CATALOG + ProvenanceQuery + fetchSignals
- `packages/l2-provenance/`、`packages/l3-metrics/`（含单测）
- `connector-mock`：fetchSignals 信号合成 + 契约测试更新
- `apps/api`、`apps/web`：接通全管道
- 更新 `docs/ARCHITECTURE.md`、`docs/MANUAL.md`、`AGENTS.md`

## 5. 未做（后续）
- L3 真实成本/延迟分布（当前财务/延迟为聚合读数）、分层指标、pass^k 从多 run 估计。
- L1 真实连接器（Langfuse/Inspect `.eval`/BI）——本需求仍 MockConnector，但 L2/L3 已能消费任何符合契约ⓠ 的信号。
- L2 大 payload 外置引用、跨 run/case 的 W3C baggage 关联。
