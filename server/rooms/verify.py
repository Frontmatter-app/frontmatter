"""Checking that a claim about repository access is true.

A client tells the server what its permission on a repository is, because the
client is the only party holding a token that can ask. That claim buys a fast
join — no forge round trip on the socket path — and it is not, on its own,
worth anything: a client can say whatever it likes.

So a claim is honoured *optimistically* and checked *afterwards*, by whatever
authority a deployment has for the forge in question:

  * A **GitHub App installation** can answer "is this login a collaborator on
    this repository, and at what level" using its own credential, without ever
    seeing a user's token. Installing it is one click for a repository admin.
  * A **public repository** answers the same question unauthenticated.
  * A deployment with neither returns `None`, which means *cannot determine* —
    deliberately not the same as "denied". The room stays up and is reported to
    the client as unverified, so the interface can say so rather than silently
    implying a guarantee nobody made.

Verification may only ever lower access. A claim of `read` is never raised to
`write` because a verifier said so; the point is to catch a client claiming
more than it has, not to hand out more than it asked for.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from server.rooms.coordinates import RoomCoordinate

Verdict = Literal["read", "write", "none"]


@dataclass(frozen=True)
class Claim:
    """What a client says about its own access to a repository."""

    permission: Literal["read", "write", "admin"]
    login: str
    external_id: str | None = None
    repo_id: str | None = None

    @property
    def level(self) -> Literal["read", "write"]:
        # `admin` and `write` are the same thing to a document editor.
        return "read" if self.permission == "read" else "write"


class RepoVerifier(Protocol):
    async def verify(self, *, coordinate: RoomCoordinate, claim: Claim) -> Verdict | None: ...


class NullVerifier:
    """Cannot determine anything, and says so.

    The honest default for a deployment with no forge credential of its own. It
    is not `AllowAll` wearing a different hat: returning `None` marks the room
    unverified, which the client is expected to surface, rather than asserting
    an approval that was never obtained.
    """

    async def verify(self, *, coordinate: RoomCoordinate, claim: Claim) -> Verdict | None:
        return None


_verifier: RepoVerifier = NullVerifier()


def get_repo_verifier() -> RepoVerifier:
    return _verifier


def set_repo_verifier(verifier: RepoVerifier) -> None:
    global _verifier
    _verifier = verifier


def apply_verdict(claimed: Literal["read", "write"], verdict: Verdict | None) -> Verdict:
    """Combines a claim with a verdict, never upward.

    The asymmetry is the whole security property, so it lives in one function
    with one test rather than being re-derived at each call site.
    """
    if verdict is None:
        return claimed
    if verdict == "none":
        return "none"
    if claimed == "read":
        return "read"
    return verdict
