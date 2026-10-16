# Iteration 2 live retests against the public URL (CSV mapping, extra=forbid, computed api-equiv, community buckets)
import os
import pytest
import requests

pytestmark = pytest.mark.skipif(os.environ.get("WORKRATE_LIVE_E2E") != "1", reason="live suite; set WORKRATE_LIVE_E2E=1")
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api/v1"
CSV = "when,llm,in,out,usd\n2026-10-10,glm-4.6,100,50,0.02"


@pytest.fixture(scope="module", autouse=True)
def reset():
    requests.post(f"{BASE}/demo/reset", timeout=60)
    yield
    requests.post(f"{BASE}/demo/reset", timeout=60)


def _body(mapping=None):
    return {"content": CSV, "filename": "pasted", "format": "csv", "harness": "pi", "billing": "api", "project_id": None,
            "csv_mapping": mapping, "mode": "skip"}


# CSV unmapped headers -> 200 with headers + file warning
def test_csv_unmapped_preview():
    r = requests.post(f"{BASE}/imports/preview", json=_body())
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["csv"]["headers"] == ["when", "llm", "in", "out", "usd"]
    assert d["file_warnings"]
    assert d["counts"].get("new", 0) == 0


# CSV remap -> 1 new with 150 tokens, then commit
def test_csv_remap_and_commit():
    m = {"date": "when", "model": "llm", "input_tokens": "in", "output_tokens": "out", "cost": "usd"}
    r = requests.post(f"{BASE}/imports/preview", json=_body(m))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["counts"]["new"] == 1
    assert d["rows"][0]["total_tokens"] == 150
    c = requests.post(f"{BASE}/imports/commit", json=_body(m))
    assert c.status_code == 201, c.text
    assert c.json()["rows_imported"] == 1
    r2 = requests.post(f"{BASE}/imports/preview", json=_body(m)).json()
    assert r2["counts"].get("duplicate") == 1


# extra fields rejected
def test_patch_unknown_field_422():
    r = requests.patch(f"{BASE}/tasks/1", json={"reference_minutes": 5})
    assert r.status_code == 422


def test_create_task_unknown_field_422():
    r = requests.post(f"{BASE}/tasks", json={"title": "TEST_x", "bogus": 1})
    assert r.status_code == 422


# create task with criteria works
def test_create_task_with_criteria():
    meta = requests.get(f"{BASE}/meta").json()
    body = {"title": "TEST_iter2 task", "project_id": meta["projects"][0]["id"],
            "category": "feature", "difficulty": "small",
            "criteria": [{"text": "crit A"}, {"text": "crit B"}]}
    r = requests.post(f"{BASE}/tasks", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    assert len(d["criteria"]) == 2
    g = requests.get(f"{BASE}/tasks/{d['id']}").json()
    assert g["title"] == "TEST_iter2 task"
    requests.delete(f"{BASE}/tasks/{d['id']}")


# computed api_equiv null for tasks with only unpriced (glm-4.6) usage
def test_computed_api_equiv_null_for_unpriced():
    tasks = requests.get(f"{BASE}/tasks").json()
    found = next((t for t in tasks if t["usage_count"] > 0 and t["api_equiv_cost"] is None), None)
    assert found, "no pi/glm task"
    d = requests.get(f"{BASE}/tasks/{found['id']}").json()
    usage = d.get("usage", [])
    if usage and all(u.get("api_equiv_cost") is None for u in usage):
        assert d["computed"]["api_equiv_cost"] is None
    else:
        pytest.skip(f"task {found['id']} has priced usage")


# community contribution buckets
def test_contribution_preview_synthetic_on():
    d = requests.get(f"{BASE}/community/contribution-preview", params={"include_synthetic": "true"}).json()
    assert d["tasks_shared"] > 0
    assert d["buckets"] and "week" not in d["buckets"][0]
    assert d["period"]["from_month"] <= d["period"]["to_month"]


def test_contribution_preview_synthetic_off():
    d = requests.get(f"{BASE}/community/contribution-preview", params={"include_synthetic": "false"}).json()
    assert d["tasks_shared"] == 0


def test_tasks_default_limit():
    assert len(requests.get(f"{BASE}/tasks").json()) >= 410
