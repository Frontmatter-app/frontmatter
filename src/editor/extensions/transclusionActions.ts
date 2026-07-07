import { EditorView } from '@codemirror/view';
import { invoke } from '../../filesystem/tauriCommands';
import { setTransclusionObjectEffect } from './transclusionRenderer';
import { executeBlockAndGetOutput } from './transclusionExecution';
import { buildRefContent, buildExecContent, replaceTransclusionBlock } from './shared/transclusionUtils';
import { mapToResolvedObject } from './transclusionTypes';

export async function handleTransclusionAction(view: EditorView, type: 'ref' | 'exec', uuid: string) {
  try {
    const wsObj = await invoke<any>('get_object_by_uuid', { objectUuid: uuid });
    if (!wsObj) {
      console.error('Transclusion source object not found:', uuid);
      return;
    }

    if (type === 'ref') {
      const contentToInsert = buildRefContent(wsObj);
      replaceTransclusionBlock(view, uuid, contentToInsert);
      invoke('set_transclusion_hash', { objectUuid: uuid, hash: wsObj.content_hash || '' }).catch(() => {});

      view.dispatch({
        effects: setTransclusionObjectEffect.of({ uuid, object: mapToResolvedObject(uuid, wsObj) }),
      });
    } else if (type === 'exec') {
      const outputText = await executeBlockAndGetOutput(uuid, wsObj);
      if (outputText === null) return;

      const contentToInsert = buildExecContent(uuid, outputText);
      replaceTransclusionBlock(view, uuid, contentToInsert);
      invoke('set_transclusion_hash', { objectUuid: uuid, hash: wsObj.content_hash || '' }).catch(() => {});

      view.dispatch({
        effects: setTransclusionObjectEffect.of({ uuid, object: mapToResolvedObject(uuid, wsObj) }),
      });
    }
  } catch (e) {
    console.error('Failed to execute transclusion action:', e);
  }
}
