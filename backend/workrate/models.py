from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class AgentModel(Base):
    __tablename__ = "models"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    provider: Mapped[str] = mapped_column(String(60), default="unknown")
    input_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    cache_write_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    cache_read_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Harness(Base):
    __tablename__ = "harnesses"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    display_name: Mapped[str] = mapped_column(String(120))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    harness_id: Mapped[int] = mapped_column(ForeignKey("harnesses.id", ondelete="CASCADE"))
    monthly_cost: Mapped[float] = mapped_column(Float)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    source_format: Mapped[str] = mapped_column(String(40))
    harness_id: Mapped[int | None] = mapped_column(ForeignKey("harnesses.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    rows_total: Mapped[int] = mapped_column(Integer, default=0)
    rows_imported: Mapped[int] = mapped_column(Integer, default=0)
    rows_duplicate: Mapped[int] = mapped_column(Integer, default=0)
    rows_overwritten: Mapped[int] = mapped_column(Integer, default=0)
    rows_invalid: Mapped[int] = mapped_column(Integer, default=0)
    warnings: Mapped[list] = mapped_column(JSON, default=list)


class UsageRecord(Base):
    __tablename__ = "usage_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(40))  # ccusage-daily|ccusage-session|ccusage-monthly|csv|manual|synthetic
    granularity: Mapped[str] = mapped_column(String(20), default="session")  # session|daily|monthly
    harness_id: Mapped[int] = mapped_column(ForeignKey("harnesses.id", ondelete="CASCADE"))
    model_id: Mapped[int | None] = mapped_column(ForeignKey("models.id", ondelete="SET NULL"), nullable=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True)
    session_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    usage_date: Mapped[date] = mapped_column(Date, index=True)
    agent_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_creation_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    billing: Mapped[str] = mapped_column(String(20), default="subscription")  # subscription|api
    reported_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    api_equiv_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_status: Mapped[str] = mapped_column(String(20), default="unknown")  # table|source_reported|unknown
    raw_model_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(64), unique=True)
    raw: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    model_id: Mapped[int | None] = mapped_column(ForeignKey("models.id", ondelete="SET NULL"), nullable=True)
    harness_id: Mapped[int | None] = mapped_column(ForeignKey("harnesses.id", ondelete="SET NULL"), nullable=True)
    harness_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(30))
    difficulty: Mapped[str] = mapped_column(String(20))
    outcome: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress|delivered|failed|abandoned
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    agent_reported_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    agent_reported_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    human_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verification_method: Mapped[str | None] = mapped_column(String(120), nullable=True)
    rework_cycles: Mapped[int] = mapped_column(Integer, default=0)
    intervention_count: Mapped[int] = mapped_column(Integer, default=0)
    human_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    review_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    reference_human_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)

    criteria: Mapped[list["AcceptanceCriterion"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)
    deliverables: Mapped[list["Deliverable"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)
    evidence: Mapped[list["Evidence"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)
    history: Mapped[list["TaskHistory"]] = relationship(cascade="all, delete-orphan", passive_deletes=True, order_by="TaskHistory.changed_at.desc()")


class AcceptanceCriterion(Base):
    __tablename__ = "acceptance_criteria"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    met: Mapped[bool] = mapped_column(Boolean, default=False)


class Deliverable(Base):
    __tablename__ = "deliverables"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30))  # pull_request|commit|document|artifact
    title: Mapped[str] = mapped_column(String(255))
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30))  # test_run|review|link|note|ci
    summary: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TaskHistory(Base):
    __tablename__ = "task_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    field: Mapped[str] = mapped_column(String(60))
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
