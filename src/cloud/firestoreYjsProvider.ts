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
} from 'firebase/firestore';
import { db, auth } from '../auth/firebase';
import { ensureUserDocumentExists } from '../auth/authStorage';
import { ensureCloudDocumentExists, CLOUD_DOCUMENTS_COL } from './firestoreSync';
import { uint8ToBase64, base64ToUint8 } from '../lib/base64';
import { getCollabColors } from '../lib/colors';

export interface PresenceData {
  uid: string;
  clientId: number;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  cursor: { anchor: any; head: any } | null;
  color: string;
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
      this.updatesCol = collection(db, CLOUD_DOCUMENTS_COL, docId, 'updates');
      this.presenceCol = collection(db, CLOUD_DOCUMENTS_COL, docId, 'presence');

      // Initialize awareness immediately (doesn't require Firestore access)
      const collabColors = getCollabColors();
      const userColor = collabColors[Math.floor(Math.random() * collabColors.length)];

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
         if (auth.currentUser) {
           ensureUserDocumentExists(auth.currentUser);
           if (this.teamId) {
             await ensureCloudDocumentExists(this.docId, auth.currentUser.uid, this.teamId);
           }
         }
       } catch (e) {
         console.error('[YjsProvider] ensureDocumentAndSync failed:', e);
       }

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
            color: state.user.color || getCollabColors()[0]
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
