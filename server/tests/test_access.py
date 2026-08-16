"""Authorization.

The socket is the enforcement point. A client rendering itself read-only is a
courtesy to the user, not a control — these assert the server does not rely on
it.
"""
from __future__ import annotations

from server.ports.access import Access, AllowAllResolver, OwnerOnlyResolver
from server.ports.snapshots import FilesystemSnapshotStore


async def test_owner_reaches_their_own_room() -> None:
    access = await OwnerOnlyResolver().resolve(user_id="alice", room_id="user/alice/notes.md")
    assert access == Access.full()


async def test_other_users_room_is_refused() -> None:
    access = await OwnerOnlyResolver().resolve(user_id="mallory", room_id="user/alice/notes.md")
    assert access.can_read is False
    assert access.can_write is False


async def test_prefix_collision_does_not_grant_access() -> None:
    """`user/alice-evil/...` must not satisfy a check for `user/alice`."""
    access = await OwnerOnlyResolver().resolve(
        user_id="alice", room_id="user/alice-evil/notes.md"
    )
    assert access.can_read is False


async def test_bare_prefix_with_no_document_is_refused() -> None:
    access = await OwnerOnlyResolver().resolve(user_id="alice", room_id="user/alice/")
    assert access.can_read is False


async def test_allow_all_still_requires_authentication_upstream() -> None:
    access = await AllowAllResolver().resolve(user_id="anyone", room_id="whatever")
    assert access == Access.full()


def test_snapshot_keys_cannot_escape_the_snapshot_root(tmp_path) -> None:
    """Room ids will carry client-supplied repository and branch names.

    Treating them as trusted path segments would be a directory traversal, so
    the store must neutralise them.
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
