import {
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../auth/firebase';
import { CloudFolderMeta, DocumentMeta } from '../types';

export const CLOUD_DOCUMENTS_COL = 'cloud_documents';
export const CLOUD_FOLDERS_COL = 'cloud_folders';

export interface CloudDocumentData {
  id: string;
  ownerId: string;
  teamId: string | null;
  path: string;          // folder path in the cloud tree, e.g. "chapter1/intro"
  title: string;
  content: string;
  stage: 'draft' | 'write' | 'revise';
  focusMode: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface CloudFolderData {
  id: string;
  ownerId: string;
  teamId: string | null;
  path: string;
  createdAt: any;
  updatedAt: any;
}

// Convert Firestore doc to DocumentMeta
export function mapFirestoreDoc(data: any): DocumentMeta {
  return {
    id: data.id,
    title: data.title || 'Untitled',
    content: data.content || '',
    stage: data.stage || 'draft',
    focus_mode: data.focusMode || false,
    cloud_path: data.path || '',
    cloud_id: data.id,
    is_cloud: true,
    created_at: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
    updated_at: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : new Date().toISOString(),
    word_count: 0,
    excerpt: undefined,
    file_created_at: undefined,
  };
}

export function mapFirestoreFolder(data: any): CloudFolderMeta {
  return {
    id: data.id,
    ownerId: data.ownerId,
    teamId: data.teamId || null,
    path: data.path || '',
    created_at: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
    updated_at: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : new Date().toISOString(),
  };
}

export async function ensureCloudDocumentExists(docId: string, uid: string, teamId?: string | null): Promise<void> {
  const docRef = doc(db, CLOUD_DOCUMENTS_COL, docId);
  const currentDoc = await getDoc(docRef);
  if (!currentDoc.exists()) {
    await setDoc(docRef, {
      id: docId,
      ownerId: uid,
      teamId: teamId || null,
      title: '',
      content: '',
      stage: 'write',
      focusMode: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

// Push local doc changes to Firestore (sync, not move — local copy stays)
export async function pushCloudDocument(
  docMeta: DocumentMeta,
  uid: string,
  teamId?: string | null,
  cloudPath?: string,
): Promise<void> {
  try {
    await ensureCloudDocumentExists(docMeta.id, uid, teamId);
    const docRef = doc(db, CLOUD_DOCUMENTS_COL, docMeta.id);
    const updateData: any = {
      title: docMeta.title,
      content: docMeta.content,
      stage: docMeta.stage,
      focusMode: docMeta.focus_mode,
      updatedAt: serverTimestamp(),
    };
    const resolvedPath = cloudPath ?? docMeta.cloud_path;
    if (resolvedPath !== undefined) {
      updateData.path = resolvedPath;
    }
    await setDoc(docRef, updateData, { merge: true });
  } catch (error: any) {
    if (error?.code !== 'permission-denied') {
      console.error('Failed to push document to cloud:', error);
      throw error;
    }
  }
}

export async function createCloudFolder(
  path: string,
  uid: string,
  teamId?: string | null,
): Promise<void> {
  const normalizedPath = path.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedPath) return;

  const folderId = `${teamId || uid}:${encodeURIComponent(normalizedPath)}`;
  const docRef = doc(db, CLOUD_FOLDERS_COL, folderId);
  await setDoc(docRef, {
    id: folderId,
    ownerId: uid,
    teamId: teamId || null,
    path: normalizedPath,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Hard-delete a cloud document (removes from Firestore entirely)
export async function deleteCloudDocument(docId: string): Promise<void> {
  try {
    const docRef = doc(db, CLOUD_DOCUMENTS_COL, docId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('Failed to delete document from cloud:', error);
    throw error;
  }
}

// Subscribe to both owned documents and team documents depending on context
export function subscribeToCloudDocuments(
  uid: string,
  teamId: string | null,
  options: {
    isTeamOwner?: boolean;
    myGroupIds?: string[];
  } = {},
  onUpdate: (docs: DocumentMeta[]) => void
): () => void {
  const collRef = collection(db, CLOUD_DOCUMENTS_COL);
  const docsMap = new Map<string, DocumentMeta>();
  const unsubs: Array<() => void> = [];

  const attachListener = (q: any) => {
    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          docsMap.delete(change.doc.id);
        } else {
          docsMap.set(change.doc.id, mapFirestoreDoc({ ...change.doc.data(), id: change.doc.id }));
        }
      });
      onUpdate(Array.from(docsMap.values()));
    }, (err) => {
      console.warn('Failed to listen to cloud documents:', err);
    });
    unsubs.push(unsub);
  };

  if (teamId) {
    if (options.isTeamOwner) {
      // Team owners can read the whole team workspace.
      attachListener(query(collRef, where('teamId', '==', teamId)));
    } else {
      // Members can only listen to docs they can actually read.
      attachListener(query(collRef, where('teamId', '==', teamId), where('ownerId', '==', uid)));
      attachListener(query(collRef, where('teamId', '==', teamId), where('filePermissions.visibleTo', '==', null)));
      attachListener(query(collRef, where('teamId', '==', teamId), where('filePermissions.visibleTo', '==', [])));

      const groupIds = (options.myGroupIds || []).filter(Boolean);
      for (let i = 0; i < groupIds.length; i += 10) {
        const batch = groupIds.slice(i, i + 10);
        if (batch.length > 0) {
          attachListener(
            query(
              collRef,
              where('teamId', '==', teamId),
              where('filePermissions.visibleTo', 'array-contains-any', batch),
            ),
          );
        }
      }
    }
  } else {
    // Personal workspace context: fetch all docs owned by user where teamId is null
    attachListener(query(collRef, where('ownerId', '==', uid), where('teamId', '==', null)));
  }

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}

export function subscribeToCloudFolders(
  uid: string,
  teamId: string | null,
  onUpdate: (folders: CloudFolderMeta[]) => void
): () => void {
  const collRef = collection(db, CLOUD_FOLDERS_COL);
  const q = teamId
    ? query(collRef, where('teamId', '==', teamId))
    : query(collRef, where('ownerId', '==', uid), where('teamId', '==', null));

  return onSnapshot(q, (snapshot) => {
    const folders = snapshot.docs.map(docSnap => mapFirestoreFolder(docSnap.data()));
    onUpdate(folders);
  }, (err) => {
    console.warn('Failed to listen to cloud folders:', err);
  });
}

// Fetch a single cloud document's latest data
export async function fetchCloudDocument(docId: string): Promise<DocumentMeta | null> {
  try {
    const docRef = doc(db, CLOUD_DOCUMENTS_COL, docId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return mapFirestoreDoc({ ...snap.data(), id: snap.id });
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch single cloud document:', error);
    return null;
  }
}
