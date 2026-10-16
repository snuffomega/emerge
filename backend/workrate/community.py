"""Community intelligence prototype: synthetic community aggregates + local contribution preview. Nothing is transmitted."""
from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, timedelta
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import analytics as A
from .models import AgentModel, Harness, Task, UsageRecord

K_ANON = 5
COMMUNITY_MODELS = {
    "claude-opus-4-5": (0.86, 0.62), "claude-sonnet-4-5": (0.82, 0.58), "gpt-5.1-codex": (0.8, 0.55),
    "gpt-5-codex": (0.76, 0.5), "gemini-3-pro": (0.77, 0.52), "claude-haiku-4-5": (0.74, 0.55),
    "glm-4.6": (0.66, 0.42), "kimi-k2": (0.69, 0.45),
}
COMMUNITY_HARNESSES = ["claude-code", "codex", "gemini-cli", "pi", "hermes", "opencode"]
EVIDENCE_LEVELS = ["self_reported", "human_accepted", "ci_verified"]


def synthetic_community(weeks: int = 12, seed_value: int = 1337) -> dict:
    rng = random.Random(seed_value)
    end = date.today() - timedelta(days=date.today().weekday())
    models, trends, categories = [], [], []
    for name, (succ, fp) in COMMUNITY_MODELS.items():
        contributors = rng.randint(18, 240)
        n = contributors * rng.randint(12, 40)
        ev = [rng.uniform(0.2, 0.4), rng.uniform(0.3, 0.45)]
        ev.append(max(0.05, 1 - sum(ev)))
        k = round(n * succ)
        models.append({
            "model": name, "contributors": contributors, "observations": n, "success_rate": A.rate(k, n),
            "first_pass_rate": A.rate(round(n * fp), n),
            "median_human_minutes": round(rng.uniform(25, 70), 1),
            "evidence_mix": dict(zip(EVIDENCE_LEVELS, [round(x, 3) for x in ev])),
            "harness_coverage": sorted(rng.sample(COMMUNITY_HARNESSES, rng.randint(1, 4))),
        })
        for w in range(weeks):
            wk = end - timedelta(weeks=weeks - 1 - w)
            wn = max(5, int(n / weeks * rng.uniform(0.6, 1.3)))
            drift = -0.06 if name == "claude-sonnet-4-5" and w >= weeks - 3 else 0
            p = min(0.97, max(0.3, succ + drift + rng.gauss(0, 0.025)))
            trends.append({"week": wk.isoformat(), "model": name, "n": wn, "success_rate": p})
    for cat in A.CATEGORIES:
        for name, (succ, _) in COMMUNITY_MODELS.items():
            n = rng.randint(3, 600)
            p = min(0.97, max(0.3, succ + rng.gauss(0, 0.06)))
            categories.append({"category": cat, "model": name, "n": n, "success_rate": A.rate(round(n * p), n),
                               "suppressed": n < 30})
    return {
        "synthetic": True,
        "notice": "SYNTHETIC DATASET — generated locally to demonstrate a future community service. No real contributions exist.",
        "contributors_total": sum(m["contributors"] for m in models),
        "observations_total": sum(m["observations"] for m in models),
        "models": models, "trends": trends, "categories": categories,
        "coverage": {"harnesses": COMMUNITY_HARNESSES, "categories": A.CATEGORIES,
                     "min_cell_n": 30, "k_anonymity": K_ANON},
    }


SHARED_FIELDS = [
    ("model", "Normalised model name (e.g. claude-sonnet-4-5)"),
    ("harness", "Harness identifier (e.g. claude-code)"),
    ("category", "Task category"),
    ("difficulty", "Task difficulty band"),
    ("period", "Month range covered by the contribution (no per-task dates)"),
    ("n", "Number of resolved tasks in the bucket"),
    ("accepted / verified / first_pass", "Outcome counts"),
    ("rework_cycles_mean", "Mean rework cycles"),
    ("human_minutes_median", "Median human minutes (rounded to 5)"),
    ("tokens_median", "Median tokens per task (rounded to 10k)"),
]
EXCLUDED_FIELDS = ["Task titles & descriptions", "Project names", "Deliverable & evidence URLs", "Session IDs",
                   "File / project paths", "Acceptance criteria text", "Exact timestamps", "Costs and subscription details",
                   "Raw imported source rows"]


def contribution_preview(db: Session, start: date | None, end: date | None, include_synthetic: bool) -> dict:
    q = select(Task).where(Task.outcome.in_(list(A.RESOLVED)))
    if not include_synthetic:
        q = q.where(Task.is_synthetic.is_(False))
    tasks = list(db.scalars(q))
    if start:
        tasks = [t for t in tasks if A.to_date(t.created_at) >= start]
    if end:
        tasks = [t for t in tasks if A.to_date(t.created_at) <= end]
    models = {m.id: m.name for m in db.scalars(select(AgentModel))}
    harn = {h.id: h.name for h in db.scalars(select(Harness))}
    tok = defaultdict(int)
    for u in db.scalars(select(UsageRecord).where(UsageRecord.task_id.is_not(None))):
        tok[u.task_id] += u.total_tokens or 0
    buckets = defaultdict(list)
    for t in tasks:
        buckets[(models.get(t.model_id, "unknown"), harn.get(t.harness_id, "unknown"), t.category, t.difficulty)].append(t)
    shared, suppressed = [], 0
    period = None
    if tasks:
        ds = [A.to_date(t.created_at) for t in tasks]
        period = {"from_month": min(ds).strftime("%Y-%m"), "to_month": max(ds).strftime("%Y-%m")}
    for (m, h, c, d), ts in sorted(buckets.items()):
        if len(ts) < K_ANON:
            suppressed += len(ts)
            continue
        hm = [t.human_minutes for t in ts if t.human_minutes is not None]
        tk = [tok[t.id] for t in ts if tok.get(t.id)]
        shared.append({
            "model": m, "harness": h, "category": c, "difficulty": d, "n": len(ts),
            "accepted": sum(1 for t in ts if t.human_accepted), "verified": sum(1 for t in ts if t.verified),
            "first_pass": sum(1 for t in ts if A.is_first_pass(t)),
            "rework_cycles_mean": round(sum(t.rework_cycles for t in ts) / len(ts), 2),
            "human_minutes_median": round(median(hm) / 5) * 5 if hm else None,
            "tokens_median": round(median(tk) / 1e4) * 1e4 if tk else None,
        })
    return {
        "transmitted": False,
        "notice": "Preview only. Nothing leaves this machine; community publishing is a future capability.",
        "k_anonymity": K_ANON, "tasks_considered": len(tasks), "tasks_shared": sum(b["n"] for b in shared),
        "tasks_suppressed": suppressed, "includes_synthetic": include_synthetic,
        "shared_fields": [{"field": f, "description": d} for f, d in SHARED_FIELDS],
        "excluded_fields": EXCLUDED_FIELDS, "period": period, "buckets": shared,
    }
