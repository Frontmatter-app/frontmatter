"""The collaboration websocket.

Speaks the standard y-websocket protocol, so the client side is y-websocket's
own `WebsocketProvider` rather than anything of ours.
"""
from __future__ import annotations

import logging
from urllib.parse import unquote

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from server.auth.users import authenticate_token
from server.collab.protocol import (
    MSG_AWARENESS,
    MSG_SYNC,
    SYNC_STEP_1,
    SYNC_STEP_2,
    SYNC_UPDATE,
    encode_awareness,
    encode_sync_step_1,
    encode_sync_step_2,
    read_awareness_client_id,
    read_var_bytes,
    read_var_uint,
)
from server.collab.room import Room, registry
from server.ports.access import get_access_resolver

logger = logging.getLogger("frontmatter.collab")

router = APIRouter()

# Close codes. 4401/4403 mirror HTTP semantics so the client can tell "sign in
# again" apart from "you may not open this", which matter differently: one is
# recoverable by refreshing a token, the other never is.
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403


@router.websocket("/collab/{room_id:path}")
async def collab(websocket: WebSocket, room_id: str) -> None:
    # y-websocket appends the room name to the URL and sends `params` as the
    # query string, so the token arrives there rather than in a header.
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=CLOSE_UNAUTHENTICATED, reason="Missing token")
        return

    user = await authenticate_token(token)
    if user is None:
        await websocket.close(code=CLOSE_UNAUTHENTICATED, reason="Invalid or expired token")
        return

    room_id = unquote(room_id).strip("/")
    if not room_id:
        await websocket.close(code=CLOSE_FORBIDDEN, reason="Missing room id")
        return

    access = await get_access_resolver().resolve(user_id=str(user.id), room_id=room_id)
    if not access.can_read:
        await websocket.close(code=CLOSE_FORBIDDEN, reason="No access to this document")
        return

    await websocket.accept()
    room = await registry.acquire(room_id)
    room.connections.add(websocket)

    try:
        # Our half of the handshake, plus whatever presence we already hold so
        # a joiner sees existing cursors without waiting for their next tick.
        await websocket.send_bytes(encode_sync_step_1(room.doc.get_state()))
        for payload, _seen in list(room.awareness.values()):
            await websocket.send_bytes(encode_awareness(payload))

        while True:
            data = await websocket.receive_bytes()
            await _handle_message(room, websocket, data, can_write=access.can_write)

    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.warning("room %s: connection error: %s", room_id, error)
    finally:
        room.connections.discard(websocket)
        await registry.release(room)


async def _handle_message(room: Room, websocket: WebSocket, data: bytes, *, can_write: bool) -> None:
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
