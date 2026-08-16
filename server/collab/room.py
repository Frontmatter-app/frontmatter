"""One document's live editing session.

A room holds a Yjs document in memory for as long as somebody is connected to
it, broadcasts updates between peers, and writes snapshots so that losing the
process does not lose the work.

Three properties are load-bearing and were bugs in the Firestore-backed
predecessor:

  * **The sync handshake happens.** State vectors are exchanged on connect, so
    a joining peer converges on the existing history instead of authoring a
    parallel one. Without it, peers built disjoint CRDT histories that either
    never merged or merged into duplicated text.
  * **Seeding happens once, and the server decides.** Every client seeding its
    own copy is what produced duplicate content: two peers inserting the same
    text each authored their own structs for it.
  * **Write access is enforced here.** A read-only peer's updates are dropped
    at the socket. The client being in read-only mode is a courtesy, not a
    control.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from pycrdt import Doc, Text

from server.collab.protocol import (
    encode_awareness,
    encode_sync_update,
)
from server.config import get_settings
from server.ports.snapshots import get_snapshot_store

logger = logging.getLogger("frontmatter.collab")


def snapshot_key(room_id: str) -> str:
    return f"rooms/{room_id}/state.ybin"


class Room:
    """Shared state for one document, for as long as peers are attached."""

    def __init__(self, room_id: str) -> None:
        settings = get_settings()
        self.room_id = room_id
        self.doc = Doc()
        self.connections: set[Any] = set()
        # clientId -> (encoded awareness payload, monotonic last-seen)
        self.awareness: dict[int, tuple[bytes, float]] = {}
        self.lock = asyncio.Lock()
        self.dirty = False
        self.bootstrapped = False
        self.last_snapshot = 0.0
        self.empty_since: float | None = None
        self._awareness_ttl = settings.awareness_ttl_seconds
        self._debounce = settings.snapshot_debounce_seconds

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def bootstrap(self) -> None:
        """Loads persisted state. Absence of a snapshot is not an error.

        A room with no snapshot is simply new; the first client to connect
        seeds it via `seed_if_empty`. That is the only path by which content
        enters a room from outside, and it runs at most once.
        """
        payload = await get_snapshot_store().load(snapshot_key(self.room_id))
        if payload:
            try:
                self.doc.apply_update(payload)
                self.bootstrapped = True
                return
            except Exception as error:
                # A corrupt snapshot must not make the document permanently
                # unopenable. Log loudly and start empty so the peer can reseed.
                logger.error("room %s: snapshot unusable, starting empty: %s", self.room_id, error)
        self.bootstrapped = False

    def seed_if_empty(self, markdown: str, draft: str = "") -> bool:
        """Seeds a brand-new room from client-supplied text. Returns whether it did.

        Guarded by `bootstrapped` so that the second client to arrive with the
        same file cannot append a duplicate copy. Once a room has any content
        this is a no-op for the rest of its life.
        """
        if self.bootstrapped:
            return False
        self.bootstrapped = True
        if not markdown and not draft:
            return False
        if markdown:
            # Bound to a name first: `doc.get(...) += x` is not valid Python,
            # and pycrdt's shared types apply the insert through __iadd__.
            markdown_text = self.doc.get("markdown", type=Text)
            markdown_text += markdown
        if draft:
            draft_text = self.doc.get("draft", type=Text)
            draft_text += draft
        self.dirty = True
        return True

    # ── presence ─────────────────────────────────────────────────────────────

    def record_awareness(self, client_id: int, payload: bytes) -> None:
        self.awareness[client_id] = (payload, time.monotonic())

    def prune_awareness(self) -> list[int]:
        """Drops presence entries nobody has refreshed. Returns what went.

        The old Firestore presence relied on peers deleting each other's rows,
        so a client that crashed left a cursor on screen forever. A TTL means
        the worst case is a stale cursor for `awareness_ttl_seconds`.
        """
        cutoff = time.monotonic() - self._awareness_ttl
        stale = [cid for cid, (_, seen) in self.awareness.items() if seen < cutoff]
        for cid in stale:
            del self.awareness[cid]
        return stale

    # ── fan-out ──────────────────────────────────────────────────────────────

    async def broadcast(self, message: bytes, exclude: Any = None) -> None:
        dead = []
        for websocket in list(self.connections):
            if websocket is exclude:
                continue
            try:
                await websocket.send_bytes(message)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.connections.discard(websocket)

    async def apply_update(self, payload: bytes, origin: Any = None) -> None:
        async with self.lock:
            self.doc.apply_update(payload)
            self.dirty = True
        await self.broadcast(encode_sync_update(payload), exclude=origin)
        await self.persist()

    async def broadcast_awareness(self, payload: bytes, origin: Any) -> None:
        await self.broadcast(encode_awareness(payload), exclude=origin)

    # ── durability ───────────────────────────────────────────────────────────

    async def persist(self, force: bool = False) -> None:
        """Writes a snapshot, at most every `snapshot_debounce_seconds`.

        Updates are cheap to apply and comparatively expensive to store, so the
        steady state is debounced and the room flushes unconditionally when it
        empties.
        """
        if not self.dirty:
            return
        now = time.monotonic()
        if not force and now - self.last_snapshot < self._debounce:
            return
        self.last_snapshot = now
        async with self.lock:
            state = self.doc.get_update()
            self.dirty = False
        try:
            await get_snapshot_store().store(snapshot_key(self.room_id), state)
        except Exception as error:
            # Put the flag back: an unwritten change is still unwritten, and
            # the next attempt must try again rather than assume success.
            self.dirty = True
            logger.error("room %s: snapshot failed: %s", self.room_id, error)

    def text(self, field: str = "markdown") -> str:
        return str(self.doc.get(field, type=Text))


class RoomRegistry:
    """Owns every live room and decides when one may be forgotten."""

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock: asyncio.Lock | None = None

    def _get_lock(self) -> asyncio.Lock:
        # Created lazily: an asyncio.Lock binds to the running loop, and this
        # registry is constructed at import time when there may not be one.
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def acquire(self, room_id: str) -> Room:
        async with self._get_lock():
            room = self._rooms.get(room_id)
            if room is None:
                room = Room(room_id)
                await room.bootstrap()
                self._rooms[room_id] = room
            room.empty_since = None
            return room

    async def release(self, room: Room) -> None:
        """Called when a peer leaves. Flushes, and marks the room evictable.

        Eviction is deferred rather than immediate: the previous implementation
        dropped the room the moment the last socket closed, so a reconnect —
        a laptop lid, a wifi handover — paid a full reload and raced the
        in-flight snapshot write.
        """
        if room.connections:
            return
        await room.persist(force=True)
        room.empty_since = time.monotonic()

    async def evict_idle(self) -> list[str]:
        settings = get_settings()
        cutoff = time.monotonic() - settings.room_idle_eviction_seconds
        evicted = []
        async with self._get_lock():
            for room_id, room in list(self._rooms.items()):
                if room.connections or room.empty_since is None:
                    continue
                if room.empty_since <= cutoff:
                    del self._rooms[room_id]
                    evicted.append(room_id)
        return evicted

    def get(self, room_id: str) -> Room | None:
        return self._rooms.get(room_id)

    @property
    def count(self) -> int:
        return len(self._rooms)

    def clear(self) -> None:
        self._rooms.clear()


registry = RoomRegistry()
