/**
 * Domain records exchanged across the data boundary.
 *
 * These are deliberately plain: no Firestore `DocumentSnapshot`, `Timestamp`,
 * or `FieldValue` leaks past this layer, so a consumer can be rendered in a
 * test against an in-memory fake.
 */

import type { TeamGroup, TeamGroupsMap } from '../auth/teamPermissions';

export type { TeamGroup, TeamGroupsMap };

export interface TeamDoc {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  members: string[];
  groups?: TeamGroupsMap;
  agreementDocId?: string;
  agreementVersion?: number;
  createdAt?: string;
}

export interface UserDoc {
  id: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  ownedTeamId?: string;
  teamId?: string | null;
  teamMemberships?: string[];
  /** Productivity metrics blob; shape is owned by the metrics feature. */
  metrics?: unknown;
}

/** Per-document access lists, keyed by team group id. */
export interface FilePermissions {
  visibleTo: string[];
  writableBy: string[];
  revisableBy: string[];
}

export interface CloudDocumentDoc {
  id: string;
  title?: string;
  path?: string;
  ownerId?: string;
  teamId?: string;
  /** Raw stored content; use `CloudDocumentsPort.getText` to read it as text. */
  content?: string;
  isAgreement?: boolean;
  filePermissions?: FilePermissions | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgreementDoc {
  teamId: string;
  uid: string;
  signedAt: string;
  agreementVersion: number;
  agreementDocId?: string;
}

/**
 * A team membership record: `teams/{teamId}/members/{uid}`.
 *
 * This document is what the security rules read to decide whether someone is on
 * a team and which groups they belong to. It is written only by the backend with
 * Admin credentials — membership used to be asserted by the member's own
 * `users/{uid}` record, which they can write.
 *
 * It carries display fields too, so the roster never needs to read other
 * people's user documents.
 */
export interface TeamMemberRecord {
  uid: string;
  groupIds: string[];
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface InviteDoc {
  id: string;
  token: string;
  teamId: string;
  email?: string;
  invitedBy?: string;
  createdAt?: string;
}

/**
 * What the invite landing page is allowed to know, resolved by the backend from
 * a token the invitee already holds.
 *
 * An invitee is not a team member yet, so they can read neither `invites` (now
 * backend-only) nor the `teams` and `cloud_documents` records this is assembled
 * from. Notably absent: the token itself, `invitedBy`, and the member list.
 */
export interface InviteDetails {
  teamId: string;
  teamName: string | null;
  invitedEmail: string;
  groupId: string | null;
  agreementVersion: number;
  agreementContent: string | null;
}

export interface CreateTeamInput {
  ownerId: string;
  name: string;
  description: string;
  agreementMarkdown: string;
}

/** Cancels a subscription. */
export type Unsubscribe = () => void;

/**
 * Receives the current value, or `null` when the record does not exist.
 * Errors are reported separately so a consumer can distinguish "absent" from
 * "could not load".
 */
export type Watcher<T> = (value: T | null, error?: Error) => void;
