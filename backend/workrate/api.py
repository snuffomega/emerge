"""REST API v1."""
from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from . import analytics as A
from . import community, seed, services as S
from .db import get_db
from .importers import ParseError
from .models import (AcceptanceCriterion, AgentModel, Deliverable, Evidence, Harness, ImportBatch, Project,
                     Subscription, Task, UsageRecord)
from .schemas import (CriterionIn, CriterionOut, CriterionPatch, DeliverableIn, DeliverableOut, EvidenceIn,
                      EvidenceOut, HarnessIn, HarnessOut, ImportBatchOut, ImportRequest, LinkRequest, ModelIn,
                      ModelOut, ModelPatch, ProjectIn, ProjectOut, SubscriptionIn, SubscriptionOut,
                      SubscriptionPatch, TaskDetail, TaskIn, TaskListItem, TaskOut, TaskPatch, UsageIn, UsageOut,
                      UsagePatch)

API_VERSION = "1.0.0"
router = APIRouter(prefix="/api/v1")


def filters(start: date | None = None, end: date | None = None, project: list[int] = Query(default=[]),
            model: list[int] = Query(default=[]), harness: list[int] = Query(default=[])) -> S.Filters:
    if start and end and start > end:
        raise HTTPException(422, "start must be on or before end")
    return S.Filters(start, end, project, model, harness)


def _get(db: Session, cls, oid: int):
    obj = db.get(cls, oid)
    if obj is None:
        raise HTTPException(404, f"{cls.__name__} {oid} not found")
    return obj


# ---------- meta & reference data ----------

@router.get("/meta", tags=["meta"])
def meta(db: Session = Depends(get_db)):
    lo, hi = S.data_range(db)
    return {
        "api_version": API_VERSION,
        "range": {"start": lo.isoformat(), "end": hi.isoformat()},
        "projects": [ProjectOut.model_validate(p).model_dump() for p in db.scalars(select(Project).order_by(Project.name))],
        "models": [ModelOut.model_validate(m).model_dump() for m in db.scalars(select(AgentModel).order_by(AgentModel.name))],
        "harnesses": [HarnessOut.model_validate(h).model_dump() for h in db.scalars(select(Harness).order_by(Harness.name))],
        "categories": A.CATEGORIES, "difficulties": A.DIFFICULTIES,
        "counts": {"tasks": db.scalar(select(func.count(Task.id))), "usage": db.scalar(select(func.count(UsageRecord.id))),
                   "synthetic_tasks": db.scalar(select(func.count(Task.id)).where(Task.is_synthetic.is_(True)))},
        "thresholds": {"min_drift_n": A.MIN_DRIFT_N, "drift_threshold": A.DRIFT_THRESHOLD, "min_cell_n": A.MIN_CELL_N},
    }


@router.post("/projects", response_model=ProjectOut, status_code=201, tags=["reference"])
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    if db.scalar(select(Project).where(Project.name == body.name)):
        raise HTTPException(409, "Project already exists")
    p = Project(**body.model_dump())
    db.add(p)
    db.commit()
    return p


@router.patch("/projects/{pid}", response_model=ProjectOut, tags=["reference"])
def update_project(pid: int, body: ProjectIn, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    p.name, p.description = body.name, body.description
    db.commit()
    return p


@router.post("/models", response_model=ModelOut, status_code=201, tags=["reference"])
def create_model(body: ModelIn, db: Session = Depends(get_db)):
    if db.scalar(select(AgentModel).where(AgentModel.name == body.name)):
        raise HTTPException(409, "Model already exists")
    m = AgentModel(**body.model_dump())
    db.add(m)
    db.commit()
    return m


@router.patch("/models/{mid}", tags=["reference"])
def update_model(mid: int, body: ModelPatch, db: Session = Depends(get_db)):
    m = _get(db, AgentModel, mid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    n = S.reprice_model(db, m)
    db.commit()
    return {"model": ModelOut.model_validate(m).model_dump(), "repriced_usage_records": n}


@router.post("/harnesses", response_model=HarnessOut, status_code=201, tags=["reference"])
def create_harness(body: HarnessIn, db: Session = Depends(get_db)):
    if db.scalar(select(Harness).where(Harness.name == body.name)):
        raise HTTPException(409, "Harness already exists")
    h = Harness(**body.model_dump())
    db.add(h)
    db.commit()
    return h


# ---------- subscriptions ----------

@router.get("/subscriptions", response_model=list[SubscriptionOut], tags=["costs"])
def list_subs(db: Session = Depends(get_db)):
    return list(db.scalars(select(Subscription).order_by(Subscription.start_date)))


@router.post("/subscriptions", response_model=SubscriptionOut, status_code=201, tags=["costs"])
def create_sub(body: SubscriptionIn, db: Session = Depends(get_db)):
    _get(db, Harness, body.harness_id)
    if body.end_date and body.end_date < body.start_date:
        raise HTTPException(422, "end_date before start_date")
    s = Subscription(**body.model_dump())
    db.add(s)
    db.commit()
    return s


@router.patch("/subscriptions/{sid}", response_model=SubscriptionOut, tags=["costs"])
def update_sub(sid: int, body: SubscriptionPatch, db: Session = Depends(get_db)):
    s = _get(db, Subscription, sid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    return s


@router.delete("/subscriptions/{sid}", status_code=204, tags=["costs"])
def delete_sub(sid: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Subscription, sid))
    db.commit()


# ---------- tasks (ledger) ----------

@router.get("/tasks", response_model=list[TaskListItem], tags=["ledger"])
def list_tasks(f: S.Filters = Depends(filters), status: str | None = None, category: str | None = None,
               difficulty: str | None = None, q: str | None = None, ids: list[int] = Query(default=[]),
               limit: int = Query(default=500, le=5000), db: Session = Depends(get_db)):
    tasks = S.query_tasks(db, f, f.start, f.end)
    if ids:
        tasks = [t for t in tasks if t.id in ids]
    if status == "accepted":
        tasks = [t for t in tasks if t.human_accepted]
    elif status == "verified":
        tasks = [t for t in tasks if t.verified]
    elif status == "accepted_unverified":
        tasks = [t for t in tasks if t.human_accepted and not t.verified]
    elif status == "agent_reported":
        tasks = [t for t in tasks if t.agent_reported_complete]
    elif status == "overclaimed":
        tasks = [t for t in tasks if t.agent_reported_complete and not t.human_accepted and t.outcome in A.RESOLVED]
    elif status == "first_pass":
        tasks = [t for t in tasks if A.is_first_pass(t)]
    elif status == "rework":
        tasks = [t for t in tasks if t.human_accepted and t.rework_cycles > 0]
    elif status in ("in_progress", "delivered", "failed", "abandoned"):
        tasks = [t for t in tasks if t.outcome == status]
    elif status == "unsuccessful":
        tasks = [t for t in tasks if t.outcome in ("failed", "abandoned")]
    if category:
        tasks = [t for t in tasks if t.category == category]
    if difficulty:
        tasks = [t for t in tasks if t.difficulty == difficulty]
    if q:
        ql = q.lower()
        tasks = [t for t in tasks if ql in t.title.lower() or ql in (t.description or "").lower() or ql == str(t.id)]
    tasks = tasks[:limit]
    cost, api, _, tok, cnt = S.task_costs(db, [t.id for t in tasks])
    ev = dict(db.execute(select(Evidence.task_id, func.count(Evidence.id)).group_by(Evidence.task_id)).all())
    out = []
    for t in tasks:
        item = TaskListItem.model_validate(t)
        item.usage_count, item.tokens, item.actual_cost = cnt.get(t.id, 0), tok.get(t.id, 0), round(cost.get(t.id, 0.0), 4)
        item.api_equiv_cost, item.evidence_count = api.get(t.id), ev.get(t.id, 0)
        out.append(item)
    return out


def _detail(db: Session, t: Task) -> TaskDetail:
    usage = list(db.scalars(select(UsageRecord).where(UsageRecord.task_id == t.id).order_by(UsageRecord.usage_date)))
    alloc = S.alloc_for_usages(db, usage)
    baselines = A.reference_baselines(list(db.scalars(select(Task))))
    ref, src, conf = A.reference_for(t, baselines)
    d = TaskDetail.model_validate(t)
    d.usage = [UsageOut.model_validate(u) for u in usage]
    mins = [u.agent_minutes for u in usage if u.agent_minutes is not None]
    tta = (t.accepted_at - t.created_at).total_seconds() / 3600 if t.accepted_at else None
    d.computed = {
        "tokens": sum(u.total_tokens for u in usage), "sessions": len(usage),
        "actual_cost": sum(alloc.get(u.id, 0) for u in usage),
        "api_equiv_cost": sum(u.api_equiv_cost for u in usage if u.api_equiv_cost is not None),
        "unknown_price_records": sum(1 for u in usage if u.api_equiv_cost is None),
        "agent_minutes": sum(mins) if mins else None, "agent_minutes_missing": len(usage) - len(mins),
        "time_to_accept_hours": tta, "reference_minutes": ref, "reference_source": src, "reference_confidence": conf,
        "uplift_ratio": (ref / max(t.human_minutes, 1)) if (ref and t.human_minutes is not None and t.human_accepted) else None,
        "first_pass": A.is_first_pass(t),
        "criteria_met": sum(1 for c in t.criteria if c.met), "criteria_total": len(t.criteria),
    }
    return d


@router.get("/tasks/{tid}", response_model=TaskDetail, tags=["ledger"])
def get_task(tid: int, db: Session = Depends(get_db)):
    t = db.scalar(select(Task).where(Task.id == tid).options(selectinload(Task.criteria), selectinload(Task.deliverables),
                                                              selectinload(Task.evidence), selectinload(Task.history)))
    if not t:
        raise HTTPException(404, "Task not found")
    return _detail(db, t)


def _check_refs(db: Session, data: dict):
    for k, cls in (("project_id", Project), ("model_id", AgentModel), ("harness_id", Harness)):
        if data.get(k) is not None:
            _get(db, cls, data[k])


@router.post("/tasks", response_model=TaskDetail, status_code=201, tags=["ledger"])
def create_task(body: TaskIn, db: Session = Depends(get_db)):
    data = body.model_dump(exclude={"criteria"})
    _check_refs(db, data)
    if data["created_at"] is None:
        data.pop("created_at")
    t = Task(**data)
    t.criteria = [AcceptanceCriterion(**c.model_dump()) for c in body.criteria]
    S.apply_task_state(t, datetime.now().replace(microsecond=0))
    db.add(t)
    db.commit()
    return get_task(t.id, db)


@router.patch("/tasks/{tid}", response_model=TaskDetail, tags=["ledger"])
def patch_task(tid: int, body: TaskPatch, db: Session = Depends(get_db)):
    t = _get(db, Task, tid)
    changes = body.model_dump(exclude_unset=True)
    _check_refs(db, changes)
    S.update_task(db, t, changes)
    return get_task(tid, db)


@router.delete("/tasks/{tid}", status_code=204, tags=["ledger"])
def delete_task(tid: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Task, tid))
    db.commit()


@router.post("/tasks/{tid}/criteria", response_model=CriterionOut, status_code=201, tags=["ledger"])
def add_criterion(tid: int, body: CriterionIn, db: Session = Depends(get_db)):
    _get(db, Task, tid)
    c = AcceptanceCriterion(task_id=tid, **body.model_dump())
    db.add(c)
    db.commit()
    return c


@router.patch("/criteria/{cid}", response_model=CriterionOut, tags=["ledger"])
def patch_criterion(cid: int, body: CriterionPatch, db: Session = Depends(get_db)):
    c = _get(db, AcceptanceCriterion, cid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    return c


@router.delete("/criteria/{cid}", status_code=204, tags=["ledger"])
def delete_criterion(cid: int, db: Session = Depends(get_db)):
    db.delete(_get(db, AcceptanceCriterion, cid))
    db.commit()


@router.post("/tasks/{tid}/deliverables", response_model=DeliverableOut, status_code=201, tags=["ledger"])
def add_deliverable(tid: int, body: DeliverableIn, db: Session = Depends(get_db)):
    _get(db, Task, tid)
    d = Deliverable(task_id=tid, **body.model_dump())
    db.add(d)
    db.commit()
    return d


@router.delete("/deliverables/{did}", status_code=204, tags=["ledger"])
def delete_deliverable(did: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Deliverable, did))
    db.commit()


@router.post("/tasks/{tid}/evidence", response_model=EvidenceOut, status_code=201, tags=["ledger"])
def add_evidence(tid: int, body: EvidenceIn, db: Session = Depends(get_db)):
    _get(db, Task, tid)
    e = Evidence(task_id=tid, **body.model_dump())
    db.add(e)
    db.commit()
    return e


@router.delete("/evidence/{eid}", status_code=204, tags=["ledger"])
def delete_evidence(eid: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Evidence, eid))
    db.commit()


# ---------- usage ----------

@router.get("/usage", response_model=list[UsageOut], tags=["usage"])
def list_usage(f: S.Filters = Depends(filters), linked: bool | None = None, task_id: int | None = None,
               batch_id: int | None = None, price_status: str | None = None, limit: int = Query(default=500, le=10000),
               db: Session = Depends(get_db)):
    q = select(UsageRecord)
    if f.start:
        q = q.where(UsageRecord.usage_date >= f.start)
    if f.end:
        q = q.where(UsageRecord.usage_date <= f.end)
    if f.project_ids:
        q = q.where(UsageRecord.project_id.in_(f.project_ids))
    if f.model_ids:
        q = q.where(UsageRecord.model_id.in_(f.model_ids))
    if f.harness_ids:
        q = q.where(UsageRecord.harness_id.in_(f.harness_ids))
    if linked is True:
        q = q.where(UsageRecord.task_id.is_not(None))
    elif linked is False:
        q = q.where(UsageRecord.task_id.is_(None))
    if task_id:
        q = q.where(UsageRecord.task_id == task_id)
    if batch_id:
        q = q.where(UsageRecord.import_batch_id == batch_id)
    if price_status:
        q = q.where(UsageRecord.price_status == price_status)
    return list(db.scalars(q.order_by(UsageRecord.usage_date.desc(), UsageRecord.id.desc()).limit(limit)))


@router.post("/usage", response_model=UsageOut, status_code=201, tags=["usage"])
def create_usage(body: UsageIn, db: Session = Depends(get_db)):
    data = body.model_dump()
    _check_refs(db, data)
    if data.get("task_id"):
        _get(db, Task, data["task_id"])
    h = _get(db, Harness, body.harness_id)
    m = db.get(AgentModel, body.model_id) if body.model_id else None
    import uuid
    u = UsageRecord(**data, source="manual", granularity="session",
                    total_tokens=body.input_tokens + body.output_tokens + body.cache_creation_tokens + body.cache_read_tokens,
                    raw_model_name=m.name if m else None,
                    dedupe_key=f"manual-{uuid.uuid4().hex}", raw={"entered_manually": True, "harness": h.name})
    S.price_usage(u, m)
    db.add(u)
    db.commit()
    return u


@router.patch("/usage/{uid}", response_model=UsageOut, tags=["usage"])
def patch_usage(uid: int, body: UsagePatch, db: Session = Depends(get_db)):
    u = _get(db, UsageRecord, uid)
    ch = body.model_dump(exclude_unset=True)
    if ch.get("task_id"):
        _get(db, Task, ch["task_id"])
    _check_refs(db, ch)
    for k, v in ch.items():
        setattr(u, k, v)
    S.price_usage(u, db.get(AgentModel, u.model_id) if u.model_id else None)
    db.commit()
    return u


@router.post("/usage/link", tags=["usage"])
def link_usage(body: LinkRequest, db: Session = Depends(get_db)):
    task = _get(db, Task, body.task_id) if body.task_id else None
    rows = list(db.scalars(select(UsageRecord).where(UsageRecord.id.in_(body.usage_ids))))
    if len(rows) != len(set(body.usage_ids)):
        raise HTTPException(404, "Some usage records were not found")
    for u in rows:
        u.task_id = task.id if task else None
        if task and u.project_id is None:
            u.project_id = task.project_id
    db.commit()
    return {"linked": len(rows), "task_id": body.task_id}


@router.delete("/usage/{uid}", status_code=204, tags=["usage"])
def delete_usage(uid: int, db: Session = Depends(get_db)):
    db.delete(_get(db, UsageRecord, uid))
    db.commit()


# ---------- imports ----------

@router.post("/imports/preview", tags=["imports"])
def import_preview(body: ImportRequest, db: Session = Depends(get_db)):
    try:
        return S.serialise_preview(S.analyse_import(db, body))
    except ParseError as e:
        raise HTTPException(422, str(e))


@router.post("/imports/commit", response_model=ImportBatchOut, status_code=201, tags=["imports"])
def import_commit(body: ImportRequest, db: Session = Depends(get_db)):
    try:
        return S.commit_import(db, body)
    except ParseError as e:
        db.rollback()
        raise HTTPException(422, str(e))


@router.get("/imports", response_model=list[ImportBatchOut], tags=["imports"])
def list_imports(db: Session = Depends(get_db)):
    return list(db.scalars(select(ImportBatch).order_by(ImportBatch.created_at.desc())))


# ---------- analytics ----------

@router.get("/analytics/dashboard", tags=["analytics"])
def an_dashboard(f: S.Filters = Depends(filters), db: Session = Depends(get_db)):
    return S.dashboard(db, f)


@router.get("/analytics/efficiency", tags=["analytics"])
def an_efficiency(f: S.Filters = Depends(filters), db: Session = Depends(get_db)):
    return S.efficiency(db, f)


@router.get("/analytics/compare", tags=["analytics"])
def an_compare(dimension: str = Query("model", pattern="^(model|harness|project|period)$"),
               min_n: int = Query(A.MIN_DRIFT_N, ge=1), a_start: date | None = None, a_end: date | None = None,
               b_start: date | None = None, b_end: date | None = None, keys: list[str] = Query(default=[]),
               f: S.Filters = Depends(filters), db: Session = Depends(get_db)):
    periods = None
    if dimension == "period":
        if not all([a_start, a_end, b_start, b_end]):
            raise HTTPException(422, "Period comparison needs a_start, a_end, b_start, b_end")
        periods = (a_start, a_end, b_start, b_end)
    parsed = [k if dimension == "period" else int(k) for k in keys if k]
    return S.compare(db, f, dimension, min_n, periods, parsed or None)


@router.get("/analytics/drift", tags=["analytics"])
def an_drift(dimension: str = Query("model", pattern="^(model|harness|project)$"), recent_weeks: int = Query(3, ge=1, le=12),
             baseline_weeks: int = Query(5, ge=1, le=26), min_n: int = Query(A.MIN_DRIFT_N, ge=3),
             threshold: float = Query(A.DRIFT_THRESHOLD, gt=0, lt=1), f: S.Filters = Depends(filters),
             db: Session = Depends(get_db)):
    return S.drift(db, f, dimension, recent_weeks, baseline_weeks, min_n, threshold)


# ---------- community ----------

@router.get("/community/overview", tags=["community"])
def comm_overview():
    return community.synthetic_community()


@router.get("/community/contribution-preview", tags=["community"])
def comm_preview(start: date | None = None, end: date | None = None, include_synthetic: bool = True,
                 db: Session = Depends(get_db)):
    return community.contribution_preview(db, start, end, include_synthetic)


# ---------- reports & export ----------

def _csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    if rows:
        keys = list(rows[0].keys())
        w = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in r.items()})
    return buf.getvalue()


def _file(content: str, media: str, name: str) -> Response:
    return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/reports/weekly", tags=["reports"])
def weekly(week_start: date | None = None, format: str = Query("json", pattern="^(json|md)$"),
           f: S.Filters = Depends(filters), db: Session = Depends(get_db)):
    r = S.weekly_report(db, f, week_start)
    if format == "md":
        return _file(S.weekly_markdown(r), "text/markdown", f"workrate-weekly-{r['week_start']}.md")
    r["markdown"] = S.weekly_markdown(r)
    return r


def _flat_rows(dimension_res: dict) -> list[dict]:
    out = []
    for r in dimension_res["rows"]:
        m, u = r["metrics"], r["usage"]
        out.append({"group": r["label"], "attempted": m["attempted"], "resolved": m["resolved"], "accepted": m["accepted"],
                    "verified": m["verified"], "success_rate": m["success_rate"]["value"],
                    "success_ci_low": m["success_rate"]["ci_low"], "success_ci_high": m["success_rate"]["ci_high"],
                    "first_pass_rate": m["first_pass_rate"]["value"], "rework_rate": m["rework_rate"]["value"],
                    "human_minutes_total": m["human_minutes_total"], "tokens": u["tokens"],
                    "actual_spend": round(u["actual_spend"], 2), "api_equiv_cost": round(u["api_equiv_cost"], 2),
                    "cost_per_accepted": r["cost_per_accepted"], "sufficient_sample": r["sufficient_sample"]})
    return out


@router.get("/reports/filtered", tags=["reports"])
def filtered_report(format: str = Query("json", pattern="^(json|csv)$"), dimension: str = Query("model", pattern="^(model|harness|project)$"),
                    f: S.Filters = Depends(filters), db: Session = Depends(get_db)):
    dash = S.dashboard(db, f)
    comp = S.compare(db, f, dimension, A.MIN_DRIFT_N)
    if format == "csv":
        return _file(_csv(_flat_rows(comp)), "text/csv", f"workrate-report-{dimension}.csv")
    return {"generated_at": datetime.now().isoformat(timespec="seconds"), "api_version": API_VERSION,
            "filters": {"start": dash["range"]["start"], "end": dash["range"]["end"], "project": f.project_ids,
                        "model": f.model_ids, "harness": f.harness_ids},
            "summary": {k: dash[k] for k in ("tasks", "usage", "cost_per_accepted", "api_equiv_per_accepted", "data_quality")},
            "weekly": dash["weekly"], "comparison": {"dimension": dimension, "rows": _flat_rows(comp)}}


EXPORT_SETS = {"tasks", "usage", "subscriptions", "evidence", "imports", "all"}


def _rows(db: Session, dataset: str, f: S.Filters) -> list[dict]:
    if dataset == "tasks":
        return [TaskOut.model_validate(t).model_dump(mode="json") for t in S.query_tasks(db, f, f.start, f.end)]
    if dataset == "usage":
        return [UsageOut.model_validate(u).model_dump(mode="json") for u in list_usage(f, None, None, None, None, 10000, db)]
    if dataset == "subscriptions":
        return [SubscriptionOut.model_validate(s).model_dump(mode="json") for s in db.scalars(select(Subscription))]
    if dataset == "evidence":
        return [{"task_id": e.task_id, **EvidenceOut.model_validate(e).model_dump(mode="json")} for e in db.scalars(select(Evidence))]
    if dataset == "imports":
        return [ImportBatchOut.model_validate(b).model_dump(mode="json") for b in db.scalars(select(ImportBatch))]
    raise HTTPException(404, "Unknown dataset")


@router.get("/export/{dataset}", tags=["reports"])
def export(dataset: str, format: str = Query("json", pattern="^(json|csv)$"), f: S.Filters = Depends(filters),
           db: Session = Depends(get_db)):
    if dataset not in EXPORT_SETS:
        raise HTTPException(404, "Unknown dataset")
    if dataset == "all":
        if format != "json":
            raise HTTPException(422, "Full export is JSON only")
        payload = {"api_version": API_VERSION, "exported_at": datetime.now().isoformat(timespec="seconds"),
                   **{k: _rows(db, k, f) for k in ("tasks", "usage", "subscriptions", "evidence", "imports")},
                   "criteria": [{"task_id": c.task_id, "id": c.id, "text": c.text, "met": c.met} for c in db.scalars(select(AcceptanceCriterion))],
                   "deliverables": [{"task_id": d.task_id, "id": d.id, "kind": d.kind, "title": d.title, "url": d.url} for d in db.scalars(select(Deliverable))],
                   "reference": meta(db)}
        return _file(json.dumps(payload, indent=2, default=str), "application/json", "workrate-export.json")
    rows = _rows(db, dataset, f)
    if format == "csv":
        return _file(_csv(rows), "text/csv", f"workrate-{dataset}.csv")
    return _file(json.dumps(rows, indent=2, default=str), "application/json", f"workrate-{dataset}.json")


# ---------- demo ----------

@router.post("/demo/reset", tags=["demo"])
def demo_reset(db: Session = Depends(get_db)):
    seed.clear_all(db)
    return {"status": "reset", **seed.seed(db)}


@router.post("/demo/clear", tags=["demo"])
def demo_clear(db: Session = Depends(get_db)):
    seed.clear_all(db)
    return {"status": "cleared"}
