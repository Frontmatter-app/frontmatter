"""Tests for the asset access rule and signing window.

The rule these pin down is the whole point of the private bucket: reading an
asset requires being able to read a document that *actually references it*.
Access to one document is not access to the bucket.

Run: python3 modal_backend/tests/test_assets.py
"""
import sys
import os
import json
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from routes.assets import (  # noqa: E402
    DIGEST_LENGTH,
    _DIGEST_RE,
    current_window,
    digest_of,
    document_references,
    SIGNING_WINDOW_SECONDS,
)

DIGEST = '4f3a9c21b70e5d88'
OTHER = 'aaaabbbbccccdddd'


def doc_with(markdown='', draft=''):
    return {'content': json.dumps({'markdown': markdown, 'draft': draft})}


def test_digest_is_a_prefix_of_the_sha256():
    import hashlib
    body = b'some image bytes'
    assert digest_of(body) == hashlib.sha256(body).hexdigest()[:DIGEST_LENGTH]
    assert len(digest_of(body)) == DIGEST_LENGTH


def test_digest_regex_accepts_only_the_exact_shape():
    assert _DIGEST_RE.match(DIGEST)
    assert not _DIGEST_RE.match(DIGEST.upper())       # uppercase hex
    assert not _DIGEST_RE.match(DIGEST[:-1])          # too short
    assert not _DIGEST_RE.match(DIGEST + 'a')         # too long
    assert not _DIGEST_RE.match('../../etc/passwd')   # path traversal
    assert not _DIGEST_RE.match('zzzzzzzzzzzzzzzz')   # not hex


def test_reference_found_in_the_markdown():
    data = doc_with(markdown=f'![A diagram](./.assets/imgs/diagram-{DIGEST}.webp)')
    assert document_references(data, DIGEST) is True


def test_reference_found_in_the_draft_outline():
    data = doc_with(draft=f'![x](./.assets/imgs/a-{DIGEST}.webp)')
    assert document_references(data, DIGEST) is True


def test_asset_not_referenced_by_this_document_is_refused():
    # Being able to read one document must not grant the whole bucket.
    data = doc_with(markdown=f'![other](./.assets/imgs/other-{OTHER}.webp)')
    assert document_references(data, DIGEST) is False


def test_empty_document_references_nothing():
    assert document_references({}, DIGEST) is False
    assert document_references({'content': ''}, DIGEST) is False


def test_plain_text_content_is_still_searched():
    # Older documents stored the markdown directly rather than as a JSON envelope.
    data = {'content': f'![x](./.assets/imgs/a-{DIGEST}.webp)'}
    assert document_references(data, DIGEST) is True


def test_malformed_json_content_does_not_raise():
    data = {'content': '{not valid json'}
    assert document_references(data, DIGEST) is False


def test_signing_window_is_stable_within_the_hour():
    # Two calls inside one window must produce the same window id, which is what
    # lets the signed URL be byte-identical and therefore cacheable.
    now = int(time.time())
    start = (now // SIGNING_WINDOW_SECONDS) * SIGNING_WINDOW_SECONDS
    assert start // SIGNING_WINDOW_SECONDS == current_window()
    assert (start + SIGNING_WINDOW_SECONDS - 1) // SIGNING_WINDOW_SECONDS == current_window()
    assert (start + SIGNING_WINDOW_SECONDS) // SIGNING_WINDOW_SECONDS == current_window() + 1


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
