import React, { useEffect, useState } from 'react';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { registry } from '../yjs/DocumentRegistry';
import * as Y from 'yjs';
import { DraftView } from '../workflow/draftView/DraftView';
import { WriteView } from '../workflow/writeView/WriteView';
import { ReviseView } from '../workflow/reviseView/ReviseView';
import { VersionPreviewView } from '../workflow/writeView/VersionPreviewView';
import { ArrowUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { Stage } from '../types';
import { useProseScanStore } from '../review/proseScanStore';
import type { GrammarLint } from '../review/grammarIssues';
import { useSettingsStore } from '../settings/settingsStore';
import { invoke } from '@tauri-apps/api/core';
import { useChromeStore } from './chromeStore';

export function CenterColumn({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { openTabs, currentDocumentId, activeVersionId, setActiveVersionId, documents, workspacePath } = useWorkspace();
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [stage, setStage] = useState<Stage>('write');
  const [title, setTitle] = useState("Untitled Document");

  // The View menu asks for a stage; the document owns the authoritative value,
  // so apply the request to the Yjs meta map and clear it.
  const requestedStage = useChromeStore((state) => state.requestedStage);
  useEffect(() => {
    if (!requestedStage || !ydoc) return;
    ydoc.getMap('meta').set('stage', requestedStage);
    useChromeStore.getState().clearRequestedStage();
  }, [requestedStage, ydoc]);

  useEffect(() => {
    if (!currentDocumentId) {
      setYdoc(null);
      return;
    }
    let active = true;
    let metaObserver: (() => void) | null = null;
    let acquiredDoc: Y.Doc | null = null;

    registry.acquire(currentDocumentId).then(doc => {
      if (active) {
        acquiredDoc = doc;
        setYdoc(doc);
        const metaStage = (doc.getMap('meta').get('stage') as Stage) || 'write';
        setStage(metaStage);

        const updateTitle = () => {
          const t = doc.getMap('meta').get('title') as string;
          setTitle(t || "Untitled Document");
        };

        updateTitle();

        metaObserver = () => {
          const s = doc.getMap('meta').get('stage') as Stage;
          if (s) setStage(s);
          const t = doc.getMap('meta').get('title') as string;
          if (t !== undefined) setTitle(t || "Untitled Document");
        };
        doc.getMap('meta').observe(metaObserver);
      }
    });

    return () => {
      active = false;
      if (acquiredDoc && metaObserver) {
        acquiredDoc.getMap('meta').unobserve(metaObserver);
      }
      registry.release(currentDocumentId);
    };
  }, [currentDocumentId]);

  const showProseLint = useSettingsStore(state => state.settings.showProseLint);
  const grammarCheck = useSettingsStore(state => state.settings.grammarCheck);

  useEffect(() => {
    if (!ydoc || !currentDocumentId) return;

    const { setGrammarLints, setGrammarError, clear } = useProseScanStore.getState();

    // Readability and inclusive language are computed in the renderer and need
    // no scan at all. Only grammar crosses the IPC boundary, and only in
    // Revise, which is the one stage that draws any of this.
    if (!showProseLint || !grammarCheck || stage !== 'revise') {
      clear();
      return;
    }

    const ytextMd = ydoc.getText('markdown');

    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    let scanInProgress = false;
    let pendingScan = false;
    let latestText = '';
    let lastScannedText: string | null = null;

    const runScan = async () => {
      if (scanInProgress) {
        pendingScan = true;
        return;
      }
      // Checking text already checked asks for work to be told nothing
      // changed. Selection moves reach the observer as document events, so
      // this is not a rare case.
      if (latestText === lastScannedText) return;

      scanInProgress = true;
      pendingScan = false;
      const textToScan = latestText;

      try {
        const lints = await invoke<GrammarLint[]>('check_grammar', { text: textToScan });
        if (active && textToScan === latestText) {
          lastScannedText = textToScan;
          setGrammarLints(lints);
        }
      } catch (e) {
        console.error('Grammar check failed:', e);
        // Surfaced rather than swallowed. The commonest cause is an app binary
        // built before `check_grammar` existed, and from the outside that is
        // indistinguishable from prose with nothing wrong in it.
        if (active) setGrammarError(e instanceof Error ? e.message : String(e));
      } finally {
        scanInProgress = false;
        if (active && pendingScan) runScan();
      }
    };

    const scheduleScan = () => {
      if (timer) clearTimeout(timer);

      // Never trimmed, and never the draft.
      //
      // `.trim()` removed leading blank lines from the text the checker saw but
      // not from the document the results were drawn on, so a file that began
      // with a blank line had every highlight one line out. The `|| draft`
      // fallback was worse: with an empty markdown body it returned results for
      // a completely different piece of text, positioned against this one.
      const text = ytextMd.toString();

      if (!text.trim()) {
        latestText = '';
        lastScannedText = null;
        clear();
        return;
      }

      latestText = text;
      timer = setTimeout(runScan, 800);
    };

    scheduleScan();
    ytextMd.observe(scheduleScan);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      ytextMd.unobserve(scheduleScan);
    };
  }, [ydoc, currentDocumentId, showProseLint, grammarCheck, stage]);

  if (openTabs.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center text-center p-8 h-full overflow-y-auto w-full", className)}>
        <div className="flex flex-col items-center justify-center select-none pointer-events-none">
          <img
            src="/app-logo.png"
            alt="Frontmatter"
            style={{
              width: '572px',
              height: '572px',
              objectFit: 'contain',
              opacity: 0.19,
              animation: 'empty-state-bounce 1.8s ease-in-out infinite',
            }}
          />
        </div>

        <div
          style={{
            width: '120px',
            height: '12px',
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.5)',
            filter: 'blur(4px)',
            position: 'relative',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: '-6px',
            animation: 'empty-state-shadow 1.8s ease-in-out infinite',
          }}
        />
      </div>
    );
  }

  if (!currentDocumentId || !ydoc) {
    return <div className={cn("flex flex-col items-center justify-center text-gray-400 w-full h-full", className)}>Loading...</div>;
  }

  const scrollToTop = () => {
    const el = document.getElementById('center-column-main');
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div
      className={cn("relative flex flex-col min-w-0 w-full h-full ", className)}
      style={{
        ...style,
        overflow: 'hidden',
      }}
    >
      <div className="flex-1 flex flex-col px-[2px] min-w-0 w-full overflow-hidden">

        <main id="center-column-main" className="flex-1 overflow-y-auto pb-32 h-full">
          {activeVersionId ? (
            <VersionPreviewView
              ydoc={ydoc}
              versionId={activeVersionId}
              documentId={currentDocumentId}
              onExit={() => setActiveVersionId(null)}
              workspacePath={workspacePath}
              filePath={documents.find(d => d.id === currentDocumentId)?.file_path}
            />
          ) : stage === 'draft' ? (
            <DraftView ydoc={ydoc} title={title} />
          ) : stage === 'write' ? (
            <WriteView ydoc={ydoc} documentId={currentDocumentId} />
          ) : stage === 'revise' ? (
            <ReviseView ydoc={ydoc} documentId={currentDocumentId} />
          ) : null}
        </main>

        <button
          onClick={scrollToTop}
          title="Back to top"
          style={{
            position: 'absolute',
            bottom: '24px',
            right: '24px',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            border: '1.5px solid rgba(0,0,0,0.15)',
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 10,
            transition: 'border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.15s ease',
            boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
          }}
          onMouseEnter={e => {
            const btn = e.currentTarget;
            btn.style.borderColor = 'rgba(0,0,0,0.3)';
            btn.style.color = 'rgba(0,0,0,0.7)';
            btn.style.boxShadow = '0 3px 10px rgba(0,0,0,0.10)';
            btn.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={e => {
            const btn = e.currentTarget;
            btn.style.borderColor = 'rgba(0,0,0,0.15)';
            btn.style.color = 'rgba(0,0,0,0.45)';
            btn.style.boxShadow = '0 1px 6px rgba(0,0,0,0.06)';
            btn.style.transform = 'translateY(0)';
          }}
        >
          <ArrowUp style={{ width: '14px', height: '14px' }} />
        </button>
      </div>
    </div>
  );
}
