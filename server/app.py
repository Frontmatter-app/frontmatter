"""The Frontmatter collaboration server.

One process. It authenticates users, holds live editing sessions, and writes
snapshots. That is the whole job.

It deliberately does NOT:
  * store documents — those are files in a git repository
  * store images — those are committed to the repository too
  * hold git credentials — the desktop app commits, using keys in the operating
    system keychain, so a compromised server cannot write to your repositories
  * require any cloud account to run
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.auth.users import auth_backend, fastapi_users
from server.auth.forge import router as forge_auth_router
from server.auth.identity import configured_providers
from server.auth.refresh_routes import router as refresh_router
from server.collab.routes import router as collab_router
from server.rooms.routes import router as rooms_router
from server.collab.room import registry
from server.config import get_settings
from server.db import create_all
from server.schemas import UserCreate, UserRead, UserUpdate

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("frontmatter")


async def _evict_idle_rooms() -> None:
    """Forgets rooms nobody has been in for a while.

    Without this, a long-lived server accumulates one Yjs document in memory
    for every file anyone has ever opened.
    """
    while True:
        try:
            await asyncio.sleep(30)
            evicted = await registry.evict_idle()
            if evicted:
                logger.info("evicted %d idle room(s)", len(evicted))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning("room eviction failed: %s", error)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()
    await create_all()

    if settings.secret_key_is_ephemeral:
        logger.warning(
            "FM_SECRET_KEY is not set, so a random one was generated for this process. "
            "Sessions will not survive a restart, and multiple replicas will reject "
            "each other's tokens. Set it before running this for real."
        )
    logger.info(
        "identity=%s  snapshots=%s  mailer=%s",
        settings.identity,
        settings.snapshot_store,
        settings.mailer,
    )

    janitor = asyncio.create_task(_evict_idle_rooms())
    try:
        yield
    finally:
        janitor.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await janitor
        # Flush anything still dirty so a graceful shutdown loses nothing.
        for room_id in list(registry._rooms):  # noqa: SLF001 — shutdown path
            room = registry.get(room_id)
            if room is not None:
                await room.persist(force=True)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Frontmatter Sync",
        description="Collaboration server for Frontmatter. AGPL-3.0.",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(
        fastapi_users.get_auth_router(auth_backend), prefix="/auth/jwt", tags=["auth"]
    )
    if settings.allow_registration:
        app.include_router(
            fastapi_users.get_register_router(UserRead, UserCreate),
            prefix="/auth",
            tags=["auth"],
        )
    app.include_router(
        fastapi_users.get_reset_password_router(), prefix="/auth", tags=["auth"]
    )
    app.include_router(fastapi_users.get_verify_router(UserRead), prefix="/auth", tags=["auth"])
    app.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"]
    )

    app.include_router(forge_auth_router)
    app.include_router(refresh_router)
    app.include_router(rooms_router)
    app.include_router(collab_router, tags=["collab"])

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, object]:
        return {"status": "ok", "rooms": registry.count}

    @app.get("/config", tags=["meta"])
    async def public_config() -> dict[str, object]:
        """What a client needs to know before signing in.

        Lets the desktop app render the right sign-in options for whatever
        server it has been pointed at, instead of assuming.
        """
        return {
            "identity": settings.identity,
            "allowRegistration": settings.allow_registration,
            "requireEmailVerification": settings.require_email_verification,
            # Which git providers this deployment can sign somebody in with.
            # Empty means password only, which is the correct answer for a
            # self-hosted server whose operator has configured no OAuth app.
            "forgeProviders": configured_providers(),
        }

    return app


app = create_app()
