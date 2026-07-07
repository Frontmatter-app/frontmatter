import { EditorState, StateField, StateEffect, Range } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { invoke } from '../../filesystem/tauriCommands';
import type { ResolvedObject, TransclusionRange } from './transclusionTypes';
import { mapToResolvedObject } from './transclusionTypes';
import StatusWidget from './transclusionWidget';

export type { ResolvedObject, TransclusionRange } from './transclusionTypes';

export const setTransclusionObjectEffect = StateEffect.define<{
  uuid: string;
  object: ResolvedObject;
}>();

export const resolvedObjectsField = StateField.define<{ [uuid: string]: ResolvedObject }>({
  create() {
    return {};
  },
  update(cache, tr) {
    let next = cache;
    for (const effect of tr.effects) {
      if (effect.is(setTransclusionObjectEffect)) {
        next = { ...next, [effect.value.uuid]: effect.value.object };
      }
    }
    return next;
  },
});

export const transclusionDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    const prevResolved = tr.startState.field(resolvedObjectsField);
    const currResolved = tr.state.field(resolvedObjectsField);

    if (!tr.docChanged && prevResolved === currResolved) {
      return deco.map(tr.changes);
    }

    return buildDecorations(tr.state, currResolved);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function findTransclusions(docText: string, doc: EditorState['doc']): TransclusionRange[] {
  const ranges: TransclusionRange[] = [];
  const refStartRegex = /<!--\s*(ref|exec):\s*([a-fA-F0-9\-]+)\s*-->/g;
  const refEndRegex = /<!--\s*\/(ref|exec)\s*-->/g;

  let match;
  while ((match = refStartRegex.exec(docText)) !== null) {
    const type = match[1] as 'ref' | 'exec';
    const uuid = match[2];
    const startPos = match.index;
    const startLine = doc.lineAt(startPos).number;

    refEndRegex.lastIndex = refStartRegex.lastIndex;
    const endMatch = refEndRegex.exec(docText);
    if (endMatch && endMatch[1] === type) {
      const endPos = endMatch.index + endMatch[0].length;
      const endLine = doc.lineAt(endMatch.index).number;
      ranges.push({ type, uuid, startPos, endPos, startLine, endLine });
      refStartRegex.lastIndex = endPos;
    }
  }
  return ranges;
}

function buildDecorations(state: EditorState, resolved: { [uuid: string]: ResolvedObject }): DecorationSet {
  const docText = state.doc.toString();
  const ranges = findTransclusions(docText, state.doc);

  if (ranges.length === 0) return Decoration.none;

  const decorations: Range<Decoration>[] = [];

  for (const range of ranges) {
    const obj = resolved[range.uuid];

    let status: 'sync' | 'out-of-sync' | 'not-found' = 'sync';
    let name = 'Unknown';

    if (obj) {
      name = obj.name;
      status = (obj.transclusion_hash && obj.transclusion_hash === obj.content_hash) ? 'sync' : 'out-of-sync';
    } else {
      status = 'not-found';
    }

    const widgetDeco = Decoration.widget({
      widget: new StatusWidget(range.type, range.uuid, name, status, obj),
      side: -1,
      block: true,
    });
    const startLinePos = state.doc.line(range.startLine).from;
    decorations.push(widgetDeco.range(startLinePos));

    for (let l = range.startLine; l <= range.endLine; l++) {
      const line = state.doc.line(l);
      decorations.push(Decoration.line({ class: 'cm-transclusion-line' }).range(line.from));
    }
  }

  decorations.sort((a, b) => a.from - b.from);
  return Decoration.set(decorations, true);
}

export const transclusionPlugin = ViewPlugin.fromClass(
  class {
    loading = new Set<string>();

    constructor(view: EditorView) {
      Promise.resolve().then(() => this.loadMissing(view));
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.transactions.some((tr) => tr.effects.length > 0)) {
        this.loadMissing(update.view);
      }
    }

    loadMissing(view: EditorView) {
      const resolved = view.state.field(resolvedObjectsField);
      const docText = view.state.doc.toString();
      const refStartRegex = /<!--\s*(ref|exec):\s*([a-fA-F0-9\-]+)\s*-->/g;
      let match;

      while ((match = refStartRegex.exec(docText)) !== null) {
        const uuid = match[2];
        if (!resolved[uuid] && !this.loading.has(uuid)) {
          this.loading.add(uuid);
          Promise.all([
            invoke<any>('get_object_by_uuid', { objectUuid: uuid }),
            invoke<string | null>('get_transclusion_hash', { objectUuid: uuid }),
          ])
            .then(([result, transclusionHash]) => {
              this.loading.delete(uuid);
              if (result) {
                const obj = mapToResolvedObject(uuid, result);
                obj.transclusion_hash = transclusionHash || undefined;
                view.dispatch({
                  effects: setTransclusionObjectEffect.of({ uuid, object: obj }),
                });
              }
            })
            .catch((err) => {
              this.loading.delete(uuid);
              console.error('Failed to load transclusion:', uuid, err);
            });
        }
      }
    }
  }
);

export const transclusionTheme = EditorView.theme({
  '.cm-transclusion-line': {
    borderLeft: '2px solid var(--editor-accent)',
    backgroundColor: 'var(--editor-accent-bg)',
    paddingLeft: '6px !important',
  },
  '.exec-spinner': {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    border: '2px solid var(--editor-border)',
    borderTopColor: 'var(--editor-accent)',
    borderRadius: '50%',
    animation: 'exec-spin 0.6s linear infinite',
  },
  '@keyframes exec-spin': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
});


