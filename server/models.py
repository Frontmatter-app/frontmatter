"""Persistent records.

Deliberately small. Documents are not here and never will be: they are files in
a git repository. What the server owns is who you are and what a live editing
session is doing — nothing that would make this database the source of truth
for anyone's writing.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from server.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLAlchemyBaseUserTableUUID, Base):
    """An account.

    `SQLAlchemyBaseUserTableUUID` supplies id, email, hashed_password,
    is_active, is_superuser and is_verified. Password hashing, verification
    tokens and reset tokens are handled by fastapi-users rather than by us,
    which is the entire reason for depending on it: those are the parts where
    hand-rolled auth goes wrong.
    """

    __tablename__ = "users"

    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ForgeIdentity(Base):
    """A git provider account linked to a user.

    Stores the provider's user id and login so the server can map a repository
    collaborator to a Frontmatter account when resolving access.

    It deliberately stores NO token. Commits are made by the desktop app with
    credentials held in the operating system keychain; a compromised server
    must not be able to write to anybody's repository.
    """

    __tablename__ = "forge_identities"
    __table_args__ = (UniqueConstraint("provider", "external_id", name="uq_forge_identity"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    external_id: Mapped[str] = mapped_column(String(128))
    login: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
