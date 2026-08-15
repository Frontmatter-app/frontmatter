import * as Y from 'yjs';
import { invoke } from '../filesystem/tauriCommands';
import { pushCloudDocument, fetchCloudDocument } from '../cloud/firestoreSync';
import { useSyncStatusStore } from '../cloud/syncStatusStore';
import { usePlanStore } from '../billing/PlanProvider';
import { auth } from '../auth/firebase';
import { getSettings } from '../settings/settingsStore';
import { extractDraftNodes } from './draftUtils';
import { uint8ToBase64, base64ToUint8 } from '../lib/base64';

/**
 * Marks locally cached CRDT state as sharing history with the sync server.
 *
 * State written before the server existed came from whatever each client
 * bootstrapped for itself, so it has no history in common with the server's
 * copy. Merging the two would integrate both as separate content and duplicate
 * the document. Unmarked state is therefore discarded on load for cloud
 * documents, which re-syncs them cleanly from the server exactly once.
 */
export const YJS_STATE_ORIGIN = 'sync-server-v1';

export function buildDocSavePayload(doc: Y.Doc, documentId: string) {
  const text = doc.getText('markdown').toString();
  const draftMsg = doc.getText('draft').toString();
  const title = (doc.getMap('meta').get('title') as string) || 'Untitled Document';
  return {
    id: documentId,
    title,
    content: JSON.stringify({
      markdown: text,
      draft: draftMsg,
      yjs_state: uint8ToBase64(Y.encodeStateAsUpdate(doc)),
      yjs_origin: YJS_STATE_ORIGIN,
    }),
    stage: (doc.getMap('meta').get('stage') as string) || 'write',
    focusMode: (doc.getMap('meta').get('focus_mode') as boolean) || false,
  };
}

export async function saveToLocalDb(doc: Y.Doc, documentId: string): Promise<string> {
  const text = doc.getText('markdown').toString();
  const payload = buildDocSavePayload(doc, documentId);
  await invoke('update_document', payload);
  return text;
}

export async function syncDraftNodesToDb(doc: Y.Doc, documentId: string): Promise<void> {
  const draftMsg = doc.getText('draft').toString();
  const nodes = extractDraftNodes(draftMsg, documentId);
  if (nodes.length > 0) {
    await invoke('sync_draft_nodes', { documentId, nodes });
  }
}

export async function syncToCloud(
  doc: Y.Doc,
  documentId: string,
): Promise<void> {
  const text = doc.getText('markdown').toString();
  const draftMsg = doc.getText('draft').toString();
  const title = (doc.getMap('meta').get('title') as string) || 'Untitled Document';
  const planState = usePlanStore.getState();
  const currentUser = auth.currentUser;
  const isCloudDoc =
    useSyncStatusStore.getState().cloudDocumentIds.has(documentId) ||
    planState.activeContext.type === 'team';
  if (!planState.isAuthor || !currentUser || !isCloudDoc) return;

  useSyncStatusStore.getState().setSyncing();
  try {
    await pushCloudDocument(
      {
        id: documentId,
        title,
        content: JSON.stringify({ markdown: text, draft: draftMsg }),
        stage: (doc.getMap('meta').get('stage') as any) || 'write',
        focus_mode: (doc.getMap('meta').get('focus_mode') as boolean) || false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        word_count: 0,
        excerpt: undefined,
        file_created_at: undefined,
      },
      currentUser.uid,
      planState.teamId,
    );
    useSyncStatusStore.getState().setSynced();
  } catch (err: any) {
    if (err?.code !== 'permission-denied') {
      console.error('Cloud sync failed:', err);
      useSyncStatusStore.getState().setError('Sync failed');
    }
  }
}

export async function loadDocData(documentId: string): Promise<{ data: any; parsed: { markdown: string; draft: string; yjs_state: string; yjs_origin?: string } }> {
  let data: any;
  try {
    data = await invoke('get_document', { id: documentId });
  } catch (dbErr) {
    const planState = usePlanStore.getState();
    if (planState.isAuthor && auth.currentUser) {
      const cloudDoc = await fetchCloudDocument(documentId);
      if (cloudDoc) {
        await invoke('create_document', {
          id: documentId,
          title: cloudDoc.title,
          content: cloudDoc.content,
          filePath: undefined,
        });
        data = await invoke('get_document', { id: documentId });
      } else {
        throw new Error('Document not found in local DB nor Cloud Firestore');
      }
    } else {
      throw dbErr;
    }
  }

  let parsed: { markdown: string; draft: string; yjs_state: string; yjs_origin?: string } = {
    markdown: data.content,
    draft: '',
    yjs_state: '',
  };
  if (data.content && data.content.startsWith('{')) {
    try {
      parsed = JSON.parse(data.content);
    } catch (e) {}
  }

  // Index cloud-only documents so their objects appear in the @ picker.
  // Local docs are indexed automatically by update_document -> index_file.
  // Cloud docs (file_path is null or empty) need explicit indexing after load.
  if (!data.file_path && parsed.markdown) {
    invoke('index_document_content', {
      documentId,
      markdown: parsed.markdown,
    }).catch((e) => console.warn('[docSync] Failed to index cloud doc:', e));
  }

  return { data, parsed };
}

/**
 * Seeds a Y.Doc from stored data.
 *
 * `isCloud` documents are seeded by the sync server, once, and must not be
 * seeded here: two peers each inserting the same markdown authored independent
 * CRDT structs for it, which is what produced duplicated document text. For
 * those, only the local CRDT state is applied — the server's sync handshake
 * supplies everything else.
 */
export function applyDocData(
  doc: Y.Doc,
  data: any,
  parsed: { markdown: string; draft: string; yjs_state: string; yjs_origin?: string },
  options: { isCloud?: boolean } = {},
) {
  const ytext = doc.getText('markdown');
  const draftText = doc.getText('draft');

  // A document backed by a file on disk is never server-seeded, whatever the
  // caller believes. Skipping the seed for one would open it blank, and the
  // next autosave writes that blank straight back over the file.
  const serverOwnsContent = !!options.isCloud && !data?.file_path;

  // Cached CRDT state from before the sync server shares no history with the
  // server's copy, so merging them would duplicate the document. Dropping it
  // costs nothing: the server resends the full state on connect.
  const cacheIsCompatible = !serverOwnsContent || parsed.yjs_origin === YJS_STATE_ORIGIN;

  let applied = false;
  if (parsed.yjs_state && cacheIsCompatible) {
    try {
      const bytes = base64ToUint8(parsed.yjs_state);
      // Applied to a scratch document first. `Y.applyUpdate` integrates leading
      // structs before it throws on a corrupt tail, so applying straight to
      // `doc` and falling back in the catch left the content in twice.
      const scratch = new Y.Doc();
      Y.applyUpdate(scratch, bytes);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch));
      scratch.destroy();
      applied = true;
    } catch (e) {
      console.error('Stored CRDT state is unusable; falling back to plaintext', e);
    }
  }

  if (!applied && !serverOwnsContent) {
    ytext.insert(0, parsed.markdown || '');
    draftText.insert(0, parsed.draft || '');
  }

  doc.getMap('meta').set('focus_mode', data.focus_mode || false);
  doc.getMap('meta').set('stage', data.stage || 'write');
  doc.getMap('meta').set('title', data.title || 'Untitled Document');
  if (data.file_path) {
    doc.getMap('meta').set('file_path', data.file_path);
  }
}
