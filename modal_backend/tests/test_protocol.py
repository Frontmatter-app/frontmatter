"""Wire-format tests for the y-websocket protocol codec.

The codec is hand-written, and a framing bug here is the kind that shows up as
"collaboration silently does nothing" rather than as an exception — so it gets
tested directly. These import cleanly without pycrdt or fastapi, because both
sit behind `modal.is_local()` guards in the module under test.

Run: python3 -m pytest modal_backend/tests/  (or: python3 modal_backend/tests/test_protocol.py)
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from routes.collab import (  # noqa: E402
    MSG_AWARENESS,
    MSG_SYNC,
    SYNC_STEP_1,
    SYNC_STEP_2,
    SYNC_UPDATE,
    encode_awareness,
    encode_sync_step_1,
    encode_sync_step_2,
    encode_sync_update,
    read_var_bytes,
    read_var_uint,
    write_var_bytes,
    write_var_uint,
)


def test_varuint_roundtrip():
    # Boundaries either side of each 7-bit group, where LEB128 continuation bugs live.
    for value in [0, 1, 127, 128, 129, 255, 256, 16383, 16384, 2 ** 31, 2 ** 53]:
        encoded = write_var_uint(value)
        decoded, offset = read_var_uint(encoded, 0)
        assert decoded == value, f"{value} -> {encoded.hex()} -> {decoded}"
        assert offset == len(encoded)


def test_varuint_matches_leb128_encoding():
    # Known-good vectors from the lib0 encoding y-websocket uses.
    assert write_var_uint(0) == b'\x00'
    assert write_var_uint(1) == b'\x01'
    assert write_var_uint(127) == b'\x7f'
    assert write_var_uint(128) == b'\x80\x01'
    assert write_var_uint(300) == b'\xac\x02'


def test_var_bytes_roundtrip():
    for payload in [b'', b'\x00', b'hello', bytes(range(256)), os.urandom(5000)]:
        encoded = write_var_bytes(payload)
        decoded, offset = read_var_bytes(encoded, 0)
        assert decoded == payload
        assert offset == len(encoded)


def test_sync_step_1_framing():
    message = encode_sync_step_1(b'\x01\x02\x03')

    offset = 0
    message_type, offset = read_var_uint(message, offset)
    sync_type, offset = read_var_uint(message, offset)
    payload, offset = read_var_bytes(message, offset)

    assert message_type == MSG_SYNC
    assert sync_type == SYNC_STEP_1
    assert payload == b'\x01\x02\x03'
    assert offset == len(message)


def test_sync_step_2_and_update_framing():
    for encoder, expected in [
        (encode_sync_step_2, SYNC_STEP_2),
        (encode_sync_update, SYNC_UPDATE),
    ]:
        message = encoder(b'update-bytes')
        offset = 0
        message_type, offset = read_var_uint(message, offset)
        sync_type, offset = read_var_uint(message, offset)
        payload, offset = read_var_bytes(message, offset)

        assert message_type == MSG_SYNC
        assert sync_type == expected
        assert payload == b'update-bytes'
        assert offset == len(message)


def test_awareness_framing():
    message = encode_awareness(b'awareness')

    offset = 0
    message_type, offset = read_var_uint(message, offset)
    payload, offset = read_var_bytes(message, offset)

    assert message_type == MSG_AWARENESS
    assert payload == b'awareness'
    assert offset == len(message)


def test_large_update_uses_multibyte_length_prefix():
    # A pasted image easily exceeds one varint byte of length; this is where a
    # naive single-byte length prefix would corrupt the stream.
    payload = os.urandom(70000)
    message = encode_sync_update(payload)

    offset = 0
    read_var_uint(message, offset)
    _, offset = read_var_uint(message, 0)
    _, offset = read_var_uint(message, offset)
    decoded, offset = read_var_bytes(message, offset)

    assert decoded == payload
    assert offset == len(message)


def test_truncated_input_raises_rather_than_silently_truncating():
    message = encode_sync_update(b'12345')
    for cut in range(1, len(message)):
        try:
            offset = 0
            _, offset = read_var_uint(message[:cut], offset)
            _, offset = read_var_uint(message[:cut], offset)
            read_var_bytes(message[:cut], offset)
        except ValueError:
            continue
        except IndexError:
            continue
        # Reaching here means a truncated frame decoded as if it were whole.
        assert cut == len(message), f"truncation at {cut} was not detected"


def test_awareness_client_id_is_second_varint():
    # The server reads the client id straight out of the awareness payload to
    # track presence TTL; this pins the offset it reads from.
    client_id = 3735928559
    payload = write_var_uint(1) + write_var_uint(client_id) + b'rest'

    count, cursor = read_var_uint(payload, 0)
    decoded_client, _ = read_var_uint(payload, cursor)

    assert count == 1
    assert decoded_client == client_id


if __name__ == '__main__':
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    print(f"\n{'FAILED' if failures else 'passed'}: {failures} failure(s)")
    sys.exit(1 if failures else 0)
