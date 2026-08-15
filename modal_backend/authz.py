"""Document access, resolved once and shared.

Mirrors `canReadDocumentData` / `canWriteDocumentResource` in firestore.rules.
The sync server and the asset endpoints both need exactly this decision, and
having one implementation means an asset can never be more reachable than the
document it belongs to.
"""
import modal

if not modal.is_local():
    from firebase_admin import firestore

from firebase import init_firebase


def document_access(uid: str, doc_id: str) -> tuple[bool, bool, dict]:
    """Returns `(can_read, can_write, document_data)`.

    A document with no `teamId` is personal: only its owner reaches it. A team
    document is reachable by the team owner, and by a member whose groups
    intersect `filePermissions.visibleTo` — or by any member when that list is
    absent, which means "unrestricted".
    """
    init_firebase()
    db = firestore.client()

    snap = db.collection('cloud_documents').document(doc_id).get()
    if not snap.exists:
        return False, False, {}
    data = snap.to_dict() or {}

    if data.get('ownerId') == uid:
        return True, True, data

    team_id = data.get('teamId')
    if not team_id:
        return False, False, data

    team_snap = db.collection('teams').document(team_id).get()
    if not team_snap.exists:
        return False, False, data
    if (team_snap.to_dict() or {}).get('ownerId') == uid:
        return True, True, data

    # Membership is the server-written record, never the caller's own profile.
    membership = (
        db.collection('teams').document(team_id)
        .collection('members').document(uid).get()
    )
    if not membership.exists:
        return False, False, data

    my_groups = set((membership.to_dict() or {}).get('groupIds') or [])
    perms = data.get('filePermissions') or {}
    visible_to = perms.get('visibleTo') or []
    writable_by = perms.get('writableBy') or []

    can_read = not visible_to or bool(my_groups.intersection(visible_to))
    can_write = can_read and (not writable_by or bool(my_groups.intersection(writable_by)))
    return can_read, can_write, data
