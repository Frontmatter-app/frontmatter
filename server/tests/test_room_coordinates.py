"""Room naming.

The stakes here are unusually asymmetric. Naming two different files the same
room merges two documents into one — unrecoverable, and silent. Naming one file
two different rooms splits a session in two, where each person sees an empty
room and concludes the feature is broken. Both failures are invisible at the
call site, so they are pinned here instead.
"""
from __future__ import annotations

import pytest

from server.rooms.coordinates import (
    InvalidCoordinate,
    canonicalize,
    room_id,
)


def coord(**overrides: str):
    base = {
        "provider": "github",
        "host": "github.com",
        "repo": "acme/handbook",
        "branch": "main",
        "path": "docs/chapter.md",
    }
    base.update(overrides)
    return canonicalize(**base)


# ── the golden vector ────────────────────────────────────────────────────────


def test_a_known_coordinate_keeps_its_known_name() -> None:
    """Pins one coordinate to one name, forever.

    Every stored snapshot on every deployment is filed under a name this
    function produced. A refactor that changes the hash does not fail loudly —
    it silently orphans every room, and everyone's work appears to vanish while
    sitting safely on disk under a name nothing computes any more. If this test
    fails, the change is only safe behind a new `r2_` version prefix.
    """
    assert room_id(coord()) == "r1_qejridpqa36ul54fs2tihtdkjokayysk"


def test_the_name_is_safe_as_a_path_component() -> None:
    """Characters that break a URL or a filename must not survive into the name.

    `feature/#42 (draft)` is a legal git branch, and y-websocket appends the
    room name to its URL without encoding it.
    """
    name = room_id(coord(branch="feature/#42 (draft)", path="a b/c?d.md"))
    version, _, digest = name.partition("_")
    assert version == "r1"
    assert len(name) == 35
    assert all(character in "abcdefghijklmnopqrstuvwxyz234567" for character in digest)


# ── the collision that a naive scheme produces ───────────────────────────────


def test_field_boundaries_cannot_be_confused() -> None:
    """Two coordinates that a separator-joined hash would merge.

    Both are legal — GitLab allows nested subgroups, so `a/b/c` is a repository
    and `c/d` is a branch name. Joined with a separator they produce the same
    string, `a/b/c/d/e.md`, and would share one room: two unrelated documents
    silently merged into one.
    """
    left = room_id(coord(repo="a/b", branch="c/d", path="e.md"))
    right = room_id(coord(repo="a/b/c", branch="d", path="e.md"))
    assert left != right


def test_path_and_branch_boundaries_cannot_be_confused() -> None:
    left = room_id(coord(branch="x/y", path="z.md"))
    right = room_id(coord(branch="x", path="y/z.md"))
    assert left != right


# ── case: where it is ignored, and where it must not be ──────────────────────


def test_repository_case_is_ignored() -> None:
    """Forges route case-insensitively, so two spellings are one repository."""
    assert room_id(coord(repo="Acme/Handbook")) == room_id(coord(repo="acme/handbook"))


def test_host_case_and_www_are_ignored() -> None:
    assert room_id(coord(host="GitHub.com")) == room_id(coord(host="github.com"))
    assert room_id(coord(host="www.github.com")) == room_id(coord(host="github.com"))


def test_branch_case_is_significant() -> None:
    """Git refs are case-sensitive: `Main` and `main` are two branches."""
    assert room_id(coord(branch="Main")) != room_id(coord(branch="main"))


def test_path_case_is_significant() -> None:
    """The case this whole scheme exists to survive.

    `Docs/A.md` and `docs/a.md` are two files in git. If their rooms differed
    only by case, the two snapshot files would collide on macOS and Windows and
    the documents would merge into one.
    """
    left = room_id(coord(path="Docs/A.md"))
    right = room_id(coord(path="docs/a.md"))
    assert left != right
    # Not merely different — different in a way a case-insensitive filesystem
    # can still tell apart.
    assert left.lower() != right.lower()


# ── normalisation ────────────────────────────────────────────────────────────


def test_composed_and_decomposed_filenames_are_one_room() -> None:
    """macOS reads filenames decomposed; git and Linux hand them back composed.

    Without normalisation, two people editing the same accented filename on
    different platforms each sit alone in a room they believe is shared.
    """
    composed = "résumé.md"       # é as one code point
    decomposed = "résumé.md"   # e + combining acute
    assert composed != decomposed
    assert room_id(coord(path=composed)) == room_id(coord(path=decomposed))


def test_equivalent_path_spellings_are_one_room() -> None:
    canonical = room_id(coord(path="docs/chapter.md"))
    assert room_id(coord(path="/docs/chapter.md")) == canonical
    assert room_id(coord(path="./docs/chapter.md")) == canonical
    assert room_id(coord(path="docs//chapter.md")) == canonical
    assert room_id(coord(path="docs\\chapter.md")) == canonical


def test_surrounding_whitespace_is_ignored() -> None:
    assert room_id(coord(path="  docs/chapter.md  ")) == room_id(coord(path="docs/chapter.md"))


# ── every field changes the room ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "field,value",
    [
        ("provider", "gitlab"),
        ("host", "git.acme.com"),
        ("repo", "acme/other"),
        ("branch", "draft"),
        ("path", "docs/other.md"),
    ],
)
def test_every_field_participates(field: str, value: str) -> None:
    assert room_id(coord(**{field: value})) != room_id(coord())


def test_self_hosted_instances_are_distinct_from_the_public_one() -> None:
    """The field that makes GitLab support a client-only change later."""
    assert room_id(coord(provider="gitlab", host="gitlab.com")) != room_id(
        coord(provider="gitlab", host="git.acme.com")
    )


# ── rejection ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("field", ["provider", "host", "repo", "branch", "path"])
def test_empty_fields_are_refused(field: str) -> None:
    with pytest.raises(InvalidCoordinate):
        coord(**{field: ""})


@pytest.mark.parametrize("field", ["provider", "host", "repo", "branch", "path"])
def test_whitespace_only_fields_are_refused(field: str) -> None:
    with pytest.raises(InvalidCoordinate):
        coord(**{field: "   "})


@pytest.mark.parametrize(
    "path",
    ["../secrets.md", "docs/../../secrets.md", "a/../../b.md"],
)
def test_traversal_is_refused(path: str) -> None:
    with pytest.raises(InvalidCoordinate):
        coord(path=path)


def test_traversal_in_a_branch_is_refused() -> None:
    with pytest.raises(InvalidCoordinate):
        coord(branch="../main")


@pytest.mark.parametrize("value", ["a\x00b.md", "a\nb.md", "a\x1bb.md"])
def test_control_characters_are_refused(value: str) -> None:
    with pytest.raises(InvalidCoordinate):
        coord(path=value)


def test_a_repo_without_an_owner_is_refused() -> None:
    with pytest.raises(InvalidCoordinate):
        coord(repo="handbook")


def test_a_path_that_normalises_to_nothing_is_refused() -> None:
    with pytest.raises(InvalidCoordinate):
        coord(path="./")


@pytest.mark.parametrize(
    "field,value",
    [
        ("path", "a" * 1025),
        ("branch", "b" * 256),
        ("repo", "o/" + "n" * 512),
    ],
)
def test_oversized_fields_are_refused(field: str, value: str) -> None:
    with pytest.raises(InvalidCoordinate):
        coord(**{field: value})


def test_a_long_but_legal_path_is_accepted() -> None:
    deep = "/".join(["folder"] * 40) + "/chapter.md"
    assert room_id(coord(path=deep)).startswith("r1_")
