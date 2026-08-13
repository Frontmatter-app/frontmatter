import { create } from 'zustand';

export type Stage = 'write' | 'revise' | 'draft';

interface ChromeState {
  /** File explorer visibility. */
  leftSidebarVisible: boolean;
  /** Inspector / review panel visibility. */
  rightSidebarVisible: boolean;
  /**
   * Stage the chrome has asked for. `CenterColumn` owns the authoritative
   * stage (it is persisted in the document), and clears this once applied.
   */
  requestedStage: Stage | null;

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  requestStage: (stage: Stage) => void;
  clearRequestedStage: () => void;
}

/**
 * Window chrome state that both the layout and the application menu drive.
 *
 * Sidebar visibility previously did not exist — both panels were always
 * rendered — so there was nothing for a "Show Explorer" command to act on.
 */
export const useChromeStore = create<ChromeState>((set) => ({
  leftSidebarVisible: true,
  rightSidebarVisible: true,
  requestedStage: null,

  toggleLeftSidebar: () => set((s) => ({ leftSidebarVisible: !s.leftSidebarVisible })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarVisible: !s.rightSidebarVisible })),
  requestStage: (stage) => set({ requestedStage: stage }),
  clearRequestedStage: () => set({ requestedStage: null }),
}));
