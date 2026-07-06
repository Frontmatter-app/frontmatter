import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  reconcileElements,
  getSceneVersion,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { AppState } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';

const EK = 'excalidraw';
const FK = 'excalidraw-files';

interface ExcalidrawSyncOptions {
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  excalidrawAPI: ExcalidrawImperativeAPI;
  isCollaborating: boolean;
  documentId: string;
}

function parseElements(data: string | undefined): OrderedExcalidrawElement[] {
  if (!data) return [];
  try { return JSON.parse(data); } catch { return []; }
}

function serializeElements(elements: readonly OrderedExcalidrawElement[]): string {
  return JSON.stringify(elements);
}

function serializeAppState(appState: Partial<AppState>): string {
  return JSON.stringify(appState);
}

function collectFileElementIds(api: ExcalidrawImperativeAPI): Set<string> {
  const ids = new Set<string>();
  const elements = api.getSceneElements() as any[];
  for (const el of elements) {
    if (el.type === 'image' && el.fileId) ids.add(el.fileId);
  }
  return ids;
}

async function loadFilesFromYMap(
  filesMap: any,
  api: ExcalidrawImperativeAPI,
  synced: Set<string>,
): Promise<void> {
  const entries: any[] = [];
  filesMap.forEach((fileData, id) => {
    if (synced.has(id)) return;
    synced.add(id);
    entries.push({
      id,
      dataURL: fileData.get('dataURL'),
      mimeType: fileData.get('mimeType'),
      created: fileData.get('created'),
    });
  });
  if (entries.length > 0) (api as any).addFiles(entries);
}

function syncNewFiles(
  currentFiles: Map<string, any>,
  ydoc: Y.Doc,
  synced: Set<string>,
): void {
  const filesMap = ydoc.getMap(FK);
  let changed = false;
  currentFiles.forEach((file, id) => {
    if (synced.has(id)) return;
    synced.add(id);
    const entry = new Y.Map();
    entry.set('dataURL', file.dataURL);
    entry.set('mimeType', file.mimeType);
    entry.set('created', file.created);
    filesMap.set(id, entry);
    changed = true;
  });
}

function cleanupOrphanedFiles(
  ydoc: Y.Doc,
  api: ExcalidrawImperativeAPI,
  synced: Set<string>,
): void {
  const used = collectFileElementIds(api);
  const filesMap = ydoc.getMap(FK);
  filesMap.forEach((_, id) => {
    if (!used.has(id)) {
      filesMap.delete(id);
      synced.delete(id);
    }
  });
}

export function useExcalidrawSync({
  ydoc,
  awareness,
  excalidrawAPI,
  isCollaborating,
  documentId,
}: ExcalidrawSyncOptions) {
  const applyingRemoteRef = useRef(false);
  const syncedFileIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!isCollaborating) return;
    applyingRemoteRef.current = true;

    const filesMap: any = ydoc.getMap(FK);
    loadFilesFromYMap(filesMap, excalidrawAPI, syncedFileIdsRef.current);

    const map = ydoc.getMap(EK);
    const storedElements = map.get('elements') as string | undefined;
    if (storedElements) {
      const elements = parseElements(storedElements);
      (excalidrawAPI as any).updateScene({
        elements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }

    applyingRemoteRef.current = false;
  }, [ydoc, excalidrawAPI, isCollaborating, documentId]);

  useEffect(() => {
    if (!isCollaborating) return;
    const map = ydoc.getMap(EK);

    const observer = (_ev: Y.YMapEvent<any>, tx?: Y.Transaction) => {
      if (tx?.origin === ydoc.clientID || applyingRemoteRef.current) return;

      const storedElements = map.get('elements') as string | undefined;
      if (!storedElements) return;

      applyingRemoteRef.current = true;

      const filesMap: any = ydoc.getMap(FK);
      loadFilesFromYMap(filesMap, excalidrawAPI, syncedFileIdsRef.current);

      const remoteElements = parseElements(storedElements) as any;
      const localElements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const appState = excalidrawAPI.getAppState();
      const reconciled = reconcileElements(localElements, remoteElements, appState);

      excalidrawAPI.updateScene({
        elements: reconciled,
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      applyingRemoteRef.current = false;
    };

    map.observe(observer);
    return () => map.unobserve(observer);
  }, [ydoc, excalidrawAPI, isCollaborating, documentId]);

  useEffect(() => {
    if (!isCollaborating) return;

    const unsubChange = excalidrawAPI.onChange((elements, appState, _files) => {
      if (applyingRemoteRef.current) return;

      const map = ydoc.getMap(EK);
      const version = getSceneVersion(elements);

      ydoc.transact(() => {
        map.set('elements', serializeElements(elements));
        map.set('appState', serializeAppState(appState));
        map.set('version', version);
      }, ydoc.clientID);

      const currentFiles = (excalidrawAPI as any).getFiles() as Map<string, any> | undefined;
      if (currentFiles && currentFiles.size > syncedFileIdsRef.current.size) {
        syncNewFiles(currentFiles, ydoc, syncedFileIdsRef.current);
      }
    });

    return () => unsubChange();
  }, [ydoc, excalidrawAPI, isCollaborating, documentId]);

  useEffect(() => {
    if (!isCollaborating) return;
    const filesMap = ydoc.getMap(FK);

    const observer = (_ev: Y.YMapEvent<any>, tx?: Y.Transaction) => {
      if (tx?.origin === ydoc.clientID || applyingRemoteRef.current) return;
      loadFilesFromYMap(filesMap, excalidrawAPI, syncedFileIdsRef.current);
    };

    filesMap.observe(observer);
    return () => filesMap.unobserve(observer);
  }, [ydoc, excalidrawAPI, isCollaborating]);

  useEffect(() => {
    if (!isCollaborating) return;
    const interval = setInterval(() => {
      cleanupOrphanedFiles(ydoc, excalidrawAPI, syncedFileIdsRef.current);
    }, 30000);
    return () => clearInterval(interval);
  }, [ydoc, excalidrawAPI, isCollaborating]);

  useEffect(() => {
    if (!isCollaborating) return;

    const handleAwarenessChange = () => {
      const collaborators = new Map<string, any>();
      awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === ydoc.clientID) return;
        if (!state.user) return;
        const user = state.user;
        const socketId = String(clientId);
        collaborators.set(socketId, {
          id: user.uid || socketId,
          socketId,
          username: user.name || 'Collaborator',
          avatarUrl: user.photo || null,
          color: user.color ? { background: user.color, stroke: user.color } : undefined,
          pointer: state.pointer ? { x: state.pointer.x, y: state.pointer.y, tool: 'pointer' as const } : undefined,
          isCurrentUser: false,
        });
      });
      (excalidrawAPI as any).updateScene({ collaborators });
    };

    awareness.on('change', handleAwarenessChange);
    return () => awareness.off('change', handleAwarenessChange);
  }, [awareness, excalidrawAPI, isCollaborating, ydoc]);
}
