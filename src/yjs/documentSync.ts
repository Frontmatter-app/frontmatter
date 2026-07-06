import * as Y from 'yjs';
import { invoke } from '../filesystem/tauriCommands';
import { pushCloudDocument, fetchCloudDocument } from '../cloud/firestoreSync';
import { useSyncStatusStore } from '../cloud/syncStatusStore';
import { usePlanStore } from '../billing/PlanProvider';
import { auth } from '../auth/firebase';
import { getSettings } from '../settings/settingsStore';
import { extractDraftNodes } from './draftUtils';
import { uint8ToBase64, base64ToUint8 } from '../lib/base64';

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

export async function loadDocData(documentId: string): Promise<{ data: any; parsed: { markdown: string; draft: string; yjs_state: string } }> {
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

  let parsed = { markdown: data.content, draft: '', yjs_state: '' };
  if (data.content && data.content.startsWith('{')) {
    try {
      parsed = JSON.parse(data.content);
    } catch (e) {}
  }
  return { data, parsed };
}

export function applyDocData(doc: Y.Doc, data: any, parsed: { markdown: string; draft: string; yjs_state: string }) {
  const ytext = doc.getText('markdown');
  const draftText = doc.getText('draft');

  if (parsed.yjs_state) {
    try {
      const bytes = base64ToUint8(parsed.yjs_state);
      Y.applyUpdate(doc, bytes);
    } catch (e) {
      console.error('Failed to apply yjs_state update, falling back to plaintext', e);
      ytext.insert(0, parsed.markdown || '');
      draftText.insert(0, parsed.draft || '');
    }
  } else {
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
