import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { MENU_COMMANDS, setMenuDocumentId } from './menuCommands';

/**
 * Subscribes to every native menu command this module owns.
 *
 * One listener per command, torn down together. File and export commands are
 * owned by `workspace/useMenuEvents`; this covers edit, format, view, go, and
 * the window and help items.
 */
export function useMenuCommands(): void {
  const { currentDocumentId } = useWorkspace();

  useEffect(() => {
    setMenuDocumentId(currentDocumentId);
  }, [currentDocumentId]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    for (const [event, run] of Object.entries(MENU_COMMANDS)) {
      listen(event, () => run())
        .then((unlisten) => {
          // The effect may have been torn down while listen() was pending.
          if (cancelled) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch((error) => console.error(`[menu] could not listen for ${event}`, error));
    }

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
}
