import modal
import os
import json
import base64

if modal.is_local():
    Request = None
    HTTPException = None
else:
    from fastapi import Request, HTTPException
    from firebase_admin import firestore

from firebase import verify_id_token, init_firebase


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


def setup_document_routes(app):
    @app.post("/compact")
    async def compact(request: Request):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        verify_id_token(auth_header.split("Bearer ")[1])

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")
        doc_id = body.get("docId")
        if not doc_id:
            raise HTTPException(status_code=400, detail="Missing docId.")

        return run_compaction(doc_id)
