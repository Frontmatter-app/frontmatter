import { EditorState } from '@codemirror/state';
import { EditorView, showTooltip, ViewUpdate } from '@codemirror/view';
import { referencePickerField, setReferencePickerStateEffect, dismissPicker } from './referencePickerCore';
import { selectItem, filterByScope } from './referencePickerSearch';
import { getPickerScope, setPickerScope, getPickerDocumentPath } from './referencePickerState';
import type { SearchItem, PickerScope, ReferencePickerState } from './referencePickerTypes';

const TYPE_COLORS: Record<string, string> = {
  CodeBlock: 'var(--editor-accent)',
  Image: 'var(--editor-info)',
  Table: 'var(--editor-success)',
  MathBlock: 'var(--editor-warning)',
  Output: 'var(--editor-warning)',
  Diagram: 'var(--editor-error)',
};

export const referencePickerTooltip = showTooltip.compute([referencePickerField], (state: EditorState) => {
  const picker = state.field(referencePickerField);
  if (!picker.active) return null;

  return {
    pos: picker.from,
    above: false,
    strictSide: false,
    arrow: false,
    create(view: EditorView) {
      const dom = document.createElement('div');
      applyPickerStyles(dom);

      const render = (pState: ReferencePickerState) => {
        dom.innerHTML = '';

        const header = document.createElement('div');
        header.style.cssText = `
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 10px 5px;
          border-bottom: 1px solid var(--editor-border);
          margin-bottom: 4px;
        `;

        const label = document.createElement('span');
        label.textContent = 'Scope:';
        label.style.cssText = `
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--editor-muted);
        `;
        header.appendChild(label);

        const scopes: { key: PickerScope; label: string }[] = [
          { key: 'file', label: 'This file' },
          { key: 'folder', label: 'Parent folder' },
          { key: 'workspace', label: 'Workspace' },
        ];

        const currentScope = getPickerScope();

        scopes.forEach(({ key, label: scopeLabel }) => {
          const pill = document.createElement('label');
          pill.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            font-size: 11px;
            color: ${currentScope === key ? 'var(--editor-accent)' : 'var(--editor-muted)'};
            font-weight: ${currentScope === key ? '600' : '400'};
          `;

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = currentScope === key;
          cb.style.cssText = 'accent-color: var(--editor-accent); cursor: pointer; width: 12px; height: 12px;';
          cb.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setPickerScope(key);
            const filtered = filterByScope(pState.allItems, key, getPickerDocumentPath());
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
            color: var(--editor-muted);
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
            color: var(--editor-muted);
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
            background: ${isSelected ? 'var(--editor-accent-bg)' : 'transparent'};
          `;

          const color = action === 'exec' ? 'var(--editor-success)' : (TYPE_COLORS[result.object_type] || 'var(--editor-muted)');

          const row = document.createElement('div');
          row.style.cssText = 'display: flex; align-items: center; gap: 6px;';

          const badge = document.createElement('span');
          badge.textContent = action === 'exec' ? '▶ Run & Insert' : `Insert ${result.object_type}`;
          badge.style.cssText = `
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: ${color};
            background: ${color}18;
            border-radius: 3px;
            padding: 2px 6px;
          `;

          const name = document.createElement('span');
          name.textContent = result.name;
          name.style.cssText = `
            font-size: 13px;
            font-weight: 500;
            color: ${isSelected ? 'var(--editor-text-color)' : 'var(--editor-muted)'};
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
            color: var(--editor-muted);
          `;

          itemEl.appendChild(row);
          itemEl.appendChild(meta);

          itemEl.addEventListener('mouseenter', () => {
            itemEl.style.background = 'var(--editor-accent-bg)';
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

function applyPickerStyles(el: HTMLElement) {
  el.style.cssText = `
    min-width: 290px;
    max-width: min(380px, calc(100vw - 24px));
    max-height: min(300px, calc(100vh - 100px));
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid var(--editor-border);
    background-color: var(--editor-bg-color);
    color: var(--editor-text-color);
    box-shadow: 0 10px 30px rgba(0,0,0,0.2), 0 2px 10px rgba(0,0,0,0.1);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 99999;
    position: relative;
  `;
}
