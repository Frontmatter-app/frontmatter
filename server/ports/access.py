"""Who may read and write a room.

Replaces the Firestore-backed `document_access`, which resolved permissions by
reading a `cloud_documents` record and a team membership subcollection. Neither
exists any more: a document is a file in a git repository, so the authority on
who may touch it is the repository.

Resolution order, once the forge adapter lands in the git-backed phase:

  1. The forge's own permissions — repository collaborators and their role.
  2. `.frontmatter/permissions.toml`, checked into the repository, refining
     those roles per path. Because it is a file in the repo, changing access is
     a pull request: reviewable, attributable, and versioned.

Today only the local resolver is wired up, which is correct for the current
state of the app: rooms are keyed by a document the connecting user already
holds locally, and there is no repository behind them yet.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


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


class AccessResolver(Protocol):
    async def resolve(self, *, user_id: str, room_id: str) -> Access: ...


class OwnerOnlyResolver:
    """Grants access to rooms namespaced under the requesting user.

    Room ids take the form `user/<user_id>/<document>`, so a peer can only
    reach rooms it owns. This is the honest resolver for the current state of
    the system — there is no sharing model yet, so it grants nothing beyond
    self-access rather than pretending to enforce one that does not exist.
    """

    async def resolve(self, *, user_id: str, room_id: str) -> Access:
        prefix = f"user/{user_id}/"
        if room_id.startswith(prefix) and len(room_id) > len(prefix):
            return Access.full()
        return Access.none()


class AllowAllResolver:
    """Every authenticated user may read and write every room.

    For single-user and fully-trusted deployments. Authentication is still
    required; this only removes per-room authorization. Never make it the
    default — the point of the port is that the enforcement path always exists.
    """

    async def resolve(self, *, user_id: str, room_id: str) -> Access:
        return Access.full()


_resolver: AccessResolver = OwnerOnlyResolver()


def get_access_resolver() -> AccessResolver:
    return _resolver


def set_access_resolver(resolver: AccessResolver) -> None:
    global _resolver
    _resolver = resolver
