import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../auth/firebase';
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
  InviteDoc,
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
const USERS = 'users';
const CLOUD_DOCUMENTS = 'cloud_documents';
const AGREEMENTS = 'agreements';
const INVITES = 'invites';

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
    const teamId = doc(collection(db, TEAMS)).id;
    const agreementDocId = doc(collection(db, CLOUD_DOCUMENTS)).id;
    const now = new Date().toISOString();

    await setDoc(doc(db, CLOUD_DOCUMENTS, agreementDocId), {
      id: agreementDocId,
      ownerId: input.ownerId,
      teamId,
      path: 'agreement',
      title: 'Agreement',
      content: JSON.stringify({ markdown: input.agreementMarkdown }),
      stage: 'draft',
      focusMode: false,
      isAgreement: true,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, TEAMS, teamId), {
      ownerId: input.ownerId,
      name: input.name,
      description: input.description,
      agreementDocId,
      agreementVersion: 1,
      members: [],
      createdAt: now,
    });

    await setDoc(
      doc(db, USERS, input.ownerId),
      { ownedTeamId: teamId, teamMemberships: arrayUnion(teamId), teamId },
      { merge: true },
    );

    return teamId;
  },

  async updateGroups(teamId, groups) {
    await updateDoc(doc(db, TEAMS, teamId), { groups });
  },

  async removeMember(teamId, uid) {
    await updateDoc(doc(db, TEAMS, teamId), { members: arrayRemove(uid) });
    await updateDoc(doc(db, USERS, uid), {
      teamId: null,
      teamMemberships: arrayRemove(teamId),
    });
  },
};

const users: UsersPort = {
  get: (uid) => readDoc<UserDoc>(USERS, uid),

  async getMany(uids) {
    const results = await Promise.all(uids.map((uid) => readDoc<UserDoc>(USERS, uid)));
    return results.filter((u): u is UserDoc => u !== null);
  },
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
    await updateDoc(doc(db, CLOUD_DOCUMENTS, documentId), {
      // deleteField() removes the key entirely, which is what "unrestricted"
      // means to the security rules.
      filePermissions: permissions ?? deleteField(),
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
  watchByToken(token, onChange) {
    return onSnapshot(
      query(collection(db, INVITES), where('token', '==', token)),
      (snapshot) => {
        const first = snapshot.docs[0];
        onChange(first ? ({ id: first.id, ...first.data() } as InviteDoc) : null);
      },
      (error) => onChange(null, error as Error),
    );
  },
};

export const firestorePorts: DataPorts = {
  teams,
  users,
  cloudDocuments,
  agreements,
  invites,
};
