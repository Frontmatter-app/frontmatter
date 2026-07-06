import modal
import os
import json
import hmac
import hashlib
import asyncio

if modal.is_local():
    HTTPException = None
else:
    from fastapi import HTTPException
    import firebase_admin
    from firebase_admin import credentials, auth

_firebase_initialized = False

def init_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return

    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if sa_json:
        try:
            creds_dict = json.loads(sa_json)
            cred = credentials.Certificate(creds_dict)
            firebase_admin.initialize_app(cred)
            _firebase_initialized = True
            return
        except Exception as e:
            print(f"Firebase init (service account JSON) failed: {e}")

    pid = os.environ.get("FIREBASE_PROJECT_ID")
    ce = os.environ.get("FIREBASE_CLIENT_EMAIL")
    pk = os.environ.get("FIREBASE_PRIVATE_KEY")
    if pid and ce and pk:
        try:
            cred = credentials.Certificate({
                "type": "service_account",
                "project_id": pid,
                "private_key": pk.replace("\\n", "\n"),
                "client_email": ce,
                "token_uri": "https://oauth2.googleapis.com/token",
            })
            firebase_admin.initialize_app(cred)
            _firebase_initialized = True
            return
        except Exception as e:
            print(f"Firebase init (individual variables) failed: {e}")

    try:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)
        _firebase_initialized = True
    except Exception as e:
        print(f"Firebase init (ApplicationDefault) failed: {e}")
        try:
            firebase_admin.initialize_app()
            _firebase_initialized = True
        except Exception as ex:
            raise ValueError(f"Could not initialize Firebase Admin SDK: {ex}")

async def verify_id_token(id_token: str):
    init_firebase()
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, auth.verify_id_token, id_token)
    except Exception as e:
        print(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid authorization token.")

def verify_webhook_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    if not secret:
        return True
    if not signature:
        return False
    computed = hmac.new(
        secret.encode('utf-8'), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(computed, signature)
