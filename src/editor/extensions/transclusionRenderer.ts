import { EditorState, StateField, StateEffect, Range } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { invoke } from '../../filesystem/tauriCommands';

export interface ResolvedObject {
  uuid: string;
  object_type: string;
  name: string;
  content?: string;
  source_path: string;
  start_line: number;
  content_hash: string;
  transclusion_hash?: string;
}

export interface TransclusionRange {
  type: 'ref' | 'exec';
  uuid: string;
  startPos: number;
  endPos: number;
  startLine: number;
  endLine: number;
}

export const setTransclusionObjectEffect = StateEffect.define<{
  uuid: string;
  object: ResolvedObject;
}>();

// ─── Cache StateField ─────────────────────────────────────────────────────────
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

// ─── Decoration StateField ───────────────────────────────────────────────────
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
      ranges.push({
        type,
        uuid,
        startPos,
        endPos,
        startLine,
        endLine,
      });
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

// ─── Async search loader plugin ───────────────────────────────────────────────
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

// ─── Global execution state for loading indicators ────────────────────────────
const executingBlocks = new Set<string>();

export function isBlockExecuting(uuid: string): boolean {
  return executingBlocks.has(uuid);
}

// ─── Shared Execution Helpers ──────────────────────────────────────────────────
export function normalizeLanguage(lang: string): string {
  const clean = lang.trim().toLowerCase();
  // If it looks like a metadata tag (e.g. `chain=addition`), treat as unknown
  if (clean.includes('=') || clean.startsWith('chain') || clean.startsWith('id') || clean.startsWith('ref')) {
    return '';
  }
  if (['python', 'py'].includes(clean)) return 'python';
  if (['javascript', 'js', 'node'].includes(clean)) return 'javascript';
  if (['typescript', 'ts'].includes(clean)) return 'typescript';
  if (['bash', 'sh', 'zsh', 'shell'].includes(clean)) return 'bash';
  if (['ruby', 'rb'].includes(clean)) return 'ruby';
  if (['go', 'golang'].includes(clean)) return 'go';
  if (['rust', 'rs'].includes(clean)) return 'rust';
  if (['php'].includes(clean)) return 'php';
  return clean;
}

export function detectLanguage(code: string, currentLang?: string): string {
  // Only trust currentLang if it's a real language name, not a metadata tag
  if (currentLang && currentLang.trim()) {
    const normalized = normalizeLanguage(currentLang);
    if (normalized) return normalized;
  }
  // Heuristic fallback from content
  const text = code.trim();
  if (text.includes('console.log') || text.includes('const ') || text.includes('let ') || text.includes('require(')) {
    return 'javascript';
  }
  if (text.includes('print(') || text.includes('def ') || text.includes('import ') || text.includes('elif ')) {
    return 'python';
  }
  return '';
}

export async function executeBlockAndGetOutput(uuid: string, wsObj: any): Promise<string | null> {
  executingBlocks.add(uuid);
  try {
    const code = wsObj.content || '';
    const lang = detectLanguage(code, wsObj.object_type?.language);

    const runtimes = await invoke<any[]>('list_runtimes');

    const runtime = runtimes.find((r) => {
      const rl = normalizeLanguage(r.language);
      return lang ? rl === lang : false;
    }) ?? runtimes.find((r) => {
      return r.is_default;
    });

    if (!runtime || !runtime.executable_path || !runtime.executable_path.trim()) {
      const displayLang = lang || 'this language';
      await invoke('show_alert_dialog', {
        title: 'Runtime Not Configured',
        description: `No compiler/interpreter path has been set for "${displayLang}". Please go to Settings -> Code Execution to configure it.`,
      });
      return null;
    }

    const executionResult = await invoke<any>('execute_block', {
      request: {
        object_uuid: uuid,
        language: lang,
        code,
        runtime_path: runtime.executable_path,
        session_id: wsObj.object_type?.session || null,
        continue_of: wsObj.object_type?.continue_of || null,
        working_dir: null,
      },
    });

    if (executionResult.success) {
      return executionResult.stdout;
    } else {
      // Code errors go into the document as output — no dialog
      return executionResult.stderr || 'Process exited with non-zero status.';
    }
  } catch (e: any) {
    const errMsg = typeof e === 'string' ? e : e.message || JSON.stringify(e);
    await invoke('show_alert_dialog', {
      title: 'Execution Failed',
      description: `Could not run code block: ${errMsg}`,
    });
    return null;
  } finally {
    executingBlocks.delete(uuid);
  }
}

// ─── Action Handlers ──────────────────────────────────────────────────────────
async function handleTransclusionAction(view: EditorView, type: 'ref' | 'exec', uuid: string) {
  try {
    const wsObj = await invoke<any>('get_object_by_uuid', { objectUuid: uuid });
    if (!wsObj) {
      console.error('Transclusion source object not found:', uuid);
      return;
    }

    if (type === 'ref') {
      let contentToInsert = '';
      const content = wsObj.content || '';

      if (isCodeBlockObject(wsObj.object_type)) {
        const typeObj = wsObj.object_type;
        const lang = typeObj.language || 'text';
        let attrs = '';
        if (typeObj.session) attrs += ` session="${typeObj.session}"`;
        if (typeObj.profile) attrs += ` profile="${typeObj.profile}"`;
        if (typeObj.id) attrs += ` id="${typeObj.id}"`;
        if (typeObj.ref_id) attrs += ` ref="${typeObj.ref_id}"`;
        if (typeObj.continue_of) attrs += ` chain=${typeObj.continue_of}`;
        if (typeObj.before_line != null) attrs += ` before=${typeObj.before_line}`;
        if (typeObj.after_line != null) attrs += ` after=${typeObj.after_line}`;

        contentToInsert = `<!-- ref: ${uuid} -->\n\`\`\`${lang}${attrs}\n${content}\n\`\`\`\n<!-- /ref -->`;
      } else {
        contentToInsert = `<!-- ref: ${uuid} -->\n${content}\n<!-- /ref -->`;
      }

      replaceTransclusionBlock(view, uuid, contentToInsert);
      invoke('set_transclusion_hash', { objectUuid: uuid, hash: wsObj.content_hash || '' }).catch(() => {});

      view.dispatch({
        effects: setTransclusionObjectEffect.of({ uuid, object: mapToResolvedObject(uuid, wsObj) }),
      });
    } else if (type === 'exec') {
      const outputText = await executeBlockAndGetOutput(uuid, wsObj);
      if (outputText === null) return;

      const contentToInsert = `<!-- exec: ${uuid} -->\n\`\`\`text\n${outputText.trim()}\n\`\`\`\n<!-- /exec -->`;
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

function replaceTransclusionBlock(view: EditorView, uuid: string, newContent: string) {
  const docText = view.state.doc.toString();
  const startRegex = new RegExp(`<!--\\s*(ref|exec):\\s*${uuid}\\s*-->`);
  const startMatch = startRegex.exec(docText);
  if (!startMatch) {
    console.error('Could not find start tag for transclusion:', uuid);
    return;
  }

  const type = startMatch[1];
  const endRegex = new RegExp(`<!--\\s*/${type}\\s*-->`);
  endRegex.lastIndex = startMatch.index + startMatch[0].length;
  const endMatch = endRegex.exec(docText);
  if (!endMatch) {
    console.error('Could not find end tag for transclusion:', uuid);
    return;
  }

  const from = startMatch.index;
  const to = endMatch.index + endMatch[0].length;

  view.dispatch({
    changes: { from, to, insert: newContent },
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function mapToResolvedObject(uuid: string, wsObj: any): ResolvedObject {
  let objectType = 'Unknown';
  if (wsObj.object_type) {
    if (typeof wsObj.object_type === 'string') {
      objectType = wsObj.object_type;
    } else if (typeof wsObj.object_type === 'object' && wsObj.object_type.type) {
      objectType = wsObj.object_type.type;
    }
  }
  return {
    uuid: wsObj.uuid || uuid,
    object_type: objectType,
    name: wsObj.name || '',
    content: wsObj.content || '',
    source_path: wsObj.document_path || '',
    start_line: wsObj.start_line || 0,
    content_hash: wsObj.content_hash || '',
    transclusion_hash: wsObj.transclusion_hash || undefined,
  };
}

function isCodeBlockObject(objectType: any) {
  return objectType === 'CodeBlock' || objectType?.type === 'CodeBlock';
}

// ─── Widgets ───────────────────────────────────────────────────────────────────
class StatusWidget extends WidgetType {
  constructor(
    private type: 'ref' | 'exec',
    private uuid: string,
    private name: string,
    private status: 'sync' | 'out-of-sync' | 'not-found',
    private object?: ResolvedObject
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const bar = document.createElement('div');
    bar.className =
      'cm-transclusion-status-bar flex items-center justify-between px-3 py-1 rounded-t-md text-[11px] font-sans select-none border-t border-x';

    const textEl = document.createElement('span');
    textEl.className = 'flex items-center gap-1.5';

    const typeLabel = this.type === 'ref' ? 'Reference' : 'Execution Output';

    let statusClass = 'border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900';
    let textClass = 'text-neutral-500 dark:text-neutral-400';
    let labelHTML = '';

    if (this.status === 'sync') {
      labelHTML = `<span style="width: 6px; height: 6px; background-color: #10b981; border-radius: 9999px; display: inline-block;"></span> ${typeLabel}: <strong class="font-semibold text-neutral-700 dark:text-neutral-300">${this.name}</strong> (Synced)`;
    } else if (this.status === 'out-of-sync') {
      statusClass = 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20';
      textClass = 'text-amber-700 dark:text-amber-400';
      const warningLabel = this.type === 'ref' ? 'Reference modified' : 'Source changed';
      labelHTML = `<span>🔄</span> ${typeLabel}: <strong class="font-semibold">${this.name}</strong> (${warningLabel})`;
    } else {
      statusClass = 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20';
      textClass = 'text-red-700 dark:text-red-400';
      labelHTML = `<span>⚠</span> Reference block not found in workspace`;
    }

    bar.className += ` ${statusClass}`;
    textEl.className += ` ${textClass}`;
    textEl.innerHTML = labelHTML;
    bar.appendChild(textEl);

    if (this.status !== 'not-found') {
      const isExecuting = isBlockExecuting(this.uuid);
      const button = document.createElement('button');

      if (isExecuting) {
        button.innerHTML = `<span class="exec-spinner"></span>`;
        button.disabled = true;
        button.className = `px-2 py-0.5 rounded text-[10px] font-medium cursor-not-allowed bg-neutral-300 dark:bg-neutral-700 text-neutral-500`;
      } else {
        const label =
          this.status === 'out-of-sync'
            ? (this.type === 'ref' ? 'Sync' : 'Re-run')
            : (this.type === 'ref' ? 'Sync' : 'Run');
        button.textContent = label;
        button.className = `px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-150 cursor-pointer ${
          this.status === 'out-of-sync'
            ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm'
            : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-700'
        }`;
        button.addEventListener('click', (e) => {
          e.preventDefault();
          button.disabled = true;
          button.innerHTML = `<span class="exec-spinner"></span>`;
          handleTransclusionAction(view, this.type, this.uuid).finally(() => {
            // Widget will re-render via state update after execution completes
          });
        });
      }
      bar.appendChild(button);
    }

    return bar;
  }

  ignoreEvent() {
    return true;
  }
}

// ─── Theme Style Definitions ──────────────────────────────────────────────────
export const transclusionTheme = EditorView.theme({
  '.cm-transclusion-line': {
    borderLeft: '2px solid var(--editor-accent, #3b82f6)',
    backgroundColor: 'rgba(59, 130, 246, 0.015)',
    paddingLeft: '6px !important',
  },
  '.exec-spinner': {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    border: '2px solid rgba(120, 120, 120, 0.3)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'exec-spin 0.6s linear infinite',
  },
  '@keyframes exec-spin': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
});
