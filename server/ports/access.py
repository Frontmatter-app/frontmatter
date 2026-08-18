"""Who may read and write a room.

A document is a file in a git repository, so the authority on who may touch it
is the repository — not a table here. The server never holds anybody's forge
token, which means it cannot ask the repository directly on the socket path
without either slowing every connection down or storing credentials it has
promised not to store.

The resolution is that the socket does not ask at all. A client trades a claim
about its own repository access for a **grant** — a short-lived token naming one
room and one permission — at `POST /rooms/grant`, and presents that grant to the
socket. Authorisation is therefore a signature check: fast, offline, and unable
to reach past the room it was minted for.

What backs the claim is a separate question, answered asynchronously by a
`RepoVerifier` and deliberately not on this path. See `server/rooms/verify.py`.

`AllowAllResolver` remains for single-user and fully-trusted deployments, where
the grant round trip buys nothing.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

AccessLevel = Literal["read", "write"]


@dataclass(frozen=True)
class Access:
    can_read: bool
    can_write: bool

    @classmethod
    def none(cls) -> "Access":
        return cls(can_read=False, can_write=False)

    @classmethod
    def full(cls) -> "Access":
        return cls(can_read=True, can_write=True)

    @classmethod
    def read_only(cls) -> "Access":
        return cls(can_read=True, can_write=False)

    @classmethod
    def of(cls, level: AccessLevel) -> "Access":
        return cls.full() if level == "write" else cls.read_only()

    @property
    def level(self) -> AccessLevel:
        return "write" if self.can_write else "read"


@dataclass(frozen=True)
class Principal:
    """Who is on this socket, and what they may do in this room."""

    user_id: str
    access: Access


class NotAuthenticated(Exception):
    """No usable credential. Recoverable by getting a fresh one."""


class AccessDenied(Exception):
    """A good credential for something else. Never recoverable by retrying."""


class AccessResolver(Protocol):
    async def resolve(self, *, room_id: str, token: str) -> Principal: ...


class GrantResolver:
    """The default: the socket's token is a room grant.

    The grant names the room it was minted for, and that name is compared
    against the room actually being opened. Without that comparison a grant for
    a document you may read would open every document on the server, which is
    exactly the hole that having a per-room token is supposed to close.
    """

    async def resolve(self, *, room_id: str, token: str) -> Principal:
        from server.rooms.grants import InvalidGrant, decode, decode_for_room

        try:
            grant = decode_for_room(token, room_id)
        except InvalidGrant:
            # Expired or malformed is worth a retry with a fresh grant; a valid
            # grant for a different room never is. Telling them apart is what
            # lets the client refresh instead of giving up, and give up instead
            # of hammering.
            try:
                decode(token)
            except InvalidGrant:
                raise NotAuthenticated("no usable grant") from None
            raise AccessDenied("grant is for a different room") from None

        return Principal(user_id=grant.user_id, access=Access.of(grant.access))


class AllowAllResolver:
    """Every authenticated user may read and write every room.

    For single-user and fully-trusted deployments. Authentication is still
    required; this only removes per-room authorization. Never make it the
    default — the point of the port is that the enforcement path always exists.
    """

    async def resolve(self, *, room_id: str, token: str) -> Principal:
        # Imported here rather than at module scope so this port stays free of
        # the auth stack for anyone who swaps in their own resolver.
        from server.auth.users import authenticate_token

        user = await authenticate_token(token)
        if user is None:
            raise NotAuthenticated("invalid session token")
        return Principal(user_id=str(user.id), access=Access.full())


_resolver: AccessResolver = GrantResolver()


def get_access_resolver() -> AccessResolver:
    return _resolver


def set_access_resolver(resolver: AccessResolver) -> None:
    global _resolver
    _resolver = resolver
