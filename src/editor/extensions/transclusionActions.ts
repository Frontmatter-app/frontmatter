import { EditorView } from '@codemirror/view';
import * as Y from 'yjs';
import { invoke } from '../../filesystem/tauriCommands';
import { setTransclusionObjectEffect } from './transclusionRenderer';
import { executeBlockAndGetOutput } from './transclusionExecution';
import { buildRefContent, buildExecContent, replaceTransclusionBlock } from './shared/transclusionUtils';
import { mapToResolvedObject } from './transclusionTypes';

// Persists a transclusion hash both locally (SQLite) and in the shared Yjs doc
// so that all peers in a team workspace see the correct sync/out-of-sync state.
function recordTransclusionHash(uuid: string, hash: string, ydoc?: Y.Doc | null) {
  invoke('set_transclusion_hash', { objectUuid: uuid, hash }).catch(() => {});
  if (ydoc) {
    ydoc.getMap('transclusion_hashes').set(uuid, hash);
  }
}

export async function handleTransclusionAction(
  view: EditorView,
  type: 'ref' | 'exec',
  uuid: string,
  ydoc?: Y.Doc | null,
) {
  try {
    const wsObj = await invoke<any>('get_object_by_uuid', { objectUuid: uuid });
    if (!wsObj) {
      console.error('Transclusion source object not found:', uuid);
      return;
    }

    if (type === 'ref') {
      const contentToInsert = buildRefContent(wsObj);
      replaceTransclusionBlock(view, uuid, contentToInsert);
      recordTransclusionHash(uuid, wsObj.content_hash || '', ydoc);

      view.dispatch({
        effects: setTransclusionObjectEffect.of({ uuid, object: mapToResolvedObject(uuid, wsObj) }),
      });
    } else if (type === 'exec') {
      const outputText = await executeBlockAndGetOutput(uuid, wsObj);
      if (outputText === null) return;

      const contentToInsert = buildExecContent(uuid, outputText);
      replaceTransclusionBlock(view, uuid, contentToInsert);
      recordTransclusionHash(uuid, wsObj.content_hash || '', ydoc);

      view.dispatch({
        effects: setTransclusionObjectEffect.of({ uuid, object: mapToResolvedObject(uuid, wsObj) }),
      });
    }
  } catch (e) {
    console.error('Failed to execute transclusion action:', e);
  }
}
