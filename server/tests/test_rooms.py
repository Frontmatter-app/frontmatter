"""Room behaviour: seeding, convergence, persistence, presence.

These cover the failures that made the previous transport lose and duplicate
people's writing, so they are regression tests for real incidents rather than
coverage for its own sake.
"""
from __future__ import annotations

import asyncio

import pytest
from pycrdt import Doc, Text

from server.collab.room import Room, RoomRegistry, snapshot_key
from server.ports.snapshots import set_snapshot_store


class InMemorySnapshotStore:
    def __init__(self) -> None:
        self.data: dict[str, bytes] = {}
        self.writes = 0

    async def load(self, key: str) -> bytes | None:
        return self.data.get(key)

    async def store(self, key: str, payload: bytes) -> None:
        self.data[key] = payload
        self.writes += 1

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)


@pytest.fixture
def store() -> InMemorySnapshotStore:
    snapshots = InMemorySnapshotStore()
    set_snapshot_store(snapshots)
    yield snapshots
    set_snapshot_store(None)


async def test_new_room_is_empty_and_unbootstrapped(store: InMemorySnapshotStore) -> None:
    room = Room("user/alice/notes.md")
    await room.bootstrap()
    assert room.bootstrapped is False
    assert room.text() == ""


async def test_first_peer_seeds_the_room(store: InMemorySnapshotStore) -> None:
    room = Room("user/alice/notes.md")
    await room.bootstrap()

    assert room.seed_if_empty("# Hello") is True
    assert room.text() == "# Hello"


async def test_second_seed_is_refused_so_content_is_not_duplicated(
    store: InMemorySnapshotStore,
) -> None:
    """The bug this exists for: two peers each seeding produced two copies.

    Both clients opened the same file, both inserted the whole document, and
    the CRDT correctly merged them into the text twice over.
    """
    room = Room("user/alice/notes.md")
    await room.bootstrap()

    room.seed_if_empty("# Hello")
    assert room.seed_if_empty("# Hello") is False
    assert room.text() == "# Hello"  # not "# Hello# Hello"


async def test_room_restored_from_snapshot_refuses_seeding(
    store: InMemorySnapshotStore,
) -> None:
    """A peer joining an existing document must not reseed it from its own copy."""
    original = Room("user/alice/notes.md")
    await original.bootstrap()
    original.seed_if_empty("established content")
    await original.persist(force=True)

    rejoined = Room("user/alice/notes.md")
    await rejoined.bootstrap()

    assert rejoined.bootstrapped is True
    assert rejoined.seed_if_empty("a client's stale copy") is False
    assert rejoined.text() == "established content"


async def test_updates_from_a_peer_converge(store: InMemorySnapshotStore) -> None:
    room = Room("user/alice/notes.md")
    await room.bootstrap()
    room.seed_if_empty("hello")

    # A peer edits its own replica and sends the delta.
    peer = Doc()
    peer.apply_update(room.doc.get_update())
    peer_text = peer.get("markdown", type=Text)
    peer_text += " world"

    await room.apply_update(peer.get_update(room.doc.get_state()))

    assert room.text() == "hello world"


async def test_concurrent_edits_from_two_peers_both_survive(
    store: InMemorySnapshotStore,
) -> None:
    room = Room("user/alice/notes.md")
    await room.bootstrap()
    room.seed_if_empty("base")

    first = Doc()
    first.apply_update(room.doc.get_update())
    second = Doc()
    second.apply_update(room.doc.get_update())

    first_text = first.get("markdown", type=Text)
    first_text += " one"
    second_text = second.get("markdown", type=Text)
    second_text += " two"

    await room.apply_update(first.get_update(room.doc.get_state()))
    await room.apply_update(second.get_update(room.doc.get_state()))

    merged = room.text()
    assert "one" in merged and "two" in merged
    assert merged.startswith("base")


async def test_persist_writes_a_snapshot_that_restores(
    store: InMemorySnapshotStore,
) -> None:
    room = Room("user/alice/notes.md")
    await room.bootstrap()
    room.seed_if_empty("durable")
    await room.persist(force=True)

    assert snapshot_key("user/alice/notes.md") in store.data

    restored = Room("user/alice/notes.md")
    await restored.bootstrap()
    assert restored.text() == "durable"


async def test_persist_is_debounced(store: InMemorySnapshotStore) -> None:
    room = Room("user/alice/notes.md")
    await room.bootstrap()
    room.seed_if_empty("x")

    await room.persist(force=True)
    writes_after_first = store.writes

    room.dirty = True
    await room.persist()  # inside the debounce window
    assert store.writes == writes_after_first

    room.dirty = True
    await room.persist(force=True)
    assert store.writes == writes_after_first + 1


async def test_clean_room_does_not_write(store: InMemorySnapshotStore) -> None:
    room = Room("user/alice/notes.md")
    await room.bootstrap()
    await room.persist(force=True)
    assert store.writes == 0


async def test_failed_snapshot_leaves_the_room_dirty(store: InMemorySnapshotStore) -> None:
    """An unwritten change is still unwritten; the next attempt must retry."""

    class FailingStore(InMemorySnapshotStore):
        async def store(self, key: str, payload: bytes) -> None:
            raise OSError("disk full")

    set_snapshot_store(FailingStore())
    room = Room("user/alice/notes.md")
    await room.bootstrap()
    room.seed_if_empty("unsaved")

    await room.persist(force=True)
    assert room.dirty is True


async def test_corrupt_snapshot_does_not_make_a_document_unopenable(
    store: InMemorySnapshotStore,
) -> None:
    store.data[snapshot_key("user/alice/notes.md")] = b"this is not a yjs update"
    room = Room("user/alice/notes.md")
    await room.bootstrap()

    # Starts empty and reseedable rather than raising and locking the user out.
    assert room.bootstrapped is False
    assert room.seed_if_empty("recovered") is True


async def test_stale_awareness_is_pruned(store: InMemorySnapshotStore) -> None:
    room = Room("user/alice/notes.md")
    await room.bootstrap()
    room._awareness_ttl = 0.05  # noqa: SLF001 — exercising the TTL

    room.record_awareness(1, b"peer-one")
    assert room.prune_awareness() == []

    await asyncio.sleep(0.06)
    assert room.prune_awareness() == [1]
    assert room.awareness == {}


async def test_awareness_replaces_rather_than_accumulates(
    store: InMemorySnapshotStore,
) -> None:
    """Ghost cursors came from having no stable key to overwrite."""
    room = Room("user/alice/notes.md")
    await room.bootstrap()

    room.record_awareness(7, b"first")
    room.record_awareness(7, b"second")

    assert len(room.awareness) == 1
    assert room.awareness[7][0] == b"second"


async def test_registry_reuses_a_live_room(store: InMemorySnapshotStore) -> None:
    registry = RoomRegistry()
    first = await registry.acquire("user/alice/notes.md")
    second = await registry.acquire("user/alice/notes.md")
    assert first is second
    assert registry.count == 1


async def test_registry_defers_eviction_so_a_reconnect_is_cheap(
    store: InMemorySnapshotStore,
) -> None:
    """The old code dropped the room the instant the last socket closed.

    A laptop lid or a wifi handover then paid a full reload and raced the
    in-flight snapshot write.
    """
    registry = RoomRegistry()
    room = await registry.acquire("user/alice/notes.md")
    room.seed_if_empty("content")

    await registry.release(room)
    assert registry.count == 1  # still resident

    # Nothing is evicted while the idle window has not elapsed.
    assert await registry.evict_idle() == []
    assert registry.count == 1


async def test_registry_evicts_after_the_idle_window(store: InMemorySnapshotStore) -> None:
    import server.collab.room as room_module

    registry = RoomRegistry()
    room = await registry.acquire("user/alice/notes.md")
    room.seed_if_empty("content")
    await registry.release(room)

    # Pretend the room emptied well in the past.
    room.empty_since = room_module.time.monotonic() - 10_000

    assert await registry.evict_idle() == ["user/alice/notes.md"]
    assert registry.count == 0


async def test_release_flushes_before_the_room_can_be_forgotten(
    store: InMemorySnapshotStore,
) -> None:
    registry = RoomRegistry()
    room = await registry.acquire("user/alice/notes.md")
    room.seed_if_empty("written on the way out")

    await registry.release(room)

    assert snapshot_key("user/alice/notes.md") in store.data
