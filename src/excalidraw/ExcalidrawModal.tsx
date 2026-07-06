import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Excalidraw,
  MainMenu,
  exportToBlob,
  CaptureUpdateAction,
  reconcileElements,
  getSceneVersion,
} from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { registry } from '../yjs/DocumentRegistry';
import { useExcalidrawStore } from './excalidrawStore';
import { getAssetUrl } from '../editor/extensions/inlinePreview/widgets';
import { normalizeMarkdownUrl } from '../editor/extensions/inlinePreview/markdown';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';

const EXCALIDRAW_MAP_KEY = 'excalidraw';

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getImageBaseName(imageUrl: string, imageAlt: string | null): string {
  const url = imageUrl.split(/[?#]/)[0];
  const parts = url.split('/');
  const lastPart = parts[parts.length - 1];
  const name = lastPart.includes('.') ? lastPart.replace(/\.[^.]+$/, '') : (imageAlt || 'image');
  return name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'image';
}

async function fetchImageAsDataURL(imageUrl: string): Promise<{ dataURL: string; blob: Blob; width: number; height: number }> {
  const resolvedUrl = getAssetUrl(normalizeMarkdownUrl(imageUrl));
  const response = await fetch(resolvedUrl);
  const blob = await response.blob();
  const dataURL = await blobToDataURL(blob);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataURL;
  });

  return { dataURL, blob, width: img.width, height: img.height };
}

function ExcalidrawSyncBridge({
  api,
  ydoc,
  awareness,
  documentId,
}: {
  api: ExcalidrawImperativeAPI;
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  documentId: string;
}) {
  const applyingRemoteRef = useRef(false);

  // Load initial scene from Yjs (elements + files) on mount
  useEffect(() => {
    const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);
    const storedElements = map.get('elements') as string | undefined;
    const storedFiles = map.get('files') as string | undefined;

    if (storedFiles) {
      try {
        const files: BinaryFiles = JSON.parse(storedFiles);
        const entries = Object.values(files).filter(Boolean) as BinaryFileData[];
        if (entries.length > 0) api.addFiles(entries);
      } catch {}
    }

    if (storedElements) {
      applyingRemoteRef.current = true;
      let elements: any[] = [];
      try { elements = JSON.parse(storedElements); } catch {}
      (api as any).updateScene({
        elements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      applyingRemoteRef.current = false;
    }
  }, []);

  // Observe remote Yjs changes → reconcile + update Excalidraw canvas
  // Skips changes WE wrote (identified by transaction origin === clientID)
  // to prevent feedback loops.
  useEffect(() => {
    const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);

    const observer = (_event: Y.YMapEvent<any>, transaction?: Y.Transaction) => {
      if (transaction?.origin === ydoc.clientID) return;
      if (applyingRemoteRef.current) return;

      const storedElements = map.get('elements') as string | undefined;
      const storedFiles = map.get('files') as string | undefined;
      if (!storedElements) return;

      applyingRemoteRef.current = true;

      let remoteElements: any[] = [];
      try { remoteElements = JSON.parse(storedElements); } catch { applyingRemoteRef.current = false; return; }

      if (storedFiles) {
        try {
          const files: BinaryFiles = JSON.parse(storedFiles);
          const entries = Object.values(files).filter(Boolean) as BinaryFileData[];
          if (entries.length > 0) api.addFiles(entries);
        } catch {}
      }

      const localElements = api.getSceneElementsIncludingDeleted();
      const appState = api.getAppState();
      const reconciled = reconcileElements(localElements, remoteElements as any, appState);

      (api as any).updateScene({
        elements: reconciled,
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      applyingRemoteRef.current = false;
    };

    map.observe(observer);
    return () => map.unobserve(observer);
  }, [ydoc, api, documentId]);

  // Write local changes from Excalidraw to Yjs (elements + files)
  useEffect(() => {
    const unsubChange = api.onChange((elements, appState, files) => {
      if (applyingRemoteRef.current) return;

      const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);
      const version = getSceneVersion(elements as any);

      ydoc.transact(() => {
        map.set('elements', JSON.stringify(elements));
        map.set('appState', JSON.stringify(appState));
        map.set('version', version);

        if (files && Object.keys(files).length > 0) {
          map.set('files', JSON.stringify(files));
        }
      }, ydoc.clientID);
    });

    return () => unsubChange();
  }, [ydoc, api, documentId]);

  // Map Yjs awareness → Excalidraw collaborators (remote cursors)
  useEffect(() => {
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

      (api as any).updateScene({ collaborators });
    };

    awareness.on('change', handleAwarenessChange);
    return () => awareness.off('change', handleAwarenessChange);
  }, [awareness, api, ydoc]);

  return null;
}

export function ExcalidrawModal() {
  const { isOpen, mode, imageUrl, imageAlt, documentId, close } = useExcalidrawStore();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<awarenessProtocol.Awareness | null>(null);
  const [hasRemoteCollab, setHasRemoteCollab] = useState(false);
  const [saving, setSaving] = useState(false);
  const imageLoadingRef = useRef(false);

  // Acquire Ydoc on open — always create awareness (local or provider-backed)
  useEffect(() => {
    if (!isOpen || !documentId) return;

    const load = async () => {
      const doc = await registry.acquire(documentId);
      setYdoc(doc);

      const provider = registry.getProvider(documentId);
      if (provider) {
        setAwareness(provider.awareness);
        setHasRemoteCollab(true);
      } else {
        setAwareness(new awarenessProtocol.Awareness(doc));
        setHasRemoteCollab(false);
      }
    };
    load();

    return () => {
      setYdoc(null);
      setAwareness(null);
      setHasRemoteCollab(false);
      imageLoadingRef.current = false;
      registry.release(documentId);
    };
  }, [isOpen, documentId]);

  // Load image into Excalidraw canvas. Clears any stale scene from a
  // previous annotation session so the image always loads fresh.
  useEffect(() => {
    if (!api || mode !== 'annotate-image' || !imageUrl || !ydoc) return;

    // Reset loading flag for new image (handles re-opening for different images)
    imageLoadingRef.current = false;

    imageLoadingRef.current = true;

    const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);
    ydoc.transact(() => {
      map.delete('elements');
      map.delete('appState');
      map.delete('version');
      map.delete('files');
    }, ydoc.clientID);

    api.updateScene({
      elements: [],
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    (async () => {
      try {
        const { dataURL, blob, width, height } = await fetchImageAsDataURL(imageUrl);
        const fileId = generateId();

        api.addFiles([{
          id: fileId,
          dataURL,
          mimeType: (blob.type || 'image/png') as any,
          created: Date.now(),
        } as BinaryFileData]);

        const imageElement: any = {
          id: generateId(),
          type: 'image',
          x: 0,
          y: 0,
          width,
          height,
          fileId,
          status: 'saved',
          scale: [1, 1],
          crop: null,
          strokeColor: '#000000',
          backgroundColor: 'transparent',
          fillStyle: 'solid',
          strokeWidth: 1,
          strokeStyle: 'solid',
          roundness: null,
          roughness: 1,
          opacity: 100,
          angle: 0,
          seed: Math.floor(Math.random() * 100000),
          version: 1,
          versionNonce: 0,
          index: null,
          isDeleted: false,
          groupIds: [],
          frameId: null,
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: true,
        };

        api.updateScene({
          elements: [imageElement],
          captureUpdate: CaptureUpdateAction.NEVER as any,
        });
      } catch (err) {
        console.error('[ExcalidrawModal] Failed to load image:', err);
      }
    })();
  }, [api, mode, imageUrl, ydoc]);

  // Save: export flattened PNG and update markdown image reference.
  // Writes the annotated image to a .annotations/ folder next to the
  // markdown file so the document stays readable (no base64 bloat).
  const handleSave = useCallback(async () => {
    if (!api) return;
    setSaving(true);

    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();

      const blob = await exportToBlob({
        elements: elements as any,
        appState,
        files,
        mimeType: 'image/png',
      });

      if (mode === 'annotate-image' && imageUrl && ydoc) {
        const markdownText = ydoc.getText('markdown');
        const currentText = markdownText.toString();

        let newUrl: string;

        // Prefer saving as an external file alongside the markdown document.
        // Falls back to base64 when no file_path is available (DB-only docs)
        // or when the filesystem write fails (e.g. web preview).
        const filePath = ydoc.getMap('meta').get('file_path') as string | undefined;
        if (filePath) {
          try {
            const docDir = filePath.substring(0, filePath.lastIndexOf('/'));
            const baseName = getImageBaseName(imageUrl, imageAlt);
            const annotationsDir = `${docDir}/.annotations`;
            const fileName = `${baseName}.png`;
            const savePath = `${annotationsDir}/${fileName}`;

            await mkdir(annotationsDir, { recursive: true });

            const arrayBuffer = await blob.arrayBuffer();
            await writeFile(savePath, new Uint8Array(arrayBuffer));

            newUrl = `./.annotations/${fileName}`;
          } catch (fsErr) {
            console.error('[ExcalidrawModal] Failed to write image file, falling back to base64:', fsErr);
            newUrl = await blobToDataURL(blob);
          }
        } else {
          newUrl = await blobToDataURL(blob);
        }

        const escapedUrl = imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\(${escapedUrl}\\)`);
        const newText = currentText.replace(regex, `(${newUrl})`);

        if (newText !== currentText) {
          ydoc.transact(() => {
            markdownText.delete(0, markdownText.length);
            markdownText.insert(0, newText);
          });
        }
      }
    } catch (err) {
      console.error('[ExcalidrawModal] Save failed:', err);
    } finally {
      setSaving(false);
      setApi(null);
      close();
    }
  }, [api, mode, imageUrl, imageAlt, ydoc, close]);

  // Revert: clear Excalidraw scene from Yjs and load original image fresh
  const handleRevert = useCallback(() => {
    if (!ydoc) return;

    const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);
    ydoc.transact(() => {
      map.delete('elements');
      map.delete('appState');
      map.delete('version');
      map.delete('files');
    });

    if (api) {
      (api as any).updateScene({
        elements: [],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }

    imageLoadingRef.current = false;
    setApi(null);
    close();
  }, [ydoc, api, close]);

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={() => {
        setApi(null);
        imageLoadingRef.current = false;
        close();
      }}
      style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(2px)',
        }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '90vw',
          maxWidth: 1100,
          height: '85vh',
          maxHeight: 800,
          background: 'var(--editor-secondary-bg, #1e1e2e)',
          borderRadius: 12,
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          border: '1px solid rgba(128,128,128,0.15)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            borderBottom: '1px solid rgba(128,128,128,0.2)',
            background: 'var(--editor-bg-color, #2e2e3e)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--editor-text-color, #e0e0e0)' }}>
              {mode === 'annotate-image' ? 'Annotate Image' : 'Excalidraw'}
            </span>
            {hasRemoteCollab && (
              <span style={{ fontSize: 11, opacity: 0.6, color: 'var(--editor-text-color, #e0e0e0)' }}>
                ● Live collaboration
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleRevert}
              title="Discard annotations and restart"
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,80,80,0.4)',
                background: 'transparent',
                color: '#ff6666',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Revert
            </button>
            <button
              onClick={() => {
                setApi(null);
                imageLoadingRef.current = false;
                close();
              }}
              style={{
                padding: '6px 16px',
                borderRadius: 8,
                border: '1px solid rgba(128,128,128,0.3)',
                background: 'transparent',
                color: 'var(--editor-text-color, #e0e0e0)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '6px 16px',
                borderRadius: 8,
                border: 'none',
                background: '#4a6cf7',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save & Close'}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Excalidraw
            excalidrawAPI={setApi}
            isCollaborating={hasRemoteCollab}
            onPointerUpdate={(payload) => {
              if (awareness) {
                awareness.setLocalStateField('pointer', {
                  x: payload.pointer.x,
                  y: payload.pointer.y,
                });
              }
            }}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: true,
                clearCanvas: true,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                saveAsImage: false,
              },
              tools: {
                image: true,
              },
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.CommandPalette />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.SaveAsImage />
            </MainMenu>
          </Excalidraw>
        </div>
        {api && ydoc && awareness && (
          <ExcalidrawSyncBridge
            api={api}
            ydoc={ydoc}
            awareness={awareness}
            documentId={documentId || ''}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
