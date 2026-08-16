import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Excalidraw, MainMenu, exportToBlob, CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { registry } from '../yjs/DocumentRegistry';
import { useExcalidrawStore } from './excalidrawStore';
import { loadImageIntoScene, exportAndSaveImage, clearSceneState, getContextFromYdoc } from './excalidrawService';
import { useExcalidrawSync } from './excalidrawYjsSync';
import { importToAssets, saveAnnotatedImage } from '../images/imageService';
import type { ImageContext } from '../images/imageTypes';
import { usePlanStore } from '../billing/PlanProvider';
import { getCurrentUser } from "../auth/session";
import { useSyncStatusStore } from '../cloud/syncStatusStore';


function SyncBridge({ api, ydoc, awareness, documentId, imageContext }: {
  api: ExcalidrawImperativeAPI; ydoc: Y.Doc; awareness: awarenessProtocol.Awareness;
  documentId: string; imageContext: ImageContext | null;
}) {
  useExcalidrawSync({ ydoc, awareness, excalidrawAPI: api, isCollaborating: true, documentId, imageContext });
  return null;
}

export function ExcalidrawModal() {
  const { isOpen, mode, imageUrl, imageAlt, documentId, sourceFrom, close } = useExcalidrawStore();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<awarenessProtocol.Awareness | null>(null);
  const [hasRemoteCollab, setHasRemoteCollab] = useState(false);
  const [saving, setSaving] = useState(false);
  const loading = useRef(false);

  // Scene images are ingested like any other image, so the bridge needs the same
  // context the rest of the pipeline uses.
  const sceneImageContext = useMemo<ImageContext | null>(() => {
    if (!ydoc) return null;
    const plan = usePlanStore.getState();
    const isCloud =
      plan.activeContext.type === 'team' ||
      (documentId ? useSyncStatusStore.getState().cloudDocumentIds.has(documentId) : false);
    return getContextFromYdoc(ydoc, isCloud, plan.teamId, getCurrentUser()?.id);
  }, [ydoc, documentId]);

  useEffect(() => {
    if (!isOpen || !documentId) return;
    const load = async () => {
      const doc = await registry.acquire(documentId); setYdoc(doc);
      const prov = registry.getProvider(documentId);
      if (prov) { setAwareness(prov.awareness); setHasRemoteCollab(true); }
      else { setAwareness(new awarenessProtocol.Awareness(doc)); setHasRemoteCollab(false); }
    };
    load();
    return () => { setYdoc(null); setAwareness(null); setHasRemoteCollab(false); loading.current = false; registry.release(documentId); };
  }, [isOpen, documentId]);

  useEffect(() => {
    if (!api || mode !== 'annotate-image' || !imageUrl || !ydoc) return;
    loading.current = true;
    clearSceneState(ydoc);
    api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.NEVER });
    (async () => {
      try {
        const ps = usePlanStore.getState();
        const isCloud = ps.activeContext.type === 'team' || (documentId ? useSyncStatusStore.getState().cloudDocumentIds.has(documentId) : false);
        const ctx = getContextFromYdoc(ydoc, isCloud, ps.teamId, getCurrentUser()?.id);
        const imported = await importToAssets(imageUrl, ctx);
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const assetUrl = imported.localPath ? convertFileSrc(imported.localPath) : imported.url;
        await loadImageIntoScene(api, assetUrl);
      } catch (err) { console.error('[ExcalidrawModal] Failed to load image:', err); }
    })();
  }, [api, mode, imageUrl, ydoc]);

  const handleSave = useCallback(async () => {
    if (!api || !ydoc) return;
    setSaving(true);
    try {
      const ps = usePlanStore.getState();
      const isCloud = ps.activeContext.type === 'team' || (documentId ? useSyncStatusStore.getState().cloudDocumentIds.has(documentId) : false);
      const ctx = getContextFromYdoc(ydoc, isCloud, ps.teamId, getCurrentUser()?.id);

      if (mode === 'new-drawing' && !imageUrl) {
        const blob = await exportToBlob({
          elements: api.getSceneElements() as any,
          appState: api.getAppState(),
          files: api.getFiles(),
          mimeType: 'image/png',
        });
        const result = await saveAnnotatedImage(blob, 'drawing', ctx);
        useExcalidrawStore.getState().onSave?.(result.url);
        setSaving(false); setApi(null); close();
        return;
      }

      if (!imageUrl) { setSaving(false); return; }
      const text = ydoc.getText('markdown');
      const newUrl = await exportAndSaveImage(api, imageUrl, imageAlt, ctx);

      // Splice just the URL. This used to delete the entire document and
      // reinsert it, which destroyed any concurrent edit and invalidated every
      // relative position in the document — annotation and suggestion anchors
      // included.
      const current = text.toString();
      const needle = `(${imageUrl})`;
      // Prefer the range the user actually clicked; fall back to a search when
      // the document has shifted since the menu opened.
      const searchFrom = typeof sourceFrom === 'number' ? Math.max(0, sourceFrom) : 0;
      let index = current.indexOf(needle, searchFrom);
      if (index === -1) index = current.indexOf(needle);

      if (index !== -1 && newUrl !== imageUrl) {
        ydoc.transact(() => {
          text.delete(index + 1, imageUrl.length);
          text.insert(index + 1, newUrl);
        }, 'annotate-image');
      }
    } catch (err) { console.error('[ExcalidrawModal] Save failed:', err); }
    finally { setSaving(false); setApi(null); close(); }
  }, [api, imageUrl, imageAlt, ydoc, close, mode, sourceFrom, documentId]);

  const handleRevert = useCallback(() => {
    if (!ydoc) return;
    clearSceneState(ydoc);
    if (api) (api as any).updateScene({ elements: [], captureUpdate: CaptureUpdateAction.NEVER });
    loading.current = false; setApi(null); close();
  }, [ydoc, api, close]);

  if (!isOpen) return null;

  const ov = { position: 'fixed' as const, inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' };
  const pnl = { display: 'flex', flexDirection: 'column' as const, width: '90vw', maxWidth: 1100, height: '85vh', maxHeight: 800, background: 'var(--editor-secondary-bg, #1e1e2e)', borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,0.35)', border: '1px solid rgba(128,128,128,0.15)' };
  const hdr = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid rgba(128,128,128,0.2)', background: 'var(--editor-bg-color, #2e2e3e)', flexShrink: 0 };
  const tit = { fontWeight: 600, fontSize: 14, color: 'var(--editor-text-color, #e0e0e0)' };
  const bdg = { fontSize: 11, opacity: 0.6, color: 'var(--editor-text-color, #e0e0e0)' };
  const rvt = { padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,80,80,0.4)', background: 'transparent', color: '#ff6666', cursor: 'pointer', fontSize: 12, fontWeight: 500 };
  const ccl = { padding: '6px 16px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.3)', background: 'transparent', color: 'var(--editor-text-color, #e0e0e0)', cursor: 'pointer', fontSize: 13, fontWeight: 500 };
  const svb = { padding: '6px 16px', borderRadius: 8, border: 'none', background: '#4a6cf7', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 };

  return createPortal(
    <div onClick={() => { setApi(null); loading.current = false; close(); }} style={ov}>
      <div onClick={(e) => e.stopPropagation()} style={pnl}>
        <div style={hdr}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={tit}>{mode === 'annotate-image' ? 'Annotate Image' : 'Excalidraw'}</span>
            {hasRemoteCollab && <span style={bdg}>● Live</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleRevert} style={rvt}>Revert</button>
            <button onClick={() => { setApi(null); loading.current = false; close(); }} style={ccl}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ ...svb, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Excalidraw excalidrawAPI={setApi} isCollaborating={hasRemoteCollab}
            onPointerUpdate={(p) => { if (awareness) awareness.setLocalStateField('pointer', { x: p.pointer.x, y: p.pointer.y }); }}
            UIOptions={{ canvasActions: { changeViewBackgroundColor: true, clearCanvas: true, export: false, loadScene: false, saveToActiveFile: false, saveAsImage: false }, tools: { image: true } }}>
            <MainMenu>
              <MainMenu.DefaultItems.SearchMenu /><MainMenu.DefaultItems.CommandPalette />
              <MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground /><MainMenu.Separator />
              <MainMenu.DefaultItems.SaveAsImage />
            </MainMenu>
          </Excalidraw>
        </div>
        {api && ydoc && awareness && (
          <SyncBridge
            api={api}
            ydoc={ydoc}
            awareness={awareness}
            documentId={documentId || ''}
            imageContext={sceneImageContext}
          />
        )}
      </div>
    </div>, document.body,
  );
}
