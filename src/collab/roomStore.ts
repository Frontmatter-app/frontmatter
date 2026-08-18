/**
 * What each open document's room has granted.
 *
 * Kept in a store rather than returned from the hook that joins the room,
 * because the two places that need it are nowhere near that hook: the editor,
 * which must stop accepting typing the server is going to drop, and the title
 * bar, which has to say why. Threading it through the component tree would mean
 * every layer in between knowing about collaboration.
 *
 * Access can change while a document is open — a grant renewed at a lower level
 * once verification catches up with a claim — so this is a live value, not
 * something read once at join time.
 */
import { create } from 'zustand';
import type { RoomAccess, RoomVerification } from './roomGrant';

export interface RoomMembership {
  roomId: string;
  access: RoomAccess;
  verification: RoomVerification;
}

interface RoomStore {
  rooms: Record<string, RoomMembership>;
  join: (documentId: string, membership: RoomMembership) => void;
  setAccess: (documentId: string, access: RoomAccess) => void;
  leave: (documentId: string) => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  rooms: {},

  join: (documentId, membership) =>
    set((state) => ({ rooms: { ...state.rooms, [documentId]: membership } })),

  setAccess: (documentId, access) =>
    set((state) => {
      const existing = state.rooms[documentId];
      if (!existing || existing.access === access) return state;
      return { rooms: { ...state.rooms, [documentId]: { ...existing, access } } };
    }),

  leave: (documentId) =>
    set((state) => {
      if (!(documentId in state.rooms)) return state;
      const rooms = { ...state.rooms };
      delete rooms[documentId];
      return { rooms };
    }),
}));

/**
 * Whether the room forbids writing to this document.
 *
 * False when there is no room at all, which is the common case and must not be
 * mistaken for "no permission": a document with nobody else in it is fully
 * editable, and always has been.
 */
export function isRoomReadOnly(documentId: string | null | undefined): boolean {
  if (!documentId) return false;
  return useRoomStore.getState().rooms[documentId]?.access === 'read';
}
