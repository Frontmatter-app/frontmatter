import modal
import os
import json

if modal.is_local():
    Request = None
    HTTPException = None
    Response = None
else:
    from fastapi import Request, HTTPException
    from fastapi.responses import Response

from firebase import verify_id_token, init_firebase


def setup_auth_routes(app):
    @app.post("/exchange-google-code")
    async def exchange_google_code(request: Request):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body.")

        code = body.get("code")
        redirect_uri = body.get("redirectUri")
        code_verifier = body.get("codeVerifier")
        if not code or not redirect_uri:
            raise HTTPException(status_code=400, detail="Missing code or redirectUri.")

        google_client_id = os.environ.get("GOOGLE_CLIENT_ID") or os.environ.get("VITE_GOOGLE_CLIENT_ID")
        google_client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
        if not google_client_id or not google_client_secret:
            raise HTTPException(status_code=500, detail="Google OAuth not configured on server.")

        payload = {"code": code, "client_id": google_client_id, "client_secret": google_client_secret, "redirect_uri": redirect_uri, "grant_type": "authorization_code"}
        if code_verifier:
            payload["code_verifier"] = code_verifier

        import httpx
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post("https://oauth2.googleapis.com/token", data=payload, timeout=15)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Google OAuth connection failed: {str(e)}")
        if res.status_code != 200:
            raise HTTPException(status_code=res.status_code, detail=f"Google OAuth Error: {res.text}")

        id_token = res.json().get("id_token")
        if not id_token:
            raise HTTPException(status_code=500, detail="Google response missing id_token.")

        try:
            async with httpx.AsyncClient() as client:
                info_res = await client.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}", timeout=15)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Google token verification failed: {str(e)}")
        if info_res.status_code != 200:
            raise HTTPException(status_code=info_res.status_code, detail=f"Google token info error: {info_res.text}")

        info = info_res.json()
        google_uid = info.get("sub")
        email = info.get("email")
        if not google_uid or not email:
            raise HTTPException(status_code=400, detail="Invalid Google token claims.")

        email_verified = info.get("email_verified") == "true" or info.get("email_verified") is True
        display_name = info.get("name")
        photo_url = info.get("picture")

        init_firebase()
        from firebase_admin import auth as fb_auth

        import asyncio
        loop = asyncio.get_event_loop()

        try:
            try:
                user_record = await loop.run_in_executor(None, fb_auth.get_user_by_email, email)
            except Exception:
                user_record = await loop.run_in_executor(None, lambda: fb_auth.create_user(email=email, email_verified=email_verified, display_name=display_name, photo_url=photo_url))
            uid = user_record.uid
            custom_token = await loop.run_in_executor(None, fb_auth.create_custom_token, uid)
            return {"customToken": custom_token.decode("utf-8"), "uid": uid, "email": email, "displayName": display_name, "photoURL": photo_url}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create Firebase user: {str(e)}")

    @app.api_route("/__/auth/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    async def firebase_auth_proxy(path: str, request: Request):
        project_id = os.environ.get("FIREBASE_PROJECT_ID")
        if not project_id and os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"):
            try:
                project_id = json.loads(os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")).get("project_id")
            except Exception:
                pass

        auth_domain = os.environ.get("FIREBASE_AUTH_DOMAIN") or os.environ.get("VITE_FIREBASE_AUTH_DOMAIN")
        if not auth_domain and project_id:
            auth_domain = f"{project_id}.firebaseapp.com"
        if not auth_domain:
            auth_domain = "marktype.firebaseapp.com"

        target = f"https://{auth_domain}/__/auth/{path}"
        params = dict(request.query_params)
        headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
        method = request.method

        import httpx
        try:
            async with httpx.AsyncClient() as client:
                if method == "GET":
                    res = await client.get(target, params=params, headers=headers, timeout=15)
                elif method == "POST":
                    body = await request.body()
                    res = await client.post(target, params=params, headers=headers, content=body, timeout=15)
                else:
                    body = await request.body()
                    res = await client.request(method, target, params=params, headers=headers, content=body, timeout=15)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Proxy connection failed: {str(e)}")

        excluded = {'content-encoding', 'transfer-encoding', 'content-length', 'connection', 'host'}
        resp_headers = {k: v for k, v in res.headers.items() if k.lower() not in excluded}
        return Response(content=res.content, status_code=res.status_code, headers=resp_headers)
