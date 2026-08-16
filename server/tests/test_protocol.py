"""Wire-format tests.

The framing is the part most likely to break subtly and least likely to fail
loudly: a varint bug does not raise, it produces a frame the other side
misreads, and the symptom is a document that quietly stops converging.
"""
from __future__ import annotations

import pytest

from server.collab.protocol import (
    MSG_AWARENESS,
    MSG_SYNC,
    SYNC_STEP_1,
    SYNC_STEP_2,
    SYNC_UPDATE,
    encode_awareness,
    encode_sync_step_1,
    encode_sync_step_2,
    encode_sync_update,
    read_awareness_client_id,
    read_var_bytes,
    read_var_uint,
    write_var_bytes,
    write_var_uint,
)


@pytest.mark.parametrize(
    "value",
    [0, 1, 127, 128, 255, 256, 16383, 16384, 2**31, 2**53],
)
def test_varint_round_trips(value: int) -> None:
    decoded, offset = read_var_uint(write_var_uint(value))
    assert decoded == value
    assert offset == len(write_var_uint(value))


def test_varint_uses_lib0_continuation_bits() -> None:
    # 128 must be two bytes: low seven bits set with the continuation flag,
    # then 1. Getting the endianness backwards still round-trips through our
    # own reader, so assert the actual bytes lib0 would produce.
    assert write_var_uint(128) == bytes([0x80, 0x01])
    assert write_var_uint(300) == bytes([0xAC, 0x02])


def test_varint_rejects_negative() -> None:
    with pytest.raises(ValueError):
        write_var_uint(-1)


def test_varint_rejects_truncated_input() -> None:
    with pytest.raises(ValueError):
        read_var_uint(bytes([0x80]))  # continuation bit set, nothing follows


def test_varint_rejects_overlong_encoding() -> None:
    with pytest.raises(ValueError):
        read_var_uint(bytes([0x80] * 12))


def test_var_bytes_round_trips() -> None:
    payload = b"\x00\x01\x02 markdown \xff"
    decoded, offset = read_var_bytes(write_var_bytes(payload))
    assert decoded == payload
    assert offset == len(write_var_bytes(payload))


def test_var_bytes_rejects_truncated_payload() -> None:
    # Claims 10 bytes, supplies 2.
    with pytest.raises(ValueError):
        read_var_bytes(write_var_uint(10) + b"ab")


def test_sync_step_1_framing() -> None:
    frame = encode_sync_step_1(b"state-vector")
    message_type, offset = read_var_uint(frame, 0)
    sync_type, offset = read_var_uint(frame, offset)
    payload, _ = read_var_bytes(frame, offset)
    assert (message_type, sync_type, payload) == (MSG_SYNC, SYNC_STEP_1, b"state-vector")


def test_sync_step_2_framing() -> None:
    frame = encode_sync_step_2(b"update")
    message_type, offset = read_var_uint(frame, 0)
    sync_type, offset = read_var_uint(frame, offset)
    payload, _ = read_var_bytes(frame, offset)
    assert (message_type, sync_type, payload) == (MSG_SYNC, SYNC_STEP_2, b"update")


def test_sync_update_framing() -> None:
    frame = encode_sync_update(b"delta")
    message_type, offset = read_var_uint(frame, 0)
    sync_type, offset = read_var_uint(frame, offset)
    payload, _ = read_var_bytes(frame, offset)
    assert (message_type, sync_type, payload) == (MSG_SYNC, SYNC_UPDATE, b"delta")


def test_awareness_framing() -> None:
    frame = encode_awareness(b"presence")
    message_type, offset = read_var_uint(frame, 0)
    payload, _ = read_var_bytes(frame, offset)
    assert (message_type, payload) == (MSG_AWARENESS, b"presence")


def test_reads_client_id_from_awareness_body() -> None:
    # Body is varint(count) ++ varint(clientId) ++ rest.
    body = write_var_uint(1) + write_var_uint(4242) + b"trailing"
    assert read_awareness_client_id(body) == 4242


def test_unparseable_awareness_body_returns_none_rather_than_raising() -> None:
    # Presence is best-effort; a bad frame must never take down a connection.
    assert read_awareness_client_id(b"") is None
    assert read_awareness_client_id(bytes([0x80])) is None
