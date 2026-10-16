# WorkRate — Agent Work Analytics

WorkRate is a local-first analytics workspace that measures how much accepted, verified work AI coding agents actually deliver. It does not stop at tokens and API prices.
It connects usage, such as ccusage exports and costs, to recorded outcomes so projects, models, harnesses, and time periods can be compared on evidence.

## Who it's for
- Individual developers and small teams who use several coding agents (Claude Code, Codex, Pi, Hermes, and others) and want to know what they are really getting for their time and money.
- Technical leads who need defensible comparisons between models and harnesses, and early warning when results get worse.
- Future community contributors who will share anonymised outcome data. This is a prototype only.

## Core features and experience
1. **Value Dashboard.** The main view puts agent usage (tokens, sessions, spend) next to delivered value (accepted and verified work). It shows:
   - tasks attempted vs. delivered
   - first-pass success and rework rates
   - human intervention and review time
   - time to accepted outcome
   - actual spend vs. API-equivalent cost
   - trends over time

   Filters for date range, project, model, and harness apply everywhere. Every metric can be drilled into, down to the records behind it.
2. **Work & Outcome Ledger.** You can create, edit, review, and link projects, tasks, sessions, models, harnesses, deliverables, acceptance criteria, and evidence (links, notes, test results).
   - Each task has three separate completion states: *agent-reported*, *human-accepted*, and *independently verified*.
   - Edits keep earlier measurements in a history, so they are never overwritten.
3. **Usage Import.**
   - Imports ccusage daily, session, and monthly JSON reports from all supported harnesses, plus a generic CSV with column mapping.
   - A preview step comes before saving. It flags duplicates, missing fields, and unknown model prices.
   - All imported data is converted to one shared format, and the original source is kept.
   - Imported usage is never treated as finished work. You link it to tasks yourself.
   - You can enter or adjust subscription costs, human effort, and outcomes by hand.
4. **Outcome Efficiency.** A transparent model compares accepted work against:
   - human time
   - agent time
   - rework
   - difficulty and category
   - comparable past outcomes
   - real cost

   It also gives an estimated **Work Uplift**: reference human effort vs. actual human effort. This is shown as a range with a confidence level. Every figure shows its formula, assumptions, sample size, and missing inputs. There is no composite "productivity score".
5. **Comparisons & Performance Drift.**
   - Compare models, harnesses, projects, and periods side by side on success, efficiency, rework, intervention, and cost per accepted outcome. Comparisons are made within the same task category and difficulty.
   - The Drift view highlights changes over time. Each change is labelled *insufficient evidence*, *possible change*, or *consistent change*, based on sample size and confidence intervals.
   - Possible confounders are listed, such as a harness change or a shift in task mix. A model is never called "degraded" without that evidence.
6. **Community Intelligence (prototype).**
   - Synthetic community datasets, clearly labelled as synthetic, show model comparisons, categories, trends, evidence quality, sample sizes, and how much of the data each contributor covers.
   - A local contribution preview shows exactly which fields would be shared (anonymised and aggregated). Nothing is ever sent anywhere.
7. **Export & Reporting.**
   - JSON or CSV export of the raw data and of filtered reports.
   - A weekly productivity summary built from the data itself, with no AI: what was completed, how much effort it took, and what changed since the previous week. It can be viewed in the app and exported as Markdown or JSON.
8. **Demo data.**
   - At least 8 weeks of consistent synthetic activity across several projects, models, and harnesses, including failures, rework, subscriptions, and API usage.
   - It contains a visible drift example.
   - Demo data is labelled as synthetic, and a one-click demo reset is provided.

## User flow
1. Open WorkRate. The dashboard loads with the labelled demo data.
2. Import a ccusage JSON or CSV file → review duplicates and warnings → confirm.
3. In the Ledger, create or open a task → link the imported sessions → record the outcome, human effort, rework, and evidence → mark it accepted or verified.
4. Return to the dashboard or Efficiency view to see how the task affected the metrics, and drill into the underlying records.
5. Compare two models or harnesses in Comparisons. Check Drift for changes and how strong the evidence is.
6. Generate the weekly summary or a filtered report and export it.
7. Optionally, open Community to preview what a contribution would contain.

## UI/UX feel
- A dense, calm analytical workspace in the style of Linear and Vercel Analytics, with a distinctive identity of its own.
- Strong typography, a clear hierarchy, and few KPI cards. Charts exist to answer questions, not to decorate.
- Dark mode by default, with a light-mode toggle.
- Left sidebar navigation, a global filter bar, and detail panels that slide out for drill-downs and record editing.
- Uncertainty is always visible: sample-size badges, confidence ranges, and "missing data" markers.
- Works on screens from laptop to large monitor, and is usable on tablet.

## Implementation phases
**Phase 1 — MVP (built now)**
- Value Dashboard with global filters and drill-downs
- Full Ledger: create, edit, link, three completion states, evidence, history
- ccusage JSON (daily/session/monthly) and generic CSV import with dedupe and warnings; manual cost and effort entry
- Outcome Efficiency with Work Uplift and visible calculations
- Comparisons and Performance Drift with evidence labels
- Community prototype with synthetic data and contribution preview
- JSON/CSV exports, filtered reports, and the weekly summary
- Seeded demo data with reset
- Versioned, documented REST API; automated tests for the calculations and data integrity
- Docker Compose and local setup documentation

**Phase 2**
- Automatic ingestion: watch ccusage output folders, git and PR links, and test-run evidence
- Custom price tables and subscription amortisation rules
- Saved views and scheduled weekly reports

**Phase 3**
- Real opt-in community publishing and aggregation service
- Optional multi-user workspaces and team roles
- Benchmarks across organisations built from verified outcomes

## Assumptions
- Data is stored in SQLite and the frontend uses Vite + TypeScript, as the brief specifies (confirmed). The hosted preview may need a small separate adapter; the local app does not depend on it.
- The app is single-user with no login (confirmed).
- Import covers ccusage daily, session, and monthly JSON for all supported harnesses, plus generic CSV (confirmed).
- No AI or external APIs are used; all summaries come from the data (confirmed).
- API-equivalent cost uses a built-in, editable price table. Models with unknown prices are flagged and are not guessed.
- Subscription cost is spread across the days in its billing period, so cost per outcome can be calculated.
- Reference human effort for Work Uplift is entered by the user for each task, or estimated from past tasks in the same category and difficulty. Either way, it is labelled as an estimate with a confidence level.
- Drift and comparison labels need a minimum sample size, shown in the UI, before any change is reported.
- Duplicate imports are detected from the source, date or session, model, and token totals. Duplicates are skipped unless you choose to overwrite them.
- Dark theme is the default.
