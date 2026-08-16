"""Full-stack tests against a running app: signup, login, socket, convergence.

These use FastAPI's TestClient rather than a live container, so they run in CI
without Docker. `scripts/verify-server.sh` performs the same journey against a
real `docker compose up` when you want to prove the container too.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pycrdt import Doc, Text

from server.app import create_app
from server.collab.protocol import (
    MSG_SYNC,
    SYNC_STEP_1,
    SYNC_STEP_2,
    encode_sync_step_2,
    encode_sync_update,
    read_var_bytes,
    read_var_uint,
)
from server.collab.room import registry
from server.db import create_all
from server.ports.access import OwnerOnlyResolver, set_access_resolver
from server.ports.snapshots import FilesystemSnapshotStore, set_snapshot_store


@pytest.fixture
async def client(tmp_path):
    # Drop and recreate rather than just create: the tests share one SQLite
    # file, so without this an account registered by one test still exists in
    # the next and every registration after the first returns 400.
    from server.db import Base, engine

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
    await create_all()

    set_snapshot_store(FilesystemSnapshotStore(tmp_path / "snapshots"))
    set_access_resolver(OwnerOnlyResolver())
    registry.clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    registry.clear()
    set_snapshot_store(None)


def register_and_login(client: TestClient, email: str, password: str = "correct-horse-battery") -> tuple[str, str]:
    """Returns `(user_id, bearer_token)`."""
    response = client.post("/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    user_id = response.json()["id"]

    response = client.post(
        "/auth/jwt/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200, response.text
    return user_id, response.json()["access_token"]


# ── accounts ─────────────────────────────────────────────────────────────────


def test_health_needs_no_credentials(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_config_tells_a_client_how_to_sign_in(client: TestClient) -> None:
    body = client.get("/config").json()
    assert body["identity"] == "builtin"
    assert body["allowRegistration"] is True


def test_signup_and_login_with_no_external_service(client: TestClient) -> None:
    """The whole point: an account, with no Firebase and no identity provider."""
    _user_id, token = register_and_login(client, "alice@example.com")
    assert token

    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_password_is_never_returned(client: TestClient) -> None:
    _user_id, token = register_and_login(client, "alice@example.com")
    body = client.get("/users/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert "password" not in body
    assert "hashed_password" not in body


def test_duplicate_registration_is_refused(client: TestClient) -> None:
    register_and_login(client, "alice@example.com")
    again = client.post(
        "/auth/register", json={"email": "alice@example.com", "password": "another-one"}
    )
    assert again.status_code == 400


def test_wrong_password_is_refused(client: TestClient) -> None:
    register_and_login(client, "alice@example.com")
    response = client.post(
        "/auth/jwt/login",
        data={"username": "alice@example.com", "password": "not-the-password"},
    )
    assert response.status_code == 400


def test_unauthenticated_request_is_refused(client: TestClient) -> None:
    assert client.get("/users/me").status_code == 401


# ── socket authorization ─────────────────────────────────────────────────────


def test_socket_without_a_token_is_closed(client: TestClient) -> None:
    with pytest.raises(Exception):
        with client.websocket_connect("/collab/user/anyone/notes.md"):
            pass


def test_socket_with_a_garbage_token_is_closed(client: TestClient) -> None:
    with pytest.raises(Exception):
        with client.websocket_connect("/collab/user/x/notes.md?token=not-a-jwt"):
            pass


def test_socket_to_another_users_room_is_refused(client: TestClient) -> None:
    """Authentication is not authorization: a valid token for the wrong room."""
    _alice_id, alice_token = register_and_login(client, "alice@example.com")
    bob_id, _bob_token = register_and_login(client, "bob@example.com")

    with pytest.raises(Exception):
        with client.websocket_connect(f"/collab/user/{bob_id}/notes.md?token={alice_token}"):
            pass


def test_socket_to_own_room_is_accepted_and_handshakes(client: TestClient) -> None:
    user_id, token = register_and_login(client, "alice@example.com")

    with client.websocket_connect(f"/collab/user/{user_id}/notes.md?token={token}") as socket:
        frame = socket.receive_bytes()
        message_type, offset = read_var_uint(frame, 0)
        sync_type, offset = read_var_uint(frame, offset)
        # The server opens with its state vector. Its absence was the original
        # bug: without it a joiner never learns what the room already holds.
        assert (message_type, sync_type) == (MSG_SYNC, SYNC_STEP_1)


# ── convergence ──────────────────────────────────────────────────────────────


def test_two_clients_converge_on_one_document(client: TestClient) -> None:
    """The claim the whole server exists to make.

    Two peers edit the same room; each one's text reaches the other.
    """
    user_id, token = register_and_login(client, "alice@example.com")
    url = f"/collab/user/{user_id}/notes.md?token={token}"

    with client.websocket_connect(url) as first, client.websocket_connect(url) as second:
        first.receive_bytes()  # server SYNC_STEP_1
        second.receive_bytes()

        # First peer writes.
        alpha = Doc()
        alpha_text = alpha.get("markdown", type=Text)
        alpha_text += "written by the first peer"
        first.send_bytes(encode_sync_update(alpha.get_update()))

        # It reaches the second peer.
        delivered = _read_until_sync_payload(second)
        beta = Doc()
        beta.apply_update(delivered)
        assert "written by the first peer" in str(beta.get("markdown", type=Text))


def test_a_late_joiner_receives_existing_content(client: TestClient) -> None:
    """A peer arriving after the writing must not start from blank.

    This is the failure that made the Firestore transport unusable: a joiner
    never received existing state, so it authored a parallel history.
    """
    user_id, token = register_and_login(client, "alice@example.com")
    url = f"/collab/user/{user_id}/notes.md?token={token}"

    with client.websocket_connect(url) as first:
        first.receive_bytes()
        alpha = Doc()
        alpha_text = alpha.get("markdown", type=Text)
        alpha_text += "established before anyone else arrived"
        first.send_bytes(encode_sync_update(alpha.get_update()))

    # A new socket, after the writer has gone.
    with client.websocket_connect(url) as late:
        late.receive_bytes()  # server's SYNC_STEP_1

        # Ask for everything: an empty state vector means "I have nothing".
        empty = Doc()
        late.send_bytes(
            _encode_step_1(empty.get_state())
        )
        payload = _read_until_sync_payload(late)

        restored = Doc()
        restored.apply_update(payload)
        assert "established before anyone else arrived" in str(
            restored.get("markdown", type=Text)
        )


def test_content_survives_the_room_being_evicted(client: TestClient) -> None:
    """Durability is the snapshot store, not git and not process memory."""
    user_id, token = register_and_login(client, "alice@example.com")
    url = f"/collab/user/{user_id}/notes.md?token={token}"

    with client.websocket_connect(url) as socket:
        socket.receive_bytes()
        doc = Doc()
        text = doc.get("markdown", type=Text)
        text += "must outlive the process"
        socket.send_bytes(encode_sync_update(doc.get_update()))

    # Simulate the room being forgotten entirely.
    registry.clear()

    with client.websocket_connect(url) as socket:
        socket.receive_bytes()
        empty = Doc()
        socket.send_bytes(_encode_step_1(empty.get_state()))
        payload = _read_until_sync_payload(socket)

    restored = Doc()
    restored.apply_update(payload)
    assert "must outlive the process" in str(restored.get("markdown", type=Text))


# ── helpers ──────────────────────────────────────────────────────────────────


def _encode_step_1(state_vector: bytes) -> bytes:
    from server.collab.protocol import encode_sync_step_1

    return encode_sync_step_1(state_vector)


def _read_until_sync_payload(socket, attempts: int = 6) -> bytes:
    """Returns the payload of the next SYNC_STEP_2 or SYNC_UPDATE frame.

    Awareness frames and handshake chatter can interleave, so the test must
    skip them rather than assume frame ordering.
    """
    for _ in range(attempts):
        frame = socket.receive_bytes()
        message_type, offset = read_var_uint(frame, 0)
        if message_type != MSG_SYNC:
            continue
        _sync_type, offset = read_var_uint(frame, offset)
        payload, _ = read_var_bytes(frame, offset)
        if payload:
            return payload
    raise AssertionError("no sync payload arrived")
