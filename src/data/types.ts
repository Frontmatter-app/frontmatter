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

export interface InviteDoc {
  id: string;
  token: string;
  teamId: string;
  email?: string;
  invitedBy?: string;
  createdAt?: string;
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
