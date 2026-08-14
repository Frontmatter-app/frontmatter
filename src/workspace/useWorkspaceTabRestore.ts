import React, { useEffect, useRef } from 'react';
import type { DocumentMeta } from '../types';

interface UseWorkspaceTabRestoreOptions {
  workspacePath: string | null;
  documents: DocumentMeta[];
  setOpenTabs: React.Dispatch<React.SetStateAction<string[]>>;
  setCurrentDocumentId: React.Dispatch<React.SetStateAction<string | null>>;
  refreshDocuments: () => Promise<unknown>;
  refreshDirectoryTree: () => Promise<void>;
}

export const tabsStorageKey = (workspacePath: string) => `marktype_tabs_${workspacePath}`;
export const activeStorageKey = (workspacePath: string) => `marktype_active_${workspacePath}`;

interface PendingRestore {
  workspacePath: string;
  tabs: string[];
  active: string | null;
}

function readSavedTabs(workspacePath: string): PendingRestore | null {
  const savedTabs = localStorage.getItem(tabsStorageKey(workspacePath));
  if (!savedTabs) return null;

  try {
    const tabs = JSON.parse(savedTabs) as string[];
    if (!Array.isArray(tabs) || tabs.length === 0) {
      localStorage.removeItem(tabsStorageKey(workspacePath));
      localStorage.removeItem(activeStorageKey(workspacePath));
      return null;
    }
    return {
      workspacePath,
      tabs: tabs.filter(id => typeof id === 'string'),
      active: localStorage.getItem(activeStorageKey(workspacePath)),
    };
  } catch {
    localStorage.removeItem(tabsStorageKey(workspacePath));
    localStorage.removeItem(activeStorageKey(workspacePath));
    return null;
  }
}

/**
 * Restores the tab strip for the workspace the window is now showing.
 *
 * Two things went wrong before. Switching workspaces left the previous
 * workspace's tabs open, and because document ids are scoped to a workspace's
 * SQLite database, opening one of those stale tabs made the document loader
 * fall back to Firestore and *recreate* the row in the new workspace — a
 * personal document quietly materialising inside a team workspace. And the
 * restore filtered saved ids against the local database alone, so a team
 * member's cloud-only documents were dropped before their subscription had
 * even delivered them.
 *
 * Tabs are therefore cleared on every switch, and saved ids are held pending
 * until a matching document actually appears — from either source.
 */
export function useWorkspaceTabRestore(opts: UseWorkspaceTabRestoreOptions) {
  const {
    workspacePath, documents, setOpenTabs, setCurrentDocumentId,
    refreshDocuments, refreshDirectoryTree,
  } = opts;

  const pendingRef = useRef<PendingRestore | null>(null);

  useEffect(() => {
    setOpenTabs([]);
    setCurrentDocumentId(null);
    pendingRef.current = null;

    if (!workspacePath) return;

    pendingRef.current = readSavedTabs(workspacePath);
    void refreshDocuments();
    void refreshDirectoryTree();
    // `refreshDocuments`/`refreshDirectoryTree` are recreated whenever the
    // workspace changes, so depending on them here would re-run the reset.
  }, [workspacePath, setOpenTabs, setCurrentDocumentId]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || pending.workspacePath !== workspacePath) return;

    const live = new Set(documents.map(d => d.id));
    const resolved = pending.tabs.filter(id => live.has(id));
    if (resolved.length === 0) return;

    setOpenTabs(previous => {
      const next = [...previous];
      for (const id of resolved) if (!next.includes(id)) next.push(id);
      return next;
    });

    setCurrentDocumentId(previous => {
      if (previous) return previous;
      const preferred = pending.active && live.has(pending.active) ? pending.active : resolved[0];
      return preferred ?? null;
    });

    const remaining = pending.tabs.filter(id => !live.has(id));
    pendingRef.current = remaining.length > 0 ? { ...pending, tabs: remaining } : null;
  }, [documents, workspacePath, setOpenTabs, setCurrentDocumentId]);
}
