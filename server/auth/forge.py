"""Sign in with your git provider.

Three steps, because the sign-in happens in a browser and the session is needed
by a desktop application:

  1. `POST /auth/forge/{provider}/start` — the app asks for a pairing code and
     an authorization URL, and opens the URL in the real browser.
  2. `GET  /auth/forge/{provider}/callback` — the provider sends the browser
     back here. The server exchanges the code for a profile, finds or creates
     the account, and parks a session token against the pairing.
  3. `POST /auth/forge/claim` — the app, which has been polling, collects it.

The account is keyed on the provider's own user id rather than on an email
address. Emails change, and on GitHub they can be hidden entirely; the numeric
id is stable across both, and across a rename. Keying on email would mean
somebody changing their address on GitHub silently becoming a different person
here — losing their documents — or, worse, inheriting somebody else's account
if an address were ever recycled.
"""
from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from server.auth.identity import (
    ForgeProfile,
    IdentityError,
    configured_providers,
    get_identity_provider,
)
from server.auth import refresh as refresh_tokens
from server.auth.pairing import PAIRING_TTL_SECONDS, store
from server.auth.users import get_jwt_strategy
from server.config import get_settings
from server.db import get_async_session
from server.models import ForgeIdentity, User

logger = logging.getLogger("frontmatter.auth")

router = APIRouter(prefix="/auth/forge", tags=["auth"])


class StartResponse(BaseModel):
    pairingCode: str
    authorizeUrl: str
    expiresIn: int


class ClaimRequest(BaseModel):
    pairingCode: str


class ClaimResponse(BaseModel):
    status: str
    accessToken: str | None = None
    # Issued alongside, so a provider sign-in is renewable exactly like a
    # password one. Without it this route would produce a session that dies in
    # an hour with no way back.
    refreshToken: str | None = None
    error: str | None = None


def _redirect_uri(provider: str) -> str:
    base = get_settings().public_url.rstrip("/")
    return f"{base}/auth/forge/{provider}/callback"


@router.get("/providers")
async def list_providers() -> dict[str, list[str]]:
    """Which providers this server can sign somebody in with."""
    return {"providers": configured_providers()}


@router.post("/{provider}/start", response_model=StartResponse)
async def start(provider: str) -> StartResponse:
    try:
        identity = get_identity_provider(provider)
    except IdentityError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    pairing = store.begin(provider)
    return StartResponse(
        pairingCode=pairing.code,
        authorizeUrl=identity.authorize_url(
            state=pairing.state, redirect_uri=_redirect_uri(provider)
        ),
        expiresIn=PAIRING_TTL_SECONDS,
    )


@router.get("/{provider}/callback", response_class=HTMLResponse)
async def callback(
    provider: str,
    state: str = "",
    code: str = "",
    error: str = "",
    session: AsyncSession = Depends(get_async_session),
) -> HTMLResponse:
    """Where the provider sends the browser back.

    Always answers with a page rather than an error status: whatever happened,
    a person is looking at this, and a raw 400 tells them nothing they can act
    on. The outcome is recorded against the pairing for the app to collect.
    """
    if not state or store.by_state(state) is None:
        # Either a stale link, or somebody's callback replayed after it expired.
        return _page("This sign-in link has expired. Start again from the app.", ok=False)

    if error or not code:
        store.settle(state, error=error or "The provider did not complete the sign-in.")
        return _page("Sign-in was cancelled. You can close this tab.", ok=False)

    try:
        identity = get_identity_provider(provider)
        profile = await identity.exchange(code=code, redirect_uri=_redirect_uri(provider))
    except IdentityError as failure:
        store.settle(state, error=str(failure))
        return _page(str(failure), ok=False)
    except Exception as failure:  # network, malformed provider response
        logger.warning("identity exchange failed for %s: %s", provider, failure)
        store.settle(state, error="Could not reach the provider. Try again.")
        return _page("Could not reach the provider. Try again.", ok=False)

    user = await link_identity(session, profile)
    token = await get_jwt_strategy().write_token(user)
    refresh = await refresh_tokens.issue(session, user.id)
    store.settle(state, token=token, refresh_token=refresh)

    return _page("You're signed in. You can close this tab and return to Frontmatter.", ok=True)


@router.post("/claim", response_model=ClaimResponse)
async def claim(body: ClaimRequest) -> ClaimResponse:
    """Collects a finished sign-in. Called repeatedly until it is ready."""
    pairing = store.claim(body.pairingCode)
    if pairing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That sign-in has expired.")
    if pairing.error:
        return ClaimResponse(status="failed", error=pairing.error)
    if pairing.token:
        return ClaimResponse(
            status="ready",
            accessToken=pairing.token,
            refreshToken=pairing.refresh_token,
        )
    return ClaimResponse(status="pending")


async def link_identity(session: AsyncSession, profile: ForgeProfile) -> User:
    """Finds or creates the account behind a provider profile.

    Three cases, in order:

      1. The provider identity is already linked — sign that account in, and
         refresh the display fields, since a rename on the provider should show
         up here rather than leaving a stale name on everybody's cursor.
      2. An account exists with the same email — link the identity to it, so
         somebody who registered with a password before does not end up with a
         second, empty account.
      3. Nobody matches — create an account with no password. It is reachable
         only through the provider, which is the intent.
    """
    existing = await session.scalar(
        select(ForgeIdentity).where(
            ForgeIdentity.provider == profile.provider,
            ForgeIdentity.external_id == profile.external_id,
        )
    )
    if existing is not None:
        user = await session.get(User, existing.user_id)
        if user is not None:
            existing.login = profile.login
            user.display_name = profile.display_name or user.display_name
            user.avatar_url = profile.avatar_url or user.avatar_url
            await session.commit()
            return user
        # The account was deleted but its identity row outlived it. Drop the
        # orphan and fall through to creating a fresh account.
        await session.delete(existing)
        await session.commit()

    user = None
    if profile.email:
        user = await session.scalar(select(User).where(User.email == profile.email))

    if user is None:
        user = User(
            email=profile.email or _placeholder_email(profile),
            # No password, and no way to sign in with one. The column is not
            # nullable, so it holds a genuine hash of a random secret nobody —
            # including this process, a moment later — knows.
            #
            # A sentinel like "!" is the obvious alternative and is wrong: the
            # verifier does not recognise it as a hash at all and raises rather
            # than returning "no match", so an ordinary failed login becomes a
            # 500 instead of a refusal.
            hashed_password=_unusable_password(),
            is_active=True,
            # The provider verified the address; making somebody confirm it a
            # second time to our own mailer would be theatre.
            is_verified=bool(profile.email),
            display_name=profile.display_name,
            avatar_url=profile.avatar_url,
        )
        session.add(user)
        await session.flush()

    session.add(
        ForgeIdentity(
            user_id=user.id,
            provider=profile.provider,
            external_id=profile.external_id,
            login=profile.login,
        )
    )
    await session.commit()
    return user


def _placeholder_email(profile: ForgeProfile) -> str:
    """A stand-in address for somebody who keeps theirs private.

    The account still needs a unique, well-formed address — it is the login
    identifier and a database constraint — but it must never be a real inbox.

    For GitHub the placeholder is GitHub's *own* no-reply convention, which is
    what their web editor already writes into commits for these accounts. Using
    it means a co-author trailer we generate matches the one GitHub would have
    generated, so the commit attributes to the right person on their end
    instead of to nobody.

    `.invalid` would be the textbook reserved suffix and cannot be used: it
    fails ordinary email validation, so the account could not be saved at all.
    """
    if profile.provider == "github":
        return f"{profile.external_id}+{profile.login}@users.noreply.github.com"
    return f"{profile.provider}-{profile.external_id}@noreply.frontmatter.app"


def _unusable_password() -> str:
    """A real hash of a secret nobody knows, including us.

    Hashed properly rather than stubbed so the password verifier recognises the
    format and simply reports no match. The plaintext is discarded here and
    never leaves this function.
    """
    from fastapi_users.password import PasswordHelper

    return PasswordHelper().hash(secrets.token_urlsafe(32))


def _page(message: str, *, ok: bool) -> HTMLResponse:
    """The one page a person sees during sign-in.

    Deliberately self-contained: no stylesheet to fetch, no script to run, and
    nothing that fails if the network drops the moment after the redirect.
    """
    tint = "#1b365d" if ok else "#8a3a30"
    return HTMLResponse(
        f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Frontmatter</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f5f4ed;color:#141413;font:16px/1.55 Charter,Georgia,serif">
<main style="max-width:26rem;padding:2rem;text-align:center">
<div style="width:3rem;height:3rem;margin:0 auto 1.5rem;border-radius:50%;background:{tint}"></div>
<p style="margin:0">{message}</p>
</main></body></html>""",
        status_code=200,
    )
