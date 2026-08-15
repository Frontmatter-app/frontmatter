import modal
import os
import json
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
    sender = f"Frontmatter <{from_email}>" if "<" not in from_email else from_email
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


async def write_membership(db, team_id: str, member_uid: str, group_id: str | None, profile: dict | None = None):
    """Creates the membership record the security rules read.

    `teams/{teamId}/members/{uid}` is the single source of truth for "is this
    person on this team, and which groups are they in". It is written only here,
    with Admin credentials — membership used to be asserted by the caller's own
    users/{uid} document, which the caller can write.

    It also carries the display name and photo so the team roster never has to
    read other people's user records.
    """
    profile = profile or {}
    await _firestore_call(
        db.collection('teams').document(team_id).collection('members').document(member_uid).set,
        {
            "uid": member_uid,
            "groupIds": [group_id] if group_id else [],
            "displayName": profile.get("displayName"),
            "email": profile.get("email"),
            "photoURL": profile.get("photoURL"),
            "joinedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


async def remove_membership(db, team_id: str, member_uid: str):
    """Revokes membership, clearing every place it is recorded.

    Removal used to be attempted from the owner's browser, where the write to the
    removed member's users/{uid} document was denied by the rules — so the member
    kept access through their own still-populated `teamMemberships`.
    """
    await _firestore_call(
        db.collection('teams').document(team_id).collection('members').document(member_uid).delete
    )
    await _firestore_call(
        db.collection('teams').document(team_id).update,
        {"members": firestore.ArrayRemove([member_uid])},
    )

    user_ref = db.collection('users').document(member_uid)
    user_snap = await _firestore_call(user_ref.get)
    if user_snap.exists:
        updates = {"teamMemberships": firestore.ArrayRemove([team_id])}
        if (user_snap.to_dict() or {}).get("teamId") == team_id:
            updates["teamId"] = None
        await _firestore_call(user_ref.update, updates)


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
        team_name = team_data.get('name', 'Frontmatter Team')

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
            await _firestore_call(target.reference.update, {
                "teamId": team_id,
                "teamMemberships": firestore.ArrayUnion([team_id]),
            })
            await write_membership(db, team_id, target_uid, group_id, target.to_dict() or {})

            html = EMAIL_ADDED_TO_TEAM.format(admin_name=admin_name, team_name=team_name)
            sent = await send_email(invitee_email, f'You have been added to the team "{team_name}" on Frontmatter', html)
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
        sent = await send_email(invitee_email, f'{admin_name} has invited you to join {team_name} on Frontmatter', html)
        return {"status": "success", "inviteId": invite_id, "emailSent": sent}

    @app.get("/invite-details/{token}")
    async def invite_details(token: str):
        """Everything the invite landing page needs, keyed by the token the invitee
        already holds.

        Replaces a direct client read of `invites`, which required
        `allow read: if true` — i.e. public enumeration of every invitee email and
        every live token. It also returns the team name and agreement text, which
        an invitee can never read directly: they are not a team member yet, so the
        `teams` and `cloud_documents` rules both deny them.

        Deliberately omits `token`, `invitedBy`, and the team's member list.
        """
        init_firebase()
        db = firestore.client()

        invites = await _firestore_call(
            db.collection('invites').where('token', '==', token).limit(1).get
        )
        if not invites:
            raise HTTPException(status_code=404, detail="Invalid or expired invitation link.")

        invite_data = invites[0].to_dict() or {}
        if invite_data.get("status") != "pending":
            raise HTTPException(status_code=410, detail="This invitation has already been used.")

        expires = invite_data.get("expiresAt")
        if expires:
            now = datetime.datetime.now(datetime.timezone.utc) if expires.tzinfo else datetime.datetime.utcnow()
            if now > expires:
                raise HTTPException(status_code=410, detail="This invitation has expired.")

        team_id = invite_data.get("teamId")
        team_snap = await _firestore_call(db.collection('teams').document(team_id).get)
        if not team_snap.exists:
            raise HTTPException(status_code=404, detail="The team no longer exists.")
        team_data = team_snap.to_dict() or {}

        agreement_content = None
        agreement_doc_id = team_data.get("agreementDocId")
        if agreement_doc_id:
            agreement_snap = await _firestore_call(
                db.collection('cloud_documents').document(agreement_doc_id).get
            )
            if agreement_snap.exists:
                raw = (agreement_snap.to_dict() or {}).get("content") or ""
                try:
                    agreement_content = json.loads(raw).get("markdown", "")
                except Exception:
                    agreement_content = raw

        return {
            "teamId": team_id,
            "teamName": team_data.get("name"),
            "invitedEmail": invite_data.get("invitedEmail"),
            "groupId": invite_data.get("groupId"),
            "agreementVersion": team_data.get("agreementVersion", 1),
            "agreementContent": agreement_content,
        }

    @app.post("/create-team")
    async def create_team(request: Request):
        """Creates a team, its agreement document, and the owner's membership row.

        This ran client-side as three unbatched writes with no rollback, and the
        owner's membership row cannot be written from the client at all — those
        records are the proof the security rules read, so they are Admin-only.
        Doing it here also lets the whole thing commit atomically.
        """
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        decoded = await verify_id_token(auth_header.split("Bearer ")[1])
        uid = decoded.get("uid")

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")

        name = (body.get("name") or "").strip()
        description = (body.get("description") or "").strip()
        agreement_markdown = body.get("agreementMarkdown") or ""
        if not name:
            raise HTTPException(status_code=400, detail="Missing team name.")

        init_firebase()
        db = firestore.client()

        user_ref = db.collection('users').document(uid)
        user_snap = await _firestore_call(user_ref.get)
        user_data = (user_snap.to_dict() or {}) if user_snap.exists else {}
        if user_data.get('plan') not in ('team', 'enterprise') or \
                user_data.get('planStatus') not in ('active', 'completed'):
            raise HTTPException(status_code=403, detail="An active Team plan is required to create a team.")

        team_ref = db.collection('teams').document()
        team_id = team_ref.id
        agreement_ref = db.collection('cloud_documents').document()

        batch = db.batch()
        batch.set(agreement_ref, {
            "id": agreement_ref.id,
            "ownerId": uid,
            "teamId": team_id,
            "path": "agreement",
            "title": "Agreement",
            "content": json.dumps({"markdown": agreement_markdown}),
            "stage": "draft",
            "focusMode": False,
            "isAgreement": True,
            # Must agree with the document's (absent) filePermissions, or the
            # rules reject it. The client path omitted this and always failed.
            "readableBy": ["*", uid],
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        batch.set(team_ref, {
            "ownerId": uid,
            "name": name,
            "description": description,
            "agreementDocId": agreement_ref.id,
            "agreementVersion": 1,
            "members": [],
            "groups": {},
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        batch.set(team_ref.collection('members').document(uid), {
            "uid": uid,
            "groupIds": [],
            "displayName": user_data.get("displayName") or decoded.get("name"),
            "email": user_data.get("email") or decoded.get("email"),
            "photoURL": user_data.get("photoURL") or decoded.get("picture"),
            "joinedAt": firestore.SERVER_TIMESTAMP,
        })
        batch.set(user_ref, {
            "ownedTeamId": team_id,
            "teamId": team_id,
            "teamMemberships": firestore.ArrayUnion([team_id]),
        }, merge=True)

        await _firestore_call(batch.commit)
        return {"status": "success", "teamId": team_id, "agreementDocId": agreement_ref.id}

    @app.post("/team-metrics")
    async def team_metrics(request: Request):
        """Per-member productivity metrics, for the team owner's activity monitor.

        Metrics live on users/{uid}, which is self-readable only — reading other
        people's user documents also exposed their plan and Creem customer id.
        This returns just the metrics, and only to the team's owner.
        """
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        decoded = await verify_id_token(auth_header.split("Bearer ")[1])
        uid = decoded.get("uid")

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")
        team_id = body.get("teamId")
        if not team_id:
            raise HTTPException(status_code=400, detail="Missing teamId.")

        init_firebase()
        db = firestore.client()

        team_ref = db.collection('teams').document(team_id)
        team_snap = await _firestore_call(team_ref.get)
        if not team_snap.exists:
            raise HTTPException(status_code=404, detail="Team not found.")
        if (team_snap.to_dict() or {}).get('ownerId') != uid:
            raise HTTPException(status_code=403, detail="Only the team owner can view team metrics.")

        members = await _firestore_call(team_ref.collection('members').get)
        out = {}
        for snap in members:
            user_snap = await _firestore_call(db.collection('users').document(snap.id).get)
            out[snap.id] = (user_snap.to_dict() or {}).get('metrics') if user_snap.exists else None
        return {"metrics": out}

    @app.post("/remove-member")
    async def remove_member(request: Request):
        """Team-owner-only membership revocation.

        This ran client-side before, where the write clearing the removed user's
        own record was denied by the rules — so revocation silently half-applied
        and the member kept access.
        """
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        decoded = await verify_id_token(auth_header.split("Bearer ")[1])
        uid = decoded.get("uid")

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")
        team_id = body.get("teamId")
        member_uid = body.get("uid")
        if not team_id or not member_uid:
            raise HTTPException(status_code=400, detail="Missing teamId or uid.")

        init_firebase()
        db = firestore.client()

        team_snap = await _firestore_call(db.collection('teams').document(team_id).get)
        if not team_snap.exists:
            raise HTTPException(status_code=404, detail="Team not found.")
        if (team_snap.to_dict() or {}).get('ownerId') != uid:
            raise HTTPException(status_code=403, detail="Only the team owner can remove members.")
        if member_uid == uid:
            raise HTTPException(status_code=400, detail="The team owner cannot be removed.")

        await remove_membership(db, team_id, member_uid)
        return {"status": "success"}

    @app.post("/set-member-groups")
    async def set_member_groups(request: Request):
        """Keeps `teams/{id}/members/{uid}.groupIds` in step with the team's group
        map, which the owner edits client-side. The rules read group membership
        only from here, so a group edit that did not land here would not take."""
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
        decoded = await verify_id_token(auth_header.split("Bearer ")[1])
        uid = decoded.get("uid")

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body.")
        team_id = body.get("teamId")
        groups = body.get("groups")
        if not team_id or not isinstance(groups, dict):
            raise HTTPException(status_code=400, detail="Missing teamId or groups.")

        init_firebase()
        db = firestore.client()

        team_ref = db.collection('teams').document(team_id)
        team_snap = await _firestore_call(team_ref.get)
        if not team_snap.exists:
            raise HTTPException(status_code=404, detail="Team not found.")
        if (team_snap.to_dict() or {}).get('ownerId') != uid:
            raise HTTPException(status_code=403, detail="Only the team owner can change groups.")

        # Invert the group map into per-member group id lists.
        by_member: dict[str, list[str]] = {}
        for group_id, group in groups.items():
            for member_uid in (group or {}).get('members', []) or []:
                by_member.setdefault(member_uid, []).append(group_id)

        members_col = team_ref.collection('members')
        existing = await _firestore_call(members_col.get)
        batch = db.batch()
        for snap in existing:
            batch.update(snap.reference, {"groupIds": by_member.get(snap.id, [])})
        await _firestore_call(batch.commit)

        await _firestore_call(team_ref.update, {"groups": groups})
        return {"status": "success", "updated": len(existing)}

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

        # The invite must have been issued by the team's own owner. Without this,
        # anyone who could create an `invites` row could mint a self-addressed
        # invitation to any team and join it durably.
        if invite_data.get("invitedBy") != team_data.get("ownerId"):
            raise HTTPException(status_code=403, detail="This invitation was not issued by the team owner.")

        members = team_data.get("members") or []
        if not isinstance(members, list):
            members = list(members.keys())
        if len(members) + 1 >= 10:
            raise HTTPException(status_code=400, detail="Team limit reached.")

        await _firestore_call(team_ref.update, {"members": firestore.ArrayUnion([uid])})
        await _firestore_call(db.collection('users').document(uid).update, {"teamMemberships": firestore.ArrayUnion([team_id]), "teamId": team_id})
        await write_membership(db, team_id, uid, invite_data.get("groupId"), {
            "displayName": decoded.get("name"),
            "email": decoded.get("email"),
            "photoURL": decoded.get("picture"),
        })

        agreement_id = f"{team_id}_{uid}"
        await _firestore_call(db.collection('agreements').document(agreement_id).set, {
            "teamId": team_id, "uid": uid, "signedAt": firestore.SERVER_TIMESTAMP,
            "agreementVersion": team_data.get("agreementVersion", 1), "agreementDocId": team_data.get("agreementDocId"),
        })

        await _firestore_call(invite_ref.update, {"status": "accepted", "acceptedAt": firestore.SERVER_TIMESTAMP, "joinedUid": uid})
        return {"status": "success", "teamId": team_id, "teamName": team_data.get("name")}
