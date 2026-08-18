"""Staying signed in without staying vulnerable.

The session token was good for seven days and could not be renewed, which is the
worst of both: long enough that a stolen one is worth having, and short enough
that anybody who keeps the app open is thrown out once a week for no reason they
can see.

Splitting it fixes both ends. The access token becomes short — an hour — so a
copy of one is nearly worthless by the time it is used. The refresh token is
long-lived, but it is stored, rotated on every use, and revocable, so it is not
a bearer credential in the way a JWT is.

**Rotation with reuse detection** is what makes that safe. Each refresh spends
its token and mints a replacement in the same family. If a spent token is ever
presented again, one of two things happened: it was stolen and the thief is
using it, or it was stolen, used by the thief, and the real client is now
presenting its copy. There is no way to tell those apart from here, and both
mean the family is compromised — so the whole family is revoked and everyone
holding one signs in again. A false positive costs one sign-in; a false negative
costs the account.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from server.config import get_settings
from server.models import RefreshToken

# 256 bits from the system generator. Long enough that guessing is not a threat
# model, which is also why the stored form is a plain SHA-256 rather than a slow
# password hash: there is no low-entropy secret here for anybody to brute force,
# and the lookup happens on every refresh.
TOKEN_BYTES = 32


class RefreshError(Exception):
    """The token cannot be used. The reason is deliberately not sent onward."""


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _expiry() -> datetime:
    return _now() + timedelta(seconds=get_settings().refresh_token_lifetime_seconds)


async def issue(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    family_id: uuid.UUID | None = None,
) -> str:
    """Mints a refresh token and returns it. The plaintext is never stored."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=_hash(token),
            family_id=family_id or uuid.uuid4(),
            expires_at=_expiry(),
        )
    )
    await session.commit()
    return token


async def rotate(session: AsyncSession, presented: str) -> tuple[uuid.UUID, str]:
    """Spends a refresh token and issues its replacement.

    Returns the user it belongs to and the new token. Raises `RefreshError` for
    anything that is not a clean, unspent, unexpired token — the caller answers
    all of them with the same 401, because telling a caller *why* their token
    was refused tells an attacker which of their guesses was closest.
    """
    record = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == _hash(presented))
    )
    if record is None:
        raise RefreshError("unknown refresh token")

    if record.used_at is not None:
        # Already spent. Either a thief is using it, or the legitimate client is
        # replaying one a thief already used. Both mean this family is no longer
        # trustworthy, and neither is distinguishable from here.
        await revoke_family(session, record.family_id)
        raise RefreshError("refresh token reused")

    if record.revoked_at is not None:
        raise RefreshError("refresh token revoked")

    # `expires_at` comes back naive on SQLite, which stores no timezone; compare
    # in UTC either way rather than letting the comparison raise.
    expires_at = record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= _now():
        raise RefreshError("refresh token expired")

    record.used_at = _now()
    replacement = secrets.token_urlsafe(TOKEN_BYTES)
    session.add(
        RefreshToken(
            user_id=record.user_id,
            token_hash=_hash(replacement),
            family_id=record.family_id,
            expires_at=_expiry(),
        )
    )
    await session.commit()
    return record.user_id, replacement


async def revoke(session: AsyncSession, presented: str) -> None:
    """Retires one token. Signing out on this device, and nowhere else."""
    record = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == _hash(presented))
    )
    if record is None:
        return
    # The whole family, not just this token: signing out should end the session,
    # and the session is the family. Retiring only the newest token would leave
    # any earlier unspent one still able to resume it.
    await revoke_family(session, record.family_id)


async def revoke_family(session: AsyncSession, family_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    await session.commit()


async def revoke_all_for_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Signs an account out everywhere. For a password change, or a lost device."""
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    await session.commit()


async def purge_expired(session: AsyncSession) -> int:
    """Deletes tokens nobody can use, so the table does not grow without bound.

    Spent tokens are kept until they expire rather than deleted on use: reuse
    detection depends on still recognising a token that has already been
    spent, and a deleted row is indistinguishable from one that never existed.
    """
    from sqlalchemy import delete

    result = await session.execute(
        delete(RefreshToken).where(RefreshToken.expires_at <= _now())
    )
    await session.commit()
    return result.rowcount or 0
