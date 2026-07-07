import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Excalidraw, MainMenu, exportToBlob, CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { registry } from '../yjs/DocumentRegistry';
import { useExcalidrawStore } from './excalidrawStore';
import { loadImageIntoScene, exportAndSaveImage, saveSceneState, clearSceneState, getContextFromYdoc } from './excalidrawService';
import { useExcalidrawSync } from './excalidrawYjsSync';
import { importToAssets, saveAnnotatedImage } from '../images/imageService';
import { usePlanStore } from '../billing/PlanProvider';
import { auth } from '../auth/firebase';

const EK = 'excalidraw';

function SyncBridge({ api, ydoc, awareness, documentId }: {
  api: ExcalidrawImperativeAPI; ydoc: Y.Doc; awareness: awarenessProtocol.Awareness; documentId: string;
}) {
  useExcalidrawSync({ ydoc, awareness, excalidrawAPI: api, isCollaborating: true, documentId });
  return null;
}

export function ExcalidrawModal() {
  const { isOpen, mode, imageUrl, imageAlt, documentId, close } = useExcalidrawStore();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<awarenessProtocol.Awareness | null>(null);
  const [hasRemoteCollab, setHasRemoteCollab] = useState(false);
  const [saving, setSaving] = useState(false);
  const loading = useRef(false);

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
    const map = ydoc.getMap(EK);
    ydoc.transact(() => { map.delete('elements'); map.delete('appState'); map.delete('version'); map.delete('files'); }, ydoc.clientID);
    api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.NEVER });
    (async () => {
      try {
        const ps = usePlanStore.getState(); const isCloud = ps.activeContext.type === 'team';
        const ctx = getContextFromYdoc(ydoc, isCloud, ps.teamId, auth.currentUser?.uid);
        const imported = await importToAssets(imageUrl, ctx); await loadImageIntoScene(api, imported.url);
      } catch (err) { console.error('[ExcalidrawModal] Failed to load image:', err); }
    })();
  }, [api, mode, imageUrl, ydoc]);

  const handleSave = useCallback(async () => {
    if (!api || !ydoc) return;
    setSaving(true);
    try {
      const ps = usePlanStore.getState(); const isCloud = ps.activeContext.type === 'team';
      const ctx = getContextFromYdoc(ydoc, isCloud, ps.teamId, auth.currentUser?.uid);

      if (mode === 'new-drawing' && !imageUrl) {
        const blob = await exportToBlob({
          elements: api.getSceneElements() as any,
          appState: api.getAppState(),
          files: api.getFiles(),
          mimeType: 'image/png',
        });
        const result = await saveAnnotatedImage(blob, 'drawing', ctx);
        useExcalidrawStore.getState().onSave?.(result.url);
        await saveSceneState(ydoc, api, ctx);
        setSaving(false); setApi(null); close();
        return;
      }

      if (!imageUrl) { setSaving(false); return; }
      const text = ydoc.getText('markdown'); const current = text.toString();
      const newUrl = await exportAndSaveImage(api, imageUrl, imageAlt, ctx);
      await saveSceneState(ydoc, api, ctx);
      const esc = imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const updated = current.replace(new RegExp(`\\(${esc}\\)`), `(${newUrl})`);
      if (updated !== current) { ydoc.transact(() => { text.delete(0, text.length); text.insert(0, updated); }); }
    } catch (err) { console.error('[ExcalidrawModal] Save failed:', err); }
    finally { setSaving(false); setApi(null); close(); }
  }, [api, imageUrl, imageAlt, ydoc, close, mode]);

  const handleRevert = useCallback(() => {
    if (!ydoc) return;
    const ps = usePlanStore.getState(); const isCloud = ps.activeContext.type === 'team';
    const ctx = getContextFromYdoc(ydoc, isCloud, ps.teamId, auth.currentUser?.uid);
    clearSceneState(ydoc, ctx);
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
        {api && ydoc && awareness && <SyncBridge api={api} ydoc={ydoc} awareness={awareness} documentId={documentId || ''} />}
      </div>
    </div>, document.body,
  );
}
