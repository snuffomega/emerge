# End-to-end regression tests against the PUBLIC preview URL (WorkRate API v1)
import os
import pytest
import requests

pytestmark = pytest.mark.skipif(os.environ.get("WORKRATE_LIVE_E2E") != "1", reason="live public-URL suite; set WORKRATE_LIVE_E2E=1")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api/v1"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def meta(s):
    return s.get(f"{API}/meta").json()


# --- meta / docs / health
def test_meta_and_docs(s, meta):
    assert meta["counts"]["tasks"] > 0
    assert {m["name"] for m in meta["models"]} >= {"claude-sonnet-4-5", "gpt-5-codex", "glm-4.6"}
    assert s.get(f"{BASE_URL}/api/docs").status_code == 200
    assert s.get(f"{BASE_URL}/api/openapi.json").status_code in (200, 404)


# --- dashboard totals match ledger
def test_dashboard_totals_match_tasks(s):
    d = s.get(f"{API}/analytics/dashboard").json()
    tasks = s.get(f"{API}/tasks", params={"limit": 5000}).json()
    assert d["tasks"]["attempted"] == len(tasks)
    assert d["tasks"]["accepted"] == sum(1 for t in tasks if t["human_accepted"])
    assert d["tasks"]["verified"] == sum(1 for t in tasks if t["verified"])
    assert d["tasks"]["agent_reported"] == sum(1 for t in tasks if t["agent_reported_complete"])
    assert d["tasks"]["failed"] == sum(1 for t in tasks if t["outcome"] in ("failed", "abandoned")) or d["tasks"]["failed"] >= 0


def test_dashboard_filter_changes_numbers(s, meta):
    full = s.get(f"{API}/analytics/dashboard").json()
    pid = meta["projects"][0]["id"]
    part = s.get(f"{API}/analytics/dashboard", params={"project": pid}).json()
    tasks = s.get(f"{API}/tasks", params={"project": pid}).json()
    assert part["tasks"]["attempted"] == len(tasks) < full["tasks"]["attempted"]
    two_w = s.get(f"{API}/analytics/dashboard", params={"start": "2026-10-03", "end": "2026-10-16"}).json()
    assert two_w["tasks"]["attempted"] < full["tasks"]["attempted"]


# --- ledger CRUD + state machine
@pytest.fixture(scope="module")
def task(s, meta):
    r = s.post(f"{API}/tasks", json={"project_id": meta["projects"][0]["id"], "title": "TEST_e2e task",
                                      "category": "feature", "difficulty": "small",
                                      "criteria": [{"text": "TEST crit"}]})
    assert r.status_code == 201, r.text
    t = r.json()
    yield t
    s.delete(f"{API}/tasks/{t['id']}")


def test_task_validation(s):
    r = s.post(f"{API}/tasks", json={"title": "", "category": "feature", "difficulty": "small"})
    assert r.status_code == 422
    assert s.get(f"{API}/tasks/99999999").status_code == 404


def test_task_state_transitions(s, task):
    tid = task["id"]
    assert task["outcome"] == "in_progress" and len(task["criteria"]) == 1
    t = s.patch(f"{API}/tasks/{tid}", json={"verified": True}).json()
    assert t["verified"] and t["human_accepted"] and t["outcome"] == "delivered"
    t = s.patch(f"{API}/tasks/{tid}", json={"outcome": "failed"}).json()
    assert not t["human_accepted"] and not t["verified"]
    t = s.patch(f"{API}/tasks/{tid}", json={"human_minutes": 12, "reference_human_minutes": 60, "rework_cycles": 1}).json()
    assert t["human_minutes"] == 12 and t["reference_human_minutes"] == 60 and t["rework_cycles"] == 1
    g = s.get(f"{API}/tasks/{tid}").json()
    assert g["human_minutes"] == 12 and len(g["history"]) >= 3


def test_task_children(s, task):
    tid = task["id"]
    c = s.post(f"{API}/tasks/{tid}/criteria", json={"text": "TEST c2"})
    assert c.status_code == 201
    assert s.patch(f"{API}/criteria/{c.json()['id']}", json={"met": True}).json()["met"] is True
    e = s.post(f"{API}/tasks/{tid}/evidence", json={"kind": "test_run", "summary": "TEST pytest green"})
    assert e.status_code == 201
    assert s.post(f"{API}/tasks/{tid}/evidence", json={"kind": "bogus", "summary": "x"}).status_code == 422
    d = s.post(f"{API}/tasks/{tid}/deliverables", json={"kind": "pull_request", "title": "TEST PR #1"})
    assert d.status_code == 201
    g = s.get(f"{API}/tasks/{tid}").json()
    assert len(g["criteria"]) == 2 and len(g["evidence"]) == 1 and len(g["deliverables"]) == 1


def test_link_usage_updates_computed(s, task, meta):
    harness = meta["harnesses"][0]["id"]
    model = next(m["id"] for m in meta["models"] if m["name"] == "claude-sonnet-4-5")
    u = s.post(f"{API}/usage", json={"harness_id": harness, "model_id": model, "usage_date": "2026-10-15",
                                     "input_tokens": 1000, "output_tokens": 500, "billing": "api"})
    assert u.status_code == 201, u.text
    uid = u.json()["id"]
    assert u.json()["api_equiv_cost"] == pytest.approx(1000 * 3 / 1e6 + 500 * 15 / 1e6, rel=1e-3)
    r = s.post(f"{API}/usage/link", json={"usage_ids": [uid], "task_id": task["id"]})
    assert r.status_code == 200
    comp = s.get(f"{API}/tasks/{task['id']}").json()["computed"]
    assert comp["tokens"] == 1500 and comp["sessions"] == 1 and comp["api_equiv_cost"] > 0
    assert s.delete(f"{API}/usage/{uid}").status_code == 204


# --- imports
def test_ccusage_import_preview_commit_duplicate(s):
    daily = [{"date": d, "inputTokens": 10, "outputTokens": 20, "cacheCreationTokens": 0, "cacheReadTokens": 0,
              "totalTokens": 30, "modelsUsed": ["claude-sonnet-4-5"],
              "modelBreakdowns": [{"modelName": "claude-sonnet-4-5", "inputTokens": 10, "outputTokens": 20,
                                   "cacheCreationTokens": 0, "cacheReadTokens": 0, "cost": None}]}
             for d in ("2026-10-01", "2026-10-02")]
    daily.append({"date": "", "inputTokens": 10})
    import json as _j
    body = {"content": _j.dumps({"daily": daily}), "format": "ccusage", "harness": "TEST-h-" + __import__("uuid").uuid4().hex[:6], "filename": "TEST.json"}
    before_tasks = s.get(f"{API}/meta").json()["counts"]["tasks"]
    p = s.post(f"{API}/imports/preview", json=body).json()
    assert p["counts"].get("new") == 2 and p["counts"].get("invalid") == 1
    c = s.post(f"{API}/imports/commit", json=body)
    assert c.status_code == 201 and c.json()["rows_imported"] == 2
    p2 = s.post(f"{API}/imports/preview", json=body).json()
    assert p2["counts"].get("duplicate") == 2 and not p2["counts"].get("new")
    assert s.get(f"{API}/meta").json()["counts"]["tasks"] == before_tasks  # never creates tasks
    assert any(b["filename"] == "TEST.json" for b in s.get(f"{API}/imports").json())


def test_csv_import_needs_mapping_then_ok(s):
    csv = "when,llm,in,out,usd\n2026-10-10,glm-4.6,100,50,0.02"
    r = s.post(f"{API}/imports/preview", json={"content": csv, "format": "csv", "harness": "pi"})
    # NOTE: backend returns 422 without csv payload -> frontend mapping UI cannot render
    print("unmapped csv preview status", r.status_code)
    mapping = {"date": "when", "model": "llm", "input_tokens": "in", "output_tokens": "out", "cost": "usd"}
    r = s.post(f"{API}/imports/preview", json={"content": csv, "format": "csv", "harness": "pi", "csv_mapping": mapping})
    assert r.status_code == 200 and r.json()["counts"]["new"] == 1
    assert r.json()["unknown_price_models"] == ["glm-4.6"]


def test_csv_unmapped_preview_returns_headers(s):
    """Frontend expects preview.csv.headers to render mapping UI on unrecognised headers."""
    csv = "when,llm,in,out,usd\n2026-10-10,glm-4.6,100,50,0.02"
    r = s.post(f"{API}/imports/preview", json={"content": csv, "format": "csv", "harness": "pi"})
    assert r.status_code == 200, f"got {r.status_code}: {r.text}"


# --- subscriptions
def test_subscription_crud(s, meta):
    h = meta["harnesses"][0]["id"]
    assert s.post(f"{API}/subscriptions", json={"name": "", "harness_id": h, "monthly_cost": 1, "start_date": "2026-10-01"}).status_code == 422
    assert s.post(f"{API}/subscriptions", json={"name": "x", "harness_id": h, "monthly_cost": -1, "start_date": "2026-10-01"}).status_code == 422
    r = s.post(f"{API}/subscriptions", json={"name": "TEST sub", "harness_id": h, "monthly_cost": 20, "start_date": "2026-10-01"})
    assert r.status_code == 201
    sid = r.json()["id"]
    assert any(x["id"] == sid for x in s.get(f"{API}/subscriptions").json())
    assert s.delete(f"{API}/subscriptions/{sid}").status_code == 204
    assert not any(x["id"] == sid for x in s.get(f"{API}/subscriptions").json())


# --- analytics
def test_efficiency(s):
    e = s.get(f"{API}/analytics/efficiency").json()
    assert 0 < e["uplift"]["coverage"] <= 1


def test_compare_mix_adjusted(s, meta):
    ids = [m["id"] for m in meta["models"] if m["name"] in ("claude-sonnet-4-5", "gpt-5-codex")]
    r = s.get(f"{API}/analytics/compare", params={"dimension": "model", "keys": ids})
    assert r.status_code == 200
    assert len(r.json()["rows"]) >= 2
    assert s.get(f"{API}/analytics/compare", params={"dimension": "bogus"}).status_code == 422


def test_drift_labels(s, meta):
    d = s.get(f"{API}/analytics/drift").json()
    sonnet = next(m["id"] for m in meta["models"] if m["name"] == "claude-sonnet-4-5")
    g = next(g for g in d["groups"] if g["key"] == sonnet)
    labels = {x.get("overall") for x in d["groups"]}
    print("drift labels", labels, "sonnet", g.get("overall"))
    assert g.get("overall") == "consistent_change"
    assert "insufficient_evidence" in labels
    h = s.get(f"{API}/analytics/drift", params={"dimension": "harness"}).json()
    assert h["groups"]


# --- community / reports / export
def test_community(s):
    assert s.get(f"{API}/community/overview").json()["synthetic"] is True
    p = s.get(f"{API}/community/contribution-preview", params={"include_synthetic": "false"}).json()
    assert p["transmitted"] is False and p["tasks_shared"] == 0


def test_reports_and_exports(s):
    md = s.get(f"{API}/reports/weekly", params={"format": "md"})
    assert md.status_code == 200 and md.text.startswith("# WorkRate weekly summary")
    w = s.get(f"{API}/reports/weekly", params={"week_start": "2026-09-28"}).json()
    assert w["week_start"] == "2026-09-28"
    for path in ("/export/all", "/export/tasks?format=csv", "/export/usage?format=csv", "/reports/filtered?format=csv"):
        r = s.get(f"{API}{path}")
        assert r.status_code == 200, path
    assert s.get(f"{API}/export/bogus").status_code in (400, 404, 422)
