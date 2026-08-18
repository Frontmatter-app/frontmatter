"""The y-websocket wire protocol.

Ported unchanged in behaviour from the previous backend, with one difference
that matters: this module imports nothing. No FastAPI, no pycrdt, no cloud SDK.
The framing is the part most likely to break subtly and least likely to fail
loudly, so it is kept independently testable.

Frames are `varint(messageType) ++ payload`, little-endian LEB128 as lib0
writes them.
"""
from __future__ import annotations

# Message types
MSG_SYNC = 0
MSG_AWARENESS = 1

# Frontmatter's own frames. Numbered well clear of the y-websocket range so a
# stock y-websocket client and this server can never misread one another: an
# unrecognised type is ignored by both sides rather than mis-parsed.
MSG_GRANT = 16  # client → server: "here is a fresh grant, keep me connected"
MSG_ACCESS = 17  # server → client: "your access here is now this"

# Sync sub-types
SYNC_STEP_1 = 0  # "here is my state vector"
SYNC_STEP_2 = 1  # "here is everything you are missing"
SYNC_UPDATE = 2  # "here is a new change"


def write_var_uint(value: int) -> bytes:
    """LEB128, as used by lib0."""
    if value < 0:
        raise ValueError("varint cannot encode a negative value")
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def read_var_uint(data: bytes, offset: int = 0) -> tuple[int, int]:
    """Returns `(value, new_offset)`."""
    value = 0
    shift = 0
    while True:
        if offset >= len(data):
            raise ValueError("truncated varint")
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
        if shift > 63:
            raise ValueError("varint too long")


def write_var_bytes(payload: bytes) -> bytes:
    return write_var_uint(len(payload)) + payload


def read_var_bytes(data: bytes, offset: int = 0) -> tuple[bytes, int]:
    length, offset = read_var_uint(data, offset)
    end = offset + length
    if end > len(data):
        raise ValueError("truncated byte array")
    return data[offset:end], end


def encode_sync_step_1(state_vector: bytes) -> bytes:
    return write_var_uint(MSG_SYNC) + write_var_uint(SYNC_STEP_1) + write_var_bytes(state_vector)


def encode_sync_step_2(update: bytes) -> bytes:
    return write_var_uint(MSG_SYNC) + write_var_uint(SYNC_STEP_2) + write_var_bytes(update)


def encode_sync_update(update: bytes) -> bytes:
    return write_var_uint(MSG_SYNC) + write_var_uint(SYNC_UPDATE) + write_var_bytes(update)


def encode_awareness(payload: bytes) -> bytes:
    return write_var_uint(MSG_AWARENESS) + write_var_bytes(payload)


def encode_access(access: str) -> bytes:
    """Tells a connected peer what it may now do.

    Sent when a grant is renewed at a different level, or when asynchronous
    verification lowers what an optimistic join was given. `access` is `read`,
    `write`, or `none`; the last is followed by a close.
    """
    return write_var_uint(MSG_ACCESS) + write_var_bytes(access.encode("utf-8"))


def read_awareness_client_id(payload: bytes) -> int | None:
    """Pulls the originating client id out of an awareness update.

    The body is `varint(count) ++ varint(clientId) ++ ...`. Used to key the
    presence map so a peer's stale entry can be replaced rather than
    accumulated — ghost cursors in the old Firestore-backed presence came from
    having no reliable identity to overwrite.

    Returns None for anything unparseable; presence is best-effort and must
    never take down a connection.
    """
    try:
        _count, cursor = read_var_uint(payload, 0)
        client_id, _ = read_var_uint(payload, cursor)
        return client_id
    except (ValueError, IndexError):
        return None
