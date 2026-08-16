/**
 * Cloud documents — currently unavailable, deliberately.
 *
 * Documents used to live in Firestore, as a `cloud_documents` record holding
 * the markdown in a JSON envelope. Firestore is gone, and its replacement is
 * not another database: **a document is a file in a git repository.** That
 * lands with git-backed rooms; until then there is no cloud document store, and
 * this module says so rather than pretending.
 *
 * It exists as a seam rather than as deleted code because the explorer, the
 * workspace layer and the CRDT sync all branch on cloud-versus-local, and
 * tearing that branching out now would be a large diff immediately re-added by
 * the git-backed implementation. When that arrives, this file is where it goes:
 * same signatures, backed by a repository instead of a collection.
 *
 * Everything local is untouched — files on disk, the SQLite index, git,
 * publishing, and live collaboration on a room all work.
 */
import type { CloudFolderMeta, DocumentMeta } from '../types';

/** True once documents can be read from and written to a git repository. */
export const CLOUD_DOCUMENTS_AVAILABLE = false;

export const CLOUD_DOCUMENTS_UNAVAILABLE_MESSAGE =
  'Cloud documents are moving to your git repository and are not available in this build. Local files are unaffected.';

function unavailable(): never {
  throw new Error(CLOUD_DOCUMENTS_UNAVAILABLE_MESSAGE);
}

/** No-op subscription: reports an empty set once, then nothing. */
function emptySubscription<T>(onChange: (items: T[]) => void): () => void {
  onChange([]);
  return () => {};
}

export function subscribeToCloudDocuments(
  _uid: string,
  _teamId: string | null,
  _scope: { isTeamOwner: boolean; myGroupIds: string[] },
  onChange: (documents: DocumentMeta[]) => void,
): () => void {
  return emptySubscription(onChange);
}

export function subscribeToCloudFolders(
  _uid: string,
  _teamId: string | null,
  onChange: (folders: CloudFolderMeta[]) => void,
): () => void {
  return emptySubscription(onChange);
}

/** Resolves to null: no cloud document exists, rather than an error state. */
export async function fetchCloudDocument(_docId: string): Promise<DocumentMeta | null> {
  return null;
}

// Writes throw rather than failing silently. A silent no-op on save is how
// people lose work; an error surfaces in the UI and is recoverable.
export async function pushCloudDocument(
  _document: DocumentMeta,
  _uid: string,
  _teamId: string | null,
  _path: string,
): Promise<void> {
  unavailable();
}

export async function deleteCloudDocument(_docId: string): Promise<void> {
  unavailable();
}

export async function createCloudFolder(
  _path: string,
  _uid: string,
  _teamId?: string | null,
): Promise<void> {
  unavailable();
}

export async function deleteCloudFolder(
  _path: string,
  _uid: string,
  _teamId?: string | null,
): Promise<void> {
  unavailable();
}

export async function moveCloudDocument(_docId: string, _newPath: string): Promise<void> {
  unavailable();
}

export function cloudFolderId(path: string, uid: string, teamId?: string | null): string {
  return `${teamId || uid}:${encodeURIComponent(path)}`;
}
