import { useEffect, useState, type RefObject } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { registry } from '../yjs/DocumentRegistry';
import { createFontTheme } from './themes/themeConfig';
import { refreshInlinePreviewEffect } from './extensions/inlinePreview/settingsRefresh';
import { setTransclusionYdoc } from './extensions/transclusionRenderer';
import type { EditorHandle } from './createEditor';

/**
 * The parts of an editor mount that every stage needs identically.
 *
 * Write and Revise each grew their own copy of all of this, and then drifted:
 * one fixed a runaway awareness timer the other still has, one tears its editor
 * down through `handle.destroy()` and the other does not, one wires the note
 * menu and the other silently discards what you type into it. Anything that is
 * genuinely the same for both belongs here, once.
 */

/**
 * Resolves the awareness instance the collaboration extension binds to.
 *
 * The registry owns one instance per open document, for exactly as long as the
 * document is open, and hands the same one to the room when it connects. That
 * ownership is the fix for a bug with no visible symptom other than the feature
 * never working: this hook used to ask the *provider* for its awareness and,
 * finding none — a provider needs a network round trip, an editor mounts
 * immediately — fall back to building a private instance. `yCollab` binds to
 * whatever it is given at construction and never looks again, so every editor
 * in the app spent its life bound to an awareness with exactly one participant
 * in it. Remote carets were fully implemented and could not appear.
 *
 * A document with no room still gets one, and it stays empty. Nothing branches
 * on whether collaboration is available; the cursor extension simply has no
 * peers to draw.
 */
export function useAwareness(ydoc: Y.Doc | null, documentId?: string): Awareness | null {
  const [awareness, setAwareness] = useState<Awareness | null>(null);

  useEffect(() => {
    if (!ydoc) { setAwareness(null); return; }

    if (documentId) {
      const owned = registry.awarenessFor(documentId);
      if (owned) {
        setAwareness(owned);
        return;
      }
    }

    // No registry entry — a preview, or a document rendered outside the
    // workspace. A standalone instance keeps the cursor extension working, and
    // is destroyed with the mount because nothing else refers to it.
    const local = new Awareness(ydoc);
    setAwareness(local);
    return () => local.destroy();
  }, [ydoc, documentId]);

  return awareness;
}

/**
 * Moves the caret in response to the rest of the app.
 *
 * The outline, the review cards and the search results all address the editor
 * by window event because they do not hold a reference to the view.
 */
export function useEditorNavigation(handleRef: RefObject<EditorHandle | null>): void {
  useEffect(() => {
    const scrollToLine = (e: Event) => {
      const lineIndex = (e as CustomEvent).detail?.lineIndex;
      const view = handleRef.current?.view;
      if (!view || typeof lineIndex !== 'number') return;
      const lineNumber = Math.min(Math.max(1, lineIndex + 1), view.state.doc.lines);
      const line = view.state.doc.line(lineNumber);
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }),
        selection: { anchor: line.from },
      });
      view.focus();
    };

    const selectRange = (e: Event) => {
      const { from, to } = (e as CustomEvent).detail ?? {};
      const view = handleRef.current?.view;
      if (!view || typeof from !== 'number' || typeof to !== 'number') return;
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 80 }),
      });
      requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;
        const node = view.domAtPos(from).node;
        const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      view.focus();
    };

    window.addEventListener('editor-scroll-to-line', scrollToLine);
    window.addEventListener('editor-select-range', selectRange);
    return () => {
      window.removeEventListener('editor-scroll-to-line', scrollToLine);
      window.removeEventListener('editor-select-range', selectRange);
    };
  }, [handleRef]);
}

export interface EditorAppearanceSettings {
  fontFamily: string;
  fontSize: string;
  lineHeight?: string;
  spellCheck?: boolean;
  livePreview?: unknown;
}

/**
 * Keeps font, spellcheck and preview settings in step with a live editor.
 *
 * All three go through compartments rather than rebuilding the view, so
 * changing a font keeps the caret, the scroll position and the undo history.
 */
export function useEditorAppearance(
  handleRef: RefObject<EditorHandle | null>,
  settings: EditorAppearanceSettings,
  spellCheckCompartment: Compartment,
): void {
  const { fontFamily, fontSize, lineHeight, spellCheck, livePreview } = settings;

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: handle.fontCompartment.reconfigure(
        createFontTheme(fontFamily, fontSize, lineHeight ?? '1.8'),
      ),
    });
  }, [handleRef, fontFamily, fontSize, lineHeight]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: spellCheckCompartment.reconfigure(
        EditorView.contentAttributes.of({ spellcheck: String(spellCheck ?? true) }),
      ),
    });
  }, [handleRef, spellCheck, spellCheckCompartment]);

  useEffect(() => {
    handleRef.current?.view.dispatch({ effects: refreshInlinePreviewEffect.of() });
  }, [handleRef, livePreview]);
}

/**
 * Points the transclusion renderer at the open document.
 *
 * Nothing called `setTransclusionYdoc`, so the shared `transclusion_hashes`
 * map was always empty: every reference fell back to its SQLite hash, the
 * per-reference round trip was never skipped, and a hash one peer resolved was
 * never shared with the others. The fallbacks meant this failed quietly rather
 * than visibly, which is why it went unnoticed.
 */
export function useTransclusionDocument(ydoc: Y.Doc | null): void {
  useEffect(() => {
    setTransclusionYdoc(ydoc);
    return () => setTransclusionYdoc(null);
  }, [ydoc]);
}

/** Mirrors focus mode onto the body, which is where the CSS hangs off it. */
export function useFocusModeAttribute(focusMode: boolean): void {
  useEffect(() => {
    document.body.setAttribute('data-focus-mode', focusMode ? 'true' : 'false');
    return () => document.body.removeAttribute('data-focus-mode');
  }, [focusMode]);
}

/** Applies a read-only reconfiguration through a compartment. */
export function setEditorReadOnly(
  handle: EditorHandle | null,
  compartment: Compartment,
  readOnly: boolean,
): void {
  if (!handle) return;
  handle.view.dispatch({ effects: compartment.reconfigure(EditorState.readOnly.of(readOnly)) });
}
