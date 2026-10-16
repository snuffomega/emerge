import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parent.parent


def database_url() -> str:
    url = os.environ.get("WORKRATE_DATABASE_URL")
    if url:
        return url
    data_dir = BACKEND_DIR / "data"
    data_dir.mkdir(exist_ok=True)
    return f"sqlite:///{data_dir / 'workrate.db'}"


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    eng = create_engine(url, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
    if url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _fk_on(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return eng


engine = make_engine(database_url())
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
