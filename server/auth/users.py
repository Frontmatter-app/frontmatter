"""Account management.

Built on `fastapi-users` rather than hand-rolled. The surface this replaces is
small — signup, login, verify, reset — but it is exactly the surface where
mistakes become breaches: password hashing parameters, reset-token entropy,
account enumeration through differing responses, timing leaks on login.

It is a library, not a service, so the deployment story stays "one process on a
VM" instead of "also run Keycloak".
"""
from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase as _SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from server.config import get_settings
from server.db import get_async_session
from server.mail import get_mailer
from server.models import User

settings = get_settings()


async def get_user_db(
    session: AsyncSession = Depends(get_async_session),
) -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    yield _SQLAlchemyUserDatabase(session, User)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.secret_key
    verification_token_secret = settings.secret_key

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        if settings.require_email_verification:
            # fastapi-users will not send this for us; requesting it here means
            # a fresh signup receives the mail without a second client call.
            await self.request_verify(user, request)

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        await get_mailer().send(
            to=user.email,
            subject="Reset your Frontmatter password",
            body=(
                "Someone asked to reset the password for this Frontmatter account.\n\n"
                f"Reset it here:\n{settings.public_url}/reset-password?token={token}\n\n"
                "If that was not you, nothing has changed and you can ignore this."
            ),
        )

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        await get_mailer().send(
            to=user.email,
            subject="Confirm your Frontmatter account",
            body=(
                "Welcome to Frontmatter.\n\n"
                f"Confirm this address:\n{settings.public_url}/verify?token={token}\n"
            ),
        )


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(
        secret=settings.secret_key,
        lifetime_seconds=settings.access_token_lifetime_seconds,
    )


# Bearer rather than cookie: the primary client is a desktop app, and the
# collaboration websocket authenticates with the same token.
auth_backend = AuthenticationBackend(
    name="jwt",
    transport=BearerTransport(tokenUrl="auth/jwt/login"),
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)


async def authenticate_token(token: str) -> User | None:
    """Resolves a bearer token to a user outside the dependency system.

    The websocket handshake needs this: `y-websocket` puts the token on the
    query string, so there is no `Authorization` header for a normal dependency
    to read, and the connection must be authorized before it is accepted.

    Returns None for any failure — expired, malformed, unknown user, or
    deactivated account — because the caller's only correct response to all of
    them is to refuse the socket.
    """
    strategy = get_jwt_strategy()
    async with _user_manager_context() as manager:
        user = await strategy.read_token(token, manager)
        if user is None or not user.is_active:
            return None
        return user


class _user_manager_context:
    """Async context manager yielding a UserManager outside a request.

    `get_user_manager` is a FastAPI dependency generator; the websocket path
    needs the same object without a request scope to resolve it.
    """

    def __init__(self) -> None:
        self._session_cm: Any = None
        self._session: AsyncSession | None = None

    async def __aenter__(self) -> UserManager:
        from server.db import async_session_maker

        self._session_cm = async_session_maker()
        self._session = await self._session_cm.__aenter__()
        return UserManager(_SQLAlchemyUserDatabase(self._session, User))

    async def __aexit__(self, *exc_info: Any) -> None:
        if self._session_cm is not None:
            await self._session_cm.__aexit__(*exc_info)
