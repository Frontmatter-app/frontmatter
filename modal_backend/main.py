# ─── Modal App and Image Setup ────────────────────────────────────────────────
# GUIDANCE: To deploy this backend without needing to install FastAPI, requests,
# or firebase-admin locally, we declare our Modal App first, and wrap the heavy
# imports so they only execute inside the Modal remote container environment.

import modal
import os
import json
import base64
import hmac
import hashlib

# These packages are not required locally for deployment, only inside the Modal image.
if modal.is_local():
    # Placeholders/stubs for local CLI analysis during deploy step
    FastAPI = None
    Request = None
    HTTPException = None
    CORSMiddleware = None
    HTMLResponse = None
else:
    from fastapi import FastAPI, Request, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import HTMLResponse
    import requests

# ─── Define Modal Image and App ──────────────────────────────────────────────
# Note: modal[fastapi] package or fastapi[standard] requires basic networking packages
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "firebase-admin==6.5.0",
        "pycrdt==0.10.1",
        "requests==2.31.0",
        "fastapi==0.111.0",
        "uvicorn==0.30.1"
    )
)

app = modal.App("marktype-backend", image=image)

# Register secret names to bind
firebase_secret = modal.Secret.from_name("firebase-secret")
creem_secret = modal.Secret.from_name("creem-secret")
resend_secret = modal.Secret.from_name("resend-secret")

# ─── FastAPI Application Definition ───────────────────────────────────────────
if modal.is_local():
    web_app = None
else:
    web_app = FastAPI(title="MarkType Backend API")
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Tauri app can load from different origins, allow all
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Lazy Firebase Initialization
_firebase_initialized = False

def init_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return
    import firebase_admin
    from firebase_admin import credentials
    
    # 1. Try FIREBASE_SERVICE_ACCOUNT_JSON
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if sa_json:
        try:
            creds_dict = json.loads(sa_json)
            cred = credentials.Certificate(creds_dict)
            firebase_admin.initialize_app(cred)
            _firebase_initialized = True
            print("Firebase initialized via service account JSON.")
            return
        except Exception as e:
            print(f"Failed initializing via service account JSON: {e}")

    # 2. Try individual env variables
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY")
    if project_id and client_email and private_key:
        try:
            cred = credentials.Certificate({
                "type": "service_account",
                "project_id": project_id,
                "private_key": private_key.replace("\\n", "\n"),
                "client_email": client_email,
                "token_uri": "https://oauth2.googleapis.com/token",
            })
            firebase_admin.initialize_app(cred)
            _firebase_initialized = True
            print("Firebase initialized via individual credentials variables.")
            return
        except Exception as e:
            print(f"Failed initializing via individual credentials variables: {e}")

    # 3. Fallback to default credentials
    try:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)
        _firebase_initialized = True
        print("Firebase initialized via Application Default Credentials.")
    except Exception as e:
        print(f"Failed initializing via Application Default Credentials: {e}")
        # Initialize without credentials for local emulator debugging if applicable
        try:
            firebase_admin.initialize_app()
            _firebase_initialized = True
            print("Firebase initialized with default configuration.")
        except Exception as ex:
            raise ValueError(f"Could not initialize Firebase Admin SDK: {ex}")

def verify_id_token(id_token: str):
    init_firebase()
    from firebase_admin import auth
    try:
        decoded = auth.verify_id_token(id_token)
        return decoded
    except Exception as e:
        print(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid authorization token.")

def verify_webhook_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    if not secret:
        # If no secret is provided, bypass verification for simpler testing
        return True
    if not signature:
        return False
    computed_signature = hmac.new(
        secret.encode('utf-8'),
        raw_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(computed_signature, signature)

# ─── FastAPI Endpoints ────────────────────────────────────────────────────────
def setup_endpoints(app):
    @app.post("/create-checkout")
    async def create_checkout(request: Request):
        # Authenticate user
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        
        id_token = auth_header.split("Bearer ")[1]
        decoded = verify_id_token(id_token)
        uid = decoded.get("uid")
        email = decoded.get("email") or ""
        
        # Read product ID from request body
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body. Expected JSON.")
            
        product_id = body.get("productId")
        print(f"[Backend] create_checkout called for product_id={product_id}, user_id={uid}")
        if not product_id:
            raise HTTPException(status_code=400, detail="Missing productId in request body.")
            
        creem_api_key = os.environ.get("CREEM_API_KEY")
        if not creem_api_key:
            raise HTTPException(status_code=500, detail="CREEM_API_KEY environment variable is not set on the server.")
            
        is_test_mode = creem_api_key.startswith("creem_test_")
        creem_base_url = "https://test-api.creem.io/v1" if is_test_mode else "https://api.creem.io/v1"
        
        # Request checkout session from Creem
        payload = {
            "product_id": product_id,
            "customer": {
                "email": email
            },
            "metadata": {
                "userId": uid
            },
            "success_url": f"{request.base_url}checkout-success"
        }
        
        try:
            res = requests.post(
                f"{creem_base_url}/checkouts",
                headers={
                    "x-api-key": creem_api_key,
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=15
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to connect to Creem API: {str(e)}")
            
        if res.status_code not in (200, 201):
            raise HTTPException(status_code=res.status_code, detail=f"Creem API Error: {res.text}")
            
        res_data = res.json()
        checkout_url = res_data.get("checkout_url")
        if not checkout_url:
            raise HTTPException(status_code=500, detail="Creem response did not contain checkout_url.")
            
        return {"url": checkout_url}

    @app.get("/checkout-success", response_class=HTMLResponse)
    async def checkout_success():
        html_content = '''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Checkout Successful | MarkType</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background: radial-gradient(circle at center, #18181b 0%, #09090b 100%);
            color: #f4f4f5;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
        }
        /* Glow Background Effects */
        .glow {
            position: absolute;
            width: 400px;
            height: 400px;
            background: radial-gradient(circle, rgba(245, 158, 11, 0.08) 0%, transparent 70%);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 0;
            pointer-events: none;
        }
        .card {
            background: rgba(24, 24, 27, 0.4);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
            padding: 3.5rem 2rem;
            max-width: 440px;
            width: 90%;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            z-index: 10;
            animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        /* Checkmark Animation */
        .checkmark-wrapper {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 2rem;
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.15);
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% {
                box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
            }
            70% {
                box-shadow: 0 0 0 15px rgba(16, 185, 129, 0);
            }
            100% {
                box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
            }
        }
        .checkmark-svg {
            width: 40px;
            height: 40px;
        }
        .checkmark-circle {
            stroke-dasharray: 166;
            stroke-dashoffset: 166;
            stroke-width: 3;
            stroke-miterlimit: 10;
            stroke: #10b981;
            fill: none;
            animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) 0.2s forwards;
        }
        .checkmark-check {
            transform-origin: 50% 50%;
            stroke-dasharray: 48;
            stroke-dashoffset: 48;
            stroke: #10b981;
            stroke-width: 4;
            stroke-linecap: round;
            fill: none;
            animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.7s forwards;
        }
        @keyframes stroke {
            100% {
                stroke-dashoffset: 0;
            }
        }
        h1 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.75rem;
            background: linear-gradient(135deg, #fb923c 0%, #f59e0b 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.02em;
        }
        .subtitle {
            font-size: 1.1rem;
            font-weight: 600;
            color: #e4e4e7;
            margin-bottom: 1.25rem;
        }
        p {
            font-size: 0.95rem;
            color: #a1a1aa;
            line-height: 1.6;
            margin-bottom: 2.25rem;
        }
        .btn {
            display: inline-block;
            width: 100%;
            padding: 0.9rem 2rem;
            font-size: 0.95rem;
            font-weight: 600;
            color: #09090b;
            background: linear-gradient(135deg, #fb923c 0%, #f59e0b 100%);
            border: none;
            border-radius: 12px;
            cursor: pointer;
            text-decoration: none;
            box-shadow: 0 4px 15px rgba(245, 158, 11, 0.25);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(245, 158, 11, 0.35);
        }
        .btn:active {
            transform: translateY(0);
        }
    </style>
</head>
<body>
    <div class="glow"></div>
    <div class="card">
        <div class="checkmark-wrapper">
            <svg class="checkmark-svg" viewBox="0 0 52 52">
                <circle class="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
                <path class="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
        </div>
        <h1>Payment Successful!</h1>
        <div class="subtitle">Thank you for upgrading</div>
        <p>Your subscription has been processed successfully. You can now close this tab and return to the MarkType app to access your new plan features.</p>
        <button onclick="window.close()" class="btn">Close Window</button>
    </div>
</body>
</html>'''
        return HTMLResponse(content=html_content, status_code=200)

    @app.post("/create-portal")
    async def create_portal(request: Request):
        # Authenticate user
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        
        id_token = auth_header.split("Bearer ")[1]
        decoded = verify_id_token(id_token)
        uid = decoded.get("uid")
        
        # Look up user in Firestore
        from firebase_admin import firestore
        db = firestore.client()
        user_ref = db.collection('users').document(uid)
        user_snap = user_ref.get()
        
        if not user_snap.exists:
            raise HTTPException(status_code=404, detail="User document not found in database.")
            
        user_data = user_snap.to_dict()
        customer_id = user_data.get("creemCustomerId")
        if not customer_id:
            raise HTTPException(status_code=400, detail="Creem customer record not found. Please upgrade to a plan first.")
            
        creem_api_key = os.environ.get("CREEM_API_KEY")
        if not creem_api_key:
            raise HTTPException(status_code=500, detail="CREEM_API_KEY environment variable is not set on the server.")
            
        is_test_mode = creem_api_key.startswith("creem_test_")
        creem_base_url = "https://test-api.creem.io/v1" if is_test_mode else "https://api.creem.io/v1"
        
        # Request portal URL from Creem
        try:
            res = requests.post(
                f"{creem_base_url}/customer-portal",
                headers={
                    "x-api-key": creem_api_key,
                    "Content-Type": "application/json"
                },
                json={
                    "customer_id": customer_id
                },
                timeout=15
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to connect to Creem API: {str(e)}")
            
        if res.status_code != 200:
            raise HTTPException(status_code=res.status_code, detail=f"Creem API Error: {res.text}")
            
        res_data = res.json()
        portal_link = res_data.get("customerPortalLink")
        if not portal_link:
            raise HTTPException(status_code=500, detail="Creem response did not contain customerPortalLink.")
            
        return {"url": portal_link}

    @app.post("/webhook")
    async def webhook(request: Request):
        raw_body = await request.body()
        signature = request.headers.get("creem-signature")
        secret = os.environ.get("CREEM_WEBHOOK_SECRET")
        
        if secret and signature:
            if not verify_webhook_signature(raw_body, signature, secret):
                raise HTTPException(status_code=401, detail="Invalid webhook signature verification.")
                
        try:
            payload = json.loads(raw_body.decode('utf-8'))
        except Exception:
            raise HTTPException(status_code=400, detail="Malformed JSON payload.")
            
        event_type = payload.get("eventType")
        
        # Support both 'data' and 'object' wrappers from Creem payloads
        event_data = payload.get("data") or payload.get("object") or {}
        
        init_firebase()
        from firebase_admin import firestore
        db = firestore.client()
        
        creem_author_prd = os.environ.get("VITE_CREEM_AUTHOR_PRD_ID") or os.environ.get("CREEM_AUTHOR_PRD_ID") or "prod_5v9ydeKW6XhjVJc5jJihRa"
        creem_team_prd = os.environ.get("VITE_CREEM_TEAM_PRD_ID") or os.environ.get("CREEM_TEAM_PRD_ID") or "prod_4sfr7PyPAbNGKb2ygpv3P8"
        
        print(f"[Webhook] Received event type: {event_type}")
        print(f"[Webhook] Server configured Author PRD: {creem_author_prd}, Team PRD: {creem_team_prd}")
        
        # Robustly extract customer, product, user, and status fields
        customer = event_data.get("customer") or {}
        if not isinstance(customer, dict):
            customer = {}
            
        customer_id = event_data.get("customerId") or customer.get("id")
        email = customer.get("email")
        
        # Metadata check
        root_metadata = event_data.get("metadata") or {}
        if not isinstance(root_metadata, dict):
            root_metadata = {}
            
        customer_metadata = customer.get("metadata") or {}
        if not isinstance(customer_metadata, dict):
            customer_metadata = {}
            
        user_id = root_metadata.get("userId") or customer_metadata.get("userId")
        
        product = event_data.get("product") or {}
        if isinstance(product, dict):
            product_id = event_data.get("productId") or product.get("id")
        else:
            product_id = event_data.get("productId") or event_data.get("product_id")
            
        status = event_data.get("status")
        
        print(f"[Webhook] Parsed info: product_id={product_id}, user_id={user_id}, customer_id={customer_id}, status={status}")

        if event_type in ("checkout.completed", "subscription.paid", "subscription.active"):
            # Plan activation logic
            if not user_id and customer_id:
                # Find user doc by creemCustomerId if user_id is missing from metadata
                users_query = db.collection('users').where('creemCustomerId', '==', customer_id).limit(1).get()
                if users_query:
                    user_id = users_query[0].id
                    
            if user_id:
                user_ref = db.collection('users').document(user_id)
                
                plan = 'free'
                if product_id == creem_team_prd:
                    plan = 'team'
                elif product_id == creem_author_prd:
                    plan = 'author'
                
                user_snap = user_ref.get()
                
                update_data = {
                    'plan': plan,
                    'planStatus': 'active' if status in ('paid', 'active', 'completed') else status,
                    'creemCustomerId': customer_id,
                    'updatedAt': firestore.SERVER_TIMESTAMP
                }
                
                if not user_snap.exists:
                    # Provide defaults for a brand-new user document in Firestore
                    update_data['createdAt'] = firestore.SERVER_TIMESTAMP
                    if email:
                        update_data['email'] = email
                        update_data['displayName'] = email.split('@')[0] if '@' in email else 'User'
                
                user_ref.set(update_data, merge=True)
                print(f"[Webhook] Successfully updated/created user {user_id} plan to {plan} (Creem Customer: {customer_id})")
            else:
                print(f"[Webhook] Warning: Event {event_type} ignored because no user_id could be resolved (Customer ID: {customer_id})")
                
        elif event_type in ("subscription.canceled", "subscription.updated", "subscription.expired", "subscription.past_due"):
            # subscription lifecycle logic
            plan = 'free'
            if status == 'active':
                if product_id == creem_team_prd:
                    plan = 'team'
                elif product_id == creem_author_prd:
                    plan = 'author'
            
            # Find user doc by creemCustomerId or user_id
            user_ref = None
            if user_id:
                user_ref = db.collection('users').document(user_id)
            elif customer_id:
                users_query = db.collection('users').where('creemCustomerId', '==', customer_id).limit(1).get()
                if users_query:
                    user_ref = users_query[0].reference
                    
            if user_ref:
                user_ref.update({
                    'plan': plan,
                    'planStatus': status,
                    'updatedAt': firestore.SERVER_TIMESTAMP
                })
                print(f"[Webhook] Updated subscription status for User: Plan: {plan}, Status: {status}")
            else:
                print(f"[Webhook] Warning: Event {event_type} ignored because no user doc found for Customer ID: {customer_id}")
                
        return {"status": "success"}

    @app.post("/compact")
    async def compact(request: Request):
        # Authenticate user
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        
        id_token = auth_header.split("Bearer ")[1]
        verify_id_token(id_token) # Ensure token is valid
        
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body. Expected JSON.")
            
        doc_id = body.get("docId")
        if not doc_id:
            raise HTTPException(status_code=400, detail="Missing docId in request body.")
            
        res = run_compaction(doc_id)
        return res

    @app.post("/exchange-google-code")
    async def exchange_google_code(request: Request):
        """
        Exchanges a Google OAuth authorization code for a Firebase custom token.
        This handles the token request to Google's OAuth server, verifies the
        ID token, and creates a Firebase custom token.
        """
        import requests
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

        print(f"[Exchange] Code: {code[:10]}..., Redirect URI: {redirect_uri}, Client ID: {google_client_id}")

        if not google_client_id or not google_client_secret:
            raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured on the server.")

        # Exchange code for tokens at Google
        payload = {
            "code": code,
            "client_id": google_client_id,
            "client_secret": google_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
        if code_verifier:
            payload["code_verifier"] = code_verifier

        try:
            res = requests.post(
                "https://oauth2.googleapis.com/token",
                data=payload,
                timeout=15
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to connect to Google OAuth server: {str(e)}")

        if res.status_code != 200:
            print(f"[Exchange] Google returned status {res.status_code}: {res.text}")
            raise HTTPException(status_code=res.status_code, detail=f"Google OAuth Error: {res.text}")

        res_data = res.json()
        id_token = res_data.get("id_token")
        if not id_token:
            raise HTTPException(status_code=500, detail="Google response did not contain id_token.")

        # Verify the ID token using Google API
        try:
            token_info_res = requests.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}",
                timeout=15
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to verify Google ID token: {str(e)}")

        if token_info_res.status_code != 200:
            raise HTTPException(status_code=token_info_res.status_code, detail=f"Google Token Verification Error: {token_info_res.text}")

        token_info = token_info_res.json()
        google_uid = token_info.get("sub")
        email = token_info.get("email")
        email_verified = token_info.get("email_verified") == "true" or token_info.get("email_verified") is True
        display_name = token_info.get("name")
        photo_url = token_info.get("picture")

        if not google_uid or not email:
            raise HTTPException(status_code=400, detail="Invalid Google token claims.")

        init_firebase()
        from firebase_admin import auth as fb_auth

        try:
            try:
                user_record = fb_auth.get_user_by_email(email)
            except Exception:
                user_record = fb_auth.create_user(
                    email=email,
                    email_verified=email_verified,
                    display_name=display_name,
                    photo_url=photo_url
                )
            
            uid = user_record.uid
            custom_token = fb_auth.create_custom_token(uid)
            
            return {
                "customToken": custom_token.decode("utf-8"),
                "uid": uid,
                "email": email,
                "displayName": display_name,
                "photoURL": photo_url
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch/create Firebase user or custom token: {str(e)}")

    @app.api_route("/__/auth/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    async def firebase_auth_proxy(path: str, request: Request):
        """
        Proxies Firebase Auth handler requests to the real Firebase authDomain.
        This is required because when running signInWithPopup from the Modal domain,
        the Firebase SDK falls back to redirecting the popup to the parent origin's
        /__/auth/handler. Proxied requests allow the popup to run the auth handler
        under the same origin (Modal), avoiding cross-origin blocking.
        """
        import requests
        from fastapi.responses import Response
        import os
        import json
        
        project_id = os.environ.get("FIREBASE_PROJECT_ID")
        if not project_id and os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"):
            try:
                sa_json = json.loads(os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"))
                project_id = sa_json.get("project_id")
            except Exception:
                pass
                
        firebase_auth_domain = os.environ.get("FIREBASE_AUTH_DOMAIN") or os.environ.get("VITE_FIREBASE_AUTH_DOMAIN")
        if not firebase_auth_domain and project_id:
            firebase_auth_domain = f"{project_id}.firebaseapp.com"
        if not firebase_auth_domain:
            firebase_auth_domain = "marktype.firebaseapp.com"
            
        target_url = f"https://{firebase_auth_domain}/__/auth/{path}"
        params = dict(request.query_params)
        headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
        method = request.method
        
        try:
            if method == "GET":
                res = requests.get(target_url, params=params, headers=headers, timeout=15)
            elif method == "POST":
                body = await request.body()
                res = requests.post(target_url, params=params, headers=headers, data=body, timeout=15)
            else:
                body = await request.body()
                res = requests.request(method, target_url, params=params, headers=headers, data=body, timeout=15)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Proxy connection failed: {str(e)}")
            
        excluded_headers = {'content-encoding', 'transfer-encoding', 'content-length', 'connection', 'host'}
        response_headers = {k: v for k, v in res.headers.items() if k.lower() not in excluded_headers}
        
        return Response(content=res.content, status_code=res.status_code, headers=response_headers)

    @app.post("/invite-member")
    async def invite_member(request: Request):
        import datetime
        import secrets
        
        # Authenticate user
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        
        id_token = auth_header.split("Bearer ")[1]
        decoded = verify_id_token(id_token)
        uid = decoded.get("uid")
        
        # Read payload
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body. Expected JSON.")
            
        invitee_email = body.get("email")
        team_id = body.get("teamId")
        group_id = body.get("groupId", "General")
        
        if not invitee_email or not team_id:
            raise HTTPException(status_code=400, detail="Missing email or teamId in request body.")
            
        invitee_email = invitee_email.strip().lower()
        
        # Get DB client
        init_firebase()
        from firebase_admin import firestore
        db = firestore.client()
        
        # 1. Fetch team document
        team_ref = db.collection('teams').document(team_id)
        team_snap = team_ref.get()
        if not team_snap.exists:
            raise HTTPException(status_code=404, detail="Team not found.")
            
        team_data = team_snap.to_dict()
        if team_data.get('ownerId') != uid:
            raise HTTPException(status_code=403, detail="Only the Team Owner can invite members.")
            
        # 2. Check if team is full (limit 10 members: owner + 9 members)
        members = team_data.get("members") or []
        if not isinstance(members, list):
            members = list(members.keys())
            
        if len(members) + 1 >= 10:
            raise HTTPException(status_code=400, detail="Team limit reached. Up to 10 seats allowed on Team Plan.")
            
        # Get inviter admin name
        inviter_ref = db.collection('users').document(uid)
        inviter_snap = inviter_ref.get()
        if inviter_snap.exists:
            inviter_data = inviter_snap.to_dict()
            admin_name = inviter_data.get('displayName') or inviter_data.get('email') or 'Your Admin'
        else:
            admin_name = decoded.get('email') or 'Your Admin'
            
        team_name = team_data.get('name', 'MarkType Team')
        
        # 3. Check if invitee user document already exists
        users_snap = db.collection('users').where('email', '==', invitee_email).limit(1).get()
        user_exists = len(users_snap) > 0
        
        if user_exists:
            target_user = users_snap[0]
            target_uid = target_user.id
            if target_uid == uid:
                raise HTTPException(status_code=400, detail="You cannot invite yourself.")
                
            # If already a member, return success directly
            if target_uid in members:
                return {
                    "status": "success",
                    "message": "User is already a member of this team.",
                    "addedDirectly": True,
                    "emailSent": False
                }
                
            # Add to team members
            team_ref.update({
                "members": firestore.ArrayUnion([target_uid])
            })
            target_user.reference.update({
                "teamId": team_id
            })
            
            # Send notification email (you have been added directly)
            subject = f"You have been added to the team \"{team_name}\" on MarkType"
            html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Added to {team_name}</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        body {{
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #09090b;
            color: #f4f4f5;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
        }}
        .wrapper {{
            width: 100%;
            background-color: #09090b;
            padding: 40px 0;
        }}
        .container {{
            max-width: 500px;
            margin: 0 auto;
            background: #18181b;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 20px;
            padding: 40px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        }}
        .logo {{
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.03em;
            background: linear-gradient(135deg, #fb923c 0%, #f59e0b 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 30px;
            display: inline-block;
        }}
        h1 {{
            font-size: 22px;
            font-weight: 600;
            margin-top: 0;
            margin-bottom: 16px;
            color: #ffffff;
            letter-spacing: -0.01em;
        }}
        p {{
            font-size: 15px;
            color: #a1a1aa;
            line-height: 1.6;
            margin-bottom: 30px;
        }}
        .btn {{
            display: inline-block;
            background: linear-gradient(135deg, #fb923c 0%, #f59e0b 100%);
            color: #09090b !important;
            font-weight: 600;
            font-size: 14px;
            text-decoration: none;
            padding: 14px 30px;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(245, 158, 11, 0.25);
            transition: transform 0.2s;
            margin-bottom: 25px;
        }}
        .divider {{
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            margin: 30px 0;
        }}
        .footer {{
            font-size: 12px;
            color: #52525b;
            margin-top: 20px;
        }}
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="container">
            <div class="logo">MarkType</div>
            <h1>Welcome to the Team!</h1>
            <p><strong>{admin_name}</strong> has added you to the team <strong>"{team_name}"</strong> on MarkType.</p>
            <p>You can now switch to the team workspace in the MarkType app to access shared files and collaborate.</p>
            
            <a href="marktype://open" class="btn">Open MarkType</a>
            
            <div class="divider"></div>
            <div class="footer">
                Please sign the team agreement document on your first switch to the team workspace.
            </div>
        </div>
    </div>
</body>
</html>
"""
            invite_id = None
        else:
            # User does not exist: create pending invite doc
            # Revoke previous pending invites for this email/team
            existing_invites = db.collection('invites') \
                .where('teamId', '==', team_id) \
                .where('invitedEmail', '==', invitee_email) \
                .where('status', '==', 'pending') \
                .get()
                
            for invite_snap in existing_invites:
                invite_snap.reference.update({
                    'status': 'revoked',
                    'updatedAt': firestore.SERVER_TIMESTAMP
                })
                
            # Create new invite doc
            token = secrets.token_urlsafe(32)
            expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=7)
            
            invite_ref = db.collection('invites').document()
            invite_data = {
                "teamId": team_id,
                "teamName": team_name,
                "invitedEmail": invitee_email,
                "groupId": group_id,
                "invitedBy": uid,
                "createdAt": firestore.SERVER_TIMESTAMP,
                "expiresAt": expires_at,
                "status": "pending",
                "token": token
            }
            invite_ref.set(invite_data)
            invite_id = invite_ref.id
            
            subject = f"{admin_name} has invited you to join {team_name} on MarkType"
            html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invitation to join {team_name}</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        body {{
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #09090b;
            color: #f4f4f5;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
        }}
        .wrapper {{
            width: 100%;
            background-color: #09090b;
            padding: 40px 0;
        }}
        .container {{
            max-width: 500px;
            margin: 0 auto;
            background: #18181b;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 20px;
            padding: 40px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        }}
        .logo {{
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.03em;
            background: linear-gradient(135deg, #fb923c 0%, #f59e0b 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 30px;
            display: inline-block;
        }}
        h1 {{
            font-size: 22px;
            font-weight: 600;
            margin-top: 0;
            margin-bottom: 16px;
            color: #ffffff;
            letter-spacing: -0.01em;
        }}
        p {{
            font-size: 15px;
            color: #a1a1aa;
            line-height: 1.6;
            margin-bottom: 30px;
        }}
        .btn {{
            display: inline-block;
            background: linear-gradient(135deg, #fb923c 0%, #f59e0b 100%);
            color: #09090b !important;
            font-weight: 600;
            font-size: 14px;
            text-decoration: none;
            padding: 14px 30px;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(245, 158, 11, 0.25);
            transition: transform 0.2s;
            margin-bottom: 25px;
        }}
        .divider {{
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            margin: 30px 0;
        }}
        .fallback-text {{
            font-size: 12px;
            color: #71717a;
            word-break: break-all;
        }}
        .fallback-link {{
            color: #fb923c;
            text-decoration: none;
        }}
        .footer {{
            font-size: 12px;
            color: #52525b;
            margin-top: 20px;
        }}
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="container">
            <div class="logo">MarkType</div>
            <h1>You've been invited!</h1>
            <p><strong>{admin_name}</strong> has invited you to join the team <strong>"{team_name}"</strong> on MarkType.</p>
            <p>Once you join, you will be added to the team workspace automatically. Please click the button below to view the invitation and agree to the membership terms.</p>
            
            <a href="https://app.marktype.io/join?token={token}" class="btn">View Invitation</a>
            
            <div class="divider"></div>
            <p class="fallback-text">
                If the button doesn't work, copy and paste this link in your browser:<br>
                <a href="https://app.marktype.io/join?token={token}" class="fallback-link">https://app.marktype.io/join?token={token}</a>
            </p>
            <p class="fallback-text">
                Or open it directly in the MarkType desktop app via:<br>
                <a href="marktype://join?token={token}" class="fallback-link">marktype://join?token={token}</a>
            </p>
            <div class="footer">
                This invitation is valid for 7 days.
            </div>
        </div>
    </div>
</body>
</html>
"""

        resend_api_key = os.environ.get("RESEND_API_KEY")
        if not resend_api_key:
            print("[Invite] WARNING: RESEND_API_KEY not set. Skipping email delivery.")
            return {
                "status": "success",
                "inviteId": invite_id,
                "emailSent": False,
                "warning": "RESEND_API_KEY environment variable is not configured."
            }
            
        from_email = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")
        from_sender = f"MarkType <{from_email}>" if "<" not in from_email else from_email
        
        payload = {
            "from": from_sender,
            "to": [invitee_email],
            "subject": subject,
            "html": html_content
        }
        
        try:
            res = requests.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {resend_api_key}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=15
            )
            if res.status_code not in (200, 201):
                print(f"[Invite] Resend API error ({res.status_code}): {res.text}")
                return {
                    "status": "success",
                    "inviteId": invite_id,
                    "emailSent": False,
                    "error": f"Resend API returned status {res.status_code}"
                }
        except Exception as e:
            print(f"[Invite] Failed to connect to Resend API: {str(e)}")
            return {
                "status": "success",
                "inviteId": invite_id,
                "emailSent": False,
                "error": f"Connection to Resend failed: {str(e)}"
            }
            
        return {
            "status": "success",
            "inviteId": invite_id,
            "emailSent": True
        }

    @app.post("/join-team")
    async def join_team(request: Request):
        import datetime
        
        # Authenticate user
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        
        id_token = auth_header.split("Bearer ")[1]
        decoded = verify_id_token(id_token)
        uid = decoded.get("uid")
        user_email = decoded.get("email", "").lower()
        
        # Read payload
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body. Expected JSON.")
            
        token = body.get("token")
        if not token:
            raise HTTPException(status_code=400, detail="Missing token in request body.")
            
        # Get DB client
        init_firebase()
        from firebase_admin import firestore
        db = firestore.client()
        
        # 1. Find invite by token
        invites_snap = db.collection('invites').where('token', '==', token).where('status', '==', 'pending').limit(1).get()
        if not invites_snap:
            raise HTTPException(status_code=404, detail="Invalid or expired invitation token.")
            
        invite_ref = invites_snap[0].reference
        invite_data = invites_snap[0].to_dict()
        
        # 2. Verify invitee email matches current user email
        invited_email = invite_data.get("invitedEmail", "").lower()
        if invited_email != user_email:
            raise HTTPException(
                status_code=400, 
                detail=f"This invitation was sent to {invited_email}. Please switch accounts to join."
            )
            
        # 3. Check expiration
        expires_at = invite_data.get("expiresAt")
        if expires_at:
            now = datetime.datetime.now(datetime.timezone.utc)
            if expires_at.tzinfo is None:
                now = datetime.datetime.utcnow()
            if now > expires_at:
                invite_ref.update({"status": "expired"})
                raise HTTPException(status_code=400, detail="This invitation has expired.")
                
        team_id = invite_data.get("teamId")
        group_id = invite_data.get("groupId", "General")
        
        # 4. Fetch team
        team_ref = db.collection('teams').document(team_id)
        team_snap = team_ref.get()
        if not team_snap.exists:
            raise HTTPException(status_code=404, detail="The team for this invitation no longer exists.")
            
        team_data = team_snap.to_dict()
        members = team_data.get("members") or []
        if not isinstance(members, list):
            members = list(members.keys())
            
        if len(members) + 1 >= 10:
            raise HTTPException(status_code=400, detail="Team limit reached. Up to 10 seats allowed on Team Plan.")
            
        # 5. Perform the join operations
        # a. Add user to team members
        team_ref.update({
            "members": firestore.ArrayUnion([uid])
        })
        
        # b. Update user memberships
        user_ref = db.collection('users').document(uid)
        user_ref.update({
            "teamMemberships": firestore.ArrayUnion([team_id]),
            "teamId": team_id
        })
        
        # c. Create agreement document
        agreement_id = f"{team_id}_{uid}"
        agreement_ref = db.collection('agreements').document(agreement_id)
        agreement_ref.set({
            "teamId": team_id,
            "uid": uid,
            "signedAt": firestore.SERVER_TIMESTAMP,
            "agreementVersion": team_data.get("agreementVersion", 1),
            "agreementDocId": team_data.get("agreementDocId")
        })
        
        # d. Update invite status to accepted
        invite_ref.update({
            "status": "accepted",
            "acceptedAt": firestore.SERVER_TIMESTAMP,
            "joinedUid": uid
        })
        
        return {
            "status": "success",
            "teamId": team_id,
            "teamName": team_data.get("name")
        }

if not modal.is_local():
    setup_endpoints(web_app)

# ─── Shared Compaction Logic (using pycrdt) ──────────────────────────────────
def run_compaction(doc_id: str):
    init_firebase()
    from firebase_admin import firestore
    from pycrdt import Doc
    
    db = firestore.client()
    doc_ref = db.collection('cloud_documents').document(doc_id)
    updates_col = doc_ref.collection('updates')
    
    updates_snap = updates_col.order_by('createdAt', direction=firestore.Query.ASCENDING).get()
    if not updates_snap:
        return {"status": "no_updates"}
        
    doc_snap = doc_ref.get()
    doc_data = doc_snap.to_dict() if doc_snap.exists else {}
    
    base_y_state_b64 = doc_data.get('yState')
    base_y_state = base64.b64decode(base_y_state_b64) if base_y_state_b64 else None
    
    ydoc = Doc()
    if base_y_state:
        try:
            ydoc.apply_update(base_y_state)
        except Exception as e:
            print(f"Failed to apply base state to document {doc_id}, starting fresh: {e}")
            
    updates_to_delete = []
    for snap in updates_snap:
        data = snap.to_dict()
        update_b64 = data.get('update')
        if update_b64:
            try:
                update_bytes = base64.b64decode(update_b64)
                ydoc.apply_update(update_bytes)
                updates_to_delete.append(snap.reference)
            except Exception as e:
                print(f"Failed to apply update chunk {snap.id} on document {doc_id}: {e}")
                
    compacted_y_state = ydoc.encode_state_as_update()
    compacted_base64 = base64.b64encode(compacted_y_state).decode('utf-8')
    
    markdown_text = str(ydoc.get_text('markdown'))
    draft_text = str(ydoc.get_text('draft'))
    
    doc_ref.update({
        'yState': compacted_base64,
        'content': json.dumps({'markdown': markdown_text, 'draft': draft_text}),
        'updatedAt': firestore.SERVER_TIMESTAMP
    })
    
    # Batch delete compacted updates
    batch = db.batch()
    count = 0
    for ref in updates_to_delete:
        batch.delete(ref)
        count += 1
        if count == 400:
            batch.commit()
            batch = db.batch()
            count = 0
            
    if count > 0:
        batch.commit()
        
    return {"status": "compacted", "count": len(updates_to_delete)}

# ─── Modal ASGI Serving function ──────────────────────────────────────────────
@app.function(secrets=[firebase_secret, creem_secret, resend_secret])
@modal.asgi_app()
def fastapi_app():
    return web_app

# ─── Scheduled Cron Compaction on Modal ─────────────────────────────────────────
@app.function(schedule=modal.Cron("0 * * * *"), secrets=[firebase_secret])
def scheduled_compaction():
    init_firebase()
    from firebase_admin import firestore
    
    db = firestore.client()
    docs = db.collection('cloud_documents').get()
    
    compaction_threshold = 50
    print(f"Running scheduled compaction for {len(docs)} documents.")
    
    for doc_snap in docs:
        doc_id = doc_snap.id
        updates_ref = doc_snap.reference.collection('updates')
        
        # Get server-side document count
        try:
            res = updates_ref.count().get()
            count = res[0].value if res and hasattr(res[0], 'value') else len(updates_ref.get())
        except Exception:
            # Fallback in case of SDK version aggregation queries issues
            count = len(updates_ref.get())
            
        if count >= compaction_threshold:
            print(f"Auto-compacting {doc_id} ({count} updates)")
            try:
                run_compaction(doc_id)
            except Exception as e:
                print(f"Error auto-compacting document {doc_id}: {e}")

