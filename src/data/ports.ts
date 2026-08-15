import type {
  AgreementDoc,
  CloudDocumentDoc,
  CreateTeamInput,
  FilePermissions,
  InviteDetails,
  TeamDoc,
  TeamGroupsMap,
  TeamMemberRecord,
  Unsubscribe,
  UserDoc,
  Watcher,
} from './types';

/**
 * The application's data boundary.
 *
 * Every port is an interface with at least two implementations: the Firestore
 * one used at runtime, and an in-memory fake used by tests. UI components
 * depend on these types, never on `firebase/firestore`, which is what makes
 * them renderable without a network or a live project.
 */

export interface TeamsPort {
  get(teamId: string): Promise<TeamDoc | null>;
  watch(teamId: string, onChange: Watcher<TeamDoc>): Unsubscribe;
  create(input: CreateTeamInput): Promise<string>;
  /**
   * The team's roster, read from its membership records.
   *
   * Use this rather than `users.getMany` for anything team-shaped: user
   * documents are self-readable only, and these records carry the display
   * fields a roster needs alongside each member's group ids.
   */
  listMembers(teamId: string): Promise<TeamMemberRecord[]>;
  /**
   * Per-member productivity metrics, keyed by uid. Team owners only — metrics
   * live on self-readable user documents, so this is resolved by the backend.
   */
  listMemberMetrics(teamId: string): Promise<Record<string, unknown | null>>;
  /** Rewrites the group map and the per-member `groupIds` together, via the backend. */
  updateGroups(teamId: string, groups: TeamGroupsMap): Promise<void>;
  /** Revokes membership everywhere it is recorded, via the backend. */
  removeMember(teamId: string, uid: string): Promise<void>;
}

export interface UsersPort {
  /** Only the signed-in user's own profile is readable. */
  get(uid: string): Promise<UserDoc | null>;
}

export interface CloudDocumentsPort {
  get(documentId: string): Promise<CloudDocumentDoc | null>;
  /**
   * Reads a document's body as plain text.
   *
   * Stored content may be a JSON envelope with a `markdown` field or a raw
   * string; unwrapping it is this layer's job, not the caller's.
   */
  getText(documentId: string): Promise<string | null>;
  getFilePermissions(documentId: string): Promise<FilePermissions | null>;
  /** Passing `null` clears the permissions and makes the document unrestricted. */
  setFilePermissions(documentId: string, permissions: FilePermissions | null): Promise<void>;
}

export interface AgreementsPort {
  watch(teamId: string, uid: string, onChange: Watcher<AgreementDoc>): Unsubscribe;
  sign(agreement: AgreementDoc): Promise<void>;
}

export interface InvitesPort {
  /**
   * Resolves an invitation from its token via the backend.
   *
   * This was a Firestore listener, which required `allow read: if true` on the
   * whole `invites` collection — public enumeration of every invitee email and
   * every live token. A one-shot read is also all the landing page ever needed:
   * an invite does not change while it is being looked at.
   *
   * Rejects with a message suitable for display when the token is unknown,
   * already used, or expired.
   */
  getByToken(token: string): Promise<InviteDetails>;
}

export interface DataPorts {
  teams: TeamsPort;
  users: UsersPort;
  cloudDocuments: CloudDocumentsPort;
  agreements: AgreementsPort;
  invites: InvitesPort;
}
