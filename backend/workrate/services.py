"""Database-backed services: loading filtered facts, imports, task edits with history, report assembly."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import analytics as A
from .importers import ParseError, identity_key, parse_ccusage, parse_csv
from .models import AgentModel, Harness, ImportBatch, Project, Subscription, Task, TaskHistory, UsageRecord, utcnow
from .pricing import compute_cost, lookup_default_price, normalize_model_name


@dataclass
class Filters:
    start: date | None = None
    end: date | None = None
    project_ids: list[int] = field(default_factory=list)
    model_ids: list[int] = field(default_factory=list)
    harness_ids: list[int] = field(default_factory=list)

    @property
    def has_dims(self) -> bool:
        return bool(self.project_ids or self.model_ids)


def data_range(db: Session) -> tuple[date, date]:
    t0, t1 = db.execute(select(func.min(Task.created_at), func.max(Task.created_at))).one()
    u0, u1 = db.execute(select(func.min(UsageRecord.usage_date), func.max(UsageRecord.usage_date))).one()
    starts = [d for d in (A.to_date(t0) if t0 else None, u0) if d]
    ends = [d for d in (A.to_date(t1) if t1 else None, u1) if d]
    today = date.today()
    return (min(starts) if starts else today - timedelta(days=55)), (max(ends) if ends else today)


def resolve_range(db: Session, f: Filters) -> tuple[date, date]:
    lo, hi = data_range(db)
    return f.start or lo, f.end or hi


def _dt(d: date) -> datetime:
    return datetime.combine(d, time.min)


def query_tasks(db: Session, f: Filters, start: date | None, end: date | None):
    q = select(Task)
    if start:
        q = q.where(Task.created_at >= _dt(start))
    if end:
        q = q.where(Task.created_at < _dt(end + timedelta(days=1)))
    if f.project_ids:
        q = q.where(Task.project_id.in_(f.project_ids))
    if f.model_ids:
        q = q.where(Task.model_id.in_(f.model_ids))
    if f.harness_ids:
        q = q.where(Task.harness_id.in_(f.harness_ids))
    return list(db.scalars(q.order_by(Task.created_at.desc())))


def usage_in_range(db: Session, start: date, end: date) -> list[UsageRecord]:
    return list(db.scalars(select(UsageRecord).where(UsageRecord.usage_date >= start, UsageRecord.usage_date <= end)))


def filter_usage(usages: list, f: Filters) -> list:
    out = usages
    if f.project_ids:
        out = [u for u in out if u.project_id in f.project_ids]
    if f.model_ids:
        out = [u for u in out if u.model_id in f.model_ids]
    if f.harness_ids:
        out = [u for u in out if u.harness_id in f.harness_ids]
    return out


@dataclass
class Context:
    start: date
    end: date
    tasks: list
    usage_all: list
    usage: list
    alloc: dict
    idle: float
    unknown_cost_ids: dict


def load_context(db: Session, f: Filters) -> Context:
    start, end = resolve_range(db, f)
    tasks = query_tasks(db, f, start, end)
    all_u = usage_in_range(db, start, end)
    subs = list(db.scalars(select(Subscription)))
    alloc, idle_by_h, unknown = A.allocate_costs(all_u, subs, start, end)
    idle = 0.0 if f.has_dims else sum(v for h, v in idle_by_h.items() if not f.harness_ids or h in f.harness_ids)
    return Context(start, end, tasks, all_u, filter_usage(all_u, f), alloc, idle, unknown)


def alloc_for_usages(db: Session, usages: list) -> dict[int, float]:
    if not usages:
        return {}
    lo, hi = min(u.usage_date for u in usages), max(u.usage_date for u in usages)
    span = usage_in_range(db, lo, hi)
    subs = list(db.scalars(select(Subscription)))
    alloc, _, _ = A.allocate_costs(span, subs, lo, hi)
    return alloc


def task_costs(db: Session, task_ids: list[int]) -> tuple[dict, dict, dict, dict, dict]:
    """Per-task (actual cost, api-equivalent, agent minutes, tokens, usage count) from linked usage."""
    if not task_ids:
        return {}, {}, {}, {}, {}
    us = list(db.scalars(select(UsageRecord).where(UsageRecord.task_id.in_(task_ids))))
    alloc = alloc_for_usages(db, us)
    cost, api, mins, tok, cnt = defaultdict(float), {}, {}, defaultdict(int), defaultdict(int)
    for u in us:
        cost[u.task_id] += alloc.get(u.id, 0.0)
        if u.api_equiv_cost is not None:
            api[u.task_id] = api.get(u.task_id, 0.0) + u.api_equiv_cost
        if u.agent_minutes is not None:
            mins[u.task_id] = mins.get(u.task_id, 0.0) + u.agent_minutes
        tok[u.task_id] += u.total_tokens or 0
        cnt[u.task_id] += 1
    return dict(cost), api, mins, dict(tok), dict(cnt)


# ---------- reference data ----------

def get_or_create_model(db: Session, raw_name: str) -> AgentModel | None:
    name = normalize_model_name(raw_name) if raw_name and raw_name != "unknown" else None
    if not name:
        return None
    m = db.scalar(select(AgentModel).where(AgentModel.name == name))
    if m:
        return m
    p = lookup_default_price(name)
    m = AgentModel(name=name, provider=p[0] if p else "unknown", input_price=p[1] if p else None,
                   output_price=p[2] if p else None, cache_write_price=p[3] if p else None,
                   cache_read_price=p[4] if p else None)
    db.add(m)
    db.flush()
    return m


def get_or_create_harness(db: Session, name: str) -> Harness:
    key = name.strip().lower().replace(" ", "-")
    h = db.scalar(select(Harness).where(Harness.name == key))
    if not h:
        h = Harness(name=key, display_name=name.strip().replace("-", " ").title())
        db.add(h)
        db.flush()
    return h


def price_usage(u: UsageRecord, model: AgentModel | None) -> None:
    c = compute_cost(model, u.input_tokens, u.output_tokens, u.cache_creation_tokens, u.cache_read_tokens)
    if c is not None:
        u.api_equiv_cost, u.price_status = c, "table"
    elif u.reported_cost is not None:
        u.api_equiv_cost, u.price_status = u.reported_cost, "source_reported"
    else:
        u.api_equiv_cost, u.price_status = None, "unknown"


def reprice_model(db: Session, model: AgentModel) -> int:
    rows = list(db.scalars(select(UsageRecord).where(UsageRecord.model_id == model.id)))
    for u in rows:
        price_usage(u, model)
    return len(rows)


# ---------- import ----------

def _match_project(db: Session, hint: str | None) -> Project | None:
    if not hint:
        return None
    base = hint.rstrip("/").split("/")[-1].split("\\")[-1].lower()
    for p in db.scalars(select(Project)):
        if p.name.lower() == base or base.endswith(p.name.lower()):
            return p
    return None


def _parse(req) -> tuple[list[dict], str, list[str], dict]:
    fmt = req.format
    if fmt == "auto":
        fmt = "ccusage" if req.content.lstrip().startswith(("{", "[")) else "csv"
    if fmt == "ccusage":
        rows, source, warns = parse_ccusage(req.content)
        return rows, source, warns, {}
    rows, headers, mapping = parse_csv(req.content, req.csv_mapping)
    return rows, "csv", [], {"headers": headers, "mapping": mapping}


FIELDS_COMPARED = ("input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "total_tokens", "reported_cost")


def analyse_import(db: Session, req) -> dict:
    rows, source, file_warnings, csv_info = _parse(req)
    harness_key = req.harness.strip().lower().replace(" ", "-")
    seen: set[str] = set()
    for r in rows:
        if r["status"] == "invalid":
            continue
        key = identity_key(harness_key, r["granularity"], r["session_key"], r["usage_date"], r["model_name"])
        r["dedupe_key"] = key
        if key in seen:
            r["status"] = "duplicate"
            r["warnings"].append("Repeated within this file")
            continue
        seen.add(key)
        existing = db.scalar(select(UsageRecord).where(UsageRecord.dedupe_key == key))
        if existing is None:
            r["status"] = "new"
        elif all(getattr(existing, k) == r[k] for k in FIELDS_COMPARED):
            r["status"] = "duplicate"
            r["existing_id"] = existing.id
        else:
            r["status"] = "changed"
            r["existing_id"] = existing.id
        model = db.scalar(select(AgentModel).where(AgentModel.name == r["model_name"]))
        known = (model and model.input_price is not None) or (not model and lookup_default_price(r["model_name"]))
        r["price_known"] = bool(known)
        if not known:
            r["warnings"].append("Unknown price: using source-reported cost" if r["reported_cost"] is not None
                                 else "Unknown price: API-equivalent cost left blank")
        if r["granularity"] != "session":
            r["warnings"].append(f"{r['granularity'].title()} aggregate — link to tasks only if it maps cleanly")
        if r.get("agent_minutes") is None:
            r.setdefault("missing", []).append("agent_minutes")
    counts = defaultdict(int)
    for r in rows:
        counts[r["status"]] += 1
    return {"rows": rows, "source": source, "file_warnings": file_warnings, "csv": csv_info, "counts": dict(counts)}


def serialise_preview(res: dict, limit: int = 300) -> dict:
    out_rows = []
    for r in res["rows"][:limit]:
        out_rows.append({k: (v.isoformat() if isinstance(v, date) else v) for k, v in r.items() if k not in ("raw", "dedupe_key")})
    models = sorted({r["model_name"] for r in res["rows"] if r.get("model_name")})
    unknown = sorted({r["model_name"] for r in res["rows"] if r.get("price_known") is False})
    return {"source": res["source"], "counts": res["counts"], "total": len(res["rows"]), "rows": out_rows,
            "file_warnings": res["file_warnings"], "csv": res["csv"], "models": models, "unknown_price_models": unknown,
            "truncated": len(res["rows"]) > limit}


def commit_import(db: Session, req) -> ImportBatch:
    res = analyse_import(db, req)
    harness = get_or_create_harness(db, req.harness)
    project = db.get(Project, req.project_id) if req.project_id else None
    batch = ImportBatch(filename=req.filename, source_format=res["source"], harness_id=harness.id,
                        rows_total=len(res["rows"]), warnings=list(res["file_warnings"]))
    db.add(batch)
    db.flush()
    unknown_models = set()
    for r in res["rows"]:
        st = r["status"]
        if st == "invalid":
            batch.rows_invalid += 1
            continue
        if st == "duplicate" or (st == "changed" and req.mode == "skip"):
            batch.rows_duplicate += 1
            continue
        model = get_or_create_model(db, r["raw_model_name"])
        if not r.get("price_known"):
            unknown_models.add(r["model_name"])
        u = db.get(UsageRecord, r["existing_id"]) if st == "changed" else UsageRecord(dedupe_key=r["dedupe_key"])
        u.source, u.granularity, u.harness_id = res["source"], r["granularity"], harness.id
        u.model_id = model.id if model else None
        if st == "new":
            proj = project or _match_project(db, r.get("project_hint"))
            u.project_id = proj.id if proj else None
        u.import_batch_id = batch.id
        u.session_key, u.usage_date, u.raw_model_name = r["session_key"], r["usage_date"], r["raw_model_name"]
        for k in ("input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "total_tokens", "reported_cost"):
            setattr(u, k, r[k])
        u.agent_minutes = r.get("agent_minutes")
        u.billing = r.get("billing") or req.billing
        u.raw = {"source_row": r["raw"], "project_hint": r.get("project_hint"), "warnings": r["warnings"]}
        price_usage(u, model)
        if st == "new":
            db.add(u)
            batch.rows_imported += 1
        else:
            batch.rows_overwritten += 1
    if unknown_models:
        batch.warnings = batch.warnings + [f"Unknown price for: {', '.join(sorted(unknown_models))}"]
    db.commit()
    return batch


# ---------- task edits ----------

TRACKED = ["title", "description", "category", "difficulty", "outcome", "model_id", "harness_id", "harness_version",
           "project_id", "agent_reported_complete", "human_accepted", "verified", "verification_method",
           "rework_cycles", "intervention_count", "human_minutes", "review_minutes", "reference_human_minutes"]


def apply_task_state(t: Task, now: datetime, changed: set | frozenset = frozenset()) -> None:
    """Keep completion states and timestamps internally consistent. An explicit outcome change wins."""
    if "outcome" in changed and t.outcome != "delivered":
        t.human_accepted = t.verified = False
    if t.verified:
        t.human_accepted = True
    if t.human_accepted and t.outcome in ("in_progress", "failed", "abandoned"):
        t.outcome = "delivered"
    if t.outcome in ("failed", "abandoned"):
        t.human_accepted = t.verified = False
    if t.agent_reported_complete and not t.agent_reported_at:
        t.agent_reported_at = now
    if not t.agent_reported_complete:
        t.agent_reported_at = None
    if t.human_accepted and not t.accepted_at:
        t.accepted_at = now
    if not t.human_accepted:
        t.accepted_at = None
    if t.verified and not t.verified_at:
        t.verified_at = now
    if not t.verified:
        t.verified_at = None


def update_task(db: Session, t: Task, changes: dict) -> Task:
    now = utcnow()
    before = {k: getattr(t, k) for k in TRACKED}
    for k, v in changes.items():
        setattr(t, k, v)
    apply_task_state(t, now, set(changes))
    for k in TRACKED:
        old, new = before[k], getattr(t, k)
        if old != new:
            db.add(TaskHistory(task_id=t.id, changed_at=now, field=k,
                               old_value=None if old is None else str(old), new_value=None if new is None else str(new)))
    db.commit()
    db.refresh(t)
    return t


# ---------- analytics assembly ----------

def name_maps(db: Session) -> dict:
    return {
        "project": {p.id: p.name for p in db.scalars(select(Project))},
        "model": {m.id: m.name for m in db.scalars(select(AgentModel))},
        "harness": {h.id: h.display_name for h in db.scalars(select(Harness))},
    }


def dashboard(db: Session, f: Filters) -> dict:
    ctx = load_context(db, f)
    tm = A.task_metrics(ctx.tasks)
    um = A.usage_metrics(ctx.usage, ctx.alloc, ctx.idle)
    linked_ids = {u.task_id for u in ctx.usage if u.task_id}
    flow_tasks = {t.id: t for t in db.scalars(select(Task).where(Task.id.in_(linked_ids)))} if linked_ids else {}
    span = (ctx.end - ctx.start).days + 1
    prev = Filters(ctx.start - timedelta(days=span), ctx.start - timedelta(days=1), f.project_ids, f.model_ids, f.harness_ids)
    pctx = load_context(db, prev)
    ptm, pum = A.task_metrics(pctx.tasks), A.usage_metrics(pctx.usage, pctx.alloc, pctx.idle)
    acc = tm["accepted"]
    names = name_maps(db)
    by_model = []
    for mid, mname in names["model"].items():
        ts = [t for t in ctx.tasks if t.model_id == mid]
        us = [u for u in ctx.usage if u.model_id == mid]
        if not ts and not us:
            continue
        m = A.task_metrics(ts)
        spend = sum(ctx.alloc.get(u.id, 0) for u in us)
        by_model.append({"model_id": mid, "model": mname, "accepted": m["accepted"], "resolved": m["resolved"],
                         "tokens": sum(u.total_tokens for u in us), "actual_spend": spend,
                         "api_equiv_cost": sum(u.api_equiv_cost or 0 for u in us),
                         "success_rate": m["success_rate"], "cost_per_accepted": spend / m["accepted"] if m["accepted"] else None})
    all_count = len(ctx.tasks) + len(ctx.usage)
    synth = sum(1 for t in ctx.tasks if t.is_synthetic) + sum(1 for u in ctx.usage if u.is_synthetic)
    return {
        "range": {"start": ctx.start.isoformat(), "end": ctx.end.isoformat(), "days": span},
        "previous_range": {"start": prev.start.isoformat(), "end": prev.end.isoformat(), "has_data": bool(pctx.tasks or pctx.usage)},
        "tasks": tm, "usage": um,
        "previous": {"tasks": ptm, "usage": pum,
                     "cost_per_accepted": pum["actual_spend"] / ptm["accepted"] if ptm["accepted"] else None},
        "cost_per_accepted": um["actual_spend"] / acc if acc else None,
        "api_equiv_per_accepted": um["api_equiv_cost"] / acc if acc else None,
        "tokens_per_accepted": um["tokens"] / acc if acc else None,
        "weekly": A.weekly_series(ctx.tasks, ctx.usage, ctx.alloc, ctx.start, ctx.end),
        "flow": A.outcome_flow(ctx.usage, flow_tasks, ctx.alloc),
        "by_model": sorted(by_model, key=lambda r: -r["accepted"]),
        "data_quality": {
            "usage_unknown_price": um["api_equiv_unknown_records"],
            "usage_unlinked": um["records"] - um["linked_records"],
            "usage_records": um["records"],
            "tasks_missing_human_minutes": tm["human_minutes_missing"],
            "tasks_missing_reference": len([t for t in ctx.tasks if t.human_accepted and not t.reference_human_minutes]),
            "synthetic_share": synth / all_count if all_count else 0,
        },
    }


def efficiency(db: Session, f: Filters) -> dict:
    ctx = load_context(db, f)
    ids = [t.id for t in ctx.tasks]
    cost, api, mins, tok, _ = task_costs(db, ids)
    all_tasks = list(db.scalars(select(Task)))
    baselines = A.reference_baselines(all_tasks)
    up = A.work_uplift(ctx.tasks, baselines)
    names = name_maps(db)
    by_model = []
    for mid in sorted({t.model_id for t in ctx.tasks if t.model_id}):
        u = A.work_uplift([t for t in ctx.tasks if t.model_id == mid], baselines)
        by_model.append({"model_id": mid, "model": names["model"].get(mid), "included": u["included"],
                         "median_ratio": u["median_ratio"], "p25_ratio": u["p25_ratio"], "p75_ratio": u["p75_ratio"],
                         "portfolio_ratio": u["portfolio_ratio"], "overall_confidence": u["overall_confidence"]})
    scatter = []
    for t in ctx.tasks:
        if t.outcome not in A.RESOLVED:
            continue
        ref, src, conf = A.reference_for(t, baselines)
        scatter.append({"id": t.id, "title": t.title, "category": t.category, "difficulty": t.difficulty,
                        "accepted": t.human_accepted, "human_minutes": t.human_minutes, "agent_minutes": mins.get(t.id),
                        "reference_minutes": ref, "reference_confidence": conf, "rework_cycles": t.rework_cycles,
                        "actual_cost": round(cost.get(t.id, 0.0), 4), "tokens": tok.get(t.id, 0),
                        "model": names["model"].get(t.model_id)})
    up_rows = up.pop("rows")
    return {
        "range": {"start": ctx.start.isoformat(), "end": ctx.end.isoformat()},
        "uplift": up,
        "uplift_by_model": by_model,
        "uplift_rows_sample": up_rows[:400],
        "cells": A.efficiency_cells(ctx.tasks, cost, api, mins),
        "baselines": [{"category": k[0], "difficulty": k[1], **v} for k, v in sorted(baselines.items())],
        "scatter": scatter,
        "assumptions": [
            "Work Uplift = reference human minutes ÷ actual human minutes, per accepted task.",
            "Reference minutes are user-entered (high confidence) or the median of user-entered references for the same category × difficulty (medium if ≥5 references, low if 2–4).",
            "Portfolio uplift charges human time spent on failed or abandoned attempts against delivered work.",
            "Cost per accepted outcome includes the cost of failed attempts in the same cell.",
            "Subscription cost is amortised daily (monthly × 12 ÷ 365) and split by token share across that day's subscription usage.",
            "Agent minutes come only from linked usage records that report a duration; imported ccusage data does not include durations.",
        ],
    }


def _dim(dimension: str):
    if dimension == "model":
        return (lambda t: t.model_id), (lambda u: u.model_id)
    if dimension == "harness":
        return (lambda t: t.harness_id), (lambda u: u.harness_id)
    if dimension == "project":
        return (lambda t: t.project_id), (lambda u: u.project_id)
    raise ValueError(dimension)


def compare(db: Session, f: Filters, dimension: str, min_n: int, periods: tuple | None = None, keys: list | None = None) -> dict:
    names = name_maps(db)
    if dimension == "period":
        a0, a1, b0, b1 = periods
        ff = Filters(min(a0, b0), max(a1, b1), f.project_ids, f.model_ids, f.harness_ids)
        ctx = load_context(db, ff)

        def pk(d):
            return "A" if a0 <= d <= a1 else "B" if b0 <= d <= b1 else None
        tk, uk = (lambda t: pk(A.to_date(t.created_at))), (lambda u: pk(u.usage_date))
        label = {"A": f"{a0} → {a1}", "B": f"{b0} → {b1}"}
    else:
        ctx = load_context(db, f)
        tk, uk = _dim(dimension)
        label = names[dimension]
    res = A.compare_groups(ctx.tasks, ctx.usage, ctx.alloc, tk, uk, min_n, keys)
    for r in res["rows"]:
        r["label"] = label.get(r["key"], str(r["key"]))
    res["dimension"] = dimension
    res["range"] = {"start": ctx.start.isoformat(), "end": ctx.end.isoformat()}
    return res


def drift(db: Session, f: Filters, dimension: str, recent_weeks: int, baseline_weeks: int, min_n: int, threshold: float) -> dict:
    _, hi = resolve_range(db, f)
    end = f.end or hi
    start = end - timedelta(days=(recent_weeks + baseline_weeks) * 7)
    tasks = query_tasks(db, f, start, end)
    tk, _ = _dim(dimension)
    res = A.drift(tasks, tk, end, recent_weeks, baseline_weeks, min_n, threshold)
    names = name_maps(db)
    weekly = A.weekly_group_rates(query_tasks(db, f, None, end), tk)
    for g in res["groups"]:
        g["label"] = names[dimension].get(g["key"], str(g["key"]))
        g["weekly"] = weekly.get(g["key"], [])
    res["dimension"] = dimension
    return res


def weekly_report(db: Session, f: Filters, week: date | None) -> dict:
    _, hi = data_range(db)
    if week is None:
        week = A.week_start(hi) - timedelta(days=7) if (hi - A.week_start(hi)).days < 6 else A.week_start(hi)
    week = A.week_start(week)
    wend = week + timedelta(days=6)
    pweek, pend = week - timedelta(days=7), week - timedelta(days=1)
    names = name_maps(db)

    def period(s, e):
        ff = Filters(s, e, f.project_ids, f.model_ids, f.harness_ids)
        ctx = load_context(db, ff)
        accepted_q = select(Task).where(Task.accepted_at >= _dt(s), Task.accepted_at < _dt(e + timedelta(days=1)))
        if f.project_ids:
            accepted_q = accepted_q.where(Task.project_id.in_(f.project_ids))
        if f.model_ids:
            accepted_q = accepted_q.where(Task.model_id.in_(f.model_ids))
        if f.harness_ids:
            accepted_q = accepted_q.where(Task.harness_id.in_(f.harness_ids))
        completed = list(db.scalars(accepted_q.order_by(Task.accepted_at)))
        return ctx, completed, A.task_metrics(ctx.tasks), A.usage_metrics(ctx.usage, ctx.alloc, ctx.idle)

    ctx, completed, tm, um = period(week, wend)
    _, pcompleted, ptm, pum = period(pweek, pend)
    effort = sum(t.human_minutes or 0 for t in completed)
    peffort = sum(t.human_minutes or 0 for t in pcompleted)
    cpa = um["actual_spend"] / len(completed) if completed else None
    pcpa = pum["actual_spend"] / len(pcompleted) if pcompleted else None

    def ch(metric, cur, prev, fmt, better="higher"):
        if cur is None or prev is None:
            return {"metric": metric, "current": cur, "previous": prev, "text": f"{metric}: not comparable (missing data)"}
        delta = cur - prev
        return {"metric": metric, "current": cur, "previous": prev, "delta": delta, "better": better,
                "text": f"{metric}: {fmt(prev)} → {fmt(cur)}"}
    pct = lambda v: f"{v*100:.0f}%"  # noqa: E731
    changes = [
        ch("Accepted tasks", len(completed), len(pcompleted), lambda v: f"{v:.0f}"),
        ch("Success rate", tm["success_rate"]["value"], ptm["success_rate"]["value"], pct),
        ch("First-pass rate", tm["first_pass_rate"]["value"], ptm["first_pass_rate"]["value"], pct),
        ch("Human effort (hours)", effort / 60, peffort / 60, lambda v: f"{v:.1f}h", "lower"),
        ch("Actual spend", um["actual_spend"], pum["actual_spend"], lambda v: f"${v:,.0f}", "lower"),
        ch("Cost per accepted task", cpa, pcpa, lambda v: f"${v:,.2f}", "lower"),
        ch("Tokens", um["tokens"], pum["tokens"], lambda v: f"{v/1e6:.1f}M", "lower"),
    ]
    caveats = []
    if tm["resolved"] < A.MIN_DRIFT_N or ptm["resolved"] < A.MIN_DRIFT_N:
        caveats.append(f"Weekly samples are small (this week n={tm['resolved']}, previous n={ptm['resolved']}); rate changes are indicative only. Use Drift for evidence-based comparisons.")
    if um["api_equiv_unknown_records"]:
        caveats.append(f"{um['api_equiv_unknown_records']} usage records have no known price; API-equivalent cost is understated.")
    unlinked = um["records"] - um["linked_records"]
    if unlinked:
        caveats.append(f"{unlinked} usage records are not linked to any task.")
    by_project = defaultdict(lambda: {"accepted": 0, "human_minutes": 0.0})
    for t in completed:
        p = by_project[names["project"].get(t.project_id, "—")]
        p["accepted"] += 1
        p["human_minutes"] += t.human_minutes or 0
    failed = [t for t in ctx.tasks if t.outcome in ("failed", "abandoned")]
    return {
        "week_start": week.isoformat(), "week_end": wend.isoformat(),
        "completed": [{"id": t.id, "title": t.title, "project": names["project"].get(t.project_id),
                       "model": names["model"].get(t.model_id), "harness": names["harness"].get(t.harness_id),
                       "category": t.category, "difficulty": t.difficulty, "verified": t.verified,
                       "rework_cycles": t.rework_cycles, "human_minutes": t.human_minutes} for t in completed],
        "failed": [{"id": t.id, "title": t.title, "model": names["model"].get(t.model_id), "outcome": t.outcome} for t in failed],
        "effort": {"human_minutes": effort, "review_minutes": sum(t.review_minutes or 0 for t in completed),
                   "rework_cycles": sum(t.rework_cycles for t in completed),
                   "failed_attempt_minutes": sum(t.human_minutes or 0 for t in failed)},
        "usage": um, "tasks": tm, "cost_per_accepted": cpa,
        "by_project": [{"project": k, **v} for k, v in sorted(by_project.items(), key=lambda kv: -kv[1]["accepted"])],
        "changes": changes, "caveats": caveats,
    }


def weekly_markdown(r: dict) -> str:
    L = [f"# WorkRate weekly summary · {r['week_start']} → {r['week_end']}", ""]
    tm, um, e = r["tasks"], r["usage"], r["effort"]
    L += ["## Completed work",
          f"{len(r['completed'])} tasks accepted ({sum(1 for c in r['completed'] if c['verified'])} independently verified). "
          f"{len(r['failed'])} attempts failed or were abandoned.", ""]
    for c in r["completed"]:
        L.append(f"- {'✔ verified' if c['verified'] else 'accepted'} · **{c['title']}** — {c['project']} · {c['model']} via {c['harness']} "
                 f"({c['category']}/{c['difficulty']}, rework {c['rework_cycles']}, human {c['human_minutes'] or 0:.0f} min)")
    L += ["", "## Effort", f"- Human time on accepted work: {e['human_minutes']/60:.1f} h (review {e['review_minutes']/60:.1f} h)",
          f"- Human time on failed attempts: {e['failed_attempt_minutes']/60:.1f} h", f"- Rework cycles: {e['rework_cycles']}",
          f"- Agent usage: {um['tokens']/1e6:.1f}M tokens over {um['sessions']} sessions",
          f"- Actual spend: ${um['actual_spend']:,.2f} · API-equivalent: ${um['api_equiv_cost']:,.2f}",
          f"- Cost per accepted task: {'$%.2f' % r['cost_per_accepted'] if r['cost_per_accepted'] is not None else 'n/a'}",
          "", "## What changed vs previous week"]
    L += [f"- {c['text']}" for c in r["changes"]]
    if r["caveats"]:
        L += ["", "## Caveats"] + [f"- {c}" for c in r["caveats"]]
    L += ["", "_Generated locally by WorkRate from recorded data. Synthetic demo records are included if present._"]
    return "\n".join(L)
