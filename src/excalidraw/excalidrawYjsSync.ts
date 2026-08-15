import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { reconcileElements, CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { ingestImage, resolveImageUrl } from '../images/imageService';
import { blobToDataURL } from '../images/imageUtils';
import type { ImageContext } from '../images/imageTypes';

/**
 * Excalidraw ↔ Yjs bridge.
 *
 * Two things changed here, both about what actually lives in the CRDT:
 *
 *  1. **Elements are stored per id**, not as one serialized array under a single
 *     `Y.Map` key. A single key is last-writer-wins: two people drawing at once
 *     resolved by client id and one scene silently replaced the other. Per-id
 *     entries let concurrent edits to different shapes merge, which is the whole
 *     reason for putting this in a CRDT.
 *
 *  2. **Images are references, not bytes.** Scene images were stored as full
 *     base64 data URIs inside the document, so every scene edit carried them,
 *     they bloated every snapshot and every local save, and any image over
 *     ~700KB permanently failed the old transport's 1 MiB per-update limit. They
 *     now go through the same content-addressed ingest as every other image, and
 *     only the reference travels in the document.
 */

const ELEMENTS_KEY = 'excalidraw-elements';
const FILES_KEY = 'excalidraw-files';
const APPSTATE_KEY = 'excalidraw';

interface ExcalidrawSyncOptions {
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  excalidrawAPI: ExcalidrawImperativeAPI;
  isCollaborating: boolean;
  documentId: string;
  imageContext: ImageContext | null;
}

/** Elements the scene currently uses, so orphaned files can be identified. */
function usedFileIds(api: ExcalidrawImperativeAPI): Set<string> {
  const ids = new Set<string>();
  for (const element of api.getSceneElements() as any[]) {
    if (element.type === 'image' && element.fileId) ids.add(element.fileId);
  }
  return ids;
}

function readElements(ydoc: Y.Doc): OrderedExcalidrawElement[] {
  const map = ydoc.getMap<any>(ELEMENTS_KEY);
  const out: OrderedExcalidrawElement[] = [];
  map.forEach((value) => {
    if (value) out.push(value as OrderedExcalidrawElement);
  });
  return out;
}

/**
 * Writes only what changed.
 *
 * `onChange` fires on pointer move, so rewriting every element each time would
 * put the entire scene into the update stream continuously.
 */
function writeChangedElements(
  ydoc: Y.Doc,
  elements: readonly OrderedExcalidrawElement[],
  lastVersions: Map<string, number>,
  origin: unknown,
): void {
  const map = ydoc.getMap<any>(ELEMENTS_KEY);
  const seen = new Set<string>();
  const changed: OrderedExcalidrawElement[] = [];

  for (const element of elements) {
    seen.add(element.id);
    const version = (element as any).version ?? 0;
    if (lastVersions.get(element.id) !== version) {
      lastVersions.set(element.id, version);
      changed.push(element);
    }
  }

  const removed: string[] = [];
  map.forEach((_value, id) => {
    if (!seen.has(id)) removed.push(id);
  });

  if (changed.length === 0 && removed.length === 0) return;

  ydoc.transact(() => {
    for (const element of changed) map.set(element.id, element);
    for (const id of removed) {
      map.delete(id);
      lastVersions.delete(id);
    }
  }, origin);
}

export function useExcalidrawSync({
  ydoc,
  awareness,
  excalidrawAPI,
  isCollaborating,
  documentId,
  imageContext,
}: ExcalidrawSyncOptions) {
  const applyingRemote = useRef(false);
  const syncedFileIds = useRef(new Set<string>());
  const lastVersions = useRef(new Map<string, number>());
  // A stable per-mount origin, so this client can recognise its own writes
  // without colliding with another client that happens to share a clientID.
  const originRef = useRef({ tag: 'excalidraw-local' });

  /** Pulls file references out of the document and hands Excalidraw the bytes. */
  const loadFiles = useRef(async (api: ExcalidrawImperativeAPI, doc: Y.Doc) => {
    const files = doc.getMap<any>(FILES_KEY);
    const pending: any[] = [];

    files.forEach((entry, id) => {
      if (syncedFileIds.current.has(id) || !entry) return;
      pending.push({ id, ...entry });
    });
    if (pending.length === 0) return;

    for (const entry of pending) {
      try {
        const response = await fetch(resolveImageUrl(entry.assetRef));
        if (!response.ok) continue;
        const dataURL = await blobToDataURL(await response.blob());
        // Marked only on success, so a transient failure retries next pass
        // rather than leaving a permanently blank image.
        syncedFileIds.current.add(entry.id);
        (api as any).addFiles([
          { id: entry.id, dataURL, mimeType: entry.mimeType, created: entry.created ?? Date.now() },
        ]);
      } catch (err) {
        console.warn('[excalidraw] Could not load scene image:', err);
      }
    }
  });

  // Initial hydration.
  useEffect(() => {
    if (!isCollaborating) return;
    applyingRemote.current = true;

    const elements = readElements(ydoc);
    if (elements.length > 0) {
      for (const element of elements) {
        lastVersions.current.set(element.id, (element as any).version ?? 0);
      }
      (excalidrawAPI as any).updateScene({
        elements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    void loadFiles.current(excalidrawAPI, ydoc);

    applyingRemote.current = false;
  }, [ydoc, excalidrawAPI, isCollaborating, documentId]);

  // Remote element changes.
  useEffect(() => {
    if (!isCollaborating) return;
    const map = ydoc.getMap<any>(ELEMENTS_KEY);

    const observer = (_event: Y.YMapEvent<any>, transaction: Y.Transaction) => {
      if (transaction.origin === originRef.current || applyingRemote.current) return;

      applyingRemote.current = true;
      try {
        const remote = readElements(ydoc) as any;
        const local = excalidrawAPI.getSceneElementsIncludingDeleted();
        const reconciled = reconcileElements(local, remote, excalidrawAPI.getAppState());

        for (const element of reconciled as any[]) {
          lastVersions.current.set(element.id, element.version ?? 0);
        }
        excalidrawAPI.updateScene({
          elements: reconciled,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      } finally {
        applyingRemote.current = false;
      }
    };

    map.observe(observer);
    return () => map.unobserve(observer);
  }, [ydoc, excalidrawAPI, isCollaborating, documentId]);

  // Remote file references.
  useEffect(() => {
    if (!isCollaborating) return;
    const files = ydoc.getMap<any>(FILES_KEY);

    const observer = (_event: Y.YMapEvent<any>, transaction: Y.Transaction) => {
      if (transaction.origin === originRef.current) return;
      void loadFiles.current(excalidrawAPI, ydoc);
    };

    files.observe(observer);
    return () => files.unobserve(observer);
  }, [ydoc, excalidrawAPI, isCollaborating]);

  // Local changes out.
  useEffect(() => {
    if (!isCollaborating) return;

    const unsubscribe = excalidrawAPI.onChange((elements, appState) => {
      if (applyingRemote.current) return;

      writeChangedElements(ydoc, elements, lastVersions.current, originRef.current);

      // Appearance is per-viewer, so only the shared bits of app state travel.
      ydoc.transact(() => {
        ydoc.getMap<any>(APPSTATE_KEY).set('viewBackgroundColor', appState.viewBackgroundColor);
      }, originRef.current);

      void publishNewFiles();
    });

    /**
     * Uploads any scene image the document does not yet reference.
     *
     * Excalidraw hands us a data URI; it is ingested like any other image and
     * only the resulting reference is stored.
     */
    async function publishNewFiles() {
      if (!imageContext) return;
      const current = (excalidrawAPI as any).getFiles?.() as Record<string, any> | undefined;
      if (!current) return;

      const files = ydoc.getMap<any>(FILES_KEY);
      for (const [id, file] of Object.entries(current)) {
        if (syncedFileIds.current.has(id) || files.has(id)) continue;
        syncedFileIds.current.add(id);
        try {
          const response = await fetch(file.dataURL);
          const blob = await response.blob();
          const stored = await ingestImage(blob, imageContext, `scene-${id}`);
          ydoc.transact(() => {
            files.set(id, {
              assetRef: stored.url,
              mimeType: file.mimeType,
              created: file.created ?? Date.now(),
            });
          }, originRef.current);
        } catch (err) {
          syncedFileIds.current.delete(id);
          console.warn('[excalidraw] Could not store scene image:', err);
        }
      }
    }

    return () => unsubscribe();
  }, [ydoc, excalidrawAPI, isCollaborating, documentId, imageContext]);

  // Orphaned file references.
  useEffect(() => {
    if (!isCollaborating) return;

    const interval = setInterval(() => {
      const used = usedFileIds(excalidrawAPI);
      const files = ydoc.getMap<any>(FILES_KEY);
      const orphans: string[] = [];
      files.forEach((_value, id) => {
        if (!used.has(id)) orphans.push(id);
      });
      if (orphans.length === 0) return;

      ydoc.transact(() => {
        for (const id of orphans) {
          files.delete(id);
          syncedFileIds.current.delete(id);
        }
      }, originRef.current);
    }, 30000);

    return () => clearInterval(interval);
  }, [ydoc, excalidrawAPI, isCollaborating]);

  // Remote pointers.
  useEffect(() => {
    if (!isCollaborating) return;

    const handleAwarenessChange = () => {
      const collaborators = new Map<string, any>();
      awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === ydoc.clientID || !state?.user) return;
        collaborators.set(String(clientId), {
          id: state.user.uid || String(clientId),
          socketId: String(clientId),
          username: state.user.name || 'Collaborator',
          avatarUrl: state.user.photo || null,
          color: state.user.color
            ? { background: state.user.color, stroke: state.user.color }
            : undefined,
          pointer: state.pointer
            ? { x: state.pointer.x, y: state.pointer.y, tool: 'pointer' as const }
            : undefined,
          isCurrentUser: false,
        });
      });
      (excalidrawAPI as any).updateScene({ collaborators });
    };

    awareness.on('change', handleAwarenessChange);
    handleAwarenessChange();
    return () => awareness.off('change', handleAwarenessChange);
  }, [awareness, excalidrawAPI, isCollaborating, ydoc]);
}
