/**
 * The explorer's data boundary.
 *
 * One view renders every tree; a source decides where nodes come from and what
 * a mutation means. Adding a backend means adding a source, not another branch
 * inside the view or the context menu.
 */

import type { ExplorerNode, ExplorerSourceId } from './explorerModel';

/**
 * What the user may do in this source right now.
 *
 * This folds together what the backend supports and what the user is permitted
 * to do, so the context menu can render from one object instead of recomputing
 * a permission expression per item.
 */
export interface ExplorerCapabilities {
  createFile: boolean;
  createFolder: boolean;
  renameFile: boolean;
  renameFolder: boolean;
  deleteFile: boolean;
  deleteFolder: boolean;
  /** Drag-and-drop within this source. */
  move: boolean;
  revealInFinder: boolean;
  /** Per-file team access lists. Team owners only. */
  managePermissions: boolean;
  /** Pin a cloud document for offline use. */
  offlineToggle: boolean;
}

export const NO_CAPABILITIES: ExplorerCapabilities = {
  createFile: false,
  createFolder: false,
  renameFile: false,
  renameFolder: false,
  deleteFile: false,
  deleteFolder: false,
  move: false,
  revealInFinder: false,
  managePermissions: false,
  offlineToggle: false,
};

/**
 * Accepts a node dragged in from the other source.
 *
 * Cross-source drops are conversions, not moves: local to cloud publishes a
 * copy to the team, cloud to local pulls one down to disk. Both keep the
 * original, which is why neither is expressed as `move`.
 */
export interface ExplorerTransfer {
  /** Verb shown while dragging, e.g. "Add to team". */
  label: string;
  accept: (node: ExplorerNode, targetFolder: ExplorerNode | null) => Promise<void>;
}

export interface ExplorerSource {
  id: ExplorerSourceId;
  /** Section heading, e.g. the folder name or the team name. */
  label: string;
  tree: ExplorerNode | null;
  capabilities: ExplorerCapabilities;
  /** Shown when the source has a root but no entries. */
  emptyMessage: string;
  /** Shown instead of a tree when there is no root at all. */
  unavailableMessage?: string;
  /** Action offered alongside `unavailableMessage`, e.g. "Open Folder". */
  onActivate?: () => void;
  activateLabel?: string;
  /**
   * Extra control in the section header, e.g. switching which folder is open.
   * The section header names the source, so source-level actions belong beside
   * that name rather than in a separate row above it.
   */
  headerAction?: { label: string; run: () => void };

  open: (node: ExplorerNode) => Promise<void>;
  /** `parent` is `null` for the source root. */
  createFile: (parent: ExplorerNode | null, name: string) => Promise<void>;
  createFolder: (parent: ExplorerNode | null, name: string) => Promise<void>;
  rename: (node: ExplorerNode, newName: string) => Promise<void>;
  remove: (node: ExplorerNode) => Promise<void>;
  move: (node: ExplorerNode, targetFolder: ExplorerNode | null) => Promise<void>;

  transfer?: ExplorerTransfer;
  revealInFinder?: (node: ExplorerNode) => Promise<void>;
  setOffline?: (node: ExplorerNode, enabled: boolean) => Promise<void>;
  /** Detaches a document from the cloud without deleting the local file. */
  unsync?: (node: ExplorerNode) => Promise<void>;
}
