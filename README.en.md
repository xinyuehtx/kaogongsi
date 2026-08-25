# Kaogongsi · End-to-End Agent Evaluation & Attribution Decision Machine

> **Kaogongsi (考功司)** was the imperial bureau — under the Ministry of Revenue (户部) in this project's framing — **charged with appraising officials' merit and performance**. We borrow the name: the appraisal, attribution, and promote/dismiss decisions once applied to officials are here applied to **AI Agents** — their evaluation, root-cause attribution, and go/no-go calls.
>
> Monorepo implementation. 中文见 [README.md](./README.md)。

## What it is

An **evaluation → attribution → decision machine**: ingest evaluation/production signals from all kinds of Agents → compute weighted metrics → attribute outcomes to **Tech / Product / Ops** → give executives a "**is it worth continuing?**" verdict (GO / NO-GO / ABSTAIN) plus a top-level attribution, and give downstream teams routed, actionable triage. **Decision support throughout; humans make the call.**

## Core capabilities

- **Reports organized by Project → Version.** Each Agent project has multiple versions; each version is one evaluation run (metrics + attribution + decision).
- **Single-version report:** tri-state gate + attribution split (Tech/Product/Ops with confidence) + Quality/Product/Financial/Guardrail KPIs + process quality (diagnostic) + decision rationale (with counter-evidence).
- **Two-version comparison:** per-metric deltas **relative to a chosen baseline version** (direction / significance / guardrail breach), with the gate transition made obvious.
- **LLM-generated comparison report:** hand the comparison to an LLM (offline deterministic template by default; swappable to a real OpenAI-compatible model) to produce "summary / improvements / regressions / recommendation".

## User flow

```
Upstream pipeline produces metric data (here: MockConnector multi-project/version fixtures)
        │
        ▼
Choose: single-version report  OR  pick two versions to compare
        │
        ▼
(Compare) click "Generate comparison report" → LLM/template verdict & advice (human decides)
```

## Architecture: 6 layers + 5 contracts (layer isolation)

Every layer is an independent package depending only on the **stable contracts** below (`@tengxiaohtx/contracts`) — independently testable, independently alive. Swap an implementation without touching the contract; upper layers are unaffected.

| Layer | Package | Upper-edge contract |
|---|---|---|
| L6 Presentation/Routing | `apps/web` · `packages/l6-report` · `packages/l6-compare` · `packages/report-llm` | ReportView / DecisionRecord / ComparisonView / ComparativeNarrative |
| L5 Decision | `packages/l5-decision` | AttributionResult |
| L4 Attribution | `packages/l4-attribution` | MetricCaseBundle |
| L3 Compute | `packages/l3-metrics` | Provenance query |
| L2 Evidence/Lineage | `packages/l2-provenance` | CanonicalSignal |
| L1 Ingest/Adapt | `packages/connector-mock` (+ future BI/Langfuse/L5) | — |
| Contracts (cross-cutting) | `packages/contracts` | the five seam types + metric catalog |

> **All six layers are wired**: `fetchSignals(L1)` → `provenance(L2)` → `trustworthy metrics(L3, with bootstrap CI)` → `attribution(L4)` → `decision(L5)` → `report(L6)`.

> **Pluggable data source:** `DataConnector` is the read-side seam; MockConnector is just the first implementation. Wiring a real BI/Langfuse/eval platform = a new connector, zero view changes.
> **Swappable LLM:** `ReportGenerator` is the model-gateway port — offline template by default, real model via env.

## Non-negotiables (enforced across the codebase)

- Views depend only on `DataConnector`, never on fixtures directly (source isolation).
- Attribution must carry metrics + cases + lineage; `metric-only` sources are marked "low-evidence, not drillable" and never masquerade as a full report.
- Comparisons/verdicts carry direction and significance — no bare-score comparison.
- Trajectory-level metrics are diagnostic, never pass/fail gates.
- The framework recommends; it never auto-executes irreversible decisions.

## Tech stack (popular OSS)

pnpm workspaces + Turborepo · TypeScript (strict) · Fastify (api) · React 19 + Vite + **Tailwind v4** (web) · Vitest (unit/BDD) · Playwright (E2E).

## Develop

```bash
pnpm install
pnpm test            # all unit tests
pnpm typecheck
pnpm build
pnpm e2e             # Playwright E2E (auto build + preview web)

pnpm --filter @tengxiaohtx/api dev     # backend :3001
pnpm --filter @tengxiaohtx/web dev     # frontend :5173
```

Open `http://localhost:5173`: pick a **project** in the top bar, toggle **single-version / two-version compare**; in compare mode pick **baseline** and **candidate**, then click **Generate comparison report**. Light/dark toggle included.

### Optional: real LLM

```bash
export KAOGONGSI_LLM_BASE_URL=http://localhost:4000/v1   # OpenAI-compatible / LiteLLM proxy
export KAOGONGSI_LLM_API_KEY=sk-xxx
export KAOGONGSI_LLM_MODEL=gpt-4o-mini
# server-side POST /api/report/compare { generateNarrative:true } then uses the real model;
# unset → offline deterministic template
```

## Enterprise (accounts / roles / full stack / Pages)

Self-hostable full stack + account system (Langfuse-style):

```bash
docker compose up --build     # or: pnpm stack:up
# http://localhost:8080 — the first registered user becomes admin
```

- **Accounts / roles**: `admin / tech / finance / bi`. Admin manages users, roles, and per-project grants in the console.
- **Project authorization**: non-admins see only granted projects; **role decides visible report sections**.
- **Ports**: account storage `StoragePort` (JSON-file volume by default, swappable to Postgres); LLM `ReportGenerator` (offline template by default) — never leaked into the core (D3).
- **Two modes**: `api` (real backend auth, self-hosted) / `local` (in-browser demo, no backend) via `VITE_DATA_MODE`.
- **GitHub Pages** (intro + docs + playground): pushing `main` triggers `.github/workflows/pages.yml` (enable Pages → “GitHub Actions” in repo settings).

## Docs

- `AGENTS.md` — collaboration workflow & non-negotiables (read first)
- `docs/rfcs/`, `docs/stories/` — per-feature RFCs & user stories
- `docs/ARCHITECTURE.md`, `docs/MANUAL.md` — living architecture & manual
