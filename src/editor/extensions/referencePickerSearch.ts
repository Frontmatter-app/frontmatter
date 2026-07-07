import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { invoke } from '../../filesystem/tauriCommands';
import type { ObjectSearchResult } from '../../types';
import { executeBlockAndGetOutput } from './transclusionExecution';
import { referencePickerField, setReferencePickerStateEffect, dismissPicker } from './referencePickerCore';
import type { SearchItem, PickerScope } from './referencePickerTypes';
import { getPickerDocumentPath, getPickerScope } from './referencePickerState';
import { buildRefContent, buildExecContent } from './shared/transclusionUtils';

export async function searchReferences(query: string): Promise<ObjectSearchResult[]> {
  try {
    return await invoke<ObjectSearchResult[]>('search_objects', { query });
  } catch (e) {
    console.error('Failed to search references:', e);
    return [];
  }
}

export function filterByScope(items: SearchItem[], scope: PickerScope, docPath: string): SearchItem[] {
  if (scope === 'file') {
    return items.filter(i => i.result.document_path === docPath);
  }
  if (scope === 'folder') {
    const parentDir = docPath.includes('/') ? docPath.split('/').slice(0, -1).join('/') : '';
    return items.filter(i => {
      const d = i.result.document_path;
      if (d === docPath) return true;
      if (!parentDir) return false;
      return d.startsWith(parentDir + '/');
    });
  }
  return items;
}

export const referencePickerSearchPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      const prev = update.startState.field(referencePickerField);
      const curr = update.state.field(referencePickerField);

      if (curr.active && curr.loading && (curr.query !== prev.query || !prev.active)) {
        const query = curr.query;
        const docPath = getPickerDocumentPath();
        const scope = getPickerScope();

        searchReferences(query)
          .then((results) => {
            const latest = update.view.state.field(referencePickerField);
            if (latest.active && latest.query === query) {
              const allItems: SearchItem[] = [];
              results.forEach((res) => {
                if (res.object_type === 'CodeBlock') {
                  allItems.push({ result: res, action: 'ref' });
                  allItems.push({ result: res, action: 'exec' });
                } else {
                  allItems.push({ result: res, action: 'ref' });
                }
              });

              const items = filterByScope(allItems, scope, docPath);

              update.view.dispatch({
                effects: setReferencePickerStateEffect.of({ allItems, items, loading: false }),
              });
            }
          })
          .catch(() => {
            update.view.dispatch({
              effects: setReferencePickerStateEffect.of({ loading: false }),
            });
          });
      }
    }
  }
);

export async function selectItem(view: EditorView, item: SearchItem) {
  const picker = view.state.field(referencePickerField);
  dismissPicker(view);

  try {
    const uuid = item.result.uuid;
    const wsObj = await invoke<any>('get_object_by_uuid', { objectUuid: uuid });
    if (!wsObj) {
      console.error('Selected object not found:', uuid);
      return;
    }

    if (item.action === 'ref') {
      const contentToInsert = buildRefContent(wsObj);
      invoke('set_transclusion_hash', { objectUuid: uuid, hash: wsObj.content_hash || '' }).catch(() => {});
      view.dispatch({
        changes: { from: picker.from, to: picker.to, insert: contentToInsert },
      });
    } else if (item.action === 'exec') {
      const outputText = await executeBlockAndGetOutput(uuid, wsObj);
      if (outputText === null) return;

      const contentToInsert = buildExecContent(uuid, outputText);
      invoke('set_transclusion_hash', { objectUuid: uuid, hash: wsObj.content_hash || '' }).catch(() => {});

      view.dispatch({
        changes: { from: picker.from, to: picker.to, insert: contentToInsert },
      });
    }
  } catch (e) {
    console.error('Failed to insert transclusion:', e);
  }
}
