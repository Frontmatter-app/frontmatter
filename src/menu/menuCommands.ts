import { openSearchPanel } from '@codemirror/search';
import { withActiveEditor } from '../editor/activeEditor';
import {
  boldCommand,
  codeCommand,
  italicCommand,
  linkCommand,
} from '../editor/formatting/commands';
import { useChromeStore } from '../layout/chromeStore';
import { useExcalidrawStore } from '../excalidraw/excalidrawStore';
import { useSettingsStore } from '../settings/settingsStore';

/**
 * What each native menu command does in the frontend.
 *
 * `menuCommands.test.ts` reads the routing table in `menu_events.rs` and fails
 * if any forwarded event is missing from here, so the menu cannot ship an item
 * that silently does nothing.
 *
 * Commands already owned elsewhere — file operations, export, settings — are
 * listed in `HANDLED_ELSEWHERE` with the module that owns them.
 */

/** Notifies a component that owns state this module cannot reach. */
const broadcast = (name: string, detail?: unknown) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

export const MENU_COMMANDS: Record<string, () => void> = {
  // -- Edit ---------------------------------------------------------------
  'menu-find': () => {
    withActiveEditor((view) => openSearchPanel(view));
  },

  // -- Format -------------------------------------------------------------
  'menu-format-bold': () => {
    withActiveEditor((view) => boldCommand.apply(view));
  },
  'menu-format-italic': () => {
    withActiveEditor((view) => italicCommand.apply(view));
  },
  'menu-format-code': () => {
    withActiveEditor((view) => codeCommand.apply(view));
  },
  'menu-format-link': () => {
    withActiveEditor((view) => linkCommand.apply(view));
  },
  'menu-open-whiteboard': () => {
    if (currentDocumentId) {
      useExcalidrawStore.getState().open({ mode: 'new-drawing', documentId: currentDocumentId });
    }
  },

  // -- View ---------------------------------------------------------------
  'menu-stage-write': () => useChromeStore.getState().requestStage('write'),
  'menu-stage-revise': () => useChromeStore.getState().requestStage('revise'),
  'menu-stage-draft': () => useChromeStore.getState().requestStage('draft'),
  'menu-toggle-focus-mode': () => broadcast('toggle-focus-mode'),
  'menu-toggle-left-sidebar': () => useChromeStore.getState().toggleLeftSidebar(),
  'menu-toggle-right-sidebar': () => useChromeStore.getState().toggleRightSidebar(),

  // -- Go -----------------------------------------------------------------
  'menu-prev-section': () => broadcast('move-section', -1),
  'menu-next-section': () => broadcast('move-section', 1),

  // -- Window & Help ------------------------------------------------------
  'menu-switch-account': () => broadcast('open-account-switcher'),
  'menu-activity-monitor': () => broadcast('open-activity-monitor'),
  'menu-keyboard-shortcuts': () => broadcast('open-keyboard-shortcuts'),
  'menu-check-updates': () => useSettingsStore.getState().openSettings('updates'),
};

/**
 * Forwarded events handled by a component rather than by this registry, and
 * where. Kept here so the contract test can account for every routed event.
 */
export const HANDLED_ELSEWHERE: Record<string, string> = {
  'menu-new-file': 'workspace/useMenuEvents',
  'menu-new-folder': 'workspace/useMenuEvents',
  'menu-open-file': 'workspace/useMenuEvents',
  'menu-open-folder': 'workspace/useMenuEvents',
  'menu-save': 'workspace/useMenuEvents',
  'menu-save-as': 'workspace/useMenuEvents',
  'menu-toggle-auto-save': 'workspace/useMenuEvents',
  'menu-clone-repository': 'workspace/useMenuEvents',
  'menu-export-file-pdf': 'workspace/useMenuEvents',
  'menu-export-file-html': 'workspace/useMenuEvents',
  'menu-export-file-markdown': 'workspace/useMenuEvents',
  'menu-export-project': 'workspace/useMenuEvents',
  'menu-settings': 'settings/SettingsModal',
};

/** Every menu event the frontend accounts for. */
export function handledMenuEvents(): string[] {
  return [...Object.keys(MENU_COMMANDS), ...Object.keys(HANDLED_ELSEWHERE)].sort();
}

/**
 * The whiteboard command needs the open document, which lives in workspace
 * state. `useMenuCommands` keeps this in step.
 */
let currentDocumentId: string | null = null;

export function setMenuDocumentId(id: string | null): void {
  currentDocumentId = id;
}
