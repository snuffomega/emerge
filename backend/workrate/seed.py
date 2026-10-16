"""Deterministic synthetic demo data (clearly flagged is_synthetic=True)."""
from __future__ import annotations

import math
import random
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .importers import identity_key
from .models import (AcceptanceCriterion, AgentModel, Deliverable, Evidence, Harness, ImportBatch, Project,
                     Subscription, Task, TaskHistory, UsageRecord)
from .pricing import DEFAULT_PRICES, compute_cost

WEEKS = 10
PROJECTS = [
    ("atlas-web", "Customer-facing React dashboard"),
    ("ledger-api", "Python billing & ledger service"),
    ("infra-platform", "Terraform + Kubernetes platform"),
    ("mobile-sync", "Offline sync engine for the mobile app"),
    ("docs-site", "Developer documentation site"),
]
HARNESSES = [("claude-code", "Claude Code"), ("codex", "Codex CLI"), ("pi", "Pi"), ("hermes", "Hermes Agent")]
UNPRICED = [("glm-4.6", "zhipu"), ("kimi-k2", "moonshot")]
HARNESS_MODELS = {
    "claude-code": [("claude-sonnet-4-5", 0.6), ("claude-opus-4-5", 0.25), ("claude-haiku-4-5", 0.15)],
    "pi": [("glm-4.6", 1.0)],
    "hermes": [("kimi-k2", 1.0)],
}
BASE_SUCCESS = {"claude-opus-4-5": 0.9, "claude-sonnet-4-5": 0.86, "claude-haiku-4-5": 0.8, "gpt-5-codex": 0.78,
                "gpt-5.1-codex": 0.83, "glm-4.6": 0.66, "kimi-k2": 0.7}
BASE_REWORK = {"claude-opus-4-5": 0.2, "claude-sonnet-4-5": 0.22, "claude-haiku-4-5": 0.3, "gpt-5-codex": 0.32,
               "gpt-5.1-codex": 0.28, "glm-4.6": 0.45, "kimi-k2": 0.4}
DIFF_SUCCESS = {"trivial": 0.09, "small": 0.04, "medium": 0.0, "large": -0.16}
DIFF_REWORK = {"trivial": -0.1, "small": 0.0, "medium": 0.08, "large": 0.2}
REF_MIN = {"trivial": 25, "small": 80, "medium": 220, "large": 540}
CAT_FACTOR = {"feature": 1.0, "bugfix": 0.9, "refactor": 1.0, "tests": 0.85, "docs": 0.7, "infra": 1.2}
SESSION_TOKENS = {"trivial": 0.35e6, "small": 1.1e6, "medium": 3.2e6, "large": 8.5e6}
SESSION_MIN = {"trivial": 5, "small": 13, "medium": 30, "large": 62}
TTA_HOURS = {"trivial": (1, 4), "small": (2, 10), "medium": (6, 30), "large": (20, 80)}

SUBJECTS = {
    "atlas-web": ["invoice table", "settings page", "chart tooltips", "auth redirect", "dark mode tokens", "search bar", "onboarding flow"],
    "ledger-api": ["refund endpoint", "currency rounding", "webhook retries", "idempotency keys", "ledger export", "rate limiter", "audit log"],
    "infra-platform": ["staging cluster", "ingress TLS", "node autoscaling", "secrets rotation", "backup policy", "CI runners"],
    "mobile-sync": ["conflict resolver", "delta encoder", "retry queue", "schema migration", "background sync", "offline cache"],
    "docs-site": ["API reference", "quick-start guide", "changelog", "search index", "code samples"],
}
VERBS = {
    "feature": ["Add", "Implement", "Build"], "bugfix": ["Fix", "Resolve crash in", "Patch"],
    "refactor": ["Refactor", "Extract module from", "Simplify"], "tests": ["Add tests for", "Increase coverage of"],
    "docs": ["Document", "Rewrite docs for"], "infra": ["Provision", "Harden", "Automate"],
}
CRITERIA = ["Existing tests pass", "New behaviour covered by tests", "No API contract changes", "Reviewed by a human",
            "Lint and type checks clean", "Performance within 5% of baseline", "Docs updated"]
FAIL_NOTES = ["Agent looped on a failing migration; reverted", "Change broke an unrelated module; abandoned",
              "Solution ignored acceptance criteria; restarted by hand", "Agent claimed completion but tests failed in CI",
              "Hallucinated an internal API; rejected in review"]


def _pick(rng: random.Random, weighted):
    r, acc = rng.random(), 0.0
    for v, w in weighted:
        acc += w
        if r <= acc:
            return v
    return weighted[-1][0]


def clear_all(db: Session) -> None:
    for m in (TaskHistory, Evidence, Deliverable, AcceptanceCriterion, UsageRecord, Task, ImportBatch, Subscription,
              Project, AgentModel, Harness):
        db.execute(delete(m))
    db.commit()


def seed(db: Session, today: date | None = None, seed_value: int = 7) -> dict:
    rng = random.Random(seed_value)
    today = today or date.today()
    start = today - timedelta(days=today.weekday()) - timedelta(weeks=WEEKS - 1)
    projects = {n: Project(name=n, description=d, is_synthetic=True) for n, d in PROJECTS}
    harnesses = {n: Harness(name=n, display_name=d, is_synthetic=True) for n, d in HARNESSES}
    models = {}
    for name in ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "gpt-5-codex", "gpt-5.1-codex"]:
        p = DEFAULT_PRICES[name]
        models[name] = AgentModel(name=name, provider=p[0], input_price=p[1], output_price=p[2], cache_write_price=p[3],
                                  cache_read_price=p[4], is_synthetic=True)
    for name, prov in UNPRICED:
        models[name] = AgentModel(name=name, provider=prov, is_synthetic=True)
    db.add_all([*projects.values(), *harnesses.values(), *models.values()])
    db.flush()
    db.add_all([
        Subscription(name="Claude Max (20x)", harness_id=harnesses["claude-code"].id, monthly_cost=200.0,
                     start_date=start - timedelta(days=30), notes="Synthetic demo subscription", is_synthetic=True),
        Subscription(name="ChatGPT Pro", harness_id=harnesses["codex"].id, monthly_cost=200.0,
                     start_date=start - timedelta(days=30), notes="Synthetic demo subscription", is_synthetic=True),
    ])

    tasks: list[Task] = []
    usage: list[UsageRecord] = []
    pr_no = 400
    n_days = (today - start).days + 1
    for day_i in range(n_days):
        d = start + timedelta(days=day_i)
        week_i = day_i // 7
        weekend = d.weekday() >= 5
        n_tasks = rng.randint(1, 3) if weekend else rng.randint(6, 9)
        for _ in range(n_tasks):
            hname = _pick(rng, [("claude-code", 0.5), ("codex", 0.3), ("pi", 0.1), ("hermes", 0.1)])
            if hname == "codex":
                share_new = min(1.0, max(0.0, (week_i - 3) / 3))
                mname = "gpt-5.1-codex" if rng.random() < share_new else "gpt-5-codex"
                version = "0.46.0" if week_i < 6 else "0.58.0"
            else:
                mname = _pick(rng, HARNESS_MODELS[hname])
                version = {"claude-code": "2.0.31", "pi": "0.9.2", "hermes": "1.4.0"}[hname]
            cat = _pick(rng, [("feature", .3), ("bugfix", .25), ("refactor", .15), ("tests", .12), ("docs", .08), ("infra", .10)])
            easy_shift = hname == "codex" and week_i >= 6
            diff_w = [("trivial", .25), ("small", .45), ("medium", .25), ("large", .05)] if easy_shift else \
                [("trivial", .15), ("small", .35), ("medium", .35), ("large", .15)]
            if mname == "claude-haiku-4-5":
                diff_w = [("trivial", .45), ("small", .45), ("medium", .1)]
            if mname == "claude-opus-4-5":
                diff_w = [("small", .2), ("medium", .45), ("large", .35)]
            diff = _pick(rng, diff_w)
            pname = _pick(rng, [("infra-platform", .7), ("ledger-api", .3)]) if cat == "infra" else \
                "docs-site" if cat == "docs" else _pick(rng, [("atlas-web", .35), ("ledger-api", .3), ("mobile-sync", .25), ("docs-site", .1)])

            drift_on = mname == "claude-sonnet-4-5" and week_i >= WEEKS - 3
            p_succ = BASE_SUCCESS[mname] + DIFF_SUCCESS[diff] - (0.13 if drift_on else 0)
            p_rework = BASE_REWORK[mname] + DIFF_REWORK[diff] + (0.27 if drift_on else 0)
            created = datetime.combine(d, time(rng.randint(8, 18), rng.randint(0, 59)))
            ref = REF_MIN[diff] * CAT_FACTOR[cat] * math.exp(rng.gauss(0, 0.3))
            in_progress = (today - d).days <= 2 and rng.random() < 0.45
            accepted = (not in_progress) and rng.random() < p_succ
            rework = 0
            if accepted and rng.random() < p_rework:
                rework = _pick(rng, [(1, .6), (2, .3), (3, .1)])
            failed = not in_progress and not accepted
            if accepted:
                human = ref * {"trivial": .35, "small": .3, "medium": .27, "large": .33}[diff] * (1 + 0.45 * rework) * math.exp(rng.gauss(0, .25))
            elif failed:
                human = ref * rng.uniform(0.15, 0.4)
            else:
                human = None
            interventions = rework + (1 if rng.random() < 0.25 else 0) + (1 if failed and rng.random() < 0.6 else 0)
            lo, hi = TTA_HOURS[diff]
            tta = rng.uniform(lo, hi) + rework * rng.uniform(3, 10)
            accepted_at = created + timedelta(hours=tta) if accepted else None
            if accepted_at and accepted_at.date() > today:
                accepted_at = datetime.combine(today, time(17, 0))
            verified = accepted and rng.random() < (0.8 if cat in ("bugfix", "tests") else 0.6)
            outcome = "in_progress" if in_progress else "delivered" if accepted else _pick(rng, [("failed", .7), ("abandoned", .3)])
            reported = accepted or (failed and rng.random() < 0.6) or (in_progress and rng.random() < 0.3)
            subj = rng.choice(SUBJECTS[pname])
            t = Task(
                project_id=projects[pname].id, model_id=models[mname].id, harness_id=harnesses[hname].id,
                harness_version=version, title=f"{rng.choice(VERBS[cat])} {subj}",
                description=f"Synthetic demo task: {cat} work on the {subj} in {pname}.", category=cat,
                difficulty=diff, outcome=outcome, created_at=created, agent_reported_complete=reported,
                agent_reported_at=created + timedelta(hours=max(0.5, tta * 0.6)) if reported else None,
                human_accepted=accepted, accepted_at=accepted_at, verified=verified,
                verified_at=accepted_at + timedelta(minutes=rng.randint(10, 240)) if verified else None,
                verification_method=("CI test suite" if cat != "docs" else "Docs build + link check") if verified else None,
                rework_cycles=rework, intervention_count=interventions,
                human_minutes=round(human, 1) if human is not None and rng.random() > 0.04 else None,
                review_minutes=round(human * 0.4, 1) if human is not None else None,
                reference_human_minutes=round(ref / 5) * 5 if rng.random() < 0.55 else None,
                is_synthetic=True,
            )
            crit = rng.sample(CRITERIA, rng.randint(2, 3))
            t.criteria = [AcceptanceCriterion(text=c, met=accepted or rng.random() < 0.4) for c in crit]
            if accepted:
                pr_no += 1
                t.deliverables = [Deliverable(kind="pull_request", title=f"PR #{pr_no}: {t.title}",
                                              url=f"https://example.invalid/{pname}/pull/{pr_no}")]
            ev = []
            if verified:
                ev.append(Evidence(kind="test_run" if cat != "docs" else "ci",
                                   summary=f"CI passed: {rng.randint(40, 900)} tests, 0 failures", created_at=t.verified_at))
            if accepted:
                ev.append(Evidence(kind="review", summary=f"Approved after {rework} rework cycle(s)", created_at=accepted_at))
            if failed:
                ev.append(Evidence(kind="note", summary=rng.choice(FAIL_NOTES), created_at=created + timedelta(hours=tta)))
            t.evidence = ev
            tasks.append(t)

            n_sessions = 1 + rework + (1 if failed and rng.random() < 0.5 else 0)
            for s in range(n_sessions):
                ud = min(today, (created + timedelta(hours=tta * s / max(n_sessions, 1))).date())
                usage.append(_session(rng, t, hname, mname, models, harnesses, projects[pname], ud, diff, drift_on))
        # unlinked exploration sessions
        if not weekend:
            for _ in range(rng.randint(0, 2)):
                hname = _pick(rng, [("claude-code", 0.65), ("codex", 0.35)])
                mname = "claude-sonnet-4-5" if hname == "claude-code" else ("gpt-5.1-codex" if week_i >= 5 else "gpt-5-codex")
                pname = rng.choice(list(projects))
                usage.append(_session(rng, None, hname, mname, models, harnesses, projects[pname], d, "small", False))

    db.add_all(tasks)
    db.flush()
    for u in usage:
        if u._task is not None:
            u.task_id = u._task.id
        db.add(u)
    hist = []
    for t in tasks:
        if t.rework_cycles and t.accepted_at:
            hist.append(TaskHistory(task_id=t.id, changed_at=t.accepted_at, field="rework_cycles",
                                    old_value=str(t.rework_cycles - 1), new_value=str(t.rework_cycles)))
        if t.human_accepted:
            hist.append(TaskHistory(task_id=t.id, changed_at=t.accepted_at, field="human_accepted", old_value="False", new_value="True"))
    db.add_all(hist)
    db.commit()
    return {"tasks": len(tasks), "usage_records": len(usage), "start": start.isoformat(), "end": today.isoformat()}


def _session(rng, task, hname, mname, models, harnesses, project, d, diff, drift_on) -> UsageRecord:
    total = SESSION_TOKENS[diff] * math.exp(rng.gauss(0, 0.35)) * (1.25 if drift_on else 1.0)
    if hname == "codex":
        split = (0.25, 0.05, 0.0, 0.70)
    elif hname == "claude-code":
        split = (0.02, 0.05, 0.08, 0.85)
    else:
        split = (0.55, 0.08, 0.0, 0.37)
    inp, out, cw, cr = (int(total * s) for s in split)
    model = models[mname]
    billing = "subscription" if hname in ("claude-code", "codex") else "api"
    reported = round(total / 1e6 * 0.9, 4) if mname == "kimi-k2" else None
    sk = f"syn-{rng.getrandbits(48):012x}"
    u = UsageRecord(
        source="synthetic", granularity="session", harness_id=harnesses[hname].id, model_id=model.id,
        project_id=project.id, session_key=sk, usage_date=d,
        agent_minutes=round(SESSION_MIN[diff] * math.exp(rng.gauss(0, 0.3)), 1), input_tokens=inp, output_tokens=out,
        cache_creation_tokens=cw, cache_read_tokens=cr, total_tokens=inp + out + cw + cr, billing=billing,
        reported_cost=reported, raw_model_name=mname, is_synthetic=True,
        dedupe_key=identity_key(hname, "session", sk, d, mname),
    )
    c = compute_cost(model, inp, out, cw, cr)
    u.api_equiv_cost, u.price_status = (c, "table") if c is not None else (reported, "source_reported") if reported else (None, "unknown")
    u._task = task
    return u
