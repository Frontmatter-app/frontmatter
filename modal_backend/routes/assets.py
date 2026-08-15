"""Content-addressed asset storage on R2, read-authorized per document.

Two properties matter here:

  * **Keys are the hash of the bytes.** An object can only ever hold the content
    it names, so one user cannot overwrite another's asset, identical images are
    stored once, and an annotated copy is a new object rather than an overwrite.

  * **Reads are authorized, not entropy-gated.** The bucket is private. A caller
    gets a short-lived presigned URL only when they can read a document that
    actually references the asset. Serving from a public CDN would have meant
    anyone holding a URL kept access forever, and removing someone from a team
    would not have revoked the images they had already seen.

The reference check needs no extra index: the document's markdown is already
stored, and the digest appears in the filename it references.
"""
import modal
import os
import re
import json
import hashlib
import asyncio
import time

if modal.is_local():
    Request = None
    HTTPException = None
else:
    from fastapi import Request, HTTPException
    import boto3

from firebase import verify_id_token
from authz import document_access

# Generous enough for a full-resolution screenshot, small enough that a single
# request cannot exhaust container memory.
MAX_ASSET_BYTES = 25 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
}

# 64 bits of the SHA-256. Short enough to live in a filename without making the
# markdown unreadable, wide enough that a collision is not a practical concern.
DIGEST_LENGTH = 16
_DIGEST_RE = re.compile(r'^[0-9a-f]{%d}$' % DIGEST_LENGTH)

# Presigned URLs are minted against an hour boundary rather than "now + an
# hour", so every request within the same window yields the identical URL and
# the browser's HTTP cache can actually hold the image. A per-request signature
# would change the URL each time and defeat caching entirely.
SIGNING_WINDOW_SECONDS = 3600

# Signing is deterministic only because the result is remembered: SigV4 embeds
# the current timestamp, so two calls would otherwise differ. Single-container
# deployment makes an in-process cache sufficient.
_signed_url_cache: dict[tuple[str, int], str] = {}

_r2_client = None


async def _run(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def get_r2_client():
    global _r2_client
    if _r2_client is None:
        _r2_client = boto3.client(
            's3',
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
            region_name='auto',
        )
    return _r2_client


def digest_of(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()[:DIGEST_LENGTH]


def current_window() -> int:
    return int(time.time()) // SIGNING_WINDOW_SECONDS


def sign_asset(key: str, window: int) -> str:
    """A presigned GET, stable for the whole signing window."""
    cached = _signed_url_cache.get((key, window))
    if cached:
        return cached

    # Expire at the end of the *next* window, so a URL handed out at the end of
    # one window is still usable for a reasonable time.
    expires_in = (window + 2) * SIGNING_WINDOW_SECONDS - int(time.time())
    url = get_r2_client().generate_presigned_url(
        'get_object',
        Params={'Bucket': os.environ['R2_BUCKET_NAME'], 'Key': key},
        ExpiresIn=max(60, expires_in),
    )

    # Keep only the current and previous window; anything older cannot be
    # returned again and would otherwise grow without bound.
    for stale in [k for k in _signed_url_cache if k[1] < window - 1]:
        _signed_url_cache.pop(stale, None)
    _signed_url_cache[(key, window)] = url
    return url


def document_references(data: dict, digest: str) -> bool:
    """Whether a document actually uses this asset.

    Access to a document is not access to the whole bucket. The digest is part
    of the filename the markdown references, so a substring match over the
    document's own content answers this without a separate index.
    """
    raw = data.get('content') or ''
    haystack = raw
    try:
        parsed = json.loads(raw) if raw.startswith('{') else None
        if isinstance(parsed, dict):
            haystack = ' '.join(
                str(parsed.get(field) or '') for field in ('markdown', 'draft')
            )
    except Exception:
        pass

    if digest in haystack:
        return True

    # Drawing scenes keep their images in the live document rather than in
    # `content`, so consult the room when one is loaded.
    try:
        from routes.collab import rooms
        room = rooms.get(data.get('id') or '')
        if room is not None:
            if digest in str(room.doc.get('markdown', type=None) or ''):
                return True
            files = room.doc.get('excalidraw-files', type=None)
            if files is not None and digest in str(files):
                return True
    except Exception:
        pass

    return False


async def verify_auth(request: Request) -> dict:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    return await verify_id_token(auth_header.split("Bearer ")[1])


def setup_asset_routes(app):
    @app.put("/assets/{digest}")
    async def upload_asset(digest: str, request: Request):
        """Stores bytes under a prefix of their own SHA-256."""
        decoded = await verify_auth(request)
        uid = decoded.get("uid")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid authorization token.")

        if not _DIGEST_RE.match(digest):
            raise HTTPException(
                status_code=400,
                detail=f"Asset key must be {DIGEST_LENGTH} lowercase hex characters.",
            )

        document_id = request.headers.get("x-document-id")
        if not document_id:
            raise HTTPException(status_code=400, detail="Missing x-document-id header.")

        content_type = (request.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported asset type: {content_type or 'unknown'}.",
            )

        body = await request.body()
        if not body:
            raise HTTPException(status_code=400, detail="Empty asset body.")
        if len(body) > MAX_ASSET_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Asset exceeds the {MAX_ASSET_BYTES // (1024 * 1024)}MB limit.",
            )

        # Content addressing only holds if the key really is the hash.
        if digest_of(body) != digest:
            raise HTTPException(status_code=400, detail="Body does not match the supplied digest.")

        _, can_write, _ = await _run(document_access, uid, document_id)
        if not can_write:
            raise HTTPException(status_code=403, detail="Not permitted to add assets to this document.")

        key = f"assets/{digest}.{ALLOWED_CONTENT_TYPES[content_type]}"
        await _run(
            get_r2_client().put_object,
            Bucket=os.environ['R2_BUCKET_NAME'],
            Key=key,
            Body=body,
            ContentType=content_type,
            # The key names the content, so a stored object never changes.
            CacheControl='private, max-age=31536000, immutable',
        )
        return {"key": key, "digest": digest}

    @app.post("/assets/sign")
    async def sign_assets(request: Request):
        """Presigned reads for the assets one document uses.

        Batched deliberately: a document with twenty images should cost one
        round trip and one authorization decision, not twenty.
        """
        decoded = await verify_auth(request)
        uid = decoded.get("uid")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid authorization token.")

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")

        document_id = body.get("documentId")
        requested = body.get("digests")
        if not document_id or not isinstance(requested, list):
            raise HTTPException(status_code=400, detail="Missing documentId or digests.")

        can_read, _, data = await _run(document_access, uid, document_id)
        if not can_read:
            # Same response whether the document is unreadable or absent, so
            # this cannot be used to probe for which documents exist.
            raise HTTPException(status_code=404, detail="Document not available.")
        data = {**data, 'id': document_id}

        window = current_window()
        urls: dict[str, str] = {}
        for digest in requested[:200]:
            if not isinstance(digest, str) or not _DIGEST_RE.match(digest):
                continue
            if not document_references(data, digest):
                continue
            for ext in dict.fromkeys(ALLOWED_CONTENT_TYPES.values()):
                key = f"assets/{digest}.{ext}"
                try:
                    await _run(
                        get_r2_client().head_object,
                        Bucket=os.environ['R2_BUCKET_NAME'],
                        Key=key,
                    )
                except Exception:
                    continue
                urls[digest] = await _run(sign_asset, key, window)
                break

        # Callers cache until this moment; it is the end of the current window.
        return {
            "urls": urls,
            "expiresAt": (window + 1) * SIGNING_WINDOW_SECONDS,
        }

    @app.get("/assets/{digest}/exists")
    async def asset_exists(digest: str, request: Request):
        """Lets an upload skip transferring bytes the bucket already holds."""
        await verify_auth(request)
        if not _DIGEST_RE.match(digest):
            raise HTTPException(status_code=400, detail="Malformed digest.")

        for ext in dict.fromkeys(ALLOWED_CONTENT_TYPES.values()):
            try:
                await _run(
                    get_r2_client().head_object,
                    Bucket=os.environ['R2_BUCKET_NAME'],
                    Key=f"assets/{digest}.{ext}",
                )
                return {"exists": True}
            except Exception:
                continue
        return {"exists": False}
