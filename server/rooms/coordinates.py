"""What a room *is*, and what it is called.

A room is one file, on one branch, in one repository, on one host. That
five-field coordinate is the room's identity, and everything else in the
collaboration stack is downstream of getting it right: two people who open the
same file must land in the same room, and two people who open different files
must never land in the same one.

The identity is a coordinate; the *name* is a hash of it. Four reasons, all of
which were near-misses rather than hypotheticals:

  * **y-websocket does not encode the room name.** It builds its URL as
    `serverUrl + '/' + roomname + '?' + params`. A branch called `feature/#42`,
    or any path containing a space or a `?`, produces a malformed URL. A
    readable scheme needs an encoding layer on both sides that can never drift.
  * **Room names become file paths.** `snapshot_key` turns one into
    `rooms/{room_id}/state.ybin`, which `FilesystemSnapshotStore` resolves
    against a real directory. On a case-insensitive filesystem — macOS and
    Windows by default — `Docs/A.md` and `docs/a.md` are genuinely different
    files in git but would share one snapshot, silently merging two documents
    into one. A fixed-length lowercase name makes that impossible by
    construction rather than by vigilance.
  * **Privacy.** Otherwise the server's disk and logs are a directory of every
    private repository path anybody edits. Hashed, the server learns the
    coordinate at grant time, where it needs it, and holds it in a row it can
    expire.
  * **Length.** Repository paths nest arbitrarily deep; filesystem components
    do not.

The name is computed *here only*. Clients send a coordinate and are told the
name, so there is never a second implementation of the hash to fall out of step
with this one.
"""
from __future__ import annotations

import base64
import hashlib
import unicodedata
from dataclasses import dataclass

# Bumping this changes every room name, orphaning every stored snapshot. It is
# a prefix rather than a bare hash so that a future change to canonicalisation
# can ship as `r2_` and leave existing rooms readable under `r1_`.
ROOM_ID_VERSION = "r1"
_DOMAIN = b"frontmatter-room-v1\x00"

# 32 base32 characters is 160 bits of the digest — far past collision concern,
# and short enough to be a comfortable filesystem component.
_NAME_LENGTH = 32

MAX_PATH_BYTES = 1024
MAX_BRANCH_BYTES = 255
MAX_REPO_BYTES = 512
MAX_HOST_BYTES = 255


class InvalidCoordinate(ValueError):
    """A coordinate that cannot name a room, with a reason worth showing."""


@dataclass(frozen=True)
class RoomCoordinate:
    """One file, on one branch, in one repository, on one host."""

    provider: str
    host: str
    repo: str
    branch: str
    path: str

    @property
    def room_id(self) -> str:
        return room_id(self)


def _nfc(value: str) -> str:
    """Normalises Unicode composition.

    macOS hands back decomposed filenames from a directory read while Linux
    and git hand back composed ones, so the same accented filename arrives in
    two different byte sequences depending on who opened it. Without this, two
    people editing `résumé.md` on different platforms would sit in two rooms,
    each convinced the other was not there.
    """
    return unicodedata.normalize("NFC", value)


def _require(value: str, field: str) -> str:
    if not value or not value.strip():
        raise InvalidCoordinate(f"{field} is required")
    return value.strip()


def _reject_control_characters(value: str, field: str) -> None:
    # Control characters cannot appear in a git ref or a sane path, and they
    # are exactly what an attacker reaches for to smuggle a newline into a log
    # line or a NUL into a filesystem call.
    if any(ord(character) < 0x20 or 0x7F <= ord(character) <= 0x9F for character in value):
        raise InvalidCoordinate(f"{field} contains a control character")


def _reject_traversal(value: str, field: str) -> None:
    if any(segment == ".." for segment in value.split("/")):
        raise InvalidCoordinate(f"{field} may not contain a '..' segment")


def _within(value: str, limit: int, field: str) -> str:
    if len(value.encode("utf-8")) > limit:
        raise InvalidCoordinate(f"{field} is too long")
    return value


def canonicalize(
    *,
    provider: str,
    host: str,
    repo: str,
    branch: str,
    path: str,
) -> RoomCoordinate:
    """Reduces a coordinate to the one form that names its room.

    The case rules are not uniform, and the asymmetry is deliberate:

      * `provider`, `host` and `repo` are lowercased. Forges route
        case-insensitively — `GitHub.com/Acme/Handbook` and
        `github.com/acme/handbook` are the same repository — so two people who
        typed different capitalisation must not be separated.
      * `branch` and `path` keep their case. Git refs and git paths are
        case-sensitive: `Main` and `main` are two branches, and `README.md` and
        `readme.md` are two files. Lowercasing here would merge documents that
        the repository considers distinct, which is the more damaging error of
        the two.
    """
    provider = _require(provider, "provider").lower()
    host = _require(host, "host").lower()
    repo = _require(repo, "repo")
    branch = _require(branch, "branch")
    path = _require(path, "path")

    for field, value in (
        ("provider", provider),
        ("host", host),
        ("repo", repo),
        ("branch", branch),
        ("path", path),
    ):
        _reject_control_characters(value, field)

    # `www.` is noise on a forge host; `remoteUrl.ts` already treats
    # `www.github.com` as `github.com` when parsing a remote.
    if host.startswith("www."):
        host = host[4:]

    repo = _nfc(repo).strip("/").lower()
    branch = _nfc(branch).strip("/")

    path = _nfc(path).replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    path = "/".join(segment for segment in path.split("/") if segment)

    _reject_traversal(repo, "repo")
    _reject_traversal(branch, "branch")
    _reject_traversal(path, "path")

    if repo.count("/") < 1:
        raise InvalidCoordinate("repo must be owner/name")
    if not path:
        raise InvalidCoordinate("path is required")

    _within(host, MAX_HOST_BYTES, "host")
    _within(repo, MAX_REPO_BYTES, "repo")
    _within(branch, MAX_BRANCH_BYTES, "branch")
    _within(path, MAX_PATH_BYTES, "path")

    return RoomCoordinate(provider=provider, host=host, repo=repo, branch=branch, path=path)


def _length_prefixed(value: str) -> bytes:
    """Encodes a field so that no two coordinates can hash alike.

    Joining the fields with a separator would make `repo="a/b", branch="c"` and
    `repo="a", branch="b/c"` produce identical input — two different files
    sharing one room. Prefixing each field with its length removes the
    ambiguity entirely, because the reader of the byte string could unambiguously
    recover the fields.
    """
    encoded = value.encode("utf-8")
    return len(encoded).to_bytes(4, "big") + encoded


def room_id(coordinate: RoomCoordinate) -> str:
    """The room's name: stable, opaque, and safe as a path component."""
    digest = hashlib.sha256(
        _DOMAIN
        + _length_prefixed(coordinate.provider)
        + _length_prefixed(coordinate.host)
        + _length_prefixed(coordinate.repo)
        + _length_prefixed(coordinate.branch)
        + _length_prefixed(coordinate.path)
    ).digest()

    # base32 rather than base64url: the alphabet is single-case, so two names
    # cannot differ only by capitalisation and then collide as snapshot files
    # on a case-insensitive filesystem.
    encoded = base64.b32encode(digest).decode("ascii").lower().rstrip("=")
    return f"{ROOM_ID_VERSION}_{encoded[:_NAME_LENGTH]}"
