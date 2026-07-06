import { useEffect } from 'react';
import { matchesCombo, SHORTCUTS_BY_ID } from './shortcuts';
import { useExcalidrawStore } from '../excalidraw/excalidrawStore';
import { useSettingsStore } from '../settings/settingsStore';

let _currentDocId: string | null = null;
export function setCurrentDocId(id: string | null) {
  _currentDocId = id;
}

const GLOBAL_ACTIONS: Record<string, () => void> = {
  'toggle-focus-mode': () => window.dispatchEvent(new CustomEvent('toggle-focus-mode')),
  'open-whiteboard': () => {
    if (_currentDocId) {
      useExcalidrawStore.getState().open({ mode: 'new-drawing', documentId: _currentDocId });
    }
  },
  'open-preferences': () => useSettingsStore.getState().openSettings(),
  'switch-account': () => window.dispatchEvent(new CustomEvent('open-account-switcher')),
  'new-document': () => window.dispatchEvent(new CustomEvent('new-document')),
};

export function useGlobalShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput) return;

      for (const [id, action] of Object.entries(GLOBAL_ACTIONS)) {
        const shortcut = SHORTCUTS_BY_ID[id];
        if (shortcut && matchesCombo(e, shortcut.combo)) {
          e.preventDefault();
          action();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}
