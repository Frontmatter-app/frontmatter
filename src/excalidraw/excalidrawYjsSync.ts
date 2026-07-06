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

const EXCALIDRAW_MAP_KEY = 'excalidraw';

interface ExcalidrawSyncOptions {
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  excalidrawAPI: ExcalidrawImperativeAPI;
  isCollaborating: boolean;
  documentId: string;
}

function parseElements(data: string | undefined): OrderedExcalidrawElement[] {
  if (!data) return [];
  try {
    return JSON.parse(data) as OrderedExcalidrawElement[];
  } catch {
    return [];
  }
}

function parseAppState(data: string | undefined): Partial<AppState> | null {
  if (!data) return null;
  try {
    return JSON.parse(data) as Partial<AppState>;
  } catch {
    return null;
  }
}

function serializeElements(
  elements: readonly OrderedExcalidrawElement[],
): string {
  return JSON.stringify(elements);
}

function serializeAppState(appState: Partial<AppState>): string {
  return JSON.stringify(appState);
}

export function useExcalidrawSync({
  ydoc,
  awareness,
  excalidrawAPI,
  isCollaborating,
  documentId,
}: ExcalidrawSyncOptions) {
  const applyingRemoteRef = useRef(false);

  // Load initial data from Yjs on mount
  useEffect(() => {
    if (!isCollaborating) return;

    const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);
    const storedElements = map.get('elements') as string | undefined;

    if (storedElements) {
      applyingRemoteRef.current = true;
      const elements = parseElements(storedElements);
      (excalidrawAPI as any).updateScene({
        elements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      applyingRemoteRef.current = false;
    }
  }, [ydoc, excalidrawAPI, isCollaborating, documentId]);

  // Observe remote Yjs changes → update Excalidraw canvas
  useEffect(() => {
    if (!isCollaborating) return;

    const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);

    const observer = () => {
      if (applyingRemoteRef.current) return;

      const storedElements = map.get('elements') as string | undefined;
      if (!storedElements) return;

      applyingRemoteRef.current = true;

      const remoteElements = parseElements(storedElements) as any;
      const localElements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const appState = excalidrawAPI.getAppState();
      const reconciled = reconcileElements(
        localElements,
        remoteElements,
        appState,
      );

      excalidrawAPI.updateScene({
        elements: reconciled,
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      applyingRemoteRef.current = false;
    };

    map.observe(observer);
    return () => map.unobserve(observer);
  }, [ydoc, excalidrawAPI, isCollaborating, documentId]);

  // Subscribe to Excalidraw onChange → write to Yjs
  useEffect(() => {
    if (!isCollaborating) return;

    const unsubChange = excalidrawAPI.onChange(
      (elements, appState, _files) => {
        if (applyingRemoteRef.current) return;

        const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);
        const version = getSceneVersion(elements);

        ydoc.transact(() => {
          map.set('elements', serializeElements(elements));
          map.set('appState', serializeAppState(appState));
          map.set('version', version);
        }, ydoc.clientID);
      },
    );

    return () => unsubChange();
  }, [ydoc, excalidrawAPI, isCollaborating, documentId]);

  // Map Yjs awareness → Excalidraw collaborators (remote cursors)
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
          color: user.color
            ? { background: user.color, stroke: user.color }
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
    return () => awareness.off('change', handleAwarenessChange);
  }, [awareness, excalidrawAPI, isCollaborating, ydoc]);
}
