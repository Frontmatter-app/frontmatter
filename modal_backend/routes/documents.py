import modal
import os
import json
import base64
import asyncio

if modal.is_local():
    Request = None
    HTTPException = None
else:
    from fastapi import Request, HTTPException
    from firebase_admin import firestore

from firebase import verify_id_token, init_firebase


async def _run_sync(fn, *args, **kwargs):
    """Firestore's sync client and the compaction merge both block; keep them off
    the event loop, matching `_firestore_call` in team.py and `_s3_call` in r2_storage.py."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def run_compaction(doc_id: str):
    init_firebase()
    from pycrdt import Doc

    db = firestore.client()
    doc_ref = db.collection('cloud_documents').document(doc_id)
    updates_col = doc_ref.collection('updates')

    updates_snap = updates_col.order_by('createdAt', direction=firestore.Query.ASCENDING).get()
    if not updates_snap:
        return {"status": "no_updates"}

    doc_snap = doc_ref.get()
    doc_data = doc_snap.to_dict() if doc_snap.exists else {}
    base_y_state = base64.b64decode(doc_data.get('yState', '')) if doc_data.get('yState') else None

    ydoc = Doc()
    if base_y_state:
        try:
            ydoc.apply_update(base_y_state)
        except Exception as e:
            print(f"Compaction: failed to apply base state for {doc_id}: {e}")

    to_delete = []
    for snap in updates_snap:
        update_b64 = snap.to_dict().get('update')
        if update_b64:
            try:
                ydoc.apply_update(base64.b64decode(update_b64))
                to_delete.append(snap.reference)
            except Exception as e:
                print(f"Compaction: failed update {snap.id} on {doc_id}: {e}")

    compacted = base64.b64encode(ydoc.encode_state_as_update()).decode('utf-8')
    doc_ref.update({
        'yState': compacted,
        'content': json.dumps({'markdown': str(ydoc.get_text('markdown')), 'draft': str(ydoc.get_text('draft'))}),
        'updatedAt': firestore.SERVER_TIMESTAMP,
    })

    batch = db.batch()
    count = 0
    for ref in to_delete:
        batch.delete(ref)
        count += 1
        if count == 400:
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()

    return {"status": "compacted", "count": len(to_delete)}


def can_administer_document(uid: str, doc_id: str) -> bool:
    """Compaction rewrites `content`/`yState` and deletes the update log, so it is
    restricted to the document's owner or the owner of the team it belongs to."""
    init_firebase()
    db = firestore.client()
    doc_snap = db.collection('cloud_documents').document(doc_id).get()
    if not doc_snap.exists:
        return False
    doc_data = doc_snap.to_dict() or {}

    if doc_data.get('ownerId') == uid:
        return True

    team_id = doc_data.get('teamId')
    if not team_id:
        return False
    team_snap = db.collection('teams').document(team_id).get()
    if not team_snap.exists:
        return False
    return (team_snap.to_dict() or {}).get('ownerId') == uid


def setup_document_routes(app):
    @app.post("/compact")
    async def compact(request: Request):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        # `verify_id_token` is async; calling it without awaiting discarded the
        # coroutine and let every request through unauthenticated.
        decoded = await verify_id_token(auth_header.split("Bearer ")[1])
        uid = decoded.get("uid")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid authorization token.")

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")
        doc_id = body.get("docId")
        if not doc_id:
            raise HTTPException(status_code=400, detail="Missing docId.")

        if not await _run_sync(can_administer_document, uid, doc_id):
            raise HTTPException(status_code=403, detail="Not permitted to compact this document.")

        return await _run_sync(run_compaction, doc_id)
