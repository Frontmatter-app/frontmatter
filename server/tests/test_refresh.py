"""Renewing a session.

The happy path is one test. The rest of this file is about what happens when a
refresh token ends up somewhere it should not, because that is the only reason
rotation exists.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.auth.identity import FakeIdentity, set_identity_provider
from server.auth.pairing import store
from server.db import create_all


@pytest.fixture
async def client(tmp_path):
    from server.db import Base, engine

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
    await create_all()

    store.clear()
    set_identity_provider("fake", FakeIdentity())
    with TestClient(create_app()) as test_client:
        yield test_client
    set_identity_provider("fake", None)
    store.clear()


def register_and_login(client: TestClient, email: str = "alice@example.com") -> str:
    password = "correct-horse-battery"
    assert client.post("/auth/register", json={"email": email, "password": password}).status_code == 201
    response = client.post("/auth/jwt/login", data={"username": email, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def a_refresh_token(client: TestClient, access_token: str) -> str:
    response = client.post(
        "/auth/refresh/issue", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert response.status_code == 200, response.text
    return response.json()["refreshToken"]


def renew(client: TestClient, refresh_token: str):
    return client.post("/auth/refresh", json={"refreshToken": refresh_token})


# ── the happy path ───────────────────────────────────────────────────────────


def test_a_refresh_token_renews_a_session(client: TestClient) -> None:
    refresh = a_refresh_token(client, register_and_login(client))
    renewed = renew(client, refresh)

    assert renewed.status_code == 200, renewed.text
    body = renewed.json()
    assert body["accessToken"]
    assert body["refreshToken"] != refresh
    assert body["expiresIn"] > 0


def test_the_renewed_token_works_on_the_api(client: TestClient) -> None:
    refresh = a_refresh_token(client, register_and_login(client))
    renewed = renew(client, refresh).json()

    me = client.get("/users/me", headers={"Authorization": f"Bearer {renewed['accessToken']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_a_session_can_be_renewed_repeatedly(client: TestClient) -> None:
    """Somebody who keeps the app open must never be signed out for it."""
    token = a_refresh_token(client, register_and_login(client))

    for _ in range(5):
        body = renew(client, token).json()
        token = body["refreshToken"]

    assert client.get(
        "/users/me", headers={"Authorization": f"Bearer {body['accessToken']}"}
    ).status_code == 200


def test_issuing_a_refresh_token_needs_a_live_session(client: TestClient) -> None:
    assert client.post("/auth/refresh/issue").status_code == 401


# ── rotation ─────────────────────────────────────────────────────────────────


def test_a_spent_token_cannot_be_used_again(client: TestClient) -> None:
    """The point of rotation: a copy captured in transit dies on first use."""
    original = a_refresh_token(client, register_and_login(client))
    renew(client, original)

    assert renew(client, original).status_code == 401


def test_reuse_revokes_the_whole_family(client: TestClient) -> None:
    """The case rotation exists for.

    A token was stolen. Whoever holds the copy uses it, and so does the real
    client. There is no way to tell which is which from here, so the safe answer
    is to end the session for both and make somebody sign in again.
    """
    original = a_refresh_token(client, register_and_login(client))
    current = renew(client, original).json()["refreshToken"]

    # The thief replays the old one.
    assert renew(client, original).status_code == 401

    # And the legitimate client's live token is dead too.
    assert renew(client, current).status_code == 401


def test_an_unrelated_session_survives_a_revoked_family(client: TestClient) -> None:
    """Signing out one device must not sign out the others."""
    access = register_and_login(client)
    laptop = a_refresh_token(client, access)
    desktop = a_refresh_token(client, access)

    renew(client, laptop)
    renew(client, laptop)  # reuse: revokes the laptop family only

    assert renew(client, desktop).status_code == 200


# ── tokens that should not work ──────────────────────────────────────────────


@pytest.mark.parametrize("token", ["", "invented", "a" * 64])
def test_an_unknown_token_is_refused(client: TestClient, token: str) -> None:
    assert renew(client, token).status_code == 401


def test_every_failure_gives_the_same_answer(client: TestClient) -> None:
    """Distinguishing them would tell a prober which guess was closest."""
    original = a_refresh_token(client, register_and_login(client))
    renew(client, original)

    reused = renew(client, original)
    unknown = renew(client, "invented")

    assert reused.status_code == unknown.status_code == 401
    assert reused.json()["detail"] == unknown.json()["detail"]


def test_an_expired_token_is_refused(client: TestClient, monkeypatch) -> None:
    from datetime import timedelta

    import server.auth.refresh as refresh_module

    refresh = a_refresh_token(client, register_and_login(client))

    # Move the clock past the token's expiry rather than waiting sixty days.
    real_now = refresh_module._now
    monkeypatch.setattr(
        refresh_module, "_now", lambda: real_now() + timedelta(days=61)
    )

    assert renew(client, refresh).status_code == 401


# ── signing out ──────────────────────────────────────────────────────────────


def test_revoking_ends_the_session(client: TestClient) -> None:
    refresh = a_refresh_token(client, register_and_login(client))

    assert client.post("/auth/refresh/revoke", json={"refreshToken": refresh}).status_code == 204
    assert renew(client, refresh).status_code == 401


def test_revoking_an_unknown_token_is_silent(client: TestClient) -> None:
    """Signing out must not fail, whatever the client happens to be holding."""
    assert client.post("/auth/refresh/revoke", json={"refreshToken": "gone"}).status_code == 204


def test_revoking_needs_no_live_access_token(client: TestClient) -> None:
    """Somebody signing out has usually been idle, so theirs has expired."""
    refresh = a_refresh_token(client, register_and_login(client))
    response = client.post("/auth/refresh/revoke", json={"refreshToken": refresh})

    assert response.status_code == 204


def test_a_deactivated_account_cannot_renew(client: TestClient) -> None:
    import uuid as uuid_module

    from server.db import async_session_maker
    from server.models import User

    access = register_and_login(client)
    refresh = a_refresh_token(client, access)
    user_id = uuid_module.UUID(
        client.get("/users/me", headers={"Authorization": f"Bearer {access}"}).json()["id"]
    )

    async def deactivate() -> None:
        async with async_session_maker() as session:
            user = await session.get(User, user_id)
            user.is_active = False
            await session.commit()

    client.portal.call(deactivate)  # type: ignore[attr-defined]
    assert renew(client, refresh).status_code == 401


# ── signing in with a provider ───────────────────────────────────────────────


def test_a_provider_sign_in_is_renewable_too(client: TestClient) -> None:
    """Otherwise that route produces a session that dies in an hour."""
    started = client.post("/auth/forge/fake/start").json()
    state = store.claim(started["pairingCode"]).state
    client.get("/auth/forge/fake/callback", params={"state": state, "code": "good"})

    claimed = client.post("/auth/forge/claim", json={"pairingCode": started["pairingCode"]}).json()
    assert claimed["refreshToken"]

    renewed = renew(client, claimed["refreshToken"])
    assert renewed.status_code == 200
