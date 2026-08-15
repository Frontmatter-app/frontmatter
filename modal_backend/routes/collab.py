"""Yjs WebSocket sync server.

Replaces the Firestore-as-CRDT-log transport, which had no sync handshake at
all. A joining peer never received the existing document state — the update log
only ever carried edits made while a provider happened to be attached, and the
base state was written before one existed. Peers therefore built disjoint CRDT
histories: remote updates either stalled forever as unapplied pending structs,
or, once a covering state arrived, integrated as a second copy of the whole
document. Compaction then deleted the log into a `yState` field no client read.

This speaks the standard `y-websocket` protocol, so the client side is
`y-websocket`'s own `WebsocketProvider` rather than anything of ours.

Three things move server-side and become enforceable here:

  * **The sync handshake.** State vectors are exchanged on connect, so a peer
    converges on the existing history instead of authoring a parallel one.
  * **Authorization.** Read access gates the connection; write access gates
    applying updates. A read-only member's edits are refused at the socket
    instead of being silently dropped by security rules.
  * **Bootstrap-once.** A room is seeded from the stored markdown exactly once,
    by the server. Every client seeding its own copy is what created the
    divergent histories in the first place.

Deployment: pinned to a single container (see main.py), so every peer of a
document shares one process and rooms need no cross-container coordination.
That is a real ceiling, not a permanent design — see the note in main.py.
"""
import modal
import os
import json
import asyncio
import time

if modal.is_local():
    WebSocket = None
    WebSocketDisconnect = None
else:
    from fastapi import WebSocket, WebSocketDisconnect
    from pycrdt import Doc

from firebase import verify_id_token, init_firebase
from authz import document_access

# ── y-websocket wire protocol ────────────────────────────────────────────────
MSG_SYNC = 0
MSG_AWARENESS = 1

SYNC_STEP_1 = 0
SYNC_STEP_2 = 1
SYNC_UPDATE = 2

# How long an awareness state survives without a refresh. Clients republish
# well inside this; the old Firestore presence rows relied on peers deleting
# each other's documents and left ghost cursors behind whenever nobody did.
AWARENESS_TTL_SECONDS = 30

# Snapshot cadence. Updates are cheap to apply and expensive to persist, so the
# room writes at most this often while active, plus once when it empties.
SNAPSHOT_DEBOUNCE_SECONDS = 10


def write_var_uint(value: int) -> bytes:
    """LEB128, as used by lib0."""
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def read_var_uint(data: bytes, offset: int) -> tuple[int, int]:
    """Returns (value, new_offset)."""
    value = 0
    shift = 0
    while True:
        if offset >= len(data):
            raise ValueError("truncated varint")
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return value, offset
        shift += 7
        if shift > 63:
            raise ValueError("varint too long")


def write_var_bytes(payload: bytes) -> bytes:
    return write_var_uint(len(payload)) + payload


def read_var_bytes(data: bytes, offset: int) -> tuple[bytes, int]:
    length, offset = read_var_uint(data, offset)
    if offset + length > len(data):
        raise ValueError("truncated byte array")
    return data[offset:offset + length], offset + length


def encode_sync_step_1(state_vector: bytes) -> bytes:
    return write_var_uint(MSG_SYNC) + write_var_uint(SYNC_STEP_1) + write_var_bytes(state_vector)


def encode_sync_step_2(update: bytes) -> bytes:
    return write_var_uint(MSG_SYNC) + write_var_uint(SYNC_STEP_2) + write_var_bytes(update)


def encode_sync_update(update: bytes) -> bytes:
    return write_var_uint(MSG_SYNC) + write_var_uint(SYNC_UPDATE) + write_var_bytes(update)


def encode_awareness(payload: bytes) -> bytes:
    return write_var_uint(MSG_AWARENESS) + write_var_bytes(payload)


# ── Persistence ──────────────────────────────────────────────────────────────
_r2_client = None


async def _run(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def get_r2_client():
    global _r2_client
    if _r2_client is None:
        import boto3
        _r2_client = boto3.client(
            's3',
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
            region_name='auto',
        )
    return _r2_client


def snapshot_key(doc_id: str) -> str:
    return f"docs/{doc_id}/state.ybin"


def load_snapshot(doc_id: str) -> bytes | None:
    client = get_r2_client()
    try:
        obj = client.get_object(Bucket=os.environ['R2_BUCKET_NAME'], Key=snapshot_key(doc_id))
        return obj['Body'].read()
    except Exception:
        return None


def store_snapshot(doc_id: str, state: bytes) -> None:
    client = get_r2_client()
    client.put_object(
        Bucket=os.environ['R2_BUCKET_NAME'],
        Key=snapshot_key(doc_id),
        Body=state,
        ContentType='application/octet-stream',
    )


def mark_bootstrapped(doc_id: str) -> None:
    from firebase_admin import firestore
    init_firebase()
    firestore.client().collection('cloud_documents').document(doc_id).update({
        'collabBootstrapped': True,
    })


class Room:
    """One document's shared state, for as long as somebody is connected."""

    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self.doc = Doc()
        self.connections: set = set()
        # clientId -> (encoded awareness update, last seen monotonic time)
        self.awareness: dict[int, tuple[bytes, float]] = {}
        self.lock = asyncio.Lock()
        self.dirty = False
        self.last_snapshot = 0.0

    def bootstrap(self) -> None:
        """Loads persisted state, seeding from markdown only if there is none.

        The seed happens here, once, precisely because letting each client do it
        is what produced duplicate content: two peers inserting the same text
        each authored their own structs for it.
        """
        state = load_snapshot(self.doc_id)
        if state:
            self.doc.apply_update(state)
            return

        from firebase_admin import firestore
        init_firebase()
        snap = firestore.client().collection('cloud_documents').document(self.doc_id).get()
        data = (snap.to_dict() or {}) if snap.exists else {}

        # Legacy documents carry a compacted `yState` from the retired Firestore
        # transport. Prefer it over the plaintext: it preserves history.
        legacy = data.get('yState')
        if legacy:
            import base64
            try:
                self.doc.apply_update(base64.b64decode(legacy))
                self.dirty = True
                return
            except Exception as e:
                print(f"[collab] {self.doc_id}: legacy yState unusable: {e}")

        raw = data.get('content') or ''
        markdown = ''
        draft = ''
        try:
            parsed = json.loads(raw) if raw.startswith('{') else {}
            markdown = parsed.get('markdown', '')
            draft = parsed.get('draft', '')
        except Exception:
            markdown = raw

        if markdown:
            from pycrdt import Text
            text = self.doc.get('markdown', type=Text)
            text += markdown
        if draft:
            from pycrdt import Text
            draft_text = self.doc.get('draft', type=Text)
            draft_text += draft

        self.dirty = True
        try:
            mark_bootstrapped(self.doc_id)
        except Exception as e:
            print(f"[collab] {self.doc_id}: could not mark bootstrapped: {e}")

    def prune_awareness(self) -> list[int]:
        cutoff = time.monotonic() - AWARENESS_TTL_SECONDS
        stale = [cid for cid, (_, seen) in self.awareness.items() if seen < cutoff]
        for cid in stale:
            del self.awareness[cid]
        return stale

    async def broadcast(self, message: bytes, exclude=None) -> None:
        dead = []
        for ws in self.connections:
            if ws is exclude:
                continue
            try:
                await ws.send_bytes(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.connections.discard(ws)

    async def persist(self, force: bool = False) -> None:
        if not self.dirty:
            return
        now = time.monotonic()
        if not force and now - self.last_snapshot < SNAPSHOT_DEBOUNCE_SECONDS:
            return
        self.last_snapshot = now
        state = self.doc.get_update()
        self.dirty = False
        try:
            await _run(store_snapshot, self.doc_id, state)
        except Exception as e:
            self.dirty = True
            print(f"[collab] {self.doc_id}: snapshot failed: {e}")


rooms: dict[str, Room] = {}
rooms_lock: asyncio.Lock | None = None


async def get_room(doc_id: str) -> Room:
    global rooms_lock
    if rooms_lock is None:
        rooms_lock = asyncio.Lock()
    async with rooms_lock:
        room = rooms.get(doc_id)
        if room is None:
            room = Room(doc_id)
            await _run(room.bootstrap)
            rooms[doc_id] = room
        return room


def setup_collab_routes(app):
    @app.websocket("/collab/{doc_id}")
    async def collab(websocket: WebSocket, doc_id: str):
        # y-websocket puts provider params on the query string.
        token = websocket.query_params.get("token")
        if not token:
            await websocket.close(code=4401, reason="Missing token")
            return

        try:
            decoded = await verify_id_token(token)
        except Exception:
            await websocket.close(code=4401, reason="Invalid token")
            return
        uid = decoded.get("uid")

        can_read, can_write, _ = await _run(document_access, uid, doc_id)
        if not can_read:
            await websocket.close(code=4403, reason="No access to this document")
            return

        await websocket.accept()
        room = await get_room(doc_id)
        room.connections.add(websocket)

        try:
            # Our side of the handshake, plus whatever presence we already hold.
            await websocket.send_bytes(encode_sync_step_1(room.doc.get_state()))
            for payload, _ in list(room.awareness.values()):
                await websocket.send_bytes(encode_awareness(payload))

            while True:
                data = await websocket.receive_bytes()
                await handle_message(room, websocket, data, can_write)

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[collab] {doc_id}: connection error: {e}")
        finally:
            room.connections.discard(websocket)
            await room.persist(force=not room.connections)
            if not room.connections:
                rooms.pop(doc_id, None)


async def handle_message(room: Room, websocket, data: bytes, can_write: bool) -> None:
    offset = 0
    message_type, offset = read_var_uint(data, offset)

    if message_type == MSG_SYNC:
        sync_type, offset = read_var_uint(data, offset)
        payload, offset = read_var_bytes(data, offset)

        if sync_type == SYNC_STEP_1:
            # They told us what they have; send only what they are missing.
            await websocket.send_bytes(encode_sync_step_2(room.doc.get_update(payload)))
            return

        if sync_type in (SYNC_STEP_2, SYNC_UPDATE):
            if not can_write:
                # Dropped, not closed: closing would put y-websocket into a
                # reconnect loop. A read-only member's editor is already put in
                # read-only mode by the permissions path, so reaching here means
                # either a stale permission or a hand-rolled client.
                print(f"[collab] {room.doc_id}: dropped update from read-only client")
                return

            async with room.lock:
                room.doc.apply_update(payload)
                room.dirty = True
            await room.broadcast(encode_sync_update(payload), exclude=websocket)
            await room.persist()
            return

    elif message_type == MSG_AWARENESS:
        payload, offset = read_var_bytes(data, offset)
        # The client id is the first varint of the awareness update body.
        try:
            _count, cursor = read_var_uint(payload, 0)
            client_id, _ = read_var_uint(payload, cursor)
            room.awareness[client_id] = (payload, time.monotonic())
        except Exception:
            pass
        room.prune_awareness()
        await room.broadcast(encode_awareness(payload), exclude=websocket)
