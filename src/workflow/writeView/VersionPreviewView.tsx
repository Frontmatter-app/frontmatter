import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as Y from 'yjs';
import { invoke } from '../../filesystem/tauriCommands';
import { ArrowLeft, RotateCcw, Plus, Minus, FileText } from 'lucide-react';
import { EditorView, ViewPlugin, Decoration, DecorationSet, GutterMarker, gutter } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Table } from '@lezer/markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting } from '@codemirror/language';
import { frontmatterHighlightStyle } from '../../editor/themes/highlightStyle';
import { inlinePreviewPlugin } from '../../editor/extensions/inlinePreview';
import { frontmatterTheme } from '../../editor/themes/themeConfig';
import { diff_match_patch } from 'diff-match-patch';
import { SnapshotMeta } from '../../types';
import { showFileAtCommit } from '../../git/gitCommands';
import { showConfirmDialog } from '../../lib/tauriDialog';
import { X } from 'lucide-react';

const dmp = new diff_match_patch();

interface DiffLine {
  type: 'equal' | 'delete' | 'insert';
  text: string;
  lineNo: number;
}

interface VersionPreviewViewProps {
  ydoc: Y.Doc;
  versionId: string;
  documentId: string;
  onExit: () => void;
  workspacePath?: string | null;
  filePath?: string | null;
}

function buildLineDiff(latestText: string, pastText: string): DiffLine[] {
  const pastLines = pastText.split('\n');
  const latestLines = latestText.split('\n');

  const lcs: number[][] = [];
  for (let i = 0; i <= pastLines.length; i++) {
    lcs[i] = [0];
  }
  for (let j = 0; j <= latestLines.length; j++) {
    lcs[0][j] = 0;
  }
  for (let i = 1; i <= pastLines.length; i++) {
    for (let j = 1; j <= latestLines.length; j++) {
      if (pastLines[i - 1] === latestLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = pastLines.length;
  let j = latestLines.length;
  let lineNo = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && pastLines[i - 1] === latestLines[j - 1]) {
      result.unshift({ type: 'equal', text: pastLines[i - 1], lineNo: lineNo++ });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      result.unshift({ type: 'insert', text: latestLines[j - 1], lineNo: -1 });
      j--;
    } else if (i > 0) {
      result.unshift({ type: 'delete', text: pastLines[i - 1], lineNo: -1 });
      i--;
    }
  }

  let counter = 0;
  for (const line of result) {
    if (line.type === 'equal') {
      line.lineNo = counter++;
    }
  }

  return result;
}

class DiffGutterMarker extends GutterMarker {
  elementClass = '';
  constructor(readonly diffType: 'insert' | 'delete') {
    super();
    this.elementClass = diffType === 'delete' ? 'cm-gutter-diff-delete' : 'cm-gutter-diff-insert';
  }
  toDOM() {
    const el = document.createElement('span');
    el.textContent = this.diffType === 'delete' ? '-' : '+';
    el.style.fontWeight = 'bold';
    el.style.fontSize = '12px';
    el.style.fontFamily = 'monospace';
    el.style.padding = '0 6px';
    el.style.display = 'inline-block';
    el.style.width = '18px';
    el.style.textAlign = 'center';
    el.style.color = this.diffType === 'delete'
      ? 'var(--editor-deleted-strike-color, #f43f5e)'
      : 'var(--editor-added-text-color, #10b981)';
    return el;
  }
}

class SpacerMarker extends GutterMarker {
  toDOM() { const el = document.createElement('span'); el.textContent = ' '; return el; }
}

function diffGutterExtension(diffLines: DiffLine[]) {
  return gutter({
    lineMarker(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number;
      const dl = diffLines[lineNo - 1];
      if (dl?.type === 'delete') return new DiffGutterMarker('delete');
      if (dl?.type === 'insert') return new DiffGutterMarker('insert');
      return null;
    },
    initialSpacer: () => new SpacerMarker(),
  });
}

function diffDecorationExtension(diffLines: DiffLine[]) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: any) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = [];
        const doc = view.state.doc;
        let docLine = 1;

        for (const dl of diffLines) {
          if (docLine > doc.lines) break;
          const line = doc.line(docLine);
          if (line.text !== dl.text) {
            break;
          }
          if (dl.type === 'delete') {
            builder.push(
              Decoration.line({
                class: 'cm-diff-delete-line',
              }).range(line.from)
            );
          } else if (dl.type === 'insert') {
            builder.push(
              Decoration.line({
                class: 'cm-diff-insert-line',
              }).range(line.from)
            );
          }
          docLine++;
        }
        return Decoration.set(builder);
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

export function VersionPreviewView({ ydoc, versionId, documentId, onExit, workspacePath, filePath }: VersionPreviewViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const [pastText, setPastText] = useState<string>('');
  const [latestText, setLatestText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [versionTime, setVersionTime] = useState<string>('');
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const [versionLabel, setVersionLabel] = useState<string>('');
  const [versionWordCount, setVersionWordCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const loadVersion = async () => {
      try {
        setIsLoading(true);
        const liveText = ydoc.getText('markdown').toString();
        setLatestText(liveText);

        let snapMeta = null;
        let pText = '';
        try {
          const snapshots: SnapshotMeta[] = await invoke('get_snapshots', { documentId });
          snapMeta = snapshots.find((s: SnapshotMeta) => s.id === versionId);
          if (snapMeta) {
            const data: number[] = await invoke('get_snapshot_data', { id: versionId });
            const tempDoc = new Y.Doc();
            Y.applyUpdate(tempDoc, new Uint8Array(data));
            pText = tempDoc.getText('markdown').toString();
            if (active) {
              const idx = snapshots.indexOf(snapMeta);
              setVersionLabel(snapMeta.label || `Version ${snapshots.length - idx}`);
              setVersionTime(new Date(snapMeta.created_at).toLocaleString());
              setVersionWordCount(snapMeta.word_count ?? null);
            }
          }
        } catch {}

        if (!snapMeta && workspacePath && filePath) {
          const gitText = await showFileAtCommit(workspacePath, versionId, filePath);
          pText = gitText;
          if (active) {
            setVersionLabel(`Commit: ${versionId.substring(0, 7)}`);
            setVersionTime('Git Commit');
            setVersionWordCount(gitText.trim() ? gitText.trim().split(/\s+/).length : 0);
          }
        }

        if (active) setPastText(pText);
      } catch (e) {
        console.error('Failed to load past version content:', e);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadVersion();
    return () => { active = false; };
  }, [ydoc, versionId, documentId, workspacePath, filePath]);

  const diffLines = useMemo(() => buildLineDiff(latestText, pastText), [latestText, pastText]);
  const displayText = useMemo(() => diffLines.map(d => d.text).join('\n'), [diffLines]);

  const handleRevertLine = useCallback((diffLineIdx: number) => {
    const dl = diffLines[diffLineIdx];
    if (!dl) return;

    const ytext = ydoc.getText('markdown');
    const currentText = ytext.toString();
    const latestLines = currentText.split('\n');

    // Calculate start/end offsets for each line in latestText
    const lineOffsets: { start: number; end: number }[] = [];
    let currentOffset = 0;
    for (let i = 0; i < latestLines.length; i++) {
      const len = latestLines[i].length;
      lineOffsets.push({ start: currentOffset, end: currentOffset + len });
      currentOffset += len + 1; // +1 for newline
    }

    // Map diffLines index to the line index of latestLines
    let latestLineIdx = 0;
    let targetLatestLineIdx: number | null = null;
    let targetInsertAtLatestLineIdx: number | null = null;

    for (let i = 0; i < diffLines.length; i++) {
      const cur = diffLines[i];
      if (i === diffLineIdx) {
        if (cur.type === 'equal') return; // nothing to revert
        if (cur.type === 'insert') {
          targetLatestLineIdx = latestLineIdx;
        } else {
          targetInsertAtLatestLineIdx = latestLineIdx;
        }
        break;
      }
      if (cur.type === 'equal' || cur.type === 'insert') {
        latestLineIdx++;
      }
    }

    if (targetLatestLineIdx !== null) {
      // Revert an addition -> delete it from current document
      const offset = lineOffsets[targetLatestLineIdx];
      if (offset) {
        ydoc.transact(() => {
          let start = offset.start;
          let len = offset.end - offset.start;
          if (targetLatestLineIdx! < lineOffsets.length - 1) {
            len += 1; // delete trailing newline
          } else if (targetLatestLineIdx! > 0) {
            start -= 1; // delete leading newline
            len += 1;
          }
          ytext.delete(start, len);
        });
      }
    } else if (targetInsertAtLatestLineIdx !== null) {
      // Revert a deletion -> insert it into current document
      ydoc.transact(() => {
        if (targetInsertAtLatestLineIdx! < lineOffsets.length) {
          const offset = lineOffsets[targetInsertAtLatestLineIdx!];
          ytext.insert(offset.start, `${dl.text}\n`);
        } else {
          if (currentText.length > 0 && !currentText.endsWith('\n')) {
            ytext.insert(ytext.length, `\n${dl.text}`);
          } else {
            ytext.insert(ytext.length, dl.text);
          }
        }
      });
    }

    setRestoredId(`line-${diffLineIdx}`);
    setTimeout(() => setRestoredId(null), 2000);
  }, [ydoc, diffLines]);

  const [activeWidget, setActiveWidget] = useState<{ x: number; y: number; lineIndex: number } | null>(null);

  useEffect(() => {
    if (isLoading || !containerRef.current) return;
    if (editorRef.current) editorRef.current.destroy();

    const clickHandler = EditorView.domEventHandlers({
      click(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return;
        const line = view.state.doc.lineAt(pos);
        const dlIdx = line.number - 1;
        const dl = diffLines[dlIdx];
        if (dl && (dl.type === 'delete' || dl.type === 'insert')) {
          setActiveWidget({
            x: event.clientX,
            y: event.clientY,
            lineIndex: dlIdx,
          });
        } else {
          setActiveWidget(null);
        }
      }
    });

    const customDiffTheme = EditorView.theme({
      ".cm-diff-delete-line": {
        backgroundColor: 'var(--editor-deleted-bg-color)',
        cursor: 'pointer !important'
      },
      ".cm-diff-insert-line": {
        backgroundColor: 'var(--editor-added-bg-color)',
        cursor: 'pointer !important'
      },
      ".cm-gutter-diff-delete": {
        cursor: 'pointer'
      },
      ".cm-gutter-diff-insert": {
        cursor: 'pointer'
      }
    });

    const state = EditorState.create({
      doc: displayText,
      extensions: [
        EditorView.lineWrapping,
        markdown({
          base: markdownLanguage,
          codeLanguages: languages,
          extensions: [Table]
        }),
        syntaxHighlighting(frontmatterHighlightStyle),
        inlinePreviewPlugin,
        frontmatterTheme,
        diffDecorationExtension(diffLines),
        diffGutterExtension(diffLines),
        clickHandler,
        customDiffTheme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    editorRef.current = view;

    return () => { view.destroy(); };
  }, [isLoading, displayText, diffLines, handleRevertLine]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full py-20 font-sans"
        style={{ color: 'var(--editor-text-color)' }}
      >
        <div className="w-8 h-8 border-2 rounded-full animate-spin mb-4"
          style={{
            borderColor: 'var(--editor-secondary-bg)',
            borderTopColor: 'var(--editor-caret-color)',
          }}
        />
        <span>Loading past snapshot diff…</span>
      </div>
    );
  }

  const currentWordCount = latestText.trim() ? latestText.trim().split(/\s+/).length : 0;
  const wordCountDelta = (versionWordCount != null && currentWordCount > 0)
    ? versionWordCount - currentWordCount
    : null;

  const handleFullRestore = async () => {
    const confirmed = await showConfirmDialog('Restore Version', 'Replace current document with this full version?');
    if (!confirmed) return;
    ydoc.transact(() => {
      const ytext = ydoc.getText('markdown');
      ytext.delete(0, ytext.length);
      ytext.insert(0, pastText);
    });
    onExit();
  };

  return (
    <div className="relative">
      {/* VS Code-style header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 text-sm border-b select-none sticky top-0 z-10"
        style={{
          backgroundColor: 'var(--editor-secondary-bg)',
          borderColor: 'var(--editor-fenced-code-border, #d0d7de)',
          color: 'var(--editor-text-color)',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity"
            style={{ color: 'var(--editor-text-color)' }}
            title="Exit diff view"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-medium">Back</span>
          </button>
          <div className="flex items-center gap-1.5 text-xs opacity-70">
            <FileText className="w-3.5 h-3.5" />
            <span className="truncate max-w-[120px]">{versionLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {versionWordCount != null && (
            <span className="opacity-60 flex items-center gap-1">
              {versionWordCount.toLocaleString()} words
              {wordCountDelta !== null && wordCountDelta !== 0 && (
                <span style={{
                  color: wordCountDelta > 0
                    ? 'var(--editor-added-text-color, #1a7f37)'
                    : 'var(--editor-deleted-strike-color)',
                  fontWeight: 600,
                }}>
                  ({wordCountDelta > 0 ? '+' : ''}{wordCountDelta.toLocaleString()})
                </span>
              )}
            </span>
          )}
          <span className="opacity-60">{versionTime}</span>
          <span className="flex items-center gap-1" style={{ color: 'var(--editor-deleted-strike-color)' }}>
            <Minus className="w-3 h-3" /> {diffLines.filter(d => d.type === 'delete').length}
          </span>
          <span className="flex items-center gap-1" style={{ color: 'var(--editor-added-text-color, #1a7f37)' }}>
            <Plus className="w-3 h-3" /> {diffLines.filter(d => d.type === 'insert').length}
          </span>
          <button
            onClick={handleFullRestore}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80 cursor-pointer"
            style={{
              backgroundColor: 'var(--editor-caret-color)',
              color: 'white',
            }}
            title="Replace current document with this version"
          >
            <RotateCcw className="w-3 h-3" />
            Restore Version
          </button>
        </div>
      </div>

      {/* Diff view content */}
      <div className="max-w-4xl mx-auto py-4 px-2">
        <div ref={containerRef} className="w-full min-h-[300px]"
          style={{
            fontFamily: 'var(--editor-font-family)',
            fontSize: 'var(--editor-font-size)',
            lineHeight: 'var(--editor-line-height)',
          }}
        />

        {/* Hint about clickable reverts */}
        <div className="text-[10px] text-right mt-2 opacity-50"
          style={{ color: 'var(--editor-deleted-text-color)' }}
        >
          Click any + or - line to show options (revert / copy)
        </div>

        {/* Inline restored flash */}
        {restoredId && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium animate-in fade-in slide-in-from-bottom-2 duration-200 mt-2"
            style={{
              backgroundColor: 'var(--editor-added-bg-color, #dafbe1)',
              color: 'var(--editor-added-text-color, #1a7f37)',
            }}
          >
            <RotateCcw className="w-3 h-3" />
            Reverted line change
          </div>
        )}
      </div>

      {/* Floating Widget at Click Cursor Position */}
      {activeWidget && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActiveWidget(null)} />
          <div
            className="fixed z-50 flex items-center gap-1.5 p-1 bg-white border border-gray-200 rounded-lg shadow-xl text-xs font-sans animate-in zoom-in-95 duration-100"
            style={{
              top: `${activeWidget.y + 10}px`,
              left: `${Math.min(activeWidget.x, window.innerWidth - 180)}px`,
            }}
          >
            <button
              onClick={() => {
                handleRevertLine(activeWidget.lineIndex);
                setActiveWidget(null);
              }}
              className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 text-white rounded font-medium cursor-pointer"
            >
              Revert
            </button>
            <button
              onClick={async () => {
                const text = diffLines[activeWidget.lineIndex]?.text || '';
                await navigator.clipboard.writeText(text);
                setActiveWidget(null);
              }}
              className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 rounded font-medium cursor-pointer"
            >
              Copy
            </button>
            <button
              onClick={() => setActiveWidget(null)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
