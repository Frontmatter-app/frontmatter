"""Database session management.

SQLAlchemy async throughout, so the same code runs on SQLite (the default —
one file, no service to operate) and Postgres (when a deployment outgrows it).
Nothing above this module names either engine.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from server.config import get_settings


class Base(DeclarativeBase):
    pass


def _prepare_sqlite_path(url: str) -> None:
    """Creates the directory for a SQLite file before the engine opens it.

    SQLite will not create intermediate directories, so a default of
    `./data/frontmatter.db` fails on a clean checkout unless we do this.
    """
    marker = "sqlite+aiosqlite:///"
    if not url.startswith(marker):
        return
    raw = url[len(marker) :]
    if raw.startswith(":memory:") or not raw:
        return
    Path(raw).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


_settings = get_settings()
_prepare_sqlite_path(_settings.database_url)

engine = create_async_engine(_settings.database_url, future=True)
async_session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def create_all() -> None:
    """Creates tables that do not exist yet.

    Deliberately not a migration system. The schema is small and additive so
    far; when it stops being either, this gets replaced by Alembic rather than
    grown into a hand-rolled migrator.
    """
    from server import models  # noqa: F401  (registers mappers)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session
