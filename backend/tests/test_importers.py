"""Parser tests using realistic ccusage export fixtures."""
import json
from datetime import date

import pytest

from workrate.importers import ParseError, guess_mapping, parse_ccusage, parse_csv
from workrate.pricing import normalize_model_name

CLAUDE_DAILY = {
    "daily": [
        {"date": "2026-05-04", "inputTokens": 1200, "outputTokens": 45000, "cacheCreationTokens": 80000,
         "cacheReadTokens": 1900000, "totalTokens": 2026200, "totalCost": 2.91,
         "modelsUsed": ["claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101"],
         "modelBreakdowns": [
             {"modelName": "claude-sonnet-4-5-20250929", "inputTokens": 1000, "outputTokens": 40000,
              "cacheCreationTokens": 70000, "cacheReadTokens": 1700000, "cost": 2.0},
             {"modelName": "claude-opus-4-5-20251101", "inputTokens": 200, "outputTokens": 5000,
              "cacheCreationTokens": 10000, "cacheReadTokens": 200000, "cost": 0.91}]},
        {"date": "not-a-date", "inputTokens": 1},
    ],
    "totals": {"inputTokens": 1200},
}

CODEX_DAILY = {
    "daily": [{"date": "Sep 15, 2025", "inputTokens": 100000, "cachedInputTokens": 60000, "outputTokens": 5000,
               "reasoningOutputTokens": 2000, "totalTokens": 105000, "costUSD": 0.2,
               "models": {"gpt-5-codex": {"inputTokens": 100000, "cachedInputTokens": 60000, "outputTokens": 5000,
                                          "reasoningOutputTokens": 2000, "totalTokens": 105000, "isFallback": False}}}],
}

SESSIONS = {"sessions": [{"sessionId": "abc-123", "projectPath": "/home/me/atlas-web", "inputTokens": 10,
                          "outputTokens": 20, "cacheCreationTokens": 0, "cacheReadTokens": 0, "totalTokens": 30,
                          "totalCost": 0.01, "lastActivity": "2026-05-05", "modelsUsed": ["claude-haiku-4-5"]}]}


def test_normalize_model_name_strips_dates_and_provider():
    assert normalize_model_name("claude-sonnet-4-5-20250929") == "claude-sonnet-4-5"
    assert normalize_model_name("anthropic/Claude-Opus-4-5") == "claude-opus-4-5"


def test_claude_daily_breakdowns_become_one_row_per_model():
    rows, fmt, _ = parse_ccusage(json.dumps(CLAUDE_DAILY))
    assert fmt == "ccusage-daily"
    parsed = [r for r in rows if r["status"] == "parsed"]
    assert [r["model_name"] for r in parsed] == ["claude-sonnet-4-5", "claude-opus-4-5"]
    assert parsed[0]["total_tokens"] == 1000 + 40000 + 70000 + 1700000
    assert parsed[0]["reported_cost"] == 2.0
    assert parsed[0]["usage_date"] == date(2026, 5, 4)
    assert [r["status"] for r in rows].count("invalid") == 1


def test_codex_cached_tokens_are_separated():
    rows, _, _ = parse_ccusage(json.dumps(CODEX_DAILY))
    r = rows[0]
    assert r["usage_date"] == date(2025, 9, 15)
    assert r["input_tokens"] == 40000 and r["cache_read_tokens"] == 60000
    assert r["reported_cost"] == pytest.approx(0.2)


def test_session_report_keeps_session_and_project():
    rows, fmt, _ = parse_ccusage(json.dumps(SESSIONS))
    assert fmt == "ccusage-session"
    assert rows[0]["session_key"] == "abc-123" and rows[0]["project_hint"] == "/home/me/atlas-web"
    assert rows[0]["granularity"] == "session"


def test_monthly_report():
    rows, fmt, _ = parse_ccusage(json.dumps({"monthly": [{"month": "2026-04", "inputTokens": 5, "outputTokens": 5,
                                                           "modelsUsed": ["gpt-5"], "totalCost": 1}]}))
    assert fmt == "ccusage-monthly" and rows[0]["usage_date"] == date(2026, 4, 1)
    assert rows[0]["granularity"] == "monthly"


def test_invalid_json_and_unknown_shape_raise():
    with pytest.raises(ParseError):
        parse_ccusage("{nope")
    with pytest.raises(ParseError):
        parse_ccusage(json.dumps({"foo": []}))


def test_csv_auto_mapping_and_missing_fields():
    content = "Date,Model,Input Tokens,Output Tokens,Cost USD,Session ID\n2026-05-04,glm-4.6,100,50,,s1\n,x,1,1,,\n2026-05-05,,0,0,,\n"
    rows, headers, mapping = parse_csv(content, None)
    assert mapping["date"] == "Date" and mapping["cost"] == "Cost USD"
    assert rows[0]["total_tokens"] == 150 and rows[0]["reported_cost"] is None and rows[0]["session_key"] == "s1"
    assert rows[1]["status"] == "invalid"
    assert "Model not specified" in rows[2]["warnings"] and "Zero tokens" in rows[2]["warnings"]
    assert guess_mapping(["day", "tokens"])["total_tokens"] == "tokens"


def test_csv_without_date_column_returns_headers_for_mapping():
    rows, headers, mapping = parse_csv("model,tokens\nx,1\n", None)
    assert rows == [] and headers == ["model", "tokens"] and mapping["date"] is None
