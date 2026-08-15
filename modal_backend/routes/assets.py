"""Content-addressed asset storage on R2.

Replaces the previous `/r2/*` endpoints, which authenticated the caller and then
authorized nothing: any signed-in user could PUT, GET, or DELETE **any key** in
the bucket. The `x-team-id` header the client sent was never read.

Two things fix that here:

  * **Keys are the SHA-256 of the bytes.** A key can only ever hold the content
    it names, so one user cannot overwrite another's asset — the worst they can
    do is write the identical bytes. Uploads are still authorized against a
    document the caller may write, which is what bounds abuse and attributes
    storage.

  * **Reads leave the backend entirely.** Objects are served from R2 through a
    public custom domain with immutable caching, so an `<img src>` needs no
    token. The old `/r2/public/{key}` required an `Authorization` header an
    `<img>` tag cannot send, and returned JSON rather than image bytes — cloud
    images could never render.

Deletion is deliberately absent: content-addressed assets are shared between
documents by construction, so removal has to be reference-counted rather than
per-document. That is the garbage-collection work, not an upload concern.
"""
import modal
import os
import re
import hashlib
import asyncio

if modal.is_local():
    Request = None
    HTTPException = None
else:
    from fastapi import Request, HTTPException
    import boto3

from firebase import verify_id_token, init_firebase

# Generous enough for a full-resolution screenshot, small enough that a single
# request cannot exhaust container memory. The old endpoint buffered the whole
# body with no limit at all.
MAX_ASSET_BYTES = 25 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
}

_SHA256_RE = re.compile(r'^[0-9a-f]{64}$')

_r2_client = None


async def _s3_call(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


async def _firestore_call(fn, *args, **kwargs):
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


def asset_public_url(key: str) -> str:
    """The CDN URL for a stored object.

    `R2_PUBLIC_BASE_URL` must point at a domain bound to the bucket with public
    read access (an R2 custom domain, or the bucket's r2.dev subdomain). Without
    it there is no URL an `<img>` tag can load, so this fails loudly rather than
    handing back something that will 401 at render time.
    """
    base = os.environ.get('R2_PUBLIC_BASE_URL', '').rstrip('/')
    if not base:
        raise HTTPException(
            status_code=500,
            detail="R2_PUBLIC_BASE_URL is not configured; assets have no public URL.",
        )
    return f"{base}/{key}"


def can_write_document(uid: str, doc_id: str) -> bool:
    """Mirrors `canWriteDocumentResource` in firestore.rules.

    Owner, or a member of the document's team who is either unrestricted, the
    team owner, or in one of `filePermissions.writableBy`.
    """
    from firebase_admin import firestore

    init_firebase()
    db = firestore.client()

    doc_snap = db.collection('cloud_documents').document(doc_id).get()
    if not doc_snap.exists:
        return False
    data = doc_snap.to_dict() or {}

    if data.get('ownerId') == uid:
        return True

    team_id = data.get('teamId')
    if not team_id:
        return False

    team_snap = db.collection('teams').document(team_id).get()
    if not team_snap.exists:
        return False
    if (team_snap.to_dict() or {}).get('ownerId') == uid:
        return True

    membership = db.collection('teams').document(team_id).collection('members').document(uid).get()
    if not membership.exists:
        return False

    writable_by = ((data.get('filePermissions') or {}).get('writableBy')) or []
    if not writable_by:
        return True
    my_groups = set((membership.to_dict() or {}).get('groupIds') or [])
    return bool(my_groups.intersection(writable_by))


async def verify_auth(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    return await verify_id_token(auth_header.split("Bearer ")[1])


def setup_asset_routes(app):
    @app.put("/assets/{digest}")
    async def upload_asset(digest: str, request: Request):
        """Stores bytes under their own SHA-256.

        The caller supplies the digest in the path and the owning document in
        `x-document-id`; both are verified before anything is written.
        """
        decoded = await verify_auth(request)
        uid = decoded.get("uid")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid authorization token.")

        if not _SHA256_RE.match(digest):
            raise HTTPException(status_code=400, detail="Asset key must be a lowercase SHA-256 hex digest.")

        document_id = request.headers.get("x-document-id")
        if not document_id:
            raise HTTPException(status_code=400, detail="Missing x-document-id header.")

        content_type = (request.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=415, detail=f"Unsupported asset type: {content_type or 'unknown'}.")

        body = await request.body()
        if len(body) > MAX_ASSET_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Asset exceeds the {MAX_ASSET_BYTES // (1024 * 1024)}MB limit.",
            )
        if not body:
            raise HTTPException(status_code=400, detail="Empty asset body.")

        # Content addressing only holds if the key really is the hash.
        actual = hashlib.sha256(body).hexdigest()
        if actual != digest:
            raise HTTPException(status_code=400, detail="Body does not match the supplied digest.")

        if not await _firestore_call(can_write_document, uid, document_id):
            raise HTTPException(status_code=403, detail="Not permitted to add assets to this document.")

        key = f"assets/{digest}.{ALLOWED_CONTENT_TYPES[content_type]}"
        client = get_r2_client()
        bucket = os.environ['R2_BUCKET_NAME']

        # Immutable: the key names the content, so a stored object never changes.
        await _s3_call(
            client.put_object,
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            CacheControl='public, max-age=31536000, immutable',
        )

        return {"key": key, "url": asset_public_url(key)}

    @app.get("/assets/{digest}/exists")
    async def asset_exists(digest: str, request: Request):
        """Lets the client skip re-uploading bytes the bucket already holds.

        Content addressing makes this safe to answer: a hit means the exact same
        bytes are already stored.
        """
        await verify_auth(request)
        if not _SHA256_RE.match(digest):
            raise HTTPException(status_code=400, detail="Asset key must be a lowercase SHA-256 hex digest.")

        client = get_r2_client()
        bucket = os.environ['R2_BUCKET_NAME']

        for ext in set(ALLOWED_CONTENT_TYPES.values()):
            key = f"assets/{digest}.{ext}"
            try:
                await _s3_call(client.head_object, Bucket=bucket, Key=key)
                return {"exists": True, "key": key, "url": asset_public_url(key)}
            except Exception:
                continue
        return {"exists": False}
