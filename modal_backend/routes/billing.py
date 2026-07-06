import modal
import os
import json
import asyncio

if modal.is_local():
    Request = None
    HTTPException = None
    HTMLResponse = None
else:
    from fastapi import Request, HTTPException
    from fastapi.responses import HTMLResponse
    from firebase_admin import firestore

from firebase import verify_id_token, verify_webhook_signature, init_firebase
from templates import CHECKOUT_SUCCESS


async def _firestore_call(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def setup_billing_routes(app):
    @app.post("/create-checkout")
    async def create_checkout(request: Request):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        id_token = auth_header.split("Bearer ")[1]
        decoded = await verify_id_token(id_token)
        uid = decoded.get("uid")
        email = decoded.get("email") or ""

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body. Expected JSON.")

        product_id = body.get("productId")
        if not product_id:
            raise HTTPException(status_code=400, detail="Missing productId in request body.")

        creem_api_key = os.environ.get("CREEM_API_KEY")
        if not creem_api_key:
            raise HTTPException(status_code=500, detail="CREEM_API_KEY is not set on the server.")

        is_test = creem_api_key.startswith("creem_test_")
        creem_base = "https://test-api.creem.io/v1" if is_test else "https://api.creem.io/v1"

        import httpx
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(
                    f"{creem_base}/checkouts",
                    headers={"x-api-key": creem_api_key, "Content-Type": "application/json"},
                    json={"product_id": product_id, "customer": {"email": email}, "metadata": {"userId": uid}, "success_url": f"{request.base_url}checkout-success"},
                    timeout=15,
                )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to connect to Creem: {str(e)}")

        if res.status_code not in (200, 201):
            raise HTTPException(status_code=res.status_code, detail=f"Creem Error: {res.text}")

        checkout_url = res.json().get("checkout_url")
        if not checkout_url:
            raise HTTPException(status_code=500, detail="Creem response missing checkout_url.")
        return {"url": checkout_url}

    @app.get("/checkout-success", response_class=HTMLResponse)
    async def checkout_success():
        return HTMLResponse(content=CHECKOUT_SUCCESS, status_code=200)

    @app.post("/create-portal")
    async def create_portal(request: Request):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        id_token = auth_header.split("Bearer ")[1]
        decoded = await verify_id_token(id_token)
        uid = decoded.get("uid")

        init_firebase()
        db = firestore.client()
        user_snap = await _firestore_call(db.collection('users').document(uid).get)
        if not user_snap.exists:
            raise HTTPException(status_code=404, detail="User document not found.")
        customer_id = user_snap.to_dict().get("creemCustomerId")
        if not customer_id:
            raise HTTPException(status_code=400, detail="Creem customer record not found.")

        creem_api_key = os.environ.get("CREEM_API_KEY")
        if not creem_api_key:
            raise HTTPException(status_code=500, detail="CREEM_API_KEY is not set.")
        is_test = creem_api_key.startswith("creem_test_")
        creem_base = "https://test-api.creem.io/v1" if is_test else "https://api.creem.io/v1"

        import httpx
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(
                    f"{creem_base}/customer-portal",
                    headers={"x-api-key": creem_api_key, "Content-Type": "application/json"},
                    json={"customer_id": customer_id},
                    timeout=15,
                )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to connect to Creem: {str(e)}")
        if res.status_code != 200:
            raise HTTPException(status_code=res.status_code, detail=f"Creem Error: {res.text}")

        portal = res.json().get("customerPortalLink")
        if not portal:
            raise HTTPException(status_code=500, detail="Creem response missing customerPortalLink.")
        return {"url": portal}

    @app.post("/webhook")
    async def webhook(request: Request):
        raw_body = await request.body()
        signature = request.headers.get("creem-signature")
        secret = os.environ.get("CREEM_WEBHOOK_SECRET")
        if secret and signature and not verify_webhook_signature(raw_body, signature, secret):
            raise HTTPException(status_code=401, detail="Invalid webhook signature.")

        try:
            payload = json.loads(raw_body.decode('utf-8'))
        except Exception:
            raise HTTPException(status_code=400, detail="Malformed JSON payload.")

        event_type = payload.get("eventType")
        event_data = payload.get("data") or payload.get("object") or {}

        init_firebase()
        db = firestore.client()

        author_prd = os.environ.get("VITE_CREEM_AUTHOR_PRD_ID") or os.environ.get("CREEM_AUTHOR_PRD_ID") or "prod_4sfr7PyPAbNGKb2ygpv3P8"
        team_prd = os.environ.get("VITE_CREEM_TEAM_PRD_ID") or os.environ.get("CREEM_TEAM_PRD_ID") or "prod_5v9ydeKW6XhjVJc5jJihRa"

        customer = event_data.get("customer") or {}
        customer_id = event_data.get("customerId") or customer.get("id")
        root_md = event_data.get("metadata") or {}
        cust_md = customer.get("metadata") or {}
        user_id = root_md.get("userId") or cust_md.get("userId")
        product = event_data.get("product") or {}
        product_id = event_data.get("productId") or (product.get("id") if isinstance(product, dict) else None) or event_data.get("product_id")
        status = event_data.get("status")

        active_events = ("checkout.completed", "subscription.paid", "subscription.active")

        if event_type in active_events:
            if not user_id and customer_id:
                users = await _firestore_call(db.collection('users').where('creemCustomerId', '==', customer_id).limit(1).get)
                if users:
                    user_id = users[0].id
            if user_id:
                plan = 'free'
                if product_id == team_prd:
                    plan = 'team'
                elif product_id == author_prd:
                    plan = 'author'
                user_ref = db.collection('users').document(user_id)
                snap = await _firestore_call(user_ref.get)
                update = {
                    'plan': plan,
                    'planStatus': 'active' if status in ('paid', 'active', 'completed') else status,
                    'creemCustomerId': customer_id,
                    'updatedAt': firestore.SERVER_TIMESTAMP,
                }
                if not snap.exists:
                    update['createdAt'] = firestore.SERVER_TIMESTAMP
                await _firestore_call(user_ref.set, update, merge=True)
        elif event_type in ("subscription.canceled", "subscription.updated", "subscription.expired", "subscription.past_due"):
            plan = 'free'
            if status == 'active':
                plan = 'team' if product_id == team_prd else ('author' if product_id == author_prd else 'free')
            user_ref = None
            if user_id:
                user_ref = db.collection('users').document(user_id)
            elif customer_id:
                users = await _firestore_call(db.collection('users').where('creemCustomerId', '==', customer_id).limit(1).get)
                if users:
                    user_ref = users[0].reference
            if user_ref:
                await _firestore_call(user_ref.update, {'plan': plan, 'planStatus': status, 'updatedAt': firestore.SERVER_TIMESTAMP})

        return {"status": "success"}
