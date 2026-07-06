export const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Ctrl';
const shift = '⇧';
const alt = isMac ? '⌥' : 'Alt';

export interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

export interface KeyCombo {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  id: string;
  keys: string[];
  description: string;
  combo: KeyCombo;
  category: string;
}

const SHORTCUTS: ShortcutDef[] = [
  { id: 'new-document', keys: [mod, 'N'], description: 'New document', combo: { key: 'n', meta: true }, category: 'Document' },
  { id: 'save-document', keys: [mod, 'S'], description: 'Save document', combo: { key: 's', meta: true }, category: 'Document' },
  { id: 'switch-account', keys: [mod, shift, 'A'], description: 'Switch account', combo: { key: 'a', meta: true, shift: true }, category: 'Document' },
  { id: 'open-preferences', keys: [mod, ','], description: 'Open preferences', combo: { key: ',', meta: true }, category: 'Document' },
  { id: 'undo', keys: [mod, 'Z'], description: 'Undo', combo: { key: 'z', meta: true }, category: 'Editor' },
  { id: 'redo', keys: [mod, shift, 'Z'], description: 'Redo', combo: { key: 'z', meta: true, shift: true }, category: 'Editor' },
  { id: 'find', keys: [mod, 'F'], description: 'Find in document', combo: { key: 'f', meta: true }, category: 'Editor' },
  { id: 'bold', keys: [mod, 'B'], description: 'Bold', combo: { key: 'b', meta: true }, category: 'Formatting' },
  { id: 'italic', keys: [mod, 'I'], description: 'Italic', combo: { key: 'i', meta: true }, category: 'Formatting' },
  { id: 'code', keys: [mod, 'E'], description: 'Inline Code', combo: { key: 'e', meta: true }, category: 'Formatting' },
  { id: 'insert-link', keys: [mod, 'K'], description: 'Insert Link', combo: { key: 'k', meta: true }, category: 'Formatting' },
  { id: 'open-whiteboard', keys: [mod, shift, 'E'], description: 'Open Whiteboard', combo: { key: 'e', meta: true, shift: true }, category: 'Formatting' },
  { id: 'toggle-focus-mode', keys: [mod, shift, 'F'], description: 'Toggle focus mode', combo: { key: 'f', meta: true, shift: true }, category: 'Workflow' },
  { id: 'switch-write', keys: [mod, shift, '1'], description: 'Switch to Write', combo: { key: '1', meta: true, shift: true }, category: 'Workflow' },
  { id: 'switch-revise', keys: [mod, shift, '2'], description: 'Switch to Revise', combo: { key: '2', meta: true, shift: true }, category: 'Workflow' },
  { id: 'switch-draft', keys: [mod, shift, '3'], description: 'Switch to Draft', combo: { key: '3', meta: true, shift: true }, category: 'Workflow' },
  { id: 'open-keyboard-shortcuts', keys: [mod, shift, 'K'], description: 'Open keyboard shortcuts', combo: { key: 'k', meta: true, shift: true }, category: 'Navigation' },
  { id: 'move-section-up', keys: [alt, '↑'], description: 'Move to previous section', combo: { key: 'ArrowUp', alt: true }, category: 'Navigation' },
  { id: 'move-section-down', keys: [alt, '↓'], description: 'Move to next section', combo: { key: 'ArrowDown', alt: true }, category: 'Navigation' },
];

export function getShortcutGroups(): ShortcutGroup[] {
  const map = new Map<string, ShortcutDef[]>();
  for (const s of SHORTCUTS) {
    if (!map.has(s.category)) map.set(s.category, []);
    map.get(s.category)!.push(s);
  }
  return Array.from(map.entries()).map(([title, shortcuts]) => ({ title, shortcuts }));
}

export const SHORTCUTS_BY_ID = Object.fromEntries(SHORTCUTS.map(s => [s.id, s])) as Record<string, ShortcutDef>;
export const SHORTCUT_IDS = SHORTCUTS.map(s => s.id);

export function matchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  const key = e.key.toLowerCase();
  if (key === 'meta' || key === 'control' || key === 'shift' || key === 'alt') return false;
  const metaMatch = combo.meta ? (e.metaKey || e.ctrlKey) : (!e.metaKey && !e.ctrlKey);
  const shiftMatch = combo.shift ? e.shiftKey : !e.shiftKey;
  const altMatch = combo.alt ? e.altKey : !e.altKey;
  return key === combo.key.toLowerCase() && metaMatch && shiftMatch && altMatch;
}
