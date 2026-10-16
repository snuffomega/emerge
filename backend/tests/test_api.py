"""End-to-end API tests against a real SQLite database (migrations + seed + full user journey)."""
import json
from datetime import date, timedelta

import pytest

V = "/api/v1"


def test_seed_is_synthetic_and_spans_eight_weeks(client, seeded):
    assert seeded["tasks"] > 200
    m = client.get(f"{V}/meta").json()
    assert m["counts"]["synthetic_tasks"] == m["counts"]["tasks"]
    span = date.fromisoformat(m["range"]["end"]) - date.fromisoformat(m["range"]["start"])
    assert span.days >= 56
    assert {"claude-code", "codex", "pi", "hermes"} <= {h["name"] for h in m["harnesses"]}


def test_dashboard_matches_persisted_records(client, seeded):
    d = client.get(f"{V}/analytics/dashboard").json()
    tasks = client.get(f"{V}/tasks", params={"limit": 5000}).json()
    assert d["tasks"]["attempted"] == len(tasks)
    assert d["tasks"]["accepted"] == sum(1 for t in tasks if t["human_accepted"])
    assert d["tasks"]["verified"] == sum(1 for t in tasks if t["verified"])
    # every verified task is accepted, every accepted task is delivered
    assert all(t["human_accepted"] and t["outcome"] == "delivered" for t in tasks if t["verified"])
    assert sum(w["accepted"] for w in d["weekly"]) == d["tasks"]["accepted"]
    flow_spend = sum(b["actual_spend"] for b in d["flow"])
    assert flow_spend + d["usage"]["idle_subscription_cost"] == pytest.approx(d["usage"]["actual_spend"], rel=1e-6)
    assert d["usage"]["api_equiv_unknown_records"] > 0  # glm-4.6 has no price


def test_subscription_spend_equals_amortised_total(client, seeded):
    d = client.get(f"{V}/analytics/dashboard", params={"harness": [1]}).json()
    subs = [s for s in client.get(f"{V}/subscriptions").json() if s["harness_id"] == 1]
    days = d["range"]["days"]
    expected = sum(s["monthly_cost"] * 12 / 365 for s in subs) * days
    assert d["usage"]["actual_spend"] == pytest.approx(expected, rel=1e-6)


def test_filters_partition_results(client, seeded):
    m = client.get(f"{V}/meta").json()
    total = client.get(f"{V}/analytics/dashboard").json()["tasks"]["attempted"]
    parts = sum(client.get(f"{V}/analytics/dashboard", params={"model": [x["id"]]}).json()["tasks"]["attempted"] for x in m["models"])
    assert parts == total
    assert client.get(f"{V}/analytics/dashboard", params={"start": "2026-02-02", "end": "2026-01-01"}).status_code == 422


def test_drift_flags_seeded_sonnet_change_with_evidence(client, seeded):
    r = client.get(f"{V}/analytics/drift", params={"dimension": "model"}).json()
    by = {g["label"]: g for g in r["groups"]}
    son = by["claude-sonnet-4-5"]
    fp = next(f for f in son["findings"] if f["metric"] == "first_pass_rate")
    assert fp["diff"] < 0
    assert son["overall"] in ("possible_change", "consistent_change")
    # small groups must never be labelled as changed
    for g in r["groups"]:
        if g["recent_n"] < r["min_n"] or g["baseline_n"] < r["min_n"]:
            assert all(f["label"] == "insufficient_evidence" for f in g["findings"][:2])


def test_codex_drift_lists_confounders(client, seeded):
    r = client.get(f"{V}/analytics/drift", params={"dimension": "harness"}).json()
    codex = next(g for g in r["groups"] if g["label"] == "Codex CLI")
    assert any(c["type"] == "harness_version_change" for c in codex["confounders"])


def test_compare_and_efficiency(client, seeded):
    ids = {x["name"]: x["id"] for x in client.get(f"{V}/meta").json()["models"]}
    c = client.get(f"{V}/analytics/compare", params={"dimension": "model", "keys": [ids["claude-sonnet-4-5"], ids["gpt-5-codex"]]}).json()
    assert c["rows"] and c["common_cells"] and len(c["adjusted_groups"]) == 2
    glm = next(r for r in c["rows"] if r["key"] == ids["glm-4.6"])
    assert glm["cost_per_accepted"] is None  # unpriced API usage must not look free
    for r in c["rows"]:
        sr = r["metrics"]["success_rate"]
        if sr["n"]:
            assert sr["ci_low"] <= sr["value"] <= sr["ci_high"]
    e = client.get(f"{V}/analytics/efficiency").json()
    assert 0 < e["uplift"]["coverage"] <= 1
    assert e["uplift"]["p25_ratio"] <= e["uplift"]["median_ratio"] <= e["uplift"]["p75_ratio"]
    m = client.get(f"{V}/meta").json()["range"]
    end = date.fromisoformat(m["end"])
    p = client.get(f"{V}/analytics/compare", params={"dimension": "period", "a_start": str(end - timedelta(days=55)),
                                                      "a_end": str(end - timedelta(days=28)), "b_start": str(end - timedelta(days=27)), "b_end": str(end)}).json()
    assert {r["key"] for r in p["rows"]} == {"A", "B"}


CCUSAGE = {"daily": [
    {"date": "2026-05-20", "inputTokens": 1000, "outputTokens": 20000, "cacheCreationTokens": 5000, "cacheReadTokens": 400000,
     "totalTokens": 426000, "totalCost": 0.5, "modelsUsed": ["claude-sonnet-4-5-20250929"],
     "modelBreakdowns": [{"modelName": "claude-sonnet-4-5-20250929", "inputTokens": 1000, "outputTokens": 20000,
                          "cacheCreationTokens": 5000, "cacheReadTokens": 400000, "cost": 0.5}]},
    {"date": "2026-05-21", "inputTokens": 10, "outputTokens": 10, "totalTokens": 20, "totalCost": 0.01,
     "modelsUsed": ["mystery-model-x"], "modelBreakdowns": [{"modelName": "mystery-model-x", "inputTokens": 10, "outputTokens": 10, "cost": None}]},
    {"date": "", "inputTokens": 5},
]}


def test_full_journey_import_link_outcome_analyse_export(client, seeded):
    body = {"content": json.dumps(CCUSAGE), "filename": "ccusage-daily.json", "format": "auto", "harness": "claude-code",
            "billing": "api"}
    pv = client.post(f"{V}/imports/preview", json=body).json()
    assert pv["counts"] == {"new": 2, "invalid": 1}
    assert "mystery-model-x" in pv["unknown_price_models"]
    before = client.get(f"{V}/meta").json()["counts"]["tasks"]
    b = client.post(f"{V}/imports/commit", json=body).json()
    assert b["rows_imported"] == 2 and b["rows_invalid"] == 1
    # imported usage never creates tasks
    assert client.get(f"{V}/meta").json()["counts"]["tasks"] == before
    # re-import: duplicates skipped
    pv2 = client.post(f"{V}/imports/preview", json=body).json()
    assert pv2["counts"] == {"duplicate": 2, "invalid": 1}
    assert client.post(f"{V}/imports/commit", json=body).json()["rows_imported"] == 0
    # changed export with overwrite mode
    changed = json.loads(json.dumps(CCUSAGE))
    changed["daily"][0]["modelBreakdowns"][0]["outputTokens"] = 30000
    body2 = {**body, "content": json.dumps(changed), "mode": "overwrite"}
    assert client.post(f"{V}/imports/preview", json=body2).json()["counts"]["changed"] == 1
    assert client.post(f"{V}/imports/commit", json=body2).json()["rows_overwritten"] == 1

    usage = [u for u in client.get(f"{V}/usage", params={"start": "2026-05-20", "end": "2026-05-21"}).json()
             if u["source"] == "ccusage-daily"]
    assert len(usage) == 2
    known = next(u for u in usage if u["raw_model_name"].startswith("claude"))
    unknown = next(u for u in usage if u["raw_model_name"] == "mystery-model-x")
    assert known["price_status"] == "table" and known["api_equiv_cost"] > 0
    assert unknown["price_status"] == "source_reported" or unknown["api_equiv_cost"] is None

    m = client.get(f"{V}/meta").json()
    proj = m["projects"][0]["id"]
    model = next(x["id"] for x in m["models"] if x["name"] == "claude-sonnet-4-5")
    t = client.post(f"{V}/tasks", json={"project_id": proj, "title": "Journey task", "category": "bugfix",
                                        "difficulty": "small", "model_id": model, "harness_id": 1,
                                        "created_at": "2026-05-20T09:00:00", "criteria": [{"text": "Tests pass"}]}).json()
    assert t["outcome"] == "in_progress" and not t["human_accepted"]
    assert client.post(f"{V}/usage/link", json={"usage_ids": [known["id"]], "task_id": t["id"]}).json()["linked"] == 1
    t2 = client.patch(f"{V}/tasks/{t['id']}", json={"agent_reported_complete": True, "human_minutes": 20, "rework_cycles": 1,
                                                    "reference_human_minutes": 90, "verified": True}).json()
    assert t2["human_accepted"] and t2["outcome"] == "delivered" and t2["verified_at"]
    fields = {h["field"] for h in t2["history"]}
    assert {"human_accepted", "verified", "rework_cycles", "human_minutes"} <= fields
    assert t2["computed"]["tokens"] == known["total_tokens"]
    assert t2["computed"]["uplift_ratio"] == pytest.approx(90 / 20)
    client.post(f"{V}/tasks/{t['id']}/evidence", json={"kind": "test_run", "summary": "pytest 120 passed"})
    # failing a task clears acceptance
    t3 = client.patch(f"{V}/tasks/{t['id']}", json={"outcome": "failed"}).json()
    assert not t3["human_accepted"] and not t3["verified"] and t3["accepted_at"] is None
    client.patch(f"{V}/tasks/{t['id']}", json={"verified": True})

    rep = client.get(f"{V}/reports/weekly", params={"week_start": "2026-05-18"}).json()
    assert any(c["id"] == t["id"] for c in rep["completed"]) is False  # accepted_at is "now", not that week
    md = client.get(f"{V}/reports/weekly", params={"format": "md"})
    assert md.status_code == 200 and md.text.startswith("# WorkRate weekly summary")
    csv_r = client.get(f"{V}/export/tasks", params={"format": "csv"})
    assert csv_r.headers["content-type"].startswith("text/csv") and "Journey task" in csv_r.text
    full = client.get(f"{V}/export/all").json()
    assert any(tt["title"] == "Journey task" for tt in full["tasks"]) and full["evidence"]
    fr = client.get(f"{V}/reports/filtered", params={"format": "csv", "dimension": "harness"})
    assert "success_rate" in fr.text.splitlines()[0]


def test_csv_import_with_mapping(client, seeded):
    content = "when,llm,in,out,usd\n2026-05-22,glm-4.6,100,50,0.02\n"
    body = {"content": content, "format": "csv", "harness": "pi", "billing": "api",
            "csv_mapping": {"date": "when", "model": "llm", "input_tokens": "in", "output_tokens": "out", "cost": "usd"}}
    pv = client.post(f"{V}/imports/preview", json=body).json()
    assert pv["counts"] == {"new": 1} and pv["rows"][0]["total_tokens"] == 150
    assert client.post(f"{V}/imports/commit", json=body).json()["rows_imported"] == 1
    unmapped = client.post(f"{V}/imports/preview", json={**body, "csv_mapping": None}).json()
    assert unmapped["csv"]["headers"] == ["when", "llm", "in", "out", "usd"] and unmapped["file_warnings"] and unmapped["total"] == 0
    assert client.post(f"{V}/imports/preview", json={**body, "content": "not json, not csv"}).status_code == 200
    assert client.post(f"{V}/imports/preview", json={**body, "format": "ccusage", "content": "{bad"}).status_code == 422
    assert client.patch(f"{V}/tasks/1", json={"reference_minutes": 5}).status_code == 422  # unknown fields rejected


def test_model_price_edit_reprices_usage(client, seeded):
    m = next(x for x in client.get(f"{V}/meta").json()["models"] if x["name"] == "glm-4.6")
    r = client.patch(f"{V}/models/{m['id']}", json={"input_price": 0.6, "output_price": 2.2}).json()
    assert r["repriced_usage_records"] > 0
    u = client.get(f"{V}/usage", params={"model": [m["id"]], "limit": 5}).json()
    assert all(x["price_status"] == "table" for x in u)


def test_community_preview_never_shares_identifiers(client, seeded):
    c = client.get(f"{V}/community/overview").json()
    assert c["synthetic"] is True
    p = client.get(f"{V}/community/contribution-preview").json()
    assert p["transmitted"] is False
    blob = json.dumps(p["buckets"])
    for proj in client.get(f"{V}/meta").json()["projects"]:
        assert proj["name"] not in blob
    assert all(b["n"] >= p["k_anonymity"] for b in p["buckets"])
    assert p["tasks_shared"] > 0 and p["tasks_shared"] + p["tasks_suppressed"] == p["tasks_considered"]
    assert all("week" not in b for b in p["buckets"])


def test_validation_and_404(client, seeded):
    assert client.post(f"{V}/tasks", json={"project_id": 1, "title": "x", "category": "nope", "difficulty": "small"}).status_code == 422
    assert client.post(f"{V}/tasks", json={"project_id": 9999, "title": "x", "category": "docs", "difficulty": "small"}).status_code == 404
    assert client.get(f"{V}/tasks/999999").status_code == 404
    assert client.patch(f"{V}/tasks/1", json={"rework_cycles": -1}).status_code == 422
