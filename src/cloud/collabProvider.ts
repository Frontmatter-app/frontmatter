/**
 * Real-time collaboration transport.
 *
 * A thin wrapper over `y-websocket`'s provider, which speaks the standard Yjs
 * sync protocol against `WS /collab/{docId}` on the backend.
 *
 * What this replaces — `FirestoreYjsProvider` — appended every Yjs update as
 * its own Firestore document and replayed the whole collection on open. It had
 * no sync handshake, so a joining peer never received the existing state: the
 * update log only carried edits made while a provider was attached, and the base
 * state was applied before one existed. Peers ended up with disjoint histories
 * that either never merged or merged into duplicated text. It also never
 * detached its `doc.on('update')` handler, so a context switch left it writing;
 * never destroyed its awareness instance; and read every update ever written on
 * each open, at two extra billed rule reads apiece.
 *
 * Presence keeps the same shape the UI already consumes, so `CollaborationBar`
 * and the Excalidraw bridge did not have to change.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import { auth } from '../auth/firebase';
import { getCollabColors } from '../lib/colors';
import { useSyncStatusStore } from './syncStatusStore';

export interface PresenceData {
  uid: string;
  clientId: number;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  cursor: { anchor: any; head: any } | null;
  color: string;
}

/**
 * A stable colour per user.
 *
 * Was `Math.random()`, so two people in a document routinely drew the same
 * colour and everyone's changed on every reconnect.
 */
function colorForUid(uid: string): string {
  const palette = getCollabColors();
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function collabSocketUrl(): string {
  const explicit = import.meta.env.VITE_COLLAB_WS_URL;
  if (explicit) return String(explicit).replace(/\/$/, '');

  const base = import.meta.env.VITE_MODAL_BASE_URL;
  if (!base) throw new Error('VITE_MODAL_BASE_URL is not configured.');
  return `${String(base).replace(/^http/, 'ws').replace(/\/$/, '')}/collab`;
}

export class CollabProvider {
  public doc: Y.Doc;
  public docId: string;
  public awareness: Awareness;

  private provider: WebsocketProvider;
  private presenceListeners: ((presence: PresenceData[]) => void)[] = [];
  private handleAwarenessChange: () => void;
  private handleStatus: (event: { status: string }) => void;

  constructor(docId: string, ydoc: Y.Doc) {
    this.docId = docId;
    this.doc = ydoc;

    // The id token authorizes the socket; the server resolves read/write access
    // from it before accepting. y-websocket appends the room name to the URL and
    // passes `params` as the query string.
    this.provider = new WebsocketProvider(collabSocketUrl(), docId, ydoc, {
      params: { token: '' },
      connect: false,
    });
    this.awareness = this.provider.awareness;

    const user = auth.currentUser;
    this.awareness.setLocalStateField('user', {
      uid: user?.uid || null,
      name: user?.displayName || user?.email?.split('@')[0] || 'Co-author',
      email: user?.email || null,
      color: colorForUid(user?.uid || 'anonymous'),
      photo: user?.photoURL || null,
    });

    this.handleAwarenessChange = () => this.emitPresence();
    this.awareness.on('change', this.handleAwarenessChange);

    this.handleStatus = ({ status }) => {
      const store = useSyncStatusStore.getState();
      if (status === 'connected') store.setSynced();
      else if (status === 'disconnected') store.setOffline();
    };
    this.provider.on('status', this.handleStatus);

    void this.connectWithToken();
  }

  /** Tokens expire, so it is fetched per connection attempt rather than once. */
  private async connectWithToken(): Promise<void> {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        useSyncStatusStore.getState().setError('Sign in to collaborate');
        return;
      }
      (this.provider as any).params = { token };
      this.provider.connect();
    } catch (err) {
      console.error('[collab] Could not open the collaboration socket:', err);
      useSyncStatusStore.getState().setError('Collaboration unavailable');
    }
  }

  private emitPresence(): void {
    const list: PresenceData[] = [];
    this.awareness.getStates().forEach((state: any, clientId: number) => {
      if (clientId === this.doc.clientID || !state?.user) return;
      list.push({
        uid: state.user.uid || String(clientId),
        clientId,
        displayName: state.user.name,
        email: state.user.email ?? null,
        photoURL: state.user.photo ?? null,
        cursor: state.cursor ?? null,
        color: state.user.color || getCollabColors()[0],
      });
    });
    this.presenceListeners.forEach((listener) => listener(list));
  }

  public onPresence(callback: (presence: PresenceData[]) => void) {
    this.presenceListeners.push(callback);
    // Deliver what is already known, so a late subscriber is not blank until
    // the next change.
    callback([]);
    this.emitPresence();
    return () => {
      this.presenceListeners = this.presenceListeners.filter((l) => l !== callback);
    };
  }

  public destroy(): void {
    this.awareness.off('change', this.handleAwarenessChange);
    this.provider.off('status', this.handleStatus);
    this.presenceListeners = [];
    // Destroys the awareness instance and its interval, disconnects the socket,
    // and detaches the document update handler — all of which the Firestore
    // provider leaked.
    this.provider.destroy();
  }
}
