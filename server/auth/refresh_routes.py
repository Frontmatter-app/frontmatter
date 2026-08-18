"""Endpoints for renewing a session.

Kept apart from `refresh.py` so the rotation rules can be tested without an HTTP
layer, and read without one.

`/auth/refresh` is deliberately anonymous. The refresh token *is* the credential
being presented, and requiring a valid access token alongside it would defeat
the point — the moment worth renewing is precisely the moment the access token
has expired.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from server.auth import refresh as refresh_tokens
from server.auth.users import current_active_user, get_jwt_strategy
from server.config import get_settings
from server.db import get_async_session
from server.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


class RefreshRequest(BaseModel):
    refreshToken: str


class IssuedRefresh(BaseModel):
    refreshToken: str
    expiresIn: int


class RenewedSession(BaseModel):
    accessToken: str
    refreshToken: str
    expiresIn: int


@router.post("/refresh/issue", response_model=IssuedRefresh)
async def issue_refresh_token(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> IssuedRefresh:
    """Trades a live session for a refresh token.

    Separate from signing in so that every route which can produce a session —
    password, git provider, and whatever comes next — gains renewal without
    each one growing its own copy of this.
    """
    token = await refresh_tokens.issue(session, user.id)
    return IssuedRefresh(
        refreshToken=token,
        expiresIn=get_settings().refresh_token_lifetime_seconds,
    )


@router.post("/refresh", response_model=RenewedSession)
async def renew_session(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_async_session),
) -> RenewedSession:
    settings = get_settings()

    try:
        user_id, replacement = await refresh_tokens.rotate(session, body.refreshToken)
    except refresh_tokens.RefreshError:
        # One answer for every failure. Distinguishing "expired" from "reused"
        # from "never existed" would tell whoever is probing which of their
        # guesses was closest.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "That session has expired. Sign in again.",
        ) from None

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        # The account was deleted or deactivated while the token was valid.
        await refresh_tokens.revoke(session, replacement)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "That session has expired. Sign in again.",
        )

    return RenewedSession(
        accessToken=await get_jwt_strategy().write_token(user),
        refreshToken=replacement,
        expiresIn=settings.access_token_lifetime_seconds,
    )


@router.post("/refresh/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_async_session),
) -> Response:
    """Signs this session out. Idempotent, and silent about unknown tokens.

    No authentication: somebody signing out may well be holding an access token
    that has already expired, and refusing to end their session because of that
    would be perverse.
    """
    await refresh_tokens.revoke(session, body.refreshToken)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
