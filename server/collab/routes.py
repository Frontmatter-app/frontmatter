"""The collaboration websocket.

Speaks the standard y-websocket protocol, so the client side is y-websocket's
own `WebsocketProvider` rather than anything of ours.
"""
from __future__ import annotations

import logging
from urllib.parse import unquote

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from server.collab.protocol import (
    MSG_AWARENESS,
    MSG_GRANT,
    MSG_SYNC,
    SYNC_STEP_1,
    SYNC_STEP_2,
    SYNC_UPDATE,
    encode_access,
    encode_awareness,
    encode_sync_step_1,
    encode_sync_step_2,
    read_awareness_client_id,
    read_var_bytes,
    read_var_uint,
)
from server.collab.room import Room, registry
from server.ports.access import (
    Access,
    AccessDenied,
    NotAuthenticated,
    get_access_resolver,
)

logger = logging.getLogger("frontmatter.collab")

router = APIRouter()

# Close codes. 4401/4403 mirror HTTP semantics so the client can tell "sign in
# again" apart from "you may not open this", which matter differently: one is
# recoverable by refreshing a token, the other never is.
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403


class Connection:
    """One peer's access, held so it can change without a reconnect.

    Access used to be a local captured once at handshake. That made it
    impossible to answer the two questions this phase introduces — a grant
    renewed at a lower level, and verification arriving after an optimistic
    join — with anything short of closing the socket, which drops presence and
    makes every cursor in the room flicker.
    """

    __slots__ = ("user_id", "access", "room_id")

    def __init__(self, user_id: str, access: Access, room_id: str) -> None:
        self.user_id = user_id
        self.access = access
        self.room_id = room_id

    @property
    def can_write(self) -> bool:
        return self.access.can_write


@router.websocket("/collab/{room_id:path}")
async def collab(websocket: WebSocket, room_id: str) -> None:
    # y-websocket appends the room name to the URL and sends `params` as the
    # query string, so the token arrives there rather than in a header. The
    # token is a room grant, not a session token: it names this room and
    # carries one bit of authority, so it cannot open anything else.
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=CLOSE_UNAUTHENTICATED, reason="Missing token")
        return

    room_id = unquote(room_id).strip("/")
    if not room_id:
        await websocket.close(code=CLOSE_FORBIDDEN, reason="Missing room id")
        return

    try:
        principal = await get_access_resolver().resolve(room_id=room_id, token=token)
    except NotAuthenticated:
        # Recoverable: the client mints a fresh grant and reconnects.
        await websocket.close(code=CLOSE_UNAUTHENTICATED, reason="Invalid or expired token")
        return
    except AccessDenied:
        await websocket.close(code=CLOSE_FORBIDDEN, reason="No access to this document")
        return

    if not principal.access.can_read:
        await websocket.close(code=CLOSE_FORBIDDEN, reason="No access to this document")
        return

    connection = Connection(principal.user_id, principal.access, room_id)

    await websocket.accept()
    room = await registry.acquire(room_id)
    room.connections.add(websocket)

    try:
        # Our half of the handshake, plus whatever presence we already hold so
        # a joiner sees existing cursors without waiting for their next tick.
        await websocket.send_bytes(encode_sync_step_1(room.doc.get_state()))
        for payload, _seen in list(room.awareness.values()):
            await websocket.send_bytes(encode_awareness(payload))
        # Stated rather than assumed: a read-only peer must be able to show why
        # its editor will not accept typing.
        await websocket.send_bytes(encode_access(connection.access.level))

        while True:
            data = await websocket.receive_bytes()
            await _handle_message(room, websocket, data, connection=connection)

    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.warning("room %s: connection error: %s", room_id, error)
    finally:
        room.connections.discard(websocket)
        await registry.release(room)


async def _renew_grant(websocket: WebSocket, connection: Connection, token: str) -> None:
    """Swaps in a fresh grant on the open socket.

    Renewing this way rather than reconnecting is what keeps a fifteen-minute
    grant invisible: a reconnect would drop this peer's awareness, so everyone
    else's screen would lose their cursor and their selection four times an
    hour for no reason they could see.
    """
    try:
        principal = await get_access_resolver().resolve(room_id=connection.room_id, token=token)
    except (NotAuthenticated, AccessDenied):
        # Keep serving under the existing grant until it lapses on its own. A
        # bad renewal is far more likely to be a client bug or a race than an
        # attack, and closing on one would turn a retry into an outage.
        logger.info("room %s: rejected a grant renewal", connection.room_id)
        return

    if principal.user_id != connection.user_id:
        logger.warning("room %s: renewal for a different user", connection.room_id)
        return

    if principal.access == connection.access:
        return

    connection.access = principal.access
    await websocket.send_bytes(encode_access(connection.access.level))


async def _handle_message(
    room: Room, websocket: WebSocket, data: bytes, *, connection: Connection
) -> None:
    can_write = connection.can_write
    try:
        message_type, offset = read_var_uint(data, 0)
    except ValueError:
        return  # Malformed frame; dropping it is preferable to killing the socket.

    if message_type == MSG_SYNC:
        try:
            sync_type, offset = read_var_uint(data, offset)
            payload, _offset = read_var_bytes(data, offset)
        except ValueError:
            return

        if sync_type == SYNC_STEP_1:
            # They sent their state vector; reply with only what they lack.
            await websocket.send_bytes(encode_sync_step_2(room.doc.get_update(payload)))
            return

        if sync_type in (SYNC_STEP_2, SYNC_UPDATE):
            if not can_write:
                # Dropped, not closed. Closing would put y-websocket into a
                # reconnect loop, and a read-only peer reaching here means
                # either a stale permission or a hand-rolled client — neither
                # is worth a denial of service against the user's own editor.
                logger.info("room %s: dropped update from read-only peer", room.room_id)
                return
            await room.apply_update(payload, origin=websocket)
            return

    elif message_type == MSG_AWARENESS:
        try:
            payload, _offset = read_var_bytes(data, offset)
        except ValueError:
            return
        client_id = read_awareness_client_id(payload)
        if client_id is not None:
            room.record_awareness(client_id, payload)
        room.prune_awareness()
        await room.broadcast_awareness(payload, origin=websocket)

    elif message_type == MSG_GRANT:
        try:
            payload, _offset = read_var_bytes(data, offset)
            token = payload.decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return
        await _renew_grant(websocket, connection, token)
