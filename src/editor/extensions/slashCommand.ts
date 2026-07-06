import { EditorState, StateField, StateEffect } from '@codemirror/state';
import { EditorView, showTooltip, keymap, tooltips, ViewUpdate } from '@codemirror/view';
import { useExcalidrawStore } from '../../excalidraw/excalidrawStore';

interface SlashCommandItem {
  label: string;
  icon: string;
  action: string;
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  { label: 'Create Excalidraw Image', icon: '🎨', action: 'create-excalidraw-image' },
];

export interface SlashCommandState {
  active: boolean;
  query: string;
  from: number;
  to: number;
  items: SlashCommandItem[];
  selectedIndex: number;
}

export const setSlashCommandStateEffect = StateEffect.define<Partial<SlashCommandState>>();

export const slashCommandField = StateField.define<SlashCommandState>({
  create() {
    return { active: false, query: '', from: 0, to: 0, items: [], selectedIndex: 0 };
  },

  update(state, tr) {
    let next = state;

    for (const effect of tr.effects) {
      if (effect.is(setSlashCommandStateEffect)) {
        next = { ...next, ...effect.value };
      }
    }

    if (!tr.docChanged && tr.selection === undefined) return next;

    const sel = tr.state.selection.main;
    if (!sel.empty) {
      return { ...next, active: false, query: '', items: [] };
    }

    const line = tr.state.doc.lineAt(sel.head);
    const cursorCol = sel.head - line.from;

    const atIndex = line.text.lastIndexOf('/', cursorCol - 1);
    if (atIndex < 0) {
      return { ...next, active: false, query: '', items: [] };
    }

    const between = line.text.slice(atIndex + 1, cursorCol);
    if (between.includes(' ')) {
      return { ...next, active: false, query: '', items: [] };
    }

    const query = between.toLowerCase();
    const from = line.from + atIndex;
    const to = sel.head;

    const items = SLASH_COMMANDS.filter(item =>
      item.label.toLowerCase().includes(query)
    );

    const queryChanged = !next.active || next.from !== from || next.query !== query;
    if (queryChanged) {
      return { ...next, active: true, query, from, to, items, selectedIndex: 0 };
    }

    return { ...next, to };
  },
});

let _currentDocumentId: string | null = null;

export function setSlashCommandDocumentId(id: string | null) {
  _currentDocumentId = id;
}

function getStage(view: EditorView): string | null {
  const el = view.dom.closest('[data-stage]');
  return el?.getAttribute('data-stage') ?? null;
}

export function executeSlashCommand(view: EditorView, item: SlashCommandItem) {
  const stage = getStage(view);
  if (stage !== 'write') return;

  const state = view.state.field(slashCommandField);
  dismissPicker(view);

  if (item.action === 'create-excalidraw-image') {
    if (_currentDocumentId) {
      useExcalidrawStore.getState().open({
        mode: 'new-drawing',
        documentId: _currentDocumentId,
      });
    }
  }
}

export function dismissPicker(view: EditorView) {
  view.dispatch({
    effects: setSlashCommandStateEffect.of({ active: false, query: '', items: [] }),
  });
}

const slashCommandTooltip = showTooltip.compute([slashCommandField], (state: EditorState) => {
  const picker = state.field(slashCommandField);
  if (!picker.active) return null;

  return {
    pos: picker.from,
    above: false,
    strictSide: true,
    arrow: false,
    create(view: EditorView) {
      const dom = document.createElement('div');
      applyPickerStyles(dom);

      const render = (pState: SlashCommandState) => {
        dom.innerHTML = '';

        if (pState.items.length === 0) {
          dom.style.display = 'none';
          return;
        }

        const selected = Math.min(pState.selectedIndex, pState.items.length - 1);

        pState.items.forEach((item, idx) => {
          const isSelected = idx === selected;
          const itemEl = document.createElement('div');

          itemEl.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-family: var(--editor-font-family, system-ui);
            background: ${isSelected ? 'var(--editor-code-bg, rgba(120, 120, 120, 0.15))' : 'transparent'};
            color: var(--editor-text-color, #111);
          `;

          const icon = document.createElement('span');
          icon.textContent = item.icon;
          icon.style.cssText = 'font-size: 14px;';

          const label = document.createElement('span');
          label.textContent = item.label;
          label.style.cssText = `
            font-weight: ${isSelected ? '500' : '400'};
          `;

          itemEl.appendChild(icon);
          itemEl.appendChild(label);

          itemEl.addEventListener('mouseenter', () => {
            itemEl.style.background = 'var(--editor-code-bg, rgba(120, 120, 120, 0.15))';
          });
          itemEl.addEventListener('mouseleave', () => {
            if (idx !== selected) itemEl.style.background = 'transparent';
          });
          itemEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            executeSlashCommand(view, item);
          });

          dom.appendChild(itemEl);
        });

        const selectedEl = dom.children[selected] as HTMLElement | undefined;
        selectedEl?.scrollIntoView({ block: 'nearest' });
      };

      render(state.field(slashCommandField));

      return {
        dom,
        update(upd: ViewUpdate) {
          const curr = upd.state.field(slashCommandField);
          const prev = upd.startState.field(slashCommandField);
          if (
            curr.items !== prev.items ||
            curr.selectedIndex !== prev.selectedIndex ||
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
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--editor-bg-color') || '#ffffff';
  const text = getComputedStyle(document.documentElement).getPropertyValue('--editor-text-color') || '#111';

  el.style.cssText = `
    min-width: 220px;
    max-width: 320px;
    max-height: 300px;
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid var(--editor-border, rgba(120, 120, 120, 0.18));
    background-color: var(--editor-bg-color, ${bg});
    color: var(--editor-text-color, ${text});
    box-shadow: 0 10px 30px rgba(0,0,0,0.15), 0 2px 10px rgba(0,0,0,0.1);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 99999;
    position: relative;
  `;
}

export const slashCommandKeymap = keymap.of([
  {
    key: 'ArrowDown',
    run(view) {
      const s = view.state.field(slashCommandField);
      if (!s.active || s.items.length === 0) return false;
      view.dispatch({
        effects: setSlashCommandStateEffect.of({
          selectedIndex: (s.selectedIndex + 1) % s.items.length,
        }),
      });
      return true;
    },
  },
  {
    key: 'ArrowUp',
    run(view) {
      const s = view.state.field(slashCommandField);
      if (!s.active || s.items.length === 0) return false;
      view.dispatch({
        effects: setSlashCommandStateEffect.of({
          selectedIndex: (s.selectedIndex - 1 + s.items.length) % s.items.length,
        }),
      });
      return true;
    },
  },
  {
    key: 'Enter',
    run(view) {
      const s = view.state.field(slashCommandField);
      if (!s.active || s.items.length === 0) return false;
      const item = s.items[Math.min(s.selectedIndex, s.items.length - 1)];
      if (item) {
        executeSlashCommand(view, item);
        return true;
      }
      return false;
    },
  },
  {
    key: 'Escape',
    run(view) {
      const s = view.state.field(slashCommandField);
      if (!s.active) return false;
      dismissPicker(view);
      return true;
    },
  },
]);

export const slashCommandTheme = EditorView.theme({
  '.cm-tooltip': {
    border: 'none !important',
    boxShadow: 'none !important',
    zIndex: '99999 !important',
  },
});

export const slashCommandExtension = [
  tooltips({ parent: document.body }),
  slashCommandField,
  slashCommandTooltip,
  slashCommandKeymap,
  slashCommandTheme,
];