# WorkRate — PRD

## Original problem statement
Build **WorkRate**, a premium, local-first analytics platform measuring the real-world productivity, efficiency and value delivered by AI coding agents. Covers: Productivity Dashboard, Work & Outcome Ledger, Usage & Data Import (ccusage JSON/CSV), Outcome Efficiency & Normalisation (Work Uplift), Model & Harness Comparisons + Performance Drift, Community Intelligence (synthetic prototype + local contribution preview), Export & Reporting (JSON/CSV, filtered reports, weekly summary). Stack: React 19 + TS + Vite + Tailwind v4 + shadcn/Radix + TanStack Query + Recharts + Zod; FastAPI + Pydantic v2 + SQLAlchemy 2 + Alembic + SQLite + pytest. Docker Compose. ≥8 weeks synthetic seeded data, demo reset, versioned REST API, tests.

## Decisions (user-approved plan)
- Single user, no auth. No AI/external APIs; summaries computed from data.
- SQLite (not Mongo). Vite replaces CRA; hosted-preview config isolated in `frontend/vite.hosted-preview.ts`.
- Unknown prices flagged, never guessed. Subscription amortised daily, split by token share.

## Architecture
- backend/workrate: analytics.py (pure), importers.py (pure), pricing.py, services.py, community.py, seed.py, api.py (/api/v1), models.py, schemas.py, main.py (Alembic upgrade on start + seed on empty)
- frontend/src: pages (Dashboard, Ledger, Usage+ImportWizard, Efficiency, Compare, Drift, Community, Reports, Settings), components/panels (TaskSheet, DrillSheet, NewTaskDialog), components/ui primitives

## Implemented (2026-10-16)
- All 7 core modules + Settings (price table w/ repricing, projects/harnesses, demo reset/clear)
- 31 backend tests passing (analytics, importers, API journey)
- README, docker-compose, Dockerfiles, Makefile

## Backlog
- P1: code-split frontend bundle; saved views; custom amortisation rules
- P2: automatic ccusage folder watch, git/PR evidence ingestion, scheduled weekly reports
- P3: real opt-in community publishing, multi-user workspaces
