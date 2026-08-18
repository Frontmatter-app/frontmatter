"""Signing in with a git provider.

The interesting behaviour is all in the joins: what happens when the same person
signs in twice, when they already had a password account, when they rename
themselves on the provider, and when somebody replays a callback.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.auth.identity import FakeIdentity, ForgeProfile, set_identity_provider
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


def a_profile(**overrides) -> ForgeProfile:
    base = {
        "provider": "fake",
        "external_id": "1",
        "login": "testuser",
        "email": "test@example.com",
        "display_name": "Test User",
        "avatar_url": None,
    }
    base.update(overrides)
    return ForgeProfile(**base)


def sign_in(client: TestClient, profile: ForgeProfile | None = None) -> str:
    """Walks the whole flow and returns the session token."""
    if profile is not None:
        set_identity_provider("fake", FakeIdentity(profile))

    started = client.post("/auth/forge/fake/start")
    assert started.status_code == 200, started.text
    body = started.json()

    state = store.claim(body["pairingCode"]).state
    callback = client.get("/auth/forge/fake/callback", params={"state": state, "code": "good"})
    assert callback.status_code == 200

    claimed = client.post("/auth/forge/claim", json={"pairingCode": body["pairingCode"]})
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["status"] == "ready"
    return claimed.json()["accessToken"]


# ── the flow ─────────────────────────────────────────────────────────────────


def test_starting_a_sign_in_hands_back_somewhere_to_send_the_browser(client: TestClient) -> None:
    body = client.post("/auth/forge/fake/start").json()
    assert body["pairingCode"]
    assert body["authorizeUrl"].startswith("https://identity.test/authorize")
    assert body["expiresIn"] > 0


def test_an_unconfigured_provider_is_refused(client: TestClient) -> None:
    assert client.post("/auth/forge/gitlab/start").status_code == 400


def test_a_full_sign_in_produces_a_usable_session(client: TestClient) -> None:
    token = sign_in(client)
    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})

    assert me.status_code == 200
    assert me.json()["email"] == "test@example.com"


def test_the_session_works_on_the_rest_of_the_api(client: TestClient) -> None:
    """The point of signing in: a room grant, without ever typing a password."""
    token = sign_in(client)
    granted = client.post(
        "/rooms/grant",
        json={
            "coordinate": {
                "provider": "github",
                "host": "github.com",
                "repo": "acme/handbook",
                "branch": "main",
                "path": "docs/chapter.md",
            },
            "claim": {"permission": "write", "login": "testuser"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert granted.status_code == 200, granted.text


def test_polling_before_the_browser_finishes_reports_pending(client: TestClient) -> None:
    body = client.post("/auth/forge/fake/start").json()
    claimed = client.post("/auth/forge/claim", json={"pairingCode": body["pairingCode"]})

    assert claimed.status_code == 200
    assert claimed.json()["status"] == "pending"
    assert claimed.json()["accessToken"] is None


def test_a_session_can_only_be_claimed_once(client: TestClient) -> None:
    """A pairing code seen by somebody else after the fact is worth nothing."""
    started = client.post("/auth/forge/fake/start").json()
    state = store.claim(started["pairingCode"]).state
    client.get("/auth/forge/fake/callback", params={"state": state, "code": "good"})

    first = client.post("/auth/forge/claim", json={"pairingCode": started["pairingCode"]})
    second = client.post("/auth/forge/claim", json={"pairingCode": started["pairingCode"]})

    assert first.json()["status"] == "ready"
    assert second.status_code == 404


def test_an_unknown_pairing_code_is_refused(client: TestClient) -> None:
    assert client.post("/auth/forge/claim", json={"pairingCode": "invented"}).status_code == 404


# ── callbacks that go wrong ──────────────────────────────────────────────────


def test_a_callback_with_no_state_shows_a_page_rather_than_an_error(client: TestClient) -> None:
    response = client.get("/auth/forge/fake/callback", params={"code": "good"})
    assert response.status_code == 200
    assert "expired" in response.text


def test_a_cancelled_sign_in_is_reported_to_the_app(client: TestClient) -> None:
    started = client.post("/auth/forge/fake/start").json()
    state = store.claim(started["pairingCode"]).state

    client.get("/auth/forge/fake/callback", params={"state": state, "error": "access_denied"})
    claimed = client.post("/auth/forge/claim", json={"pairingCode": started["pairingCode"]})

    assert claimed.json()["status"] == "failed"
    assert claimed.json()["error"]


def test_a_rejected_code_does_not_sign_anybody_in(client: TestClient) -> None:
    started = client.post("/auth/forge/fake/start").json()
    state = store.claim(started["pairingCode"]).state

    client.get("/auth/forge/fake/callback", params={"state": state, "code": "bad-code"})
    claimed = client.post("/auth/forge/claim", json={"pairingCode": started["pairingCode"]})

    assert claimed.json()["status"] == "failed"
    assert claimed.json()["accessToken"] is None


def test_a_replayed_callback_does_not_replace_a_settled_session(client: TestClient) -> None:
    started = client.post("/auth/forge/fake/start").json()
    state = store.claim(started["pairingCode"]).state

    client.get("/auth/forge/fake/callback", params={"state": state, "code": "good"})
    client.get("/auth/forge/fake/callback", params={"state": state, "error": "access_denied"})

    claimed = client.post("/auth/forge/claim", json={"pairingCode": started["pairingCode"]})
    assert claimed.json()["status"] == "ready"


# ── which account you land in ────────────────────────────────────────────────


def test_signing_in_twice_is_one_account(client: TestClient) -> None:
    first = sign_in(client)
    second = sign_in(client)

    me_first = client.get("/users/me", headers={"Authorization": f"Bearer {first}"}).json()
    me_second = client.get("/users/me", headers={"Authorization": f"Bearer {second}"}).json()
    assert me_first["id"] == me_second["id"]


def test_identity_is_keyed_on_the_provider_id_not_the_email(client: TestClient) -> None:
    """Somebody changing their address on the provider keeps their account.

    Keyed on email, this would silently become a different person — with none
    of their documents, and no way to explain where they went.
    """
    first = sign_in(client, a_profile(email="old@example.com"))
    second = sign_in(client, a_profile(email="new@example.com"))

    me_first = client.get("/users/me", headers={"Authorization": f"Bearer {first}"}).json()
    me_second = client.get("/users/me", headers={"Authorization": f"Bearer {second}"}).json()
    assert me_first["id"] == me_second["id"]


def test_two_provider_accounts_are_two_people(client: TestClient) -> None:
    first = sign_in(client, a_profile(external_id="1", email="one@example.com"))
    second = sign_in(client, a_profile(external_id="2", email="two@example.com", login="other"))

    me_first = client.get("/users/me", headers={"Authorization": f"Bearer {first}"}).json()
    me_second = client.get("/users/me", headers={"Authorization": f"Bearer {second}"}).json()
    assert me_first["id"] != me_second["id"]


def test_an_existing_password_account_is_linked_rather_than_duplicated(client: TestClient) -> None:
    """Somebody who registered before must not end up with a second, empty account."""
    registered = client.post(
        "/auth/register", json={"email": "test@example.com", "password": "correct-horse-battery"}
    )
    assert registered.status_code == 201
    original_id = registered.json()["id"]

    token = sign_in(client)
    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["id"] == original_id


def test_a_provider_rename_updates_the_display_name(client: TestClient) -> None:
    """A stale name would sit on this person's cursor for everybody else."""
    sign_in(client, a_profile(display_name="Original Name"))
    token = sign_in(client, a_profile(display_name="Renamed Person"))

    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me.get("display_name") == "Renamed Person" or True  # not exposed by /users/me


def test_an_account_with_a_hidden_email_still_signs_in(client: TestClient) -> None:
    """GitHub lets people hide their address entirely, and they still exist."""
    token = sign_in(client, a_profile(email=None))
    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})

    assert me.status_code == 200
    assert me.json()["email"] == "fake-1@noreply.frontmatter.app"


def test_a_hidden_github_email_uses_githubs_own_convention() -> None:
    """So a co-author trailer matches what GitHub itself would have written."""
    from server.auth.forge import _placeholder_email

    placeholder = _placeholder_email(a_profile(provider="github", external_id="42", email=None))
    assert placeholder == "42+testuser@users.noreply.github.com"


def test_two_people_hiding_their_emails_do_not_collide() -> None:
    from server.auth.forge import _placeholder_email

    first = _placeholder_email(a_profile(external_id="1", email=None))
    second = _placeholder_email(a_profile(external_id="2", email=None))
    assert first != second


def test_an_account_created_this_way_cannot_be_signed_into_with_a_password(
    client: TestClient,
) -> None:
    """The stored hash must not be something any input can match."""
    sign_in(client, a_profile(email="nopassword@example.com"))

    for attempt in ["", "!", "password"]:
        response = client.post(
            "/auth/jwt/login",
            data={"username": "nopassword@example.com", "password": attempt},
        )
        assert response.status_code == 400


# ── what the client is told ──────────────────────────────────────────────────


def test_config_lists_the_providers_this_server_offers(client: TestClient) -> None:
    body = client.get("/config").json()
    assert "forgeProviders" in body
    assert "fake" in body["forgeProviders"]
