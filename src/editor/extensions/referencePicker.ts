import { EditorState, StateField, StateEffect } from '@codemirror/state';
import { EditorView, showTooltip, keymap, ViewPlugin, ViewUpdate, tooltips } from '@codemirror/view';
import { invoke } from '../../filesystem/tauriCommands';
import { ObjectSearchResult } from '../../types';
import { executeBlockAndGetOutput } from './transclusionRenderer';

// ─── Document Path ────────────────────────────────────────────────────────
// Module-level so WriteView can update it without recreating the editor.
let _currentDocPath = '';
export function setPickerDocumentPath(path: string) {
  _currentDocPath = path;
}
// Kept for import compatibility; no longer used as a CM Facet.
export const documentPathFacet = { of: (_: string) => [] as any[] };

// ─── Scope ───────────────────────────────────────────────────────────────────
// Module-level: persists across queries and document switches.
type PickerScope = 'file' | 'folder' | 'workspace';
// Default to 'file' — scoped to the current document by default.
let pickerScope: PickerScope = 'file';

export interface SearchItem {
  result: ObjectSearchResult;
  action: 'ref' | 'exec';
}

export interface ReferencePickerState {
  active: boolean;
  loading: boolean;
  query: string;
  from: number;
  to: number;
  allItems: SearchItem[];      // all results from backend (unfiltered)
  items: SearchItem[];         // scope-filtered items shown in UI
  selectedIndex: number;
}

export const setReferencePickerStateEffect = StateEffect.define<Partial<ReferencePickerState>>();

export const referencePickerField = StateField.define<ReferencePickerState>({
  create() {
    return { active: false, loading: false, query: '', from: 0, to: 0, allItems: [], items: [], selectedIndex: 0 };
  },

  update(state, tr) {
    let next = state;

    // Apply state effects
    for (const effect of tr.effects) {
      if (effect.is(setReferencePickerStateEffect)) {
        next = { ...next, ...effect.value };
      }
    }

    // Scan on doc/selection changes
    if (!tr.docChanged && tr.selection === undefined) return next;

    const sel = tr.state.selection.main;
    if (!sel.empty) {
      return { ...next, active: false, loading: false, query: '', items: [] };
    }

    const line = tr.state.doc.lineAt(sel.head);
    const cursorCol = sel.head - line.from;
    const atIndex = line.text.lastIndexOf('@', cursorCol - 1);

    if (atIndex < 0) {
      return { ...next, active: false, loading: false, query: '', items: [] };
    }

    const between = line.text.slice(atIndex + 1, cursorCol);
    if (between.includes(' ')) {
      return { ...next, active: false, loading: false, query: '', items: [] };
    }

    const query = between;
    if (query.length > 50) {
      return { ...next, active: false, loading: false, query: '', items: [] };
    }

    const from = line.from + atIndex;
    const to = sel.head;

    const queryChanged = !next.active || next.from !== from || next.query !== query;
    if (queryChanged) {
      return { ...next, active: true, loading: true, query, from, to, items: [], selectedIndex: 0 };
    }

    return { ...next, to };
  },
});

// ─── Async search plugin ───────────────────────────────────────────────────────
export const referencePickerSearchPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      const prev = update.startState.field(referencePickerField);
      const curr = update.state.field(referencePickerField);

      if (curr.active && curr.loading && (curr.query !== prev.query || !prev.active)) {
        const query = curr.query;
        const docPath = _currentDocPath;
        const scope = pickerScope;

        searchReferences(query)
          .then((results) => {
            const latest = update.view.state.field(referencePickerField);
            if (latest.active && latest.query === query) {
              // Expand CodeBlocks to offer both reference and execution actions
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

/** Filter a SearchItem list by the current scope. */
function filterByScope(items: SearchItem[], scope: PickerScope, docPath: string): SearchItem[] {
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
  // workspace — no filter
  return items;
}

// ─── Selection action ──────────────────────────────────────────────────────────
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

        contentToInsert = `\n<!-- ref: ${uuid} -->\n\`\`\`${lang}${attrs}\n${content}\n\`\`\`\n<!-- /ref -->\n`;
      } else {
        contentToInsert = `\n<!-- ref: ${uuid} -->\n${content}\n<!-- /ref -->\n`;
      }

      invoke('set_transclusion_hash', { objectUuid: uuid, hash: wsObj.content_hash || '' }).catch(() => {});
      view.dispatch({
        changes: { from: picker.from, to: picker.to, insert: contentToInsert },
      });
    } else if (item.action === 'exec') {
      const outputText = await executeBlockAndGetOutput(uuid, wsObj);
      if (outputText === null) return; // execution failed or was aborted

      const contentToInsert = `\n<!-- exec: ${uuid} -->\n\`\`\`text\n${outputText.trim()}\n\`\`\`\n<!-- /exec -->\n`;
      invoke('set_transclusion_hash', { objectUuid: uuid, hash: wsObj.content_hash || '' }).catch(() => {});

      view.dispatch({
        changes: { from: picker.from, to: picker.to, insert: contentToInsert },
      });
    }
  } catch (e) {
    console.error('Failed to insert transclusion:', e);
  }
}

export function dismissPicker(view: EditorView) {
  view.dispatch({
    effects: setReferencePickerStateEffect.of({ active: false, loading: false, query: '', items: [] }),
  });
}

function isCodeBlockObject(objectType: any) {
  return objectType === 'CodeBlock' || objectType?.type === 'CodeBlock';
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
const referencePickerTooltip = showTooltip.compute([referencePickerField], (state: EditorState) => {
  const picker = state.field(referencePickerField);
  if (!picker.active) return null;

  return {
    pos: picker.from,
    above: false,
    strictSide: true,
    arrow: false,
    create(view: EditorView) {
      const dom = document.createElement('div');
      applyPickerStyles(dom);

      const render = (pState: ReferencePickerState) => {
        dom.innerHTML = '';

        // ── Scope header ────────────────────────────────────────────────────────
        const header = document.createElement('div');
        header.style.cssText = `
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 10px 5px;
          border-bottom: 1px solid var(--editor-border, rgba(120,120,120,0.18));
          margin-bottom: 4px;
        `;

        const label = document.createElement('span');
        label.textContent = 'Scope:';
        label.style.cssText = `
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--editor-muted, #888);
          font-family: var(--editor-mono-font, monospace);
        `;
        header.appendChild(label);

        const scopes: { key: PickerScope; label: string }[] = [
          { key: 'file',      label: 'This file' },
          { key: 'folder',    label: 'Parent folder' },
          { key: 'workspace', label: 'Workspace' },
        ];

        scopes.forEach(({ key, label: scopeLabel }) => {
          const pill = document.createElement('label');
          pill.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            font-size: 11px;
            font-family: var(--editor-font-family, system-ui);
            color: ${ pickerScope === key ? 'var(--editor-accent, #7c3aed)' : 'var(--editor-muted, #888)' };
            font-weight: ${ pickerScope === key ? '600' : '400' };
          `;

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = pickerScope === key;
          cb.style.cssText = 'accent-color: var(--editor-accent, #7c3aed); cursor: pointer; width: 12px; height: 12px;';
          cb.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            pickerScope = key;
            // Re-filter from allItems without a network round-trip
            const filtered = filterByScope(pState.allItems, key, _currentDocPath);
            view.dispatch({
              effects: setReferencePickerStateEffect.of({ items: filtered, selectedIndex: 0 }),
            });
          });

          pill.appendChild(cb);
          pill.appendChild(document.createTextNode(scopeLabel));
          header.appendChild(pill);
        });

        dom.appendChild(header);

        if (pState.loading) {
          const loadingEl = document.createElement('div');
          loadingEl.style.cssText = `
            padding: 10px 14px;
            font-size: 12px;
            color: var(--editor-muted, #6a737d);
            font-family: var(--editor-font-family, system-ui);
          `;
          loadingEl.textContent = 'Searching…';
          dom.appendChild(loadingEl);
          return;
        }

        if (pState.items.length === 0 && !pState.loading) {
          const emptyEl = document.createElement('div');
          emptyEl.style.cssText = `
            padding: 10px 14px;
            font-size: 12px;
            color: var(--editor-muted, #6a737d);
            font-family: var(--editor-font-family, system-ui);
          `;
          emptyEl.textContent = pState.query ? `No results for "${pState.query}"` : 'No referenceable objects in scope';
          dom.appendChild(emptyEl);
          return;
        }

        const selected = Math.min(pState.selectedIndex, pState.items.length - 1);

        pState.items.forEach((item, idx) => {
          const isSelected = idx === selected;
          const { result, action } = item;
          const itemEl = document.createElement('div');

          itemEl.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 7px 12px;
            border-radius: 6px;
            cursor: pointer;
            background: ${isSelected ? 'var(--editor-code-bg, rgba(120, 120, 120, 0.15))' : 'transparent'};
          `;

          const typeColors: Record<string, string> = {
            CodeBlock: '#7c3aed',
            Image: '#0369a1',
            Table: '#047857',
            MathBlock: '#7c2d12',
            Output: '#b45309',
            Diagram: '#be185d',
          };
          const color = action === 'exec' ? '#10b981' : typeColors[result.object_type] || '#6a737d';

          const row = document.createElement('div');
          row.style.cssText = 'display: flex; align-items: center; gap: 6px;';

          const badge = document.createElement('span');
          badge.textContent = action === 'exec' ? '▶ Run & Insert' : `📄 Insert ${result.object_type}`;
          badge.style.cssText = `
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: ${color};
            background: ${color}18;
            border-radius: 3px;
            padding: 2px 6px;
            font-family: var(--editor-mono-font, monospace);
          `;

          const name = document.createElement('span');
          name.textContent = result.name;
          name.style.cssText = `
            font-size: 13px;
            font-weight: 500;
            color: ${isSelected ? 'var(--editor-text-color, inherit)' : 'var(--editor-muted, inherit)'};
            font-family: var(--editor-font-family, system-ui);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          `;

          row.appendChild(badge);
          row.appendChild(name);

          const meta = document.createElement('span');
          const file = result.document_path.split('/').pop() || result.document_path;
          meta.textContent =
            action === 'exec'
              ? `Execute this block and write output inline · ${file}`
              : `Insert static transclusion link to block · ${file}`;
          meta.style.cssText = `
            font-size: 10px;
            color: var(--editor-muted, #888);
            font-family: var(--editor-mono-font, monospace);
          `;

          itemEl.appendChild(row);
          itemEl.appendChild(meta);

          itemEl.addEventListener('mouseenter', () => {
            itemEl.style.background = 'var(--editor-code-bg, rgba(120, 120, 120, 0.15))';
          });
          itemEl.addEventListener('mouseleave', () => {
            if (idx !== selected) itemEl.style.background = 'transparent';
          });
          itemEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectItem(view, item);
          });

          dom.appendChild(itemEl);
        });

        const selectedEl = dom.children[selected] as HTMLElement | undefined;
        selectedEl?.scrollIntoView({ block: 'nearest' });
      };

      render(state.field(referencePickerField));

      return {
        dom,
        update(upd: ViewUpdate) {
          const curr = upd.state.field(referencePickerField);
          const prev = upd.startState.field(referencePickerField);
          if (
            curr.items !== prev.items ||
            curr.selectedIndex !== prev.selectedIndex ||
            curr.loading !== prev.loading ||
            curr.query !== prev.query
          ) {
            render(curr);
          }
        },
      };
    },
  };
});

function isDarkMode() {
  return document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
}

function applyPickerStyles(el: HTMLElement) {
  const dark = isDarkMode();
  const bg = dark ? '#1e1e1e' : '#ffffff';
  const text = dark ? '#e5e5e5' : '#1e1e1e';
  const border = dark ? '#333333' : '#e5e5e5';

  el.style.cssText = `
    min-width: 290px;
    max-width: 380px;
    max-height: 300px;
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid var(--editor-border, ${border});
    background-color: var(--editor-bg-color, ${bg});
    color: var(--editor-text-color, ${text});
    box-shadow: 0 10px 30px rgba(0,0,0,0.2), 0 2px 10px rgba(0,0,0,0.1);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 99999;
    position: relative;
  `;
}

// ─── Keymap ───────────────────────────────────────────────────────────────────
export const referencePickerKeymap = keymap.of([
  {
    key: 'ArrowDown',
    run(view) {
      const s = view.state.field(referencePickerField);
      if (!s.active || s.items.length === 0) return false;
      view.dispatch({
        effects: setReferencePickerStateEffect.of({
          selectedIndex: (s.selectedIndex + 1) % s.items.length,
        }),
      });
      return true;
    },
  },
  {
    key: 'ArrowUp',
    run(view) {
      const s = view.state.field(referencePickerField);
      if (!s.active || s.items.length === 0) return false;
      view.dispatch({
        effects: setReferencePickerStateEffect.of({
          selectedIndex: (s.selectedIndex - 1 + s.items.length) % s.items.length,
        }),
      });
      return true;
    },
  },
  {
    key: 'Enter',
    run(view) {
      const s = view.state.field(referencePickerField);
      if (!s.active || s.items.length === 0) return false;
      const item = s.items[Math.min(s.selectedIndex, s.items.length - 1)];
      if (item) {
        selectItem(view, item);
        return true;
      }
      return false;
    },
  },
  {
    key: 'Escape',
    run(view) {
      const s = view.state.field(referencePickerField);
      if (!s.active) return false;
      dismissPicker(view);
      return true;
    },
  },
]);

// Override CodeMirror tooltip wrapper — ensure it always appears on top
export const referencePickerTheme = EditorView.theme({
  '.cm-tooltip': {
    border: 'none !important',
    boxShadow: 'none !important',
    zIndex: '99999 !important',
  },
});

// ─── Bundle ───────────────────────────────────────────────────────────────────
export const referencePickerExtension = [
  // Mount all tooltips on document.body so they escape overflow:hidden parents
  tooltips({ parent: document.body }),
  referencePickerField,
  referencePickerSearchPlugin,
  referencePickerTooltip,
  referencePickerKeymap,
  referencePickerTheme,
];

// ─── Tauri search ─────────────────────────────────────────────────────────────
export async function searchReferences(query: string): Promise<ObjectSearchResult[]> {
  try {
    return await invoke<ObjectSearchResult[]>('search_objects', { query });
  } catch (e) {
    console.error('Failed to search references:', e);
    return [];
  }
}
