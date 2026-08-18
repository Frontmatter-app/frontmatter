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


class RefreshToken(Base):
    """One long-lived credential for renewing a short-lived session.

    Three properties matter here, and each is a column rather than a convention:

    **Only a hash is stored.** A database dump must not be a pile of live
    sessions. The token itself exists in the response that issued it and in the
    client's keychain, nowhere else — so verification is by hash lookup, and a
    lost row cannot be turned back into a credential.

    **Tokens rotate.** Each refresh consumes its token and issues a new one, so
    a token captured in transit is worth nothing once the legitimate client has
    used it.

    **Rotation is only useful with reuse detection**, which is what `family_id`
    is for. Every descendant of one sign-in shares a family. If a token that has
    already been used is presented again, either it was stolen or the real
    client is replaying — and there is no way to tell which. The whole family is
    revoked, which signs that session out everywhere and is the safe answer to
    both.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Indexed and unique: every refresh is a lookup by this value.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Shared by every token descended from one sign-in.
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Set when the token is spent. A second presentation is the theft signal.
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def is_spendable(self) -> bool:
        return self.used_at is None and self.revoked_at is None


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
