import { create } from 'zustand';

export type SyncStatusType = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

interface SyncStatusState {
  status: SyncStatusType;
  lastSyncedAt: Date | null;
  errorMessage: string | null;
  cloudDocumentIds: Set<string>;
  setSyncing: () => void;
  setSynced: () => void;
  setError: (msg: string) => void;
  setOffline: () => void;
  setIdle: () => void;
  setCloudDocumentIds: (ids: string[]) => void;
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  errorMessage: null,
  cloudDocumentIds: new Set<string>(),
  setSyncing: () => set({ status: 'syncing', errorMessage: null }),
  setSynced: () => set({ status: 'synced', lastSyncedAt: new Date(), errorMessage: null }),
  setError: (msg) => set({ status: 'error', errorMessage: msg }),
  setOffline: () => set({ status: 'offline', errorMessage: 'No network connection' }),
  setIdle: () => set({ status: 'idle' }),
  setCloudDocumentIds: (ids) => set({ cloudDocumentIds: new Set(ids) }),
}));
