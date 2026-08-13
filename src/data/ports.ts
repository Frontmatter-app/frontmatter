import type {
  AgreementDoc,
  CloudDocumentDoc,
  CreateTeamInput,
  FilePermissions,
  InviteDoc,
  TeamDoc,
  TeamGroupsMap,
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
  updateGroups(teamId: string, groups: TeamGroupsMap): Promise<void>;
  removeMember(teamId: string, uid: string): Promise<void>;
}

export interface UsersPort {
  get(uid: string): Promise<UserDoc | null>;
  /** Resolves several profiles at once, skipping any that are missing. */
  getMany(uids: string[]): Promise<UserDoc[]>;
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
  watchByToken(token: string, onChange: Watcher<InviteDoc>): Unsubscribe;
}

export interface DataPorts {
  teams: TeamsPort;
  users: UsersPort;
  cloudDocuments: CloudDocumentsPort;
  agreements: AgreementsPort;
  invites: InvitesPort;
}
