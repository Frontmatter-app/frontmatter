import modal
import os
import datetime
import secrets
import asyncio

if modal.is_local():
    Request = None
    HTTPException = None
else:
    from fastapi import Request, HTTPException
    from firebase_admin import firestore

from firebase import verify_id_token, init_firebase
from templates import EMAIL_ADDED_TO_TEAM, EMAIL_INVITATION


async def send_email(to: str, subject: str, html: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        return False
    from_email = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")
    sender = f"MarkType <{from_email}>" if "<" not in from_email else from_email
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"from": sender, "to": [to], "subject": subject, "html": html},
                timeout=15,
            )
            return res.status_code in (200, 201)
    except Exception as e:
        print(f"[Invite] Resend error: {e}")
        return False


async def _firestore_call(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def setup_team_routes(app):
    @app.post("/invite-member")
    async def invite_member(request: Request):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        id_token = auth_header.split("Bearer ")[1]
        decoded = await verify_id_token(id_token)
        uid = decoded.get("uid")

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")

        invitee_email = body.get("email", "").strip().lower()
        team_id = body.get("teamId")
        group_id = body.get("groupId", "General")
        if not invitee_email or not team_id:
            raise HTTPException(status_code=400, detail="Missing email or teamId.")

        init_firebase()
        db = firestore.client()

        team_ref = db.collection('teams').document(team_id)
        team_snap = await _firestore_call(team_ref.get)
        if not team_snap.exists:
            raise HTTPException(status_code=404, detail="Team not found.")
        team_data = team_snap.to_dict()
        if team_data.get('ownerId') != uid:
            raise HTTPException(status_code=403, detail="Only the Team Owner can invite members.")

        members = team_data.get("members") or []
        if not isinstance(members, list):
            members = list(members.keys())
        if len(members) + 1 >= 10:
            raise HTTPException(status_code=400, detail="Team limit reached (10 seats).")

        inviter_snap = await _firestore_call(db.collection('users').document(uid).get)
        admin_name = (inviter_snap.to_dict().get('displayName') if inviter_snap.exists else None) or decoded.get('email') or 'Your Admin'
        team_name = team_data.get('name', 'MarkType Team')

        users_snap = await _firestore_call(db.collection('users').where('email', '==', invitee_email).limit(1).get)
        user_exists = len(users_snap) > 0
        invite_id = None

        if user_exists:
            target = users_snap[0]
            target_uid = target.id
            if target_uid == uid:
                raise HTTPException(status_code=400, detail="You cannot invite yourself.")
            if target_uid in members:
                return {"status": "success", "message": "User is already a member.", "addedDirectly": True, "emailSent": False}

            await _firestore_call(team_ref.update, {"members": firestore.ArrayUnion([target_uid])})
            await _firestore_call(target.reference.update, {"teamId": team_id})

            html = EMAIL_ADDED_TO_TEAM.format(admin_name=admin_name, team_name=team_name)
            sent = await send_email(invitee_email, f'You have been added to the team "{team_name}" on MarkType', html)
            return {"status": "success", "addedDirectly": True, "emailSent": sent}

        existing = await _firestore_call(db.collection('invites').where('teamId', '==', team_id).where('invitedEmail', '==', invitee_email).where('status', '==', 'pending').get)
        for snap in existing:
            await _firestore_call(snap.reference.update, {'status': 'revoked', 'updatedAt': firestore.SERVER_TIMESTAMP})

        token = secrets.token_urlsafe(32)
        expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=7)
        invite_ref = db.collection('invites').document()
        await _firestore_call(invite_ref.set, {
            "teamId": team_id, "teamName": team_name, "invitedEmail": invitee_email,
            "groupId": group_id, "invitedBy": uid, "createdAt": firestore.SERVER_TIMESTAMP,
            "expiresAt": expires_at, "status": "pending", "token": token,
        })
        invite_id = invite_ref.id

        html = EMAIL_INVITATION.format(admin_name=admin_name, team_name=team_name, token=token)
        sent = await send_email(invitee_email, f'{admin_name} has invited you to join {team_name} on MarkType', html)
        return {"status": "success", "inviteId": invite_id, "emailSent": sent}

    @app.post("/join-team")
    async def join_team(request: Request):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        id_token = auth_header.split("Bearer ")[1]
        decoded = await verify_id_token(id_token)
        uid = decoded.get("uid")
        user_email = decoded.get("email", "").lower()

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")
        token = body.get("token")
        if not token:
            raise HTTPException(status_code=400, detail="Missing token.")

        init_firebase()
        db = firestore.client()

        invites = await _firestore_call(db.collection('invites').where('token', '==', token).where('status', '==', 'pending').limit(1).get)
        if not invites:
            raise HTTPException(status_code=404, detail="Invalid or expired invitation token.")

        invite_ref = invites[0].reference
        invite_data = invites[0].to_dict()
        if invite_data.get("invitedEmail", "").lower() != user_email:
            raise HTTPException(status_code=400, detail=f"This invitation was sent to {invite_data.get('invitedEmail')}.")

        expires = invite_data.get("expiresAt")
        if expires:
            now = datetime.datetime.now(datetime.timezone.utc) if expires.tzinfo else datetime.datetime.utcnow()
            if now > expires:
                await _firestore_call(invite_ref.update, {"status": "expired"})
                raise HTTPException(status_code=400, detail="This invitation has expired.")

        team_id = invite_data.get("teamId")
        team_ref = db.collection('teams').document(team_id)
        team_snap = await _firestore_call(team_ref.get)
        if not team_snap.exists:
            raise HTTPException(status_code=404, detail="The team no longer exists.")
        team_data = team_snap.to_dict()
        members = team_data.get("members") or []
        if not isinstance(members, list):
            members = list(members.keys())
        if len(members) + 1 >= 10:
            raise HTTPException(status_code=400, detail="Team limit reached.")

        await _firestore_call(team_ref.update, {"members": firestore.ArrayUnion([uid])})
        await _firestore_call(db.collection('users').document(uid).update, {"teamMemberships": firestore.ArrayUnion([team_id]), "teamId": team_id})

        agreement_id = f"{team_id}_{uid}"
        await _firestore_call(db.collection('agreements').document(agreement_id).set, {
            "teamId": team_id, "uid": uid, "signedAt": firestore.SERVER_TIMESTAMP,
            "agreementVersion": team_data.get("agreementVersion", 1), "agreementDocId": team_data.get("agreementDocId"),
        })

        await _firestore_call(invite_ref.update, {"status": "accepted", "acceptedAt": firestore.SERVER_TIMESTAMP, "joinedUid": uid})
        return {"status": "success", "teamId": team_id, "teamName": team_data.get("name")}
