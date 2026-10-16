# WorkRate

**Local-first analytics for the real work delivered by AI coding agents.**

WorkRate connects agent *usage* (tokens, sessions, subscriptions, API spend, ccusage exports) to recorded *outcomes* (tasks that were agent-reported, human-accepted and independently verified). You can then compare projects, models, harnesses and time periods on evidence instead of token counts.

Everything runs locally on SQLite. It needs no paid APIs, credentials or cloud services, and no data is ever transmitted.

---

## Quick start

### Docker Compose
```bash
docker compose up --build
# UI   → http://localhost:8080
# API  → http://localhost:8001/api/docs  (OpenAPI / Swagger)
```
Data is stored in the `workrate-data` volume. On an empty database the backend seeds ten weeks of **synthetic** demo data. Set `WORKRATE_SEED_ON_EMPTY=false` to start with no data.

### Development
Requirements: Python 3.11+ and Node 20.19+ with Yarn 1.
```bash
make setup      # venv + yarn install
make backend    # FastAPI on :8001 (migrations run automatically on start)
make frontend   # Vite on :3000, proxies /api → :8001
make test       # backend test-suite (calculations, imports, data integrity, full journey)
make typecheck  # TypeScript
```

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `WORKRATE_DATABASE_URL` | backend | `sqlite:///backend/data/workrate.db` | SQLAlchemy URL |
| `WORKRATE_SEED_ON_EMPTY` | backend | `true` | Seed synthetic demo data when the DB has no tasks |
| `CORS_ORIGINS` | backend | `*` | Comma-separated origins |
| `VITE_API_URL` | frontend | `""` (same origin) | API base URL |
| `WORKRATE_API_PROXY` | frontend dev | — | Dev-server proxy target for `/api` |

> The hosted preview environment (Emergent) also uses `REACT_APP_BACKEND_URL` and `vite.hosted-preview.ts`. Both are inactive unless the platform's environment variables are present, and the local app does not depend on them.

---

## Architecture

```
frontend/  React 19 · TypeScript · Vite · Tailwind v4 · shadcn-style Radix primitives · TanStack Query · Recharts · Zod
backend/
  workrate/
    analytics.py   pure calculations (no DB) — rates, Wilson CIs, cost allocation, uplift, comparisons, drift
    importers.py   pure parsers — ccusage JSON (daily/weekly/monthly/session/blocks) and CSV with column mapping
    pricing.py     built-in editable price table + model-name normalisation
    services.py    DB-backed loading, import dedupe/commit, task edits with history, report assembly
    community.py   synthetic community dataset + local k-anonymous contribution preview
    seed.py        deterministic synthetic demo data
    api.py         versioned REST API (/api/v1)
    models.py      SQLAlchemy 2 models     schemas.py  Pydantic v2 contracts
  migrations/      Alembic
  tests/           pytest
```

The frontend, the API, the analytics and persistence are kept apart. `analytics.py` and `importers.py` contain no database access, so the processing engine can be replaced or reused on its own.

---

## Data model

* **Project · Model · Harness**: reference data. Models carry an editable price per million tokens. A blank price means *unknown*, and WorkRate never guesses one.
* **Task**: a unit of work, with category and difficulty. It has **three independent completion signals**: `agent_reported_complete`, `human_accepted` and `verified`, plus `outcome` (in_progress / delivered / failed / abandoned), human minutes, review minutes, rework cycles, interventions and an optional reference human estimate.
  * Each task also has acceptance criteria, deliverables and evidence (test runs, CI, review, links, notes).
  * Every edit to a tracked field is written to **TaskHistory**, so earlier measurements are kept.
* **UsageRecord**: normalised usage (tokens by type, date, session, billing = subscription | api, reported cost, API-equivalent cost, price status). The original source row is retained in `raw`. A record links to at most one task.
* **Subscription**: actual subscription spend per harness.
* **ImportBatch**: provenance and counts for each import.

**Imported usage never creates tasks.** It counts toward delivered work only after you link it to a task.

---

## How the numbers are calculated

| Metric | Definition |
|---|---|
| Accepted rate | human-accepted ÷ resolved (delivered + failed + abandoned) |
| First-pass success | accepted with 0 rework cycles ÷ resolved |
| Rework rate | accepted with ≥1 rework ÷ accepted |
| Over-claim rate | agent-reported but not accepted ÷ resolved agent-reported |
| Verification rate | verified ÷ accepted |
| Time to accepted outcome | `accepted_at − created_at` (median, p75) |
| Actual spend | API-billed usage at its price, plus subscriptions amortised daily (`monthly × 12 ÷ 365`) and split across that harness's subscription usage on the same day by token share. Days with no usage are reported as unattributable idle cost. |
| API-equivalent cost | tokens × price table. If the model price is unknown, the source-reported cost (e.g. ccusage `cost`) is used and flagged. If neither exists, the cost stays blank and the record is counted as missing. |
| Cost per accepted outcome | all spend in scope, **including failed attempts**, ÷ accepted tasks |

* All rates carry **95% Wilson intervals** and sample sizes.
* **Work Uplift** = reference human minutes ÷ actual human minutes, per accepted task.
  * The reference is user-entered (*high* confidence) or the median of user-entered references in the same category × difficulty (*medium* if there are ≥5 references, *low* if 2–4).
  * Tasks with no usable reference are excluded, not imputed.
  * The result is shown as a median with interquartile range, plus a *portfolio* ratio that charges human time spent on failed attempts.
* **Mix-adjusted comparison** uses direct standardisation of the accepted rate. It covers only the category × difficulty cells that every compared group has observed (≥3 each), and shows how much of each group's data those cells cover.
* **Performance Drift** compares a recent window with a baseline window, per model, harness or project. The difference uses Newcombe's hybrid-score 95% interval.
  * `insufficient evidence`: either window has fewer than *min n* tasks (default 15).
  * `consistent change`: the interval excludes 0 **and** |Δ| ≥ the threshold (default 10 pts).
  * `possible change`: only one of those two conditions holds.
  * `no meaningful change`: neither holds.
  * Possible confounders are listed: harness version change, shifts in category, difficulty, project or harness mix (total variation distance), sensitivity to mix adjustment, and modest samples.

---

## Importing usage

* **ccusage JSON**: `npx ccusage daily --json`, `session`, `monthly`, `weekly` and `blocks` reports. Codex (`@ccusage/codex`) exports and other harnesses that use the same shape are also supported.
  * `modelBreakdowns` become one row per model.
  * Codex `models{}` maps are split, and the reported cost is apportioned by token share.
  * Codex cached input tokens are separated from input tokens.
* **CSV**: columns are auto-mapped (date, session_id, model, token columns, cost, project, agent_minutes, billing), and the mapping can be edited in the UI.
* **Preview before commit.** Each row is classified as `new`, `duplicate` (identical), `changed` (same identity, different values) or `invalid`.
  * Identity = harness + granularity + session + date + normalised model.
  * Choose *skip* or *overwrite* for changed rows.
  * Unknown prices are flagged.

---

## API

The API is versioned under `/api/v1`. Interactive docs are at `/api/docs`, and the schema at `/api/openapi.json`. Main groups:

* `meta`
* `projects` · `models` · `harnesses` · `subscriptions`
* `tasks` (+ criteria / deliverables / evidence)
* `usage` (+ `/usage/link`)
* `imports/preview` · `imports/commit`
* `analytics/dashboard|efficiency|compare|drift`
* `community/overview|contribution-preview`
* `reports/weekly` (JSON or Markdown) · `reports/filtered` (JSON / CSV)
* `export/{tasks|usage|subscriptions|evidence|imports|all}`
* `demo/reset|clear`

All analytics endpoints accept `start`, `end`, `project`, `model` and `harness`. The last three can be repeated.

---

## Tests

```bash
cd backend && python -m pytest tests -q
```
* `test_analytics.py`: Wilson intervals, the three-signal outcome metrics, subscription allocation and idle cost, unknown-price handling, outcome flow, uplift confidence and failed-attempt time, drift labelling, confounders, mix adjustment, weekly series.
* `test_importers.py`: realistic Claude Code daily, Codex daily, session and monthly fixtures; invalid input; CSV auto-mapping and missing fields.
* `test_e2e_public_api.py`, `test_iter2_retest_live.py`: optional live suites against a running deployment (`WORKRATE_LIVE_E2E=1`), skipped by default.
* `test_api.py`: migrations and seed, dashboard totals reconciled against persisted rows, filter partitioning, amortised subscription spend, seeded drift detection, and the full journey: import → dedupe → overwrite → create task → link usage → record outcome → history → evidence → weekly report → CSV/JSON export. Also price edits with repricing, community privacy (no identifiers, k-anonymity) and validation.

---

## Demo data

The demo data is ten weeks of deterministic synthetic activity across five projects, four harnesses (Claude Code, Codex CLI, Pi, Hermes Agent) and seven models. It includes:
* failures, rework and over-claims
* subscription and API billing
* models with unknown prices
* a seeded first-pass decline for `claude-sonnet-4-5` in the last three weeks
* a confounded Codex harness upgrade with a shift toward easier tasks

All demo rows have `is_synthetic = true` and are labelled in the UI. **Settings → Reset demo data** regenerates them, and **Clear everything** starts empty.

## Roadmap
* **Phase 2**: automatic ingestion (watch ccusage folders, git/PR links, test evidence), custom price tables and amortisation rules, saved views, scheduled reports.
* **Phase 3**: opt-in community publishing and an aggregation service, multi-user workspaces, cross-organisation benchmarks built from verified outcomes.
