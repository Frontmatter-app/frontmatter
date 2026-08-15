import modal
import os

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "firebase-admin==6.5.0",
        "pycrdt==0.10.1",
        "httpx==0.27.0",
        "fastapi[standard]==0.111.0",
        "boto3==1.34.0",
    )
)

app = modal.App("marktype-backend", image=image)

firebase_secret = modal.Secret.from_name("firebase-secret")
creem_secret = modal.Secret.from_name("creem-secret")
resend_secret = modal.Secret.from_name("resend-secret")
r2_secret = modal.Secret.from_name("r2-secret")

if modal.is_local():
    web_app = None
else:
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from firebase import init_firebase

    web_app = FastAPI(title="MarkType Backend API")
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from routes.billing import setup_billing_routes
    from routes.auth import setup_auth_routes
    from routes.team import setup_team_routes
    from routes.documents import setup_document_routes
    # routes.r2_storage is gone: its /r2/{key} endpoints authenticated the caller
    # and authorized nothing, so any signed-in user could read, overwrite, or
    # delete every object in the bucket. routes.assets replaces it.
    from routes.assets import setup_asset_routes
    from routes.collab import setup_collab_routes

    setup_billing_routes(web_app)
    setup_auth_routes(web_app)
    setup_team_routes(web_app)
    setup_document_routes(web_app)
    setup_asset_routes(web_app)
    setup_collab_routes(web_app)


# `max_containers=1` is load-bearing, not a cost setting.
#
# The collaboration rooms in routes/collab.py hold each document's Yjs state in
# process memory, so every peer of a document must land in the same container.
# Modal load-balances an ASGI app across containers by default, which would put
# two editors of the same document in different processes that never exchange
# updates — the exact failure the sync server exists to fix.
#
# This caps concurrency at one container. Well within reach for early team use,
# since a room is cheap and idle rooms are evicted on last disconnect. To scale
# past it, rooms need either per-document container affinity or cross-container
# fan-out (a shared pub/sub), and the snapshot ownership rules change with it.
@app.function(
    secrets=[firebase_secret, creem_secret, resend_secret, r2_secret],
    max_containers=1,
)
@modal.asgi_app()
def fastapi_app():
    return web_app


# DISABLED: compaction merges the update log into `cloud_documents/{id}.yState` and
# deletes the log, but no client reads `yState` — so every compacted document becomes
# unrecoverable for any peer that joins afterwards. Re-enabling this before the Yjs sync
# server lands (which removes the update log entirely) will destroy documents.
#
# Left callable as a plain function so the migration backfill can reuse it.
def scheduled_compaction():
    from firebase import init_firebase
    from firebase_admin import firestore
    from routes.documents import run_compaction

    init_firebase()
    db = firestore.client()
    docs = db.collection('cloud_documents').get()
    threshold = 50
    print(f"Scheduled compaction: checking {len(docs)} documents.")

    for doc_snap in docs:
        doc_id = doc_snap.id
        updates_ref = doc_snap.reference.collection('updates')
        try:
            res = updates_ref.count().get()
            count = res[0].value if res and hasattr(res[0], 'value') else len(updates_ref.get())
        except Exception:
            count = len(updates_ref.get())
        if count >= threshold:
            print(f"Auto-compacting {doc_id} ({count} updates)")
            try:
                run_compaction(doc_id)
            except Exception as e:
                print(f"Error compacting {doc_id}: {e}")
