"""Pure analytical calculations. Inputs are plain objects (ORM rows or test doubles); no DB access here."""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median
from typing import Callable, Iterable

CATEGORIES = ["feature", "bugfix", "refactor", "tests", "docs", "infra"]
DIFFICULTIES = ["trivial", "small", "medium", "large"]
RESOLVED = {"delivered", "failed", "abandoned"}

MIN_DRIFT_N = 15
DRIFT_THRESHOLD = 0.10
MIN_CELL_N = 3
UPLIFT_EST_MEDIUM_N = 5
UPLIFT_EST_LOW_N = 2


# ---------- statistics primitives ----------

def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float] | None:
    if n <= 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def rate(k: int, n: int) -> dict:
    ci = wilson(k, n)
    return {
        "value": (k / n) if n else None,
        "k": k,
        "n": n,
        "ci_low": ci[0] if ci else None,
        "ci_high": ci[1] if ci else None,
    }


def quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def med(values: Iterable[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return median(vals) if vals else None


def tvd(a: dict, b: dict) -> float:
    """Total variation distance between two count distributions."""
    ta, tb = sum(a.values()), sum(b.values())
    if not ta or not tb:
        return 0.0
    keys = set(a) | set(b)
    return 0.5 * sum(abs(a.get(k, 0) / ta - b.get(k, 0) / tb) for k in keys)


def diff_ci(k1: int, n1: int, k2: int, n2: int) -> tuple[float, float, float] | None:
    """Difference p1 - p2 with Newcombe hybrid-score 95% interval."""
    if not n1 or not n2:
        return None
    p1, p2 = k1 / n1, k2 / n2
    l1, u1 = wilson(k1, n1)
    l2, u2 = wilson(k2, n2)
    d = p1 - p2
    lo = d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)
    hi = d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)
    return d, lo, hi


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def to_date(v) -> date:
    return v.date() if isinstance(v, datetime) else v


# ---------- task outcome metrics ----------

def is_first_pass(t) -> bool:
    return bool(t.human_accepted) and (t.rework_cycles or 0) == 0


def task_metrics(tasks: list) -> dict:
    resolved = [t for t in tasks if t.outcome in RESOLVED]
    accepted = [t for t in resolved if t.human_accepted]
    verified = [t for t in accepted if t.verified]
    failed = [t for t in resolved if not t.human_accepted]
    reported = [t for t in resolved if t.agent_reported_complete]
    overclaimed = [t for t in reported if not t.human_accepted]
    human_known = [t.human_minutes for t in resolved if t.human_minutes is not None]
    tta = [
        (t.accepted_at - t.created_at).total_seconds() / 3600
        for t in accepted
        if t.accepted_at and t.created_at
    ]
    return {
        "attempted": len(tasks),
        "in_progress": len(tasks) - len(resolved),
        "resolved": len(resolved),
        "agent_reported": len([t for t in tasks if t.agent_reported_complete]),
        "accepted": len(accepted),
        "verified": len(verified),
        "failed": len(failed),
        "success_rate": rate(len(accepted), len(resolved)),
        "first_pass_rate": rate(len([t for t in resolved if is_first_pass(t)]), len(resolved)),
        "rework_rate": rate(len([t for t in accepted if (t.rework_cycles or 0) > 0]), len(accepted)),
        "intervention_rate": rate(len([t for t in resolved if (t.intervention_count or 0) > 0]), len(resolved)),
        "overclaim_rate": rate(len(overclaimed), len(reported)),
        "verification_rate": rate(len(verified), len(accepted)),
        "avg_rework_cycles": (sum(t.rework_cycles or 0 for t in accepted) / len(accepted)) if accepted else None,
        "human_minutes_total": sum(human_known),
        "review_minutes_total": sum(t.review_minutes or 0 for t in resolved),
        "intervention_total": sum(t.intervention_count or 0 for t in resolved),
        "human_minutes_missing": len(resolved) - len(human_known),
        "human_minutes_per_accepted_median": med(t.human_minutes for t in accepted),
        "human_minutes_on_failed": sum(t.human_minutes or 0 for t in failed),
        "time_to_accept_hours_median": med(tta),
        "time_to_accept_hours_p75": quantile(tta, 0.75),
    }


# ---------- cost allocation ----------

def daily_subscription_cost(sub, d: date) -> float:
    if d < sub.start_date or (sub.end_date and d > sub.end_date):
        return 0.0
    return sub.monthly_cost * 12 / 365


def usage_api_spend(u) -> float | None:
    if u.api_equiv_cost is not None:
        return u.api_equiv_cost
    return u.reported_cost


def allocate_costs(usages: list, subs: list, start: date, end: date) -> tuple[dict[int, float], dict, dict]:
    """Actual cost per usage record.

    API-billed usage costs its (computed or source-reported) price. Subscription cost is amortised per day
    (monthly * 12 / 365) and split across that harness's subscription usage on the same day by token share.
    Days with no usage leave the cost unallocated ("idle").
    Returns (cost_by_usage_id, idle_by_harness, unknown_api_ids).
    """
    alloc: dict[int, float] = {}
    unknown: dict[int, bool] = {}
    bucket: dict[tuple[date, int], list] = defaultdict(list)
    for u in usages:
        if u.billing == "api":
            c = usage_api_spend(u)
            alloc[u.id] = c or 0.0
            if c is None:
                unknown[u.id] = True
        else:
            alloc[u.id] = 0.0
            bucket[(u.usage_date, u.harness_id)].append(u)
    idle: dict[int, float] = defaultdict(float)
    d = start
    while d <= end:
        for s in subs:
            c = daily_subscription_cost(s, d)
            if not c:
                continue
            rows = bucket.get((d, s.harness_id), [])
            tok = sum(r.total_tokens or 0 for r in rows)
            if tok > 0:
                for r in rows:
                    alloc[r.id] += c * (r.total_tokens or 0) / tok
            elif rows:
                for r in rows:
                    alloc[r.id] += c / len(rows)
            else:
                idle[s.harness_id] += c
        d += timedelta(days=1)
    return alloc, dict(idle), unknown


def usage_metrics(usages: list, alloc: dict[int, float], idle: float = 0.0) -> dict:
    api_known = [u.api_equiv_cost for u in usages if u.api_equiv_cost is not None]
    actual = sum(alloc.get(u.id, 0.0) for u in usages) + idle
    return {
        "records": len(usages),
        "sessions": len([u for u in usages if u.granularity == "session"]),
        "tokens": sum(u.total_tokens or 0 for u in usages),
        "input_tokens": sum(u.input_tokens or 0 for u in usages),
        "output_tokens": sum(u.output_tokens or 0 for u in usages),
        "cache_tokens": sum((u.cache_creation_tokens or 0) + (u.cache_read_tokens or 0) for u in usages),
        "agent_minutes": sum(u.agent_minutes or 0 for u in usages),
        "api_equiv_cost": sum(api_known),
        "api_equiv_unknown_records": len(usages) - len(api_known),
        "actual_spend": actual,
        "spend_unknown_records": len([u for u in usages if u.billing == "api" and usage_api_spend(u) is None]),
        "idle_subscription_cost": idle,
        "linked_records": len([u for u in usages if u.task_id is not None]),
    }


def outcome_flow(usages: list, tasks_by_id: dict, alloc: dict[int, float]) -> list[dict]:
    """Where usage went: tokens and cost by the outcome of the task it is linked to."""
    order = ["verified", "accepted", "failed", "in_progress", "unlinked"]
    acc = {k: {"bucket": k, "tokens": 0, "actual_spend": 0.0, "api_equiv_cost": 0.0, "records": 0} for k in order}
    for u in usages:
        t = tasks_by_id.get(u.task_id) if u.task_id else None
        if t is None:
            b = "unlinked"
        elif t.human_accepted and t.verified:
            b = "verified"
        elif t.human_accepted:
            b = "accepted"
        elif t.outcome in RESOLVED:
            b = "failed"
        else:
            b = "in_progress"
        acc[b]["tokens"] += u.total_tokens or 0
        acc[b]["actual_spend"] += alloc.get(u.id, 0.0)
        acc[b]["api_equiv_cost"] += u.api_equiv_cost or 0.0
        acc[b]["records"] += 1
    return [acc[k] for k in order]


def weekly_series(tasks: list, usages: list, alloc: dict[int, float], start: date, end: date) -> list[dict]:
    weeks: list[date] = []
    w = week_start(start)
    while w <= end:
        weeks.append(w)
        w += timedelta(days=7)
    t_by: dict[date, list] = defaultdict(list)
    for t in tasks:
        t_by[week_start(to_date(t.created_at))].append(t)
    u_by: dict[date, list] = defaultdict(list)
    for u in usages:
        u_by[week_start(u.usage_date)].append(u)
    out = []
    for w in weeks:
        tm = task_metrics(t_by[w])
        um = usage_metrics(u_by[w], alloc)
        out.append({
            "week": w.isoformat(),
            "attempted": tm["attempted"],
            "resolved": tm["resolved"],
            "accepted": tm["accepted"],
            "verified": tm["verified"],
            "failed": tm["failed"],
            "accepted_unverified": tm["accepted"] - tm["verified"],
            "first_pass_rate": tm["first_pass_rate"]["value"],
            "success_rate": tm["success_rate"]["value"],
            "rework_rate": tm["rework_rate"]["value"],
            "human_minutes": tm["human_minutes_total"],
            "tokens": um["tokens"],
            "sessions": um["sessions"],
            "actual_spend": um["actual_spend"],
            "api_equiv_cost": um["api_equiv_cost"],
            "cost_per_accepted": (um["actual_spend"] / tm["accepted"]) if tm["accepted"] else None,
            "tokens_per_accepted": (um["tokens"] / tm["accepted"]) if tm["accepted"] else None,
            "partial": w + timedelta(days=6) > end,
        })
    return out


# ---------- efficiency & work uplift ----------

def reference_baselines(all_tasks: list) -> dict[tuple[str, str], dict]:
    """Median user-entered reference human minutes per (category, difficulty)."""
    refs: dict[tuple[str, str], list[float]] = defaultdict(list)
    for t in all_tasks:
        if t.reference_human_minutes:
            refs[(t.category, t.difficulty)].append(t.reference_human_minutes)
    return {k: {"median": median(v), "n": len(v)} for k, v in refs.items()}


def reference_for(t, baselines: dict) -> tuple[float | None, str, str]:
    """(reference_minutes, source, confidence)."""
    if t.reference_human_minutes:
        return t.reference_human_minutes, "user_entered", "high"
    b = baselines.get((t.category, t.difficulty))
    if b and b["n"] >= UPLIFT_EST_MEDIUM_N:
        return b["median"], "historical_estimate", "medium"
    if b and b["n"] >= UPLIFT_EST_LOW_N:
        return b["median"], "historical_estimate", "low"
    return None, "missing", "none"


def work_uplift(tasks: list, baselines: dict) -> dict:
    resolved = [t for t in tasks if t.outcome in RESOLVED]
    accepted = [t for t in resolved if t.human_accepted]
    rows, missing_ref, missing_actual = [], 0, 0
    for t in accepted:
        ref, src, conf = reference_for(t, baselines)
        if ref is None:
            missing_ref += 1
            continue
        if t.human_minutes is None:
            missing_actual += 1
            continue
        rows.append({"task_id": t.id, "reference": ref, "actual": t.human_minutes, "source": src,
                     "confidence": conf, "ratio": ref / max(t.human_minutes, 1.0)})
    ratios = [r["ratio"] for r in rows]
    high = [r for r in rows if r["confidence"] == "high"]
    failed_minutes = sum(t.human_minutes or 0 for t in resolved if not t.human_accepted)
    ref_sum = sum(r["reference"] for r in rows)
    act_sum = sum(r["actual"] for r in rows)
    conf_counts = {c: len([r for r in rows if r["confidence"] == c]) for c in ("high", "medium", "low")}
    if len(high) >= 10 and conf_counts["high"] / max(len(rows), 1) >= 0.6:
        overall = "medium" if len(rows) < 30 else "high"
    elif len(rows) >= 5:
        overall = "low"
    else:
        overall = "insufficient"
    return {
        "accepted": len(accepted),
        "included": len(rows),
        "coverage": (len(rows) / len(accepted)) if accepted else None,
        "missing_reference": missing_ref,
        "missing_actual_effort": missing_actual,
        "confidence_counts": conf_counts,
        "overall_confidence": overall,
        "median_ratio": quantile(ratios, 0.5),
        "p25_ratio": quantile(ratios, 0.25),
        "p75_ratio": quantile(ratios, 0.75),
        "portfolio_ratio": (ref_sum / (act_sum + failed_minutes)) if (act_sum + failed_minutes) else None,
        "reference_minutes": ref_sum,
        "actual_minutes": act_sum,
        "failed_attempt_minutes": failed_minutes,
        "minutes_difference_user_ref_only": sum(r["reference"] - r["actual"] for r in high),
        "minutes_difference_all": ref_sum - act_sum - failed_minutes,
        "rows": rows,
    }


def efficiency_cells(tasks: list, cost_by_task: dict[int, float], api_by_task: dict[int, float],
                     agent_min_by_task: dict[int, float]) -> list[dict]:
    cells: dict[tuple[str, str], list] = defaultdict(list)
    for t in tasks:
        cells[(t.category, t.difficulty)].append(t)
    out = []
    for (cat, diff), ts in cells.items():
        m = task_metrics(ts)
        acc = [t for t in ts if t.human_accepted]
        cost = sum(cost_by_task.get(t.id, 0.0) for t in ts)
        api = sum(api_by_task.get(t.id, 0.0) for t in ts)
        out.append({
            "category": cat, "difficulty": diff,
            "resolved": m["resolved"], "accepted": m["accepted"],
            "success_rate": m["success_rate"],
            "rework_rate": m["rework_rate"],
            "human_minutes_median": m["human_minutes_per_accepted_median"],
            "agent_minutes_median": med(agent_min_by_task.get(t.id) for t in acc),
            "cost_per_accepted": (cost / len(acc)) if acc else None,
            "api_equiv_per_accepted": (api / len(acc)) if acc else None,
            "sufficient": m["resolved"] >= MIN_CELL_N,
        })
    order = {c: i for i, c in enumerate(CATEGORIES)}
    dord = {d: i for i, d in enumerate(DIFFICULTIES)}
    out.sort(key=lambda r: (order.get(r["category"], 99), dord.get(r["difficulty"], 99)))
    return out


# ---------- comparisons ----------

def mix_adjusted_success(groups: dict, min_cell: int = MIN_CELL_N) -> dict:
    """Direct standardisation of success rate over (category, difficulty) cells every group has observed."""
    per_group: dict = {}
    for g, ts in groups.items():
        cells: dict = defaultdict(lambda: [0, 0])
        for t in ts:
            if t.outcome in RESOLVED:
                c = cells[(t.category, t.difficulty)]
                c[1] += 1
                c[0] += 1 if t.human_accepted else 0
        per_group[g] = cells
    if not per_group:
        return {"common_cells": [], "groups": {}}
    common = None
    for cells in per_group.values():
        ok = {k for k, v in cells.items() if v[1] >= min_cell}
        common = ok if common is None else common & ok
    common = sorted(common or [])
    pooled = {c: sum(per_group[g][c][1] for g in per_group) for c in common}
    total = sum(pooled.values())
    res = {}
    for g, cells in per_group.items():
        n_g = sum(v[1] for v in cells.values())
        if not common or not total:
            res[g] = {"adjusted_success": None, "coverage": 0.0}
            continue
        adj = sum(pooled[c] / total * cells[c][0] / cells[c][1] for c in common)
        cov = sum(cells[c][1] for c in common) / n_g if n_g else 0.0
        res[g] = {"adjusted_success": adj, "coverage": cov}
    return {"common_cells": [{"category": c[0], "difficulty": c[1], "n": pooled[c]} for c in common], "groups": res}


def _cost_per(um: dict, acc: int) -> float | None:
    if not acc or (um["records"] and um["spend_unknown_records"] == um["records"]):
        return None
    return um["actual_spend"] / acc


def compare_groups(tasks: list, usages: list, alloc: dict[int, float], task_key: Callable, usage_key: Callable,
                   min_n: int = MIN_DRIFT_N, keys: list | None = None) -> dict:
    t_groups: dict = defaultdict(list)
    for t in tasks:
        k = task_key(t)
        if k is not None:
            t_groups[k].append(t)
    u_groups: dict = defaultdict(list)
    for u in usages:
        k = usage_key(u)
        if k is not None:
            u_groups[k].append(u)
    eligible = {g: ts for g, ts in t_groups.items()
                if len([t for t in ts if t.outcome in RESOLVED]) >= min_n and (not keys or g in keys)}
    adjusted = mix_adjusted_success(eligible)
    rows = []
    for g in sorted(set(t_groups) | set(u_groups), key=str):
        ts, us = t_groups.get(g, []), u_groups.get(g, [])
        m = task_metrics(ts)
        um = usage_metrics(us, alloc)
        acc = m["accepted"]
        cat_rates = {}
        for cat in CATEGORIES:
            ct = [t for t in ts if t.category == cat]
            cm = task_metrics(ct)
            cat_rates[cat] = cm["success_rate"]
        rows.append({
            "key": g,
            "metrics": m,
            "usage": um,
            "cost_per_accepted": _cost_per(um, acc),
            "api_equiv_per_accepted": (um["api_equiv_cost"] / acc) if acc and um["api_equiv_unknown_records"] < um["records"] else None,
            "api_equiv_coverage": ((um["records"] - um["api_equiv_unknown_records"]) / um["records"]) if um["records"] else None,
            "tokens_per_accepted": (um["tokens"] / acc) if acc else None,
            "interventions_per_task": (sum(t.intervention_count or 0 for t in ts if t.outcome in RESOLVED) / m["resolved"]) if m["resolved"] else None,
            "sufficient_sample": len([t for t in ts if t.outcome in RESOLVED]) >= min_n,
            "in_adjustment": g in eligible,
            "adjusted": adjusted["groups"].get(g),
            "by_category": cat_rates,
        })
    return {"rows": rows, "common_cells": adjusted["common_cells"], "adjusted_groups": list(eligible), "min_n": min_n}


# ---------- performance drift ----------

def _label(n_r: int, n_b: int, d: tuple | None, min_n: int, threshold: float) -> str:
    if n_r < min_n or n_b < min_n or d is None:
        return "insufficient_evidence"
    diff, lo, hi = d
    excludes_zero = lo > 0 or hi < 0
    if excludes_zero and abs(diff) >= threshold:
        return "consistent_change"
    if excludes_zero or abs(diff) >= threshold:
        return "possible_change"
    return "no_meaningful_change"


def _dist(ts: list, attr: str) -> dict:
    d: dict = defaultdict(int)
    for t in ts:
        d[getattr(t, attr)] += 1
    return dict(d)


def _stratified_baseline(recent: list, baseline: list, success: Callable) -> float | None:
    """Baseline rate re-weighted to the recent window's category x difficulty mix."""
    rc: dict = defaultdict(int)
    for t in recent:
        rc[(t.category, t.difficulty)] += 1
    bc: dict = defaultdict(lambda: [0, 0])
    for t in baseline:
        c = bc[(t.category, t.difficulty)]
        c[1] += 1
        c[0] += 1 if success(t) else 0
    usable = {k: v for k, v in rc.items() if bc[k][1] > 0}
    tot = sum(usable.values())
    if not tot:
        return None
    return sum(v / tot * bc[k][0] / bc[k][1] for k, v in usable.items())


def drift(tasks: list, key: Callable, end: date, recent_weeks: int = 3, baseline_weeks: int = 5,
          min_n: int = MIN_DRIFT_N, threshold: float = DRIFT_THRESHOLD) -> dict:
    recent_start = end - timedelta(days=recent_weeks * 7 - 1)
    base_end = recent_start - timedelta(days=1)
    base_start = recent_start - timedelta(days=baseline_weeks * 7)
    groups: dict = defaultdict(lambda: ([], []))
    for t in tasks:
        if t.outcome not in RESOLVED:
            continue
        d = to_date(t.created_at)
        g = key(t)
        if g is None:
            continue
        if recent_start <= d <= end:
            groups[g][0].append(t)
        elif base_start <= d <= base_end:
            groups[g][1].append(t)

    metrics = {
        "success_rate": (lambda t: bool(t.human_accepted), "higher_is_better"),
        "first_pass_rate": (is_first_pass, "higher_is_better"),
    }
    results = []
    for g, (rec, base) in sorted(groups.items(), key=lambda kv: str(kv[0])):
        findings = []
        for name, (fn, direction) in metrics.items():
            kr, kb = sum(1 for t in rec if fn(t)), sum(1 for t in base if fn(t))
            d = diff_ci(kr, len(rec), kb, len(base))
            label = _label(len(rec), len(base), d, min_n, threshold)
            adj_b = _stratified_baseline(rec, base, fn)
            adj_diff = (kr / len(rec) - adj_b) if (rec and adj_b is not None) else None
            findings.append({
                "metric": name,
                "direction": direction,
                "recent": rate(kr, len(rec)),
                "baseline": rate(kb, len(base)),
                "diff": d[0] if d else None,
                "diff_ci_low": d[1] if d else None,
                "diff_ci_high": d[2] if d else None,
                "mix_adjusted_diff": adj_diff,
                "label": label,
            })
        # rework among accepted, higher is worse
        ra = [t for t in rec if t.human_accepted]
        ba = [t for t in base if t.human_accepted]
        kr, kb = sum(1 for t in ra if t.rework_cycles), sum(1 for t in ba if t.rework_cycles)
        d = diff_ci(kr, len(ra), kb, len(ba))
        findings.append({
            "metric": "rework_rate", "direction": "lower_is_better",
            "recent": rate(kr, len(ra)), "baseline": rate(kb, len(ba)),
            "diff": d[0] if d else None, "diff_ci_low": d[1] if d else None, "diff_ci_high": d[2] if d else None,
            "mix_adjusted_diff": None,
            "label": _label(len(ra), len(ba), d, min_n, threshold),
        })
        confounders = []
        vr, vb = {t.harness_version for t in rec if t.harness_version}, {t.harness_version for t in base if t.harness_version}
        if vr and vb and vr != vb:
            confounders.append({"type": "harness_version_change", "detail": f"Harness versions changed: {', '.join(sorted(vb))} → {', '.join(sorted(vr))}"})
        for attr, lbl, thr in (("category", "task category mix", 0.2), ("difficulty", "difficulty mix", 0.2),
                               ("project_id", "project mix", 0.25), ("harness_id", "harness mix", 0.2)):
            v = tvd(_dist(rec, attr), _dist(base, attr))
            if v > thr:
                confounders.append({"type": f"{attr}_shift", "detail": f"Shift in {lbl} (TVD {v:.2f})"})
        sr = findings[0]
        if sr["diff"] is not None and sr["mix_adjusted_diff"] is not None and abs(sr["diff"] - sr["mix_adjusted_diff"]) > 0.05:
            confounders.append({"type": "mix_sensitivity", "detail": f"Success change is {sr['diff']*100:+.0f} pts raw vs {sr['mix_adjusted_diff']*100:+.0f} pts after mix adjustment"})
        if min_n <= min(len(rec), len(base)) < 2 * min_n:
            confounders.append({"type": "small_sample", "detail": f"Samples are modest (recent n={len(rec)}, baseline n={len(base)})"})
        labels = [f["label"] for f in findings]
        overall = ("consistent_change" if "consistent_change" in labels else
                   "possible_change" if "possible_change" in labels else
                   "insufficient_evidence" if all(l == "insufficient_evidence" for l in labels) else
                   "no_meaningful_change")
        results.append({"key": g, "recent_n": len(rec), "baseline_n": len(base), "findings": findings,
                        "confounders": confounders, "overall": overall})
    return {
        "recent_window": {"start": recent_start.isoformat(), "end": end.isoformat()},
        "baseline_window": {"start": base_start.isoformat(), "end": base_end.isoformat()},
        "min_n": min_n, "threshold": threshold, "groups": results,
    }


def weekly_group_rates(tasks: list, key: Callable) -> dict:
    out: dict = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    for t in tasks:
        if t.outcome not in RESOLVED:
            continue
        g = key(t)
        if g is None:
            continue
        c = out[g][week_start(to_date(t.created_at)).isoformat()]
        c[0] += 1
        c[1] += 1 if t.human_accepted else 0
        c[2] += 1 if is_first_pass(t) else 0
    return {g: [{"week": w, "n": v[0], "success_rate": v[1] / v[0], "first_pass_rate": v[2] / v[0]}
                for w, v in sorted(weeks.items())] for g, weeks in out.items()}
