"""Unit tests for analytical calculations (pure functions, realistic fixtures)."""
from datetime import date, datetime, timedelta
from types import SimpleNamespace as NS

import pytest

from workrate import analytics as a


def task(i, outcome="delivered", accepted=True, verified=False, rework=0, interventions=0, human=60.0,
         ref=None, cat="feature", diff="medium", created=datetime(2026, 5, 4, 9), hours=5, reported=True,
         model=1, harness=1, version="1.0", project=1):
    return NS(id=i, outcome=outcome, human_accepted=accepted, verified=verified, rework_cycles=rework,
              intervention_count=interventions, human_minutes=human, reference_human_minutes=ref, category=cat,
              difficulty=diff, created_at=created, accepted_at=created + timedelta(hours=hours) if accepted else None,
              agent_reported_complete=reported, model_id=model, harness_id=harness, harness_version=version,
              project_id=project)


def usage(i, d=date(2026, 5, 4), tokens=1000, billing="subscription", api=1.0, reported=None, harness=1, task_id=None,
          gran="session", model=1, project=1):
    return NS(id=i, usage_date=d, total_tokens=tokens, billing=billing, api_equiv_cost=api, reported_cost=reported,
              harness_id=harness, task_id=task_id, granularity=gran, model_id=model, project_id=project,
              input_tokens=tokens, output_tokens=0, cache_creation_tokens=0, cache_read_tokens=0, agent_minutes=10)


def test_wilson_interval_bounds_and_known_value():
    lo, hi = a.wilson(8, 10)
    assert 0.49 < lo < 0.50 and 0.94 < hi < 0.95
    assert a.wilson(0, 0) is None
    lo, hi = a.wilson(0, 5)
    assert lo == 0.0 and hi > 0


def test_task_metrics_distinguishes_reported_accepted_verified():
    ts = [
        task(1, verified=True),
        task(2, rework=2, interventions=1),
        task(3, outcome="failed", accepted=False, reported=True, human=30),  # agent over-claimed
        task(4, outcome="abandoned", accepted=False, reported=False, human=None),
        task(5, outcome="in_progress", accepted=False, reported=False),
    ]
    m = a.task_metrics(ts)
    assert m["attempted"] == 5 and m["resolved"] == 4 and m["in_progress"] == 1
    assert m["accepted"] == 2 and m["verified"] == 1 and m["failed"] == 2
    assert m["success_rate"]["value"] == pytest.approx(0.5)
    assert m["first_pass_rate"]["k"] == 1
    assert m["rework_rate"]["value"] == pytest.approx(0.5)
    assert m["overclaim_rate"]["k"] == 1 and m["overclaim_rate"]["n"] == 3
    assert m["human_minutes_missing"] == 1
    assert m["human_minutes_on_failed"] == 30


def test_subscription_cost_split_by_token_share_and_idle():
    sub = NS(harness_id=1, monthly_cost=36.5 * 30 / 12 * 12 / 30, start_date=date(2026, 5, 1), end_date=None)
    daily = a.daily_subscription_cost(sub, date(2026, 5, 4))
    us = [usage(1, tokens=3000), usage(2, tokens=1000), usage(3, billing="api", api=2.5)]
    alloc, idle, unknown = a.allocate_costs(us, [sub], date(2026, 5, 4), date(2026, 5, 5))
    assert alloc[1] == pytest.approx(daily * 0.75)
    assert alloc[2] == pytest.approx(daily * 0.25)
    assert alloc[3] == 2.5
    assert idle[1] == pytest.approx(daily)  # 5 May has no usage
    assert not unknown


def test_unknown_api_price_is_flagged_not_guessed():
    us = [usage(1, billing="api", api=None, reported=None)]
    alloc, _, unknown = a.allocate_costs(us, [], date(2026, 5, 4), date(2026, 5, 4))
    assert alloc[1] == 0.0 and unknown == {1: True}
    m = a.usage_metrics(us, alloc)
    assert m["api_equiv_unknown_records"] == 1


def test_outcome_flow_buckets():
    ts = {1: task(1, verified=True), 2: task(2), 3: task(3, outcome="failed", accepted=False)}
    us = [usage(1, task_id=1), usage(2, task_id=2), usage(3, task_id=3), usage(4)]
    flow = {r["bucket"]: r for r in a.outcome_flow(us, ts, {1: 1, 2: 2, 3: 3, 4: 4})}
    assert flow["verified"]["actual_spend"] == 1 and flow["accepted"]["actual_spend"] == 2
    assert flow["failed"]["actual_spend"] == 3 and flow["unlinked"]["actual_spend"] == 4


def test_work_uplift_confidence_and_failed_time():
    hist = [task(100 + i, ref=240) for i in range(5)]  # 5 user references for feature/medium
    ts = [task(1, ref=120, human=60), task(2, human=80), task(3, cat="docs", diff="trivial", human=10),
          task(4, outcome="failed", accepted=False, human=40)]
    b = a.reference_baselines(hist + ts)
    up = a.work_uplift(ts, b)
    assert up["included"] == 2 and up["missing_reference"] == 1
    assert up["confidence_counts"]["high"] == 1 and up["confidence_counts"]["medium"] == 1
    assert up["failed_attempt_minutes"] == 40
    # portfolio ratio penalises failed attempts: (120+240)/(60+80+40)
    assert up["portfolio_ratio"] == pytest.approx(360 / 180)
    assert up["overall_confidence"] == "insufficient"


def test_drift_requires_minimum_sample():
    end = date(2026, 6, 7)
    rec = [task(i, created=datetime(2026, 6, 1, 9)) for i in range(5)]
    base = [task(100 + i, created=datetime(2026, 5, 1, 9), accepted=False, outcome="failed") for i in range(5)]
    res = a.drift(rec + base, lambda t: t.model_id, end, 3, 5)
    assert res["groups"][0]["findings"][0]["label"] == "insufficient_evidence"


def test_drift_detects_consistent_change_and_harness_confounder():
    end = date(2026, 6, 7)
    rec = [task(i, created=datetime(2026, 6, 1, 9), accepted=i % 2 == 0, outcome="delivered" if i % 2 == 0 else "failed",
                version="2.0") for i in range(40)]
    base = [task(100 + i, created=datetime(2026, 5, 1, 9), accepted=i % 10 != 0,
                 outcome="delivered" if i % 10 != 0 else "failed") for i in range(40)]
    g = a.drift(rec + base, lambda t: t.model_id, end, 3, 5)["groups"][0]
    sr = g["findings"][0]
    assert sr["diff"] == pytest.approx(0.5 - 0.9)
    assert sr["label"] == "consistent_change"
    assert any(c["type"] == "harness_version_change" for c in g["confounders"])


def test_drift_small_difference_is_not_flagged():
    end = date(2026, 6, 7)
    rec = [task(i, created=datetime(2026, 6, 1, 9), accepted=i % 10 != 0, outcome="delivered" if i % 10 != 0 else "failed") for i in range(40)]
    base = [task(100 + i, created=datetime(2026, 5, 1, 9), accepted=i % 10 != 0, outcome="delivered" if i % 10 != 0 else "failed") for i in range(40)]
    g = a.drift(rec + base, lambda t: t.model_id, end, 3, 5)["groups"][0]
    assert g["findings"][0]["label"] == "no_meaningful_change"


def test_mix_adjusted_success_controls_for_difficulty():
    # Model 1 does only easy tasks, model 2 mostly hard; within each cell they are equal.
    g1 = [task(i, diff="small", accepted=i % 10 != 0, outcome="delivered" if i % 10 != 0 else "failed") for i in range(20)]
    g1 += [task(50 + i, diff="large", accepted=i % 2 == 0, outcome="delivered" if i % 2 == 0 else "failed") for i in range(4)]
    g2 = [task(100 + i, diff="small", accepted=i % 10 != 0, outcome="delivered" if i % 10 != 0 else "failed") for i in range(10)]
    g2 += [task(200 + i, diff="large", accepted=i % 2 == 0, outcome="delivered" if i % 2 == 0 else "failed") for i in range(20)]
    raw1 = a.task_metrics(g1)["success_rate"]["value"]
    raw2 = a.task_metrics(g2)["success_rate"]["value"]
    adj = a.mix_adjusted_success({1: g1, 2: g2})
    assert raw1 - raw2 > 0.2
    assert adj["groups"][1]["adjusted_success"] == pytest.approx(adj["groups"][2]["adjusted_success"])


def test_weekly_series_marks_partial_week():
    ts = [task(1, created=datetime(2026, 5, 4, 9)), task(2, created=datetime(2026, 5, 12, 9))]
    s = a.weekly_series(ts, [usage(1)], {1: 5.0}, date(2026, 5, 4), date(2026, 5, 13))
    assert [w["week"] for w in s] == ["2026-05-04", "2026-05-11"]
    assert s[0]["accepted"] == 1 and s[0]["cost_per_accepted"] == 5.0
    assert s[1]["partial"] is True
