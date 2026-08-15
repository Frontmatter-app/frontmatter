import { useEffect } from 'react';
import type * as Y from 'yjs';
import type { EditorView } from '@codemirror/view';
import { extractImageRefs, prepareAssets, setImageBaseDir } from './assetResolver';
import { refreshInlinePreviewEffect } from '../editor/extensions/inlinePreview/settingsRefresh';
import type { ImageContext } from './imageTypes';

/**
 * Resolves a document's images and re-renders when the answers arrive.
 *
 * The image widgets are synchronous — they cannot await a permission check or a
 * disk lookup — so resolution happens here instead, and the editor is asked to
 * re-render once it has something better to show.
 *
 * Cloud reads are presigned and expire, so this also re-runs when the document
 * changes: a newly pasted image needs authorizing, and a long editing session
 * outlives a signature window.
 */
export function useDocumentAssets(
  ydoc: Y.Doc | null,
  view: EditorView | null,
  context: ImageContext | null,
) {
  const docDir = context?.docDir ?? '';
  const documentId = context?.documentId ?? '';
  const isCloud = !!context?.isCloud;

  useEffect(() => {
    setImageBaseDir(docDir);
  }, [docDir]);

  useEffect(() => {
    if (!ydoc || !documentId) return;
    let active = true;

    const run = async () => {
      const refs = extractImageRefs(ydoc.getText('markdown').toString());
      if (refs.length === 0) return;
      const changed = await prepareAssets(refs, { documentId, isCloud, docDir });
      // Only redraw when something actually resolved, so this cannot loop.
      if (changed && active && view?.dom.isConnected) {
        view.dispatch({ effects: refreshInlinePreviewEffect.of(undefined) });
      }
    };

    void run();

    // Debounced: typing a paragraph should not re-scan on every keystroke, but
    // an image pasted mid-session still resolves without reopening the file.
    let timer: any;
    const observer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 400);
    };
    const ytext = ydoc.getText('markdown');
    ytext.observe(observer);

    // Presigned URLs expire; refresh well before the window closes.
    const interval = setInterval(() => void run(), 15 * 60 * 1000);

    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
      ytext.unobserve(observer);
    };
  }, [ydoc, view, documentId, isCloud, docDir]);
}
