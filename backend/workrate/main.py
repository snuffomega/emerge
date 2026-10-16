import os
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from .api import API_VERSION, router
from .db import BACKEND_DIR, SessionLocal, engine
from .models import Task
from .seed import seed


def run_migrations() -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", str(engine.url))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_app):
    run_migrations()
    if os.environ.get("WORKRATE_SEED_ON_EMPTY", "true").lower() == "true":
        with SessionLocal() as db:
            if not db.scalar(select(func.count(Task.id))):
                seed(db)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        lifespan=lifespan,
        title="WorkRate API",
        version=API_VERSION,
        description="Local-first analytics for the real work delivered by AI coding agents. All routes are versioned under /api/v1.",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
                       allow_credentials=origins != ["*"])
    app.include_router(router)

    @app.get("/api/health", tags=["meta"])
    def health():
        return {"status": "ok", "api_version": API_VERSION}

    return app


app = create_app()
