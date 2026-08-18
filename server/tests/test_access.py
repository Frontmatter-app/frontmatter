"""Authorization.

The socket is the enforcement point. A client rendering itself read-only is a
courtesy to the user, not a control — these assert the server does not rely on
it.
"""
from __future__ import annotations

import pytest

from server.ports.access import (
    Access,
    AccessDenied,
    AllowAllResolver,
    GrantResolver,
    NotAuthenticated,
)
from server.ports.snapshots import FilesystemSnapshotStore
from server.rooms import grants


async def test_a_grant_opens_the_room_it_names() -> None:
    token = grants.encode(grants.mint(room_id="r1_alpha", user_id="alice", access="write"))
    principal = await GrantResolver().resolve(room_id="r1_alpha", token=token)

    assert principal.user_id == "alice"
    assert principal.access == Access.full()


async def test_a_read_grant_yields_read_only() -> None:
    token = grants.encode(grants.mint(room_id="r1_alpha", user_id="alice", access="read"))
    principal = await GrantResolver().resolve(room_id="r1_alpha", token=token)

    assert principal.access == Access.read_only()
    assert principal.access.can_write is False


async def test_a_grant_for_another_room_is_denied() -> None:
    """The property that makes a leaked grant survivable.

    Authentication is not authorization: this token is perfectly valid, and
    still must not open this room.
    """
    token = grants.encode(grants.mint(room_id="r1_mine", user_id="alice", access="write"))

    with pytest.raises(AccessDenied):
        await GrantResolver().resolve(room_id="r1_someone-elses", token=token)


async def test_an_expired_grant_asks_for_a_new_one() -> None:
    """Distinct from denial: the client should re-mint, not give up."""
    token = grants.encode(grants.mint(room_id="r1_alpha", user_id="alice", access="write", ttl=-1))

    with pytest.raises(NotAuthenticated):
        await GrantResolver().resolve(room_id="r1_alpha", token=token)


@pytest.mark.parametrize("token", ["", "not-a-grant", "a.b"])
async def test_a_garbage_token_is_not_authenticated(token: str) -> None:
    with pytest.raises(NotAuthenticated):
        await GrantResolver().resolve(room_id="r1_alpha", token=token)


async def test_a_session_token_does_not_open_a_socket() -> None:
    """The change this phase makes.

    A session token used to be enough to attempt any room. Now it is not a
    room grant, so it opens nothing.
    """
    with pytest.raises(NotAuthenticated):
        await GrantResolver().resolve(room_id="r1_alpha", token="a.session.jwt")


async def test_allow_all_still_requires_authentication(monkeypatch) -> None:
    import server.auth.users as users

    monkeypatch.setattr(users, "authenticate_token", _resolves_to(None))
    with pytest.raises(NotAuthenticated):
        await AllowAllResolver().resolve(room_id="whatever", token="bad")


async def test_allow_all_grants_everything_to_a_signed_in_user(monkeypatch) -> None:
    import server.auth.users as users

    monkeypatch.setattr(users, "authenticate_token", _resolves_to(_FakeUser("anyone")))
    principal = await AllowAllResolver().resolve(room_id="whatever", token="good")

    assert principal.access == Access.full()
    assert principal.user_id == "anyone"


class _FakeUser:
    def __init__(self, identifier: str) -> None:
        self.id = identifier


def _resolves_to(value):
    async def _authenticate(_token: str):
        return value

    return _authenticate


# ── snapshot storage ─────────────────────────────────────────────────────────


def test_snapshot_keys_cannot_escape_the_snapshot_root(tmp_path) -> None:
    """Room ids are hashed now, but the store must not depend on that.

    Anything that ever names a key — a future asset store, a debugging tool —
    inherits this guard, so it is tested on the store rather than assumed from
    the caller.
    """
    store = FilesystemSnapshotStore(tmp_path)
    resolved = store._path("../../../../etc/passwd")  # noqa: SLF001
    assert tmp_path.resolve() in resolved.parents or resolved.parent == tmp_path.resolve()
    assert "etc" in resolved.parts
    assert ".." not in resolved.parts


async def test_filesystem_store_round_trips(tmp_path) -> None:
    store = FilesystemSnapshotStore(tmp_path)
    await store.store("rooms/a/state.ybin", b"payload")
    assert await store.load("rooms/a/state.ybin") == b"payload"
    await store.delete("rooms/a/state.ybin")
    assert await store.load("rooms/a/state.ybin") is None


async def test_filesystem_store_returns_none_for_unknown_key(tmp_path) -> None:
    store = FilesystemSnapshotStore(tmp_path)
    assert await store.load("rooms/missing/state.ybin") is None
