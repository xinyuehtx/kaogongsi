# RFC-012：可信指标深化（真实分布 / 分层 / pass^k 实测）+ 反事实验证

| | |
|---|---|
| 状态 | **✅ 已完成**：metrics 15 · attribution 7 · ingest 12 单测 + E2E 15；全绿 |
| 需求序号 | 012 |
| 层 | L3 计算 · L4 归因（+ L1 接入侧信号、L6 呈现） |
| 关联 | 痛点 **P1 指标不可信** / **P2 说不清原因**；公理 A4（不确定性）· T56（分层报告）· T57（REFLECT 反事实） |

---

## 1. 为什么

六层贯通后（RFC-004），指标虽从信号算出，但**深度不足**：
- Cost-of-Pass 由上游预汇总，看不到**真实成本分布**；
- 延迟只有单读数，没有**分位数**；
- pass^k 用 `rate^k` **外推**（假设各次运行独立）——这正是 P1 最容易骗人的地方；
- 只有整体值，**整体 72% 会掩盖 hard 层 15%**（T56）；
- 归因给了分布与置信度，但 `counterfactualVerified` 字段一直**空着**（T57 未落地）。

## 2. L3 深化

### 2.1 聚合口径显式化
`MetricDef.aggregation`：`rate | mean | cost_per_pass | p50 | p95 | p99`（缺省：`caseBased→rate`，否则 `mean`）。
单条读数时一律回落 `mean`——**BI/metric-only 来源行为不变**（向后兼容）。

### 2.2 真实成本分布 → Cost-of-Pass
`cost_of_pass` 标 `cost_per_pass`：接入方发**逐案例成本信号**（observation=成本，verdict=通过/失败），
L3 算 `总成本 / 通过数`。ingest 已改为逐案例发送（不再上游预汇总）。

### 2.3 延迟分位数
`latency_p95` 标 `p95`：取值=p95，并附 `distribution { p50, p95, p99 }`（线性插值 `percentile()`）。

### 2.4 pass^k 实测（P1 核心）
`passHatKFromRuns(cases, k?)`：按 `caseId` 分组，**同一用例的多个 `runId` = 重复运行**；
一个用例只有 **k 次全过** 才计入分子；k 缺省=实际最小重复次数。
- 有重复运行 → 用实测值，KPI 标 `passHatKFromRuns: true`；
- 无重复运行 → 回落通过率/幂次外推（`passHatK` 仍保留，但注明是**独立性假设**）。

### 2.5 分层指标（T56）
信号带 `stratum`（难度/场景/租户…），L3 按同一聚合口径产出 `Kpi.strata[{key,value,nSamples}]`，
展示序 `easy<medium<hard`。接入侧约定式标签：`difficulty:hard` / `stratum:x` / `tier:x`，
或用 `mapping.stratumFrom` 覆盖。

## 3. L4 反事实验证（T57）

**充分性检验**：对每个责任方 P，假设"修好 P"（其失败案例视为通过），
若**残余问题 ≤ 20%** → `counterfactualVerified = true`（P 单独就能解释绝大部分问题）。
- 单因主导（技术 4/5）：残余 20% → 标注 ✓
- 双因并存（各 50%）：残余 50% → **都不标注**（避免把"相关"当"因果"）
- 无失败（先验分布）：不做标注（无问题可"修"）

`AttributionResult.counterfactualMethod` 写明这是**数据级**反事实，**不是重跑执行器**——
真正的 REFLECT 重跑需要执行层，列为后续。

## 4. 呈现（L6）

新增 **「分层指标（诊断）」** 分区：每指标给整体值 + 各层值/样本量 + **最差层差距**；
web `ExecDashboard` 渲染分层卡片，**最差层标红**。分层是**诊断视角**，门禁仍看整体与护栏（D11/A1）。

## 5. 验收标准

| # | 验收 | 状态 |
|---|---|---|
| AC-1 | Cost-of-Pass 由真实逐案例成本算出（总成本/通过数） | ✅ metrics + ingest 端到端 |
| AC-2 | 延迟给 p50/p95/p99 分布，p95 参与护栏判定 | ✅ |
| AC-3 | 有重复运行时 pass^k **实测**，并标明口径；否则回落 | ✅ |
| AC-4 | 分层指标暴露"整体掩盖某层"（demo：整体 72% / hard 15%） | ✅ + E2E |
| AC-5 | 反事实：单因标注、双因都不标注、无失败不标注 | ✅ 3 单测 |
| AC-6 | 单读数/BI 来源行为不回归 | ✅ 专项单测 + 全量 E2E |

## 6. 诚实标注

- **反事实是数据级充分性检验**，非重跑；REFLECT 真重跑需执行层（后续）。
- 分层标签依赖接入方约定（`difficulty:` 等）或 `stratumFrom`；无标签则不产分层（不臆造）。
- `connector-mock` 仅**打分层标签**、不改变任何整体取值（坏结果集中到 hard 层以保证语义一致）；
  成本/延迟在 mock 仍是聚合读数，真实分布走 ingest。
- pass^k 的 k 由数据决定（最小重复次数），未做统计功效校正。

## 7. 后续
- REFLECT 真重跑（需执行层/沙箱）；分层显著性（各层 CI 而非仅点值）；成本-质量 Pareto；
  pass^k 的无偏估计与功效校正；分层门禁策略（是否允许某层单独破线）。
