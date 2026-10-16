from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Category = Literal["feature", "bugfix", "refactor", "tests", "docs", "infra"]
Difficulty = Literal["trivial", "small", "medium", "large"]
Outcome = Literal["in_progress", "delivered", "failed", "abandoned"]
Billing = Literal["subscription", "api"]


class Inp(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProjectIn(Inp):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""


class ProjectOut(ORM):
    id: int
    name: str
    description: str
    is_synthetic: bool


class ModelIn(Inp):
    name: str = Field(min_length=1, max_length=120)
    provider: str = "unknown"
    input_price: float | None = Field(default=None, ge=0)
    output_price: float | None = Field(default=None, ge=0)
    cache_write_price: float | None = Field(default=None, ge=0)
    cache_read_price: float | None = Field(default=None, ge=0)


class ModelPatch(Inp):
    provider: str | None = None
    input_price: float | None = Field(default=None, ge=0)
    output_price: float | None = Field(default=None, ge=0)
    cache_write_price: float | None = Field(default=None, ge=0)
    cache_read_price: float | None = Field(default=None, ge=0)


class ModelOut(ORM):
    id: int
    name: str
    provider: str
    input_price: float | None
    output_price: float | None
    cache_write_price: float | None
    cache_read_price: float | None
    is_synthetic: bool


class HarnessIn(Inp):
    name: str = Field(min_length=1, max_length=60)
    display_name: str


class HarnessOut(ORM):
    id: int
    name: str
    display_name: str
    is_synthetic: bool


class SubscriptionIn(Inp):
    name: str = Field(min_length=1)
    harness_id: int
    monthly_cost: float = Field(ge=0)
    start_date: date
    end_date: date | None = None
    notes: str = ""


class SubscriptionPatch(Inp):
    name: str | None = None
    monthly_cost: float | None = Field(default=None, ge=0)
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = None


class SubscriptionOut(ORM):
    id: int
    name: str
    harness_id: int
    monthly_cost: float
    start_date: date
    end_date: date | None
    notes: str
    is_synthetic: bool


class CriterionIn(Inp):
    text: str = Field(min_length=1)
    met: bool = False


class CriterionPatch(Inp):
    text: str | None = None
    met: bool | None = None


class CriterionOut(ORM):
    id: int
    text: str
    met: bool


class DeliverableIn(Inp):
    kind: Literal["pull_request", "commit", "document", "artifact"]
    title: str = Field(min_length=1)
    url: str | None = None


class DeliverableOut(ORM):
    id: int
    kind: str
    title: str
    url: str | None


class EvidenceIn(Inp):
    kind: Literal["test_run", "review", "ci", "link", "note"]
    summary: str = Field(min_length=1)
    url: str | None = None


class EvidenceOut(ORM):
    id: int
    kind: str
    summary: str
    url: str | None
    created_at: datetime


class HistoryOut(ORM):
    id: int
    changed_at: datetime
    field: str
    old_value: str | None
    new_value: str | None


class TaskIn(Inp):
    project_id: int
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    category: Category
    difficulty: Difficulty
    model_id: int | None = None
    harness_id: int | None = None
    harness_version: str | None = None
    outcome: Outcome = "in_progress"
    created_at: datetime | None = None
    agent_reported_complete: bool = False
    human_accepted: bool = False
    verified: bool = False
    verification_method: str | None = None
    rework_cycles: int = Field(default=0, ge=0)
    intervention_count: int = Field(default=0, ge=0)
    human_minutes: float | None = Field(default=None, ge=0)
    review_minutes: float | None = Field(default=None, ge=0)
    reference_human_minutes: float | None = Field(default=None, gt=0)
    criteria: list[CriterionIn] = []


class TaskPatch(Inp):
    project_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    category: Category | None = None
    difficulty: Difficulty | None = None
    model_id: int | None = None
    harness_id: int | None = None
    harness_version: str | None = None
    outcome: Outcome | None = None
    agent_reported_complete: bool | None = None
    human_accepted: bool | None = None
    verified: bool | None = None
    verification_method: str | None = None
    rework_cycles: int | None = Field(default=None, ge=0)
    intervention_count: int | None = Field(default=None, ge=0)
    human_minutes: float | None = Field(default=None, ge=0)
    review_minutes: float | None = Field(default=None, ge=0)
    reference_human_minutes: float | None = Field(default=None, gt=0)


class TaskOut(ORM):
    id: int
    project_id: int
    model_id: int | None
    harness_id: int | None
    harness_version: str | None
    title: str
    description: str
    category: str
    difficulty: str
    outcome: str
    created_at: datetime
    agent_reported_complete: bool
    agent_reported_at: datetime | None
    human_accepted: bool
    accepted_at: datetime | None
    verified: bool
    verified_at: datetime | None
    verification_method: str | None
    rework_cycles: int
    intervention_count: int
    human_minutes: float | None
    review_minutes: float | None
    reference_human_minutes: float | None
    is_synthetic: bool


class TaskListItem(TaskOut):
    usage_count: int = 0
    tokens: int = 0
    actual_cost: float = 0.0
    api_equiv_cost: float | None = None
    evidence_count: int = 0


class UsageOut(ORM):
    id: int
    source: str
    granularity: str
    harness_id: int
    model_id: int | None
    project_id: int | None
    task_id: int | None
    import_batch_id: int | None
    session_key: str | None
    usage_date: date
    agent_minutes: float | None
    input_tokens: int
    output_tokens: int
    cache_creation_tokens: int
    cache_read_tokens: int
    total_tokens: int
    billing: str
    reported_cost: float | None
    api_equiv_cost: float | None
    price_status: str
    raw_model_name: str | None
    is_synthetic: bool


class TaskDetail(TaskOut):
    criteria: list[CriterionOut]
    deliverables: list[DeliverableOut]
    evidence: list[EvidenceOut]
    history: list[HistoryOut]
    usage: list[UsageOut] = []
    computed: dict = {}


class UsageIn(Inp):
    harness_id: int
    model_id: int | None = None
    project_id: int | None = None
    task_id: int | None = None
    usage_date: date
    session_key: str | None = None
    agent_minutes: float | None = Field(default=None, ge=0)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cache_creation_tokens: int = Field(default=0, ge=0)
    cache_read_tokens: int = Field(default=0, ge=0)
    billing: Billing = "subscription"
    reported_cost: float | None = Field(default=None, ge=0)


class UsagePatch(Inp):
    task_id: int | None = None
    project_id: int | None = None
    model_id: int | None = None
    billing: Billing | None = None
    agent_minutes: float | None = Field(default=None, ge=0)
    reported_cost: float | None = Field(default=None, ge=0)


class LinkRequest(Inp):
    usage_ids: list[int] = Field(min_length=1)
    task_id: int | None


class ImportRequest(Inp):
    content: str = Field(min_length=1)
    filename: str = "upload"
    format: Literal["auto", "ccusage", "csv"] = "auto"
    harness: str = Field(min_length=1)
    billing: Billing = "subscription"
    project_id: int | None = None
    csv_mapping: dict[str, str | None] | None = None
    mode: Literal["skip", "overwrite"] = "skip"


class ImportBatchOut(ORM):
    id: int
    filename: str
    source_format: str
    harness_id: int | None
    created_at: datetime
    rows_total: int
    rows_imported: int
    rows_duplicate: int
    rows_overwritten: int
    rows_invalid: int
    warnings: list
