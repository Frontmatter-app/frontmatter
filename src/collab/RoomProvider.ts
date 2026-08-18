/**
 * A live editing session for one file, on one branch, in one repository.
 *
 * Succeeds `cloud/collabProvider.ts`, which was named for a cloud that no
 * longer exists and addressed rooms by a client-generated document UUID — an id
 * meaningful only on the machine that minted it, so two people opening the same
 * file could never have met in the same room.
 *
 * Three things changed with the move, all of them load-bearing:
 *
 * **The room is named by the server.** A coordinate goes up, a room id comes
 * back. Everyone who opens that file gets that id, which is what makes
 * collaboration possible at all.
 *
 * **The socket authenticates with a grant, not a session.** The grant names one
 * room, so it cannot be pointed at another document.
 *
 * **Awareness is injected, not created.** The editor binds its cursor extension
 * at construction, so an awareness instance swapped underneath it is simply
 * ignored — the caret would render for nobody. The registry owns one instance
 * per open document for its whole life, and hands it here.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import { getCurrentUser } from '../auth/session';
import { getCollabSocketUrl } from '../api/serverUrl';
import { getCollabColors } from '../lib/colors';
import { useSyncStatusStore } from '../cloud/syncStatusStore';
import { MSG_ACCESS, encodeGrant } from './roomProtocol';
import { millisecondsUntilRenewal, type RoomAccess, type RoomGrant } from './roomGrant';

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
  const url = getCollabSocketUrl();
  // Reaching here without a server is a programming error rather than a user
  // one: a room is only ever opened after a grant, and a grant requires a
  // server to have issued it.
  if (!url) throw new Error('No collaboration server is configured.');
  return url;
}

export interface RoomProviderOptions {
  /** Fetches a replacement grant when the current one nears expiry. */
  renew: () => Promise<RoomGrant | null>;
  /** Told whenever the server states what this peer may do. */
  onAccessChange?: (access: RoomAccess | 'none') => void;
}

export class RoomProvider {
  readonly doc: Y.Doc;
  readonly roomId: string;
  readonly awareness: Awareness;

  private provider: WebsocketProvider;
  private grant: RoomGrant;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceListeners: ((presence: PresenceData[]) => void)[] = [];
  private handleAwarenessChange: () => void;
  private handleStatus: (event: { status: string }) => void;
  private destroyed = false;

  constructor(
    grant: RoomGrant,
    ydoc: Y.Doc,
    awareness: Awareness,
    private readonly options: RoomProviderOptions,
  ) {
    this.doc = ydoc;
    this.roomId = grant.roomId;
    this.grant = grant;
    this.awareness = awareness;

    this.provider = new WebsocketProvider(collabSocketUrl(), grant.roomId, ydoc, {
      params: { token: grant.token },
      awareness,
      connect: false,
      // y-websocket treats every close code from 4400 to 4499 as permanent and
      // stops reconnecting for good. That is right for 4403 — being told you
      // may not open this document is not something a retry fixes — and wrong
      // for 4401, which means the grant lapsed and a fresh one would work.
      // Under the default the app would go quietly offline for the rest of the
      // session, with no error and no way back short of a restart.
      shouldReconnect: (event: CloseEvent) => {
        if (event?.code === 4403) return false;
        if (event?.code === 4401) void this.renewNow();
        return true;
      },
    });

    // Registered so the frame is understood rather than merely tolerated:
    // y-websocket logs "Unable to compute message" for any type it has no
    // handler for, which would be one console error per access statement.
    //
    // Acting on it waits for something to act on. Until a verifier exists,
    // every access statement simply confirms the grant this peer already holds,
    // and read-only state is taken from that. When verification can lower
    // access mid-session, this is where the client learns.
    this.provider.messageHandlers[MSG_ACCESS] = () => {};

    const user = getCurrentUser();
    this.awareness.setLocalStateField('user', {
      uid: user?.id || null,
      name: user?.display_name || user?.email?.split('@')[0] || 'Co-author',
      email: user?.email || null,
      color: colorForUid(user?.id || 'anonymous'),
      photo: user?.avatar_url || null,
    });

    this.handleAwarenessChange = () => this.emitPresence();
    this.awareness.on('change', this.handleAwarenessChange);

    this.handleStatus = ({ status }) => {
      const store = useSyncStatusStore.getState();
      if (status === 'connected') store.setSynced();
      else if (status === 'disconnected') store.setOffline();
    };
    this.provider.on('status', this.handleStatus);

    this.scheduleRenewal();
    this.provider.connect();
  }

  /** What this peer may currently do, as the server last stated it. */
  get access(): RoomAccess {
    return this.grant.access;
  }

  /** Replaces the grant over the open socket, rather than by reconnecting. */
  private async renewNow(): Promise<void> {
    if (this.destroyed) return;
    try {
      const next = await this.options.renew();
      if (!next || this.destroyed) return;

      const previousAccess = this.grant.access;
      this.grant = next;
      // Kept in step so that if the socket *does* drop, the reconnect carries
      // a grant that is still valid.
      (this.provider as any).params = { token: next.token };

      const socket = (this.provider as any).ws as WebSocket | null;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(encodeGrant(next.token));
      }
      if (next.access !== previousAccess) {
        this.options.onAccessChange?.(next.access);
      }
      this.scheduleRenewal();
    } catch (error) {
      console.error('[room] Could not renew the room grant:', error);
    }
  }

  private scheduleRenewal(): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    if (this.destroyed) return;
    this.renewTimer = setTimeout(() => void this.renewNow(), millisecondsUntilRenewal(this.grant));
  }

  /**
   * Everyone else currently in the document.
   *
   * Exposed as well as broadcast because two callers want it at a moment of
   * their own choosing rather than on change: the commit path, which asks who
   * else is in the room to decide whether it is empty and to attribute the
   * commit to the people who wrote it.
   */
  peers(): PresenceData[] {
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
    return list;
  }

  private emitPresence(): void {
    const list = this.peers();
    this.presenceListeners.forEach((listener) => listener(list));
  }

  onPresence(callback: (presence: PresenceData[]) => void) {
    this.presenceListeners.push(callback);
    // Deliver what is already known, so a late subscriber is not blank until
    // the next change.
    callback([]);
    this.emitPresence();
    return () => {
      this.presenceListeners = this.presenceListeners.filter((l) => l !== callback);
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.awareness.off('change', this.handleAwarenessChange);
    this.provider.off('status', this.handleStatus);
    this.presenceListeners = [];

    // Safe for the injected awareness: y-websocket's `destroy` detaches its own
    // listener from that instance but does not destroy it. The instance belongs
    // to the registry and outlives this provider — the open editor is still
    // bound to it, and destroying it here would leave every caret bound to a
    // dead object.
    //
    // The local presence entry is cleared first so peers see this cursor go
    // rather than watching a ghost sit there until the server's TTL prunes it.
    this.awareness.setLocalState(null);
    this.provider.destroy();
  }
}
