"""Room grants.

A grant is the only thing standing between an authenticated account and a
document it has no business seeing, so the interesting tests here are the
rejections rather than the happy path.
"""
from __future__ import annotations

import time

import pytest

from server.rooms import grants
from server.rooms.grants import InvalidGrant


def a_grant(**overrides):
    base = {"room_id": "r1_abc", "user_id": "user-1", "access": "write"}
    base.update(overrides)
    return grants.mint(**base)


def test_a_grant_survives_a_round_trip() -> None:
    issued = a_grant()
    decoded = grants.decode(grants.encode(issued))

    assert decoded.room_id == issued.room_id
    assert decoded.user_id == issued.user_id
    assert decoded.access == "write"
    assert decoded.can_write is True


def test_read_access_round_trips_as_read() -> None:
    decoded = grants.decode(grants.encode(a_grant(access="read")))
    assert decoded.access == "read"
    assert decoded.can_write is False


def test_a_grant_is_scoped_to_one_room() -> None:
    """The property that makes a leaked grant survivable."""
    token = grants.encode(a_grant(room_id="r1_mine"))

    assert grants.decode_for_room(token, "r1_mine").room_id == "r1_mine"
    with pytest.raises(InvalidGrant):
        grants.decode_for_room(token, "r1_someone-elses")


def test_a_tampered_access_bit_is_refused() -> None:
    """The whole attack: flip `r` to `w` and start typing in someone's document."""
    import base64
    import json

    token = grants.encode(a_grant(access="read"))
    body, _, signature = token.partition(".")

    claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    claims["acc"] = "w"
    forged_body = (
        base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
        .decode()
        .rstrip("=")
    )

    with pytest.raises(InvalidGrant):
        grants.decode(f"{forged_body}.{signature}")


def test_a_tampered_subject_is_refused() -> None:
    import base64
    import json

    token = grants.encode(a_grant(user_id="alice"))
    body, _, signature = token.partition(".")
    claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    claims["sub"] = "mallory"
    forged = (
        base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
        .decode()
        .rstrip("=")
    )

    with pytest.raises(InvalidGrant):
        grants.decode(f"{forged}.{signature}")


def test_an_expired_grant_is_refused() -> None:
    token = grants.encode(a_grant(ttl=-1))
    with pytest.raises(InvalidGrant):
        grants.decode(token)


def test_a_grant_about_to_expire_is_still_valid() -> None:
    decoded = grants.decode(grants.encode(a_grant(ttl=5)))
    assert decoded.seconds_remaining <= 5
    assert decoded.can_write


@pytest.mark.parametrize(
    "token",
    ["", ".", "not-a-token", "a.b", "....", "eyJhIjoxfQ", "eyJhIjoxfQ.", ".signature"],
)
def test_malformed_tokens_are_refused(token: str) -> None:
    with pytest.raises(InvalidGrant):
        grants.decode(token)


def test_a_grant_signed_with_another_key_is_refused() -> None:
    """A second deployment's tokens must not open this one's rooms."""
    token = grants.encode(a_grant())
    body, _, _ = token.partition(".")

    with pytest.raises(InvalidGrant):
        grants.decode(f"{body}.{'A' * 43}")


def test_a_session_token_is_not_a_room_grant() -> None:
    """`typ` exists so the two token families can never be confused."""
    import base64
    import json

    claims = {"typ": "session", "sub": "alice", "exp": int(time.time()) + 600}
    body = (
        base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
        .decode()
        .rstrip("=")
    )
    forged = f"{body}.{grants._sign(body)}"

    with pytest.raises(InvalidGrant):
        grants.decode(forged)


def test_each_grant_is_individually_identifiable() -> None:
    """A `jti` is what makes revoking one session possible later."""
    assert a_grant().token_id != a_grant().token_id
