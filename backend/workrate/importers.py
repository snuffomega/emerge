"""Parsers that turn ccusage JSON exports and generic CSV into normalised usage rows (no DB access)."""
from __future__ import annotations

import csv
import hashlib
import io
import json
from datetime import date, datetime

from .pricing import normalize_model_name

CSV_FIELDS = ["date", "session_id", "model", "input_tokens", "output_tokens", "cache_creation_tokens",
              "cache_read_tokens", "total_tokens", "cost", "project", "agent_minutes", "billing"]

CSV_ALIASES = {
    "date": ["date", "day", "usage_date", "timestamp", "lastactivity", "last_activity"],
    "session_id": ["session_id", "sessionid", "session", "id"],
    "model": ["model", "model_name", "modelname", "models"],
    "input_tokens": ["input_tokens", "inputtokens", "input", "prompt_tokens"],
    "output_tokens": ["output_tokens", "outputtokens", "output", "completion_tokens"],
    "cache_creation_tokens": ["cache_creation_tokens", "cachecreationtokens", "cache_write_tokens", "cache_creation"],
    "cache_read_tokens": ["cache_read_tokens", "cachereadtokens", "cached_input_tokens", "cache_read"],
    "total_tokens": ["total_tokens", "totaltokens", "tokens", "total"],
    "cost": ["cost", "cost_usd", "costusd", "totalcost", "total_cost"],
    "project": ["project", "project_name", "projectpath", "project_path", "repo"],
    "agent_minutes": ["agent_minutes", "duration_minutes", "minutes", "duration"],
    "billing": ["billing", "billing_type", "plan"],
}


class ParseError(ValueError):
    pass


def parse_date(v) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000 if v > 1e11 else v).date()
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m", "%b %d, %Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _int(v) -> int:
    try:
        return int(float(v)) if v not in (None, "") else 0
    except (TypeError, ValueError):
        return 0


def _float(v) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def identity_key(harness: str, granularity: str, session_key: str | None, d: date, model: str) -> str:
    raw = f"{harness}|{granularity}|{session_key or ''}|{d.isoformat()}|{model}"
    return hashlib.sha256(raw.encode()).hexdigest()[:40]


def _tokens(obj: dict) -> dict:
    inp = _int(obj.get("inputTokens"))
    cached = obj.get("cachedInputTokens")
    cr = _int(obj.get("cacheReadTokens", obj.get("cacheReadInputTokens", cached)))
    cw = _int(obj.get("cacheCreationTokens", obj.get("cacheCreationInputTokens")))
    out = _int(obj.get("outputTokens"))
    note = None
    if cached is not None and "cacheReadTokens" not in obj and cr <= inp:
        inp -= cr  # Codex reports cached input as a subset of input tokens
        note = "cached input tokens separated from input tokens"
    total = _int(obj.get("totalTokens")) or (inp + out + cw + cr)
    return {"input_tokens": inp, "output_tokens": out, "cache_creation_tokens": cw, "cache_read_tokens": cr,
            "total_tokens": total, "_note": note}


def _cost(obj: dict) -> float | None:
    for k in ("cost", "totalCost", "costUSD", "cost_usd"):
        if k in obj and obj[k] is not None:
            return _float(obj[k])
    return None


ENTRY_KEYS = {"daily": "daily", "weekly": "weekly", "monthly": "monthly", "sessions": "session", "session": "session",
              "blocks": "session", "data": "daily"}


def parse_ccusage(content: str) -> tuple[list[dict], str, list[str]]:
    try:
        doc = json.loads(content)
    except json.JSONDecodeError as e:
        raise ParseError(f"Invalid JSON: {e.msg} (line {e.lineno})")
    entries, granularity, report = None, None, None
    if isinstance(doc, list):
        entries, granularity, report = doc, "daily", "daily"
    else:
        for k, g in ENTRY_KEYS.items():
            if isinstance(doc.get(k), list):
                entries, granularity, report = doc[k], g, k
                break
    if entries is None:
        raise ParseError("No ccusage report found. Expected a 'daily', 'weekly', 'monthly', 'sessions' or 'blocks' array.")
    file_warnings: list[str] = []
    rows: list[dict] = []
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            rows.append({"index": i, "status": "invalid", "warnings": ["Entry is not an object"], "raw": e})
            continue
        if e.get("isGap"):
            continue
        if report == "blocks":
            d = parse_date(e.get("startTime"))
            session_key = e.get("id") or e.get("startTime")
            tok_src = e.get("tokenCounts") or e
        else:
            d = parse_date(e.get("date") or e.get("week") or e.get("month") or e.get("lastActivity"))
            session_key = e.get("sessionId") or e.get("session") if granularity == "session" else None
            tok_src = e
        project = e.get("projectPath") or e.get("project")
        base_warn = []
        if d is None:
            rows.append({"index": i, "status": "invalid", "warnings": ["Missing or unparseable date"], "raw": e})
            continue
        breakdowns: list[tuple[str, dict, float | None]] = []
        if isinstance(e.get("modelBreakdowns"), list) and e["modelBreakdowns"]:
            for b in e["modelBreakdowns"]:
                breakdowns.append((b.get("modelName") or b.get("model") or "unknown", b, _cost(b)))
        elif isinstance(e.get("models"), dict) and e["models"]:
            total_cost = _cost(e)
            tot = sum(_int(v.get("totalTokens")) or 1 for v in e["models"].values())
            for name, b in e["models"].items():
                share = (_int(b.get("totalTokens")) or 1) / tot
                c = total_cost * share if total_cost is not None else None
                breakdowns.append((name, b, c))
            if len(e["models"]) > 1 and total_cost is not None:
                base_warn.append("Reported cost apportioned across models by token share")
            if any(isinstance(b, dict) and b.get("isFallback") for b in e["models"].values()):
                base_warn.append("ccusage used fallback pricing for at least one model")
        else:
            models = e.get("modelsUsed") or e.get("models") or []
            if isinstance(models, list) and len(models) == 1:
                name = models[0]
            elif isinstance(models, list) and len(models) > 1:
                name = "+".join(sorted(models))
                base_warn.append("Multiple models without breakdown; recorded as a combined model")
            else:
                name = "unknown"
                base_warn.append("Model not specified")
            breakdowns.append((name, tok_src, _cost(e)))
        for name, b, c in breakdowns:
            t = _tokens(b)
            warns = list(base_warn)
            if t.pop("_note"):
                warns.append("Cached input tokens separated from input tokens")
            if t["total_tokens"] == 0:
                warns.append("Zero tokens")
            rows.append({
                "index": i, "status": "parsed", "granularity": granularity, "usage_date": d,
                "session_key": str(session_key) if session_key else None,
                "raw_model_name": name, "model_name": normalize_model_name(name) if name != "unknown" else "unknown",
                **t, "reported_cost": c, "project_hint": project, "agent_minutes": None, "billing": None,
                "warnings": warns, "raw": b if b is not e else e,
            })
    if not rows:
        file_warnings.append("The report contained no entries")
    return rows, f"ccusage-{report if report != 'sessions' else 'session'}", file_warnings


def guess_mapping(headers: list[str]) -> dict[str, str | None]:
    norm = {h: h.strip().lower().replace(" ", "_").replace("-", "_") for h in headers}
    mapping: dict[str, str | None] = {}
    for f in CSV_FIELDS:
        mapping[f] = next((h for h, n in norm.items() if n in CSV_ALIASES[f] or n.replace("_", "") in CSV_ALIASES[f]), None)
    return mapping


def parse_csv(content: str, mapping: dict[str, str | None] | None) -> tuple[list[dict], list[str], dict]:
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    headers = reader.fieldnames or []
    if not headers:
        raise ParseError("CSV has no header row")
    mapping = {**guess_mapping(headers), **{k: v for k, v in (mapping or {}).items() if v}}
    if not mapping.get("date"):
        return [], headers, mapping
    rows = []
    for i, r in enumerate(reader):
        get = lambda f: r.get(mapping[f]) if mapping.get(f) else None  # noqa: E731
        d = parse_date(get("date"))
        if d is None:
            rows.append({"index": i, "status": "invalid", "warnings": ["Missing or unparseable date"], "raw": r})
            continue
        warns = []
        name = (get("model") or "").strip() or "unknown"
        if name == "unknown":
            warns.append("Model not specified")
        inp, out = _int(get("input_tokens")), _int(get("output_tokens"))
        cw, cr = _int(get("cache_creation_tokens")), _int(get("cache_read_tokens"))
        total = _int(get("total_tokens")) or (inp + out + cw + cr)
        if total == 0:
            warns.append("Zero tokens")
        billing = (get("billing") or "").strip().lower() or None
        if billing not in (None, "api", "subscription"):
            warns.append(f"Unknown billing '{billing}', defaulting")
            billing = None
        sid = (get("session_id") or "").strip() or None
        rows.append({
            "index": i, "status": "parsed", "granularity": "session" if sid else "daily", "usage_date": d,
            "session_key": sid, "raw_model_name": name,
            "model_name": normalize_model_name(name) if name != "unknown" else "unknown",
            "input_tokens": inp, "output_tokens": out, "cache_creation_tokens": cw, "cache_read_tokens": cr,
            "total_tokens": total, "reported_cost": _float(get("cost")), "project_hint": get("project") or None,
            "agent_minutes": _float(get("agent_minutes")), "billing": billing, "warnings": warns, "raw": r,
        })
    return rows, headers, mapping
