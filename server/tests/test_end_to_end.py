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
    MSG_ACCESS,
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
from server.ports.access import GrantResolver, set_access_resolver
from server.ports.snapshots import FilesystemSnapshotStore, set_snapshot_store


# Which repository the current test is working in.
#
# Room ids are a hash of the coordinate, so every test naming the same
# repository, branch and path would name the *same room* — and rooms outlive
# an individual test by design, being evicted lazily rather than on the last
# disconnect. That made tests share state through the registry: one test's
# lingering room could serve another test's sockets, and two sockets in one
# test could even land on different room objects either side of a `clear()`.
# A repository per test restores the isolation the old per-user room ids gave
# for free, and models reality better besides.
_current_repo = "acme/handbook"


@pytest.fixture
async def client(tmp_path, request):
    # Drop and recreate rather than just create: the tests share one SQLite
    # file, so without this an account registered by one test still exists in
    # the next and every registration after the first returns 400.
    from server.db import Base, engine

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
    await create_all()

    global _current_repo
    _current_repo = f"acme/{request.node.name.replace('_', '-')}"

    set_snapshot_store(FilesystemSnapshotStore(tmp_path / "snapshots"))
    set_access_resolver(GrantResolver())
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


def a_coordinate(**overrides) -> dict:
    base = {
        "provider": "github",
        "host": "github.com",
        "repo": _current_repo,
        "branch": "main",
        "path": "docs/chapter.md",
    }
    base.update(overrides)
    return base


def request_grant(
    client: TestClient,
    session_token: str,
    *,
    permission: str = "write",
    coordinate: dict | None = None,
) -> dict:
    """Trades a claim for a room, the way the desktop app does."""
    response = client.post(
        "/rooms/grant",
        json={
            "coordinate": coordinate or a_coordinate(),
            "claim": {"permission": permission, "login": "alice"},
        },
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def socket_url(grant: dict) -> str:
    return f"/collab/{grant['roomId']}?token={grant['token']}"


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


def test_a_grant_needs_a_signed_in_account(client: TestClient) -> None:
    response = client.post(
        "/rooms/grant",
        json={"coordinate": a_coordinate(), "claim": {"permission": "write", "login": "alice"}},
    )
    assert response.status_code == 401


def test_a_grant_names_the_room_rather_than_the_client(client: TestClient) -> None:
    """Clients never compute a room id; they are told one.

    That is what keeps the naming scheme single-sourced — there is no second
    implementation of the hash to drift out of step with the server's.
    """
    _user_id, token = register_and_login(client, "alice@example.com")
    grant = request_grant(client, token)

    assert grant["roomId"].startswith("r1_")
    assert grant["access"] == "write"
    # No verifier is configured in tests, and saying so is the honest answer.
    assert grant["verification"] == "unverified"
    assert grant["renewAfter"] < grant["expiresIn"]


def test_the_same_file_is_the_same_room_for_everybody(client: TestClient) -> None:
    """Two people opening one file must land together, or nobody sees anybody."""
    _alice_id, alice_token = register_and_login(client, "alice@example.com")
    _bob_id, bob_token = register_and_login(client, "bob@example.com")

    alice = request_grant(client, alice_token)
    bob = request_grant(client, bob_token)

    assert alice["roomId"] == bob["roomId"]
    assert alice["token"] != bob["token"]


def test_different_files_are_different_rooms(client: TestClient) -> None:
    _user_id, token = register_and_login(client, "alice@example.com")

    first = request_grant(client, token)
    second = request_grant(client, token, coordinate=a_coordinate(path="docs/other.md"))
    branched = request_grant(client, token, coordinate=a_coordinate(branch="draft"))

    assert len({first["roomId"], second["roomId"], branched["roomId"]}) == 3


def test_an_unusable_coordinate_is_refused(client: TestClient) -> None:
    _user_id, token = register_and_login(client, "alice@example.com")

    response = client.post(
        "/rooms/grant",
        json={
            "coordinate": a_coordinate(path="../../etc/passwd"),
            "claim": {"permission": "write", "login": "alice"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400


def test_socket_without_a_token_is_closed(client: TestClient) -> None:
    with pytest.raises(Exception):
        with client.websocket_connect("/collab/r1_anything"):
            pass


def test_socket_with_a_garbage_token_is_closed(client: TestClient) -> None:
    with pytest.raises(Exception):
        with client.websocket_connect("/collab/r1_anything?token=not-a-grant"):
            pass


def test_a_session_token_no_longer_opens_a_socket(client: TestClient) -> None:
    """The hole this phase closes.

    A session token used to be sufficient for any room name on the server.
    """
    _user_id, session_token = register_and_login(client, "alice@example.com")
    grant = request_grant(client, session_token)

    with pytest.raises(Exception):
        with client.websocket_connect(f"/collab/{grant['roomId']}?token={session_token}"):
            pass


def test_a_grant_does_not_open_a_different_room(client: TestClient) -> None:
    """Authentication is not authorization: a valid grant for the wrong room."""
    _user_id, token = register_and_login(client, "alice@example.com")

    mine = request_grant(client, token)
    theirs = request_grant(client, token, coordinate=a_coordinate(repo="acme/secrets"))

    with pytest.raises(Exception):
        with client.websocket_connect(f"/collab/{theirs['roomId']}?token={mine['token']}"):
            pass


def test_socket_with_a_grant_is_accepted_and_handshakes(client: TestClient) -> None:
    _user_id, token = register_and_login(client, "alice@example.com")
    grant = request_grant(client, token)

    with client.websocket_connect(socket_url(grant)) as socket:
        frame = socket.receive_bytes()
        message_type, offset = read_var_uint(frame, 0)
        sync_type, offset = read_var_uint(frame, offset)
        # The server opens with its state vector. Its absence was the original
        # bug: without it a joiner never learns what the room already holds.
        assert (message_type, sync_type) == (MSG_SYNC, SYNC_STEP_1)


def test_the_server_states_the_access_it_granted(client: TestClient) -> None:
    """A read-only peer must be able to explain why its editor will not type."""
    _user_id, token = register_and_login(client, "alice@example.com")
    grant = request_grant(client, token, permission="read")
    assert grant["access"] == "read"

    with client.websocket_connect(socket_url(grant)) as socket:
        assert _read_access_frame(socket) == "read"


def test_a_read_only_peer_cannot_write(client: TestClient) -> None:
    """The client rendering itself read-only is a courtesy, not the control."""
    _alice_id, alice_token = register_and_login(client, "alice@example.com")
    _bob_id, bob_token = register_and_login(client, "bob@example.com")

    writer = request_grant(client, alice_token)
    reader = request_grant(client, bob_token, permission="read")

    with client.websocket_connect(socket_url(reader)) as read_only, client.websocket_connect(
        socket_url(writer)
    ) as watcher:
        read_only.receive_bytes()
        watcher.receive_bytes()

        rejected = Doc()
        rejected_text = rejected.get("markdown", type=Text)
        rejected_text += "written by someone with read access"
        read_only.send_bytes(encode_sync_update(rejected.get_update()))

        # The writer asks for everything the room holds. The dropped update
        # must not be in it.
        empty = Doc()
        watcher.send_bytes(_encode_step_1(empty.get_state()))
        payload = _read_until_sync_payload(watcher, allow_empty=True)

        restored = Doc()
        if payload:
            restored.apply_update(payload)
        assert "read access" not in str(restored.get("markdown", type=Text))


# ── convergence ──────────────────────────────────────────────────────────────


def test_two_clients_converge_on_one_document(client: TestClient) -> None:
    """The claim the whole server exists to make.

    Two peers edit the same room; each one's text reaches the other.
    """
    _user_id, token = register_and_login(client, "alice@example.com")
    url = socket_url(request_grant(client, token))

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
    _user_id, token = register_and_login(client, "alice@example.com")
    url = socket_url(request_grant(client, token))

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
    _user_id, token = register_and_login(client, "alice@example.com")
    url = socket_url(request_grant(client, token))

    with client.websocket_connect(url) as socket:
        socket.receive_bytes()
        doc = Doc()
        text = doc.get("markdown", type=Text)
        text += "must outlive the process"
        socket.send_bytes(encode_sync_update(doc.get_update()))

        # Barrier, not decoration. Frames are handled in order, so a reply to
        # this one proves the update above was applied — and applying it is
        # what writes the snapshot. Without the barrier the test races the
        # server: `registry.clear()` below can drop the room before it has
        # processed anything, and the failure looks like broken durability
        # rather than a test that did not wait.
        socket.send_bytes(_encode_step_1(Doc().get_state()))
        assert b"must outlive the process" in _read_until_sync_payload(socket)

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


def _read_until_sync_payload(socket, attempts: int = 6, allow_empty: bool = False) -> bytes:
    """Returns the payload of the next SYNC_STEP_2 or SYNC_UPDATE frame.

    Awareness and access frames interleave with the handshake, so the test must
    skip them rather than assume frame ordering.

    `allow_empty` is for the read-only case, where "the room holds nothing" is
    the assertion rather than a timeout: an empty update is the correct answer
    and waiting for a non-empty one would hang.
    """
    for _ in range(attempts):
        frame = socket.receive_bytes()
        message_type, offset = read_var_uint(frame, 0)
        if message_type != MSG_SYNC:
            continue
        _sync_type, offset = read_var_uint(frame, offset)
        payload, _ = read_var_bytes(frame, offset)
        if payload or allow_empty:
            return payload
    if allow_empty:
        return b""
    raise AssertionError("no sync payload arrived")


def _read_access_frame(socket, attempts: int = 6) -> str:
    """The server's statement of what this peer may do."""
    for _ in range(attempts):
        frame = socket.receive_bytes()
        message_type, offset = read_var_uint(frame, 0)
        if message_type != MSG_ACCESS:
            continue
        payload, _ = read_var_bytes(frame, offset)
        return payload.decode("utf-8")
    raise AssertionError("no access frame arrived")
