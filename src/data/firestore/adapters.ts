import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../auth/firebase';
import { deriveReadableBy } from '../../cloud/readableBy';
import { backendCall } from './backendCall';
import { unwrapContent } from '../fakes';
import type {
  AgreementsPort,
  CloudDocumentsPort,
  DataPorts,
  InvitesPort,
  TeamsPort,
  UsersPort,
} from '../ports';
import type {
  AgreementDoc,
  CloudDocumentDoc,
  InviteDetails,
  TeamDoc,
  UserDoc,
  Watcher,
} from '../types';

/**
 * Firestore implementations of the data ports.
 *
 * This is the only place outside `auth/` and `cloud/` that imports
 * `firebase/firestore`. Snapshots are converted to plain records here so
 * nothing downstream has to know about Firestore at all.
 */

const TEAMS = 'teams';
const MEMBERS = 'members';
const USERS = 'users';
const CLOUD_DOCUMENTS = 'cloud_documents';
const AGREEMENTS = 'agreements';

/** Bridges a Firestore document subscription to a plain `Watcher`. */
function watchDoc<T>(path: [string, string], onChange: Watcher<T>) {
  return onSnapshot(
    doc(db, path[0], path[1]),
    (snap) => onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null),
    (error) => onChange(null, error as Error),
  );
}

async function readDoc<T>(collectionName: string, id: string): Promise<T | null> {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null;
}

const teams: TeamsPort = {
  get: (teamId) => readDoc<TeamDoc>(TEAMS, teamId),

  watch: (teamId, onChange) => watchDoc<TeamDoc>([TEAMS, teamId], onChange),

  async create(input) {
    // Server-side: the owner's membership record is Admin-only, `ownedTeamId`
    // and `teamMemberships` are no longer client-writable, and the four writes
    // now commit as one batch instead of three unrolled-back `setDoc`s.
    const result = await backendCall<{ teamId: string }>('/create-team', {
      name: input.name,
      description: input.description,
      agreementMarkdown: input.agreementMarkdown,
    });
    return result.teamId;
  },

  async listMembers(teamId) {
    // Roster data comes from the team's own membership records, not from each
    // member's users/{uid} document. Those are self-readable only now — reading
    // them exposed every account's email, plan, and Creem customer id to anyone
    // signed in.
    const snapshot = await getDocs(collection(db, TEAMS, teamId, MEMBERS));
    return snapshot.docs.map((memberDoc) => {
      const data = memberDoc.data();
      return {
        uid: memberDoc.id,
        groupIds: (data.groupIds as string[]) ?? [],
        displayName: (data.displayName as string) ?? null,
        email: (data.email as string) ?? null,
        photoURL: (data.photoURL as string) ?? null,
      };
    });
  },

  async listMemberMetrics(teamId) {
    const result = await backendCall<{ metrics: Record<string, unknown | null> }>(
      '/team-metrics',
      { teamId },
    );
    return result.metrics ?? {};
  },

  async updateGroups(teamId, groups) {
    // Goes through the backend so the per-member `groupIds` on the membership
    // records move with the group map. The rules read group membership only from
    // there, so writing `teams/{id}.groups` alone would not take effect.
    await backendCall('/set-member-groups', { teamId, groups });
  },

  async removeMember(teamId, uid) {
    // Was two client writes, the second of which — clearing the removed user's
    // own record — the rules denied. Revocation half-applied and the member kept
    // access through their still-populated `teamMemberships`.
    await backendCall('/remove-member', { teamId, uid });
  },
};

const users: UsersPort = {
  get: (uid) => readDoc<UserDoc>(USERS, uid),
};

const cloudDocuments: CloudDocumentsPort = {
  get: (documentId) => readDoc<CloudDocumentDoc>(CLOUD_DOCUMENTS, documentId),

  async getText(documentId) {
    const record = await readDoc<CloudDocumentDoc>(CLOUD_DOCUMENTS, documentId);
    return record ? unwrapContent(record.content) : null;
  },

  async getFilePermissions(documentId) {
    const record = await readDoc<CloudDocumentDoc>(CLOUD_DOCUMENTS, documentId);
    return record?.filePermissions ?? null;
  },

  async setFilePermissions(documentId, permissions) {
    const record = await readDoc<CloudDocumentDoc>(CLOUD_DOCUMENTS, documentId);
    await updateDoc(doc(db, CLOUD_DOCUMENTS, documentId), {
      // deleteField() removes the key entirely, which is what "unrestricted"
      // means to the security rules.
      filePermissions: permissions ?? deleteField(),
      // The query index has to move with the permissions in the same write:
      // the rules reject an update whose index disagrees with its file
      // permissions, and a lagging index would drop the document out of every
      // member's listener.
      readableBy: deriveReadableBy(record?.ownerId, permissions?.visibleTo),
    });
  },
};

const agreements: AgreementsPort = {
  watch: (teamId, uid, onChange) =>
    watchDoc<AgreementDoc>([AGREEMENTS, `${teamId}_${uid}`], onChange),

  async sign(agreement) {
    await setDoc(doc(db, AGREEMENTS, `${agreement.teamId}_${agreement.uid}`), agreement);
  },
};

const invites: InvitesPort = {
  // Not a Firestore read: `invites` is backend-only now, because the token in each
  // row is the join flow's bearer secret and the collection was world-readable.
  async getByToken(token) {
    const baseUrl = import.meta.env.VITE_MODAL_BASE_URL || '';
    if (!baseUrl) throw new Error('VITE_MODAL_BASE_URL is not configured.');

    const res = await fetch(`${baseUrl}/invite-details/${encodeURIComponent(token)}`);
    if (!res.ok) {
      // The backend distinguishes unknown (404) from used/expired (410); both
      // carry a message meant for the invitee.
      const detail = await res
        .json()
        .then((body) => body?.detail)
        .catch(() => null);
      throw new Error(detail || 'This invitation link is no longer valid.');
    }
    return (await res.json()) as InviteDetails;
  },
};

export const firestorePorts: DataPorts = {
  teams,
  users,
  cloudDocuments,
  agreements,
  invites,
};
