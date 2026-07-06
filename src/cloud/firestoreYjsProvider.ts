import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
} from 'firebase/firestore';
import { db, auth } from '../auth/AuthProvider';

export interface PresenceData {
  uid: string;          // real Firebase uid (from awareness state.user.uid)
  clientId: number;     // Yjs clientID (ephemeral per-tab)
  displayName: string;
  email: string | null;
  photoURL: string | null;
  cursor: { anchor: any; head: any } | null;
  color: string;
}

/** Encode a Uint8Array to a base64 string without using Node's Buffer. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode a base64 string back to a Uint8Array without using Node's Buffer. */
function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class FirestoreYjsProvider {
   public doc: Y.Doc;
   public docId: string;
   public awareness: awarenessProtocol.Awareness;
   private updatesCol: any;
   private presenceCol: any;
   private unsubscribeUpdates: (() => void) | null = null;
   private unsubscribePresence: (() => void) | null = null;
   private presenceListeners: ((presence: PresenceData[]) => void)[] = [];
   private presenceThrottleTimeout: any = null;
   private teamId: string | null;

   constructor(docId: string, ydoc: Y.Doc, teamId?: string | null) {
     this.docId = docId;
     this.doc = ydoc;
     this.awareness = new awarenessProtocol.Awareness(ydoc);
     this.teamId = teamId || null;
     this.updatesCol = collection(db, 'cloud_documents', docId, 'updates');
     this.presenceCol = collection(db, 'cloud_documents', docId, 'presence');

     // Initialize awareness immediately (doesn't require Firestore access)
     const colors = [
       '#FF5733', '#33FF57', '#3357FF', '#FF33A1', '#A133FF',
       '#33FFF0', '#F3FF33', '#FF8F33', '#8FFF33', '#FF3333'
     ];
     const userColor = colors[Math.floor(Math.random() * colors.length)];

     this.awareness.setLocalStateField('user', {
       uid: auth.currentUser?.uid || null,
       name: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Co-author',
       email: auth.currentUser?.email || null,
       color: userColor,
       photo: auth.currentUser?.photoURL || null
     });

     // Verify document access and initialize sync
     this.ensureDocumentAndSync();
   }

  private async ensureDocumentAndSync(): Promise<void> {
      try {
        const docRef = doc(db, 'cloud_documents', this.docId);
        const snap = await getDoc(docRef);

        // Update user profile updatedAt to record last active timestamp
        if (auth.currentUser) {
          const userRef = doc(db, 'users', auth.currentUser.uid);
          setDoc(userRef, { updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
        }

        if (!snap.exists() && auth.currentUser && this.teamId) {
          await setDoc(docRef, {
            id: this.docId,
            ownerId: auth.currentUser.uid,
            teamId: this.teamId,
            title: '',
            content: '',
            stage: 'write',
            focusMode: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (e) {
        console.error('[YjsProvider] ensureDocumentAndSync failed:', e);
      }

      // Attach listeners - rules will validate permissions
      this.initUpdatesSync();
      this.initPresenceSync();
  }

// Sync Yjs doc updates
   private initUpdatesSync() {
     this.doc.on('update', (update: Uint8Array, origin: any) => {
       if (origin === this) return;
       const updateBase64 = uint8ToBase64(update);
       addDoc(this.updatesCol, {
         update: updateBase64,
         senderId: auth.currentUser?.uid || 'anonymous',
         createdAt: serverTimestamp()
       }).catch((err) => {
         if (err?.code !== 'permission-denied') {
           console.error('[YjsProvider] Yjs update write failed:', err);
         }
       });
     });

     const updatesQuery = query(this.updatesCol, orderBy('createdAt', 'asc'));
     this.unsubscribeUpdates = onSnapshot(updatesQuery, (snapshot) => {
       snapshot.docChanges().forEach((change) => {
         if (change.type === 'added') {
           const data = change.doc.data() as any;
           if (data && data.update) {
             const updateBytes = base64ToUint8(data.update);
             try {
               Y.applyUpdate(this.doc, updateBytes, this);
             } catch (e) {}
           }
         }
       });
     }, (err) => {
       if (err?.code !== 'permission-denied') {
         console.error('[YjsProvider] Yjs listener failed:', err);
       }
     });
   }

// Sync awareness cursor presence
   private initPresenceSync() {
     const clientId = String(this.doc.clientID);
     const presenceDocRef = doc(this.presenceCol, clientId);

     // Write initial local state
     const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
     const updateBase64 = uint8ToBase64(update);
     setDoc(presenceDocRef, {
       update: updateBase64,
       updatedAt: serverTimestamp()
     }).catch((err) => {
       console.error('[YjsProvider] Initial presence write failed:', err);
     });

    let pendingUpdate = false;
    const sendLocalPresence = () => {
      pendingUpdate = false;
      const localUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
      const localBase64 = uint8ToBase64(localUpdate);
      setDoc(presenceDocRef, {
        update: localBase64,
        updatedAt: serverTimestamp()
      }, { merge: true }).catch((err) => {
        console.error('[YjsProvider] Presence update failed:', err);
      });
    };

    // Watch local awareness changes
    this.awareness.on('update', ({ added, updated, removed }: any, origin: any) => {
      if (origin === this) return;

      if (!this.presenceThrottleTimeout) {
        sendLocalPresence();
        this.presenceThrottleTimeout = setTimeout(() => {
          this.presenceThrottleTimeout = null;
          if (pendingUpdate) {
            sendLocalPresence();
          }
        }, 800);
      } else {
        pendingUpdate = true;
      }
    });

    // Listen to remote awareness changes
    this.unsubscribePresence = onSnapshot(this.presenceCol, (snapshot) => {
      const activePresence: PresenceData[] = [];
      const now = Date.now();

      snapshot.forEach((sdoc) => {
        const data = sdoc.data() as any;
        const cid = Number(sdoc.id);

        if (data && cid !== this.doc.clientID && data.update) {
          // Check if remote presence is stale (older than 60s)
          const updatedAt = data.updatedAt?.toDate();
          if (updatedAt && now - updatedAt.getTime() > 60000) {
            const stDocRef = doc(this.presenceCol, sdoc.id);
            deleteDoc(stDocRef).catch(() => {});
            return;
          }

          const updateBytes = base64ToUint8(data.update);
          try {
            awarenessProtocol.applyAwarenessUpdate(this.awareness, updateBytes, this);
          } catch (e) {
            console.error('[YjsProvider] Failed to apply remote awareness:', e);
          }
        }
      });

      // Map Yjs awareness states to our simple presence list for CollaborationBar
      this.awareness.getStates().forEach((state: any, cid: number) => {
        if (cid !== this.doc.clientID && state.user) {
          // Log remote state to diagnose cursor rendering
          console.log('[Collab] Remote state for', cid, '| user:', state.user.name, '| cursor:', state.cursor);
          activePresence.push({
            uid: state.user.uid || String(cid),
            clientId: cid,
            displayName: state.user.name,
            email: state.user.email || null,
            photoURL: state.user.photo || null,
            cursor: state.cursor ?? null,
            color: state.user.color || '#FF5733'
          });
        }
      });

      this.presenceListeners.forEach((listener) => listener(activePresence));
    }, (err) => {
      if (err?.code !== 'permission-denied') {
        console.error('[YjsProvider] Presence listener error:', err);
      }
    });
  }

  public onPresence(callback: (presence: PresenceData[]) => void) {
    this.presenceListeners.push(callback);
    return () => {
      this.presenceListeners = this.presenceListeners.filter(l => l !== callback);
    };
  }

  public destroy() {
    if (this.presenceThrottleTimeout) {
      clearTimeout(this.presenceThrottleTimeout);
    }
    if (this.unsubscribeUpdates) this.unsubscribeUpdates();
    if (this.unsubscribePresence) this.unsubscribePresence();

    const clientId = String(this.doc.clientID);
    const presenceDocRef = doc(this.presenceCol, clientId);
    deleteDoc(presenceDocRef).catch(console.error);
  }
}
