"""Permission to be in one room, for fifteen minutes.

The socket used to accept the session token, which meant every authenticated
account could attempt every room name and the only thing standing between them
and somebody else's document was the access resolver getting it right on every
path. A grant inverts that: it names one room and carries one bit of authority,
so a token that leaks — or a bug in the resolver — cannot reach past the room it
was minted for.

Three properties are deliberate:

  * **Short-lived, and renewed over the open socket.** Fifteen minutes bounds
    how long a revoked collaborator keeps writing. Renewal is a message rather
    than a reconnect because reconnecting drops awareness, and a cursor that
    vanishes every quarter of an hour reads as a bug.
  * **The room is a claim, not a parameter.** The socket compares the room it
    was asked for against the room inside the token. They must match exactly.
  * **Access can only be reduced.** A grant is minted from a claim the client
    made about itself; verification against the forge can lower it to read-only
    or revoke it, and never raises it.

Signed with the server's existing `secret_key`, so a deployment that already
sets one gains nothing new to configure.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Literal

from server.config import get_settings

GRANT_TTL_SECONDS = 15 * 60

# The client renews at 80% of the lifetime. Named here rather than in the client
# so the two cannot drift into a window where the token expires first.
GRANT_RENEW_AT = 0.8

Access = Literal["read", "write"]


class InvalidGrant(Exception):
    """A grant that cannot be trusted. The reason is never sent to the client."""


@dataclass(frozen=True)
class Grant:
    room_id: str
    user_id: str
    access: Access
    expires_at: int
    token_id: str

    @property
    def can_write(self) -> bool:
        return self.access == "write"

    @property
    def seconds_remaining(self) -> int:
        return max(0, self.expires_at - int(time.time()))


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _sign(payload: str) -> str:
    secret = get_settings().secret_key.encode("utf-8")
    return _b64(hmac.new(secret, payload.encode("ascii"), hashlib.sha256).digest())


def mint(*, room_id: str, user_id: str, access: Access, ttl: int = GRANT_TTL_SECONDS) -> Grant:
    """Issues a grant. The caller has already decided the access is warranted."""
    return Grant(
        room_id=room_id,
        user_id=user_id,
        access=access,
        expires_at=int(time.time()) + ttl,
        token_id=secrets.token_urlsafe(9),
    )


def encode(grant: Grant) -> str:
    body = _b64(
        json.dumps(
            {
                "typ": "room",
                "room": grant.room_id,
                "sub": grant.user_id,
                "acc": "w" if grant.access == "write" else "r",
                "exp": grant.expires_at,
                "jti": grant.token_id,
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )
    return f"{body}.{_sign(body)}"


def decode(token: str) -> Grant:
    """Verifies a grant, or raises.

    Signature before parsing, always: the payload is attacker-supplied until
    the MAC says otherwise, and `json.loads` on unverified bytes is how a
    parser bug becomes a vulnerability.
    """
    try:
        body, _, signature = token.partition(".")
        if not body or not signature:
            raise InvalidGrant("malformed grant")

        # Constant-time: a fast reject on the first wrong byte leaks the
        # signature one byte at a time to anyone willing to measure.
        if not hmac.compare_digest(signature, _sign(body)):
            raise InvalidGrant("bad signature")

        claims = json.loads(_unb64(body))
    except InvalidGrant:
        raise
    except Exception as error:  # malformed base64, malformed JSON, wrong types
        raise InvalidGrant("malformed grant") from error

    if claims.get("typ") != "room":
        raise InvalidGrant("not a room grant")

    room = claims.get("room")
    user_id = claims.get("sub")
    access = claims.get("acc")
    expires_at = claims.get("exp")

    if not isinstance(room, str) or not room:
        raise InvalidGrant("no room")
    if not isinstance(user_id, str) or not user_id:
        raise InvalidGrant("no subject")
    if access not in ("r", "w"):
        raise InvalidGrant("no access")
    if not isinstance(expires_at, int):
        raise InvalidGrant("no expiry")
    if expires_at <= int(time.time()):
        raise InvalidGrant("expired")

    return Grant(
        room_id=room,
        user_id=user_id,
        access="write" if access == "w" else "read",
        expires_at=expires_at,
        token_id=str(claims.get("jti", "")),
    )


def decode_for_room(token: str, room_id: str) -> Grant:
    """Verifies a grant *and* that it was minted for this room.

    Kept as one function because checking the room is not optional and a
    separate step is a step somebody eventually forgets.
    """
    grant = decode(token)
    if not hmac.compare_digest(grant.room_id, room_id):
        raise InvalidGrant("grant is for a different room")
    return grant
