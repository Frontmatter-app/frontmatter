import { EditorView } from '@codemirror/view';
import { normalizeMarkdownUrl } from './markdown';
import { resolveImageUrl } from '../../../images/imageService';
import { showImageContextMenu, setCurrentExcalidrawDocumentId, setImageAnnotationManager, setImageAuthorId, setImageYdoc } from './imageContextMenu';

export { setCurrentExcalidrawDocumentId, setImageAnnotationManager, setImageAuthorId, setImageYdoc };

function isSafePreviewUrl(rawUrl: string) {
  return normalizeMarkdownUrl(rawUrl) !== '';
}

async function openPreviewUrl(rawUrl: string) {
  if (!isSafePreviewUrl(rawUrl)) return;

  const resolvedUrl = resolveImageUrl(normalizeMarkdownUrl(rawUrl));
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_browser_url', { url: resolvedUrl });
  } catch {
    window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
  }
}

function findElement(target: EventTarget | null, selector: string) {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

function getStage(view: EditorView): string | null {
  const el = view.dom.closest('[data-stage]');
  return el?.getAttribute('data-stage') ?? null;
}

export const inlinePreviewInteractions = EditorView.domEventHandlers({
  mousedown(event, view) {
    const image = findElement(event.target, '[data-inline-preview-image]');
    if (image?.dataset.imageUrl && image.dataset.sourceFrom) {
      event.preventDefault();
      event.stopPropagation();

      // Placing the caret used to be gated on the write stage while the event
      // was swallowed in every stage, so clicking an image anywhere else did
      // nothing at all — the editor did not even take focus. Revealing the
      // source is the right response wherever the document is editable.
      const pos = Number(image.dataset.sourceFrom);
      view.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    }

    const checkbox = findElement(event.target, '.cm-task-preview-checkbox');
    if (checkbox) {
      event.preventDefault();
      event.stopPropagation();

      const sourceFrom = checkbox.dataset.sourceFrom;
      if (sourceFrom) {
        // `sourceFrom` is the start of this task marker, whose text is exactly
        // `[ ]` or `[x]`, so the state is one character at `from + 1`.
        //
        // This used to rewrite the whole line with `raw.replace('[ ]', '[x]')`,
        // which toggled the *first* marker-shaped thing on the line — the wrong
        // box when a line held two, and a literal `[x]` in prose when it held
        // one. Replacing the entire line was also a delete-and-insert of every
        // character on it, which under Yjs discards a collaborator's concurrent
        // edit to the same line; a one-character change merges cleanly.
        const from = Number(sourceFrom);
        const marker = view.state.doc.sliceString(from, from + 3);
        if (/^\[[ xX]\]$/.test(marker)) {
          const checked = marker[1] !== ' ';
          view.dispatch({
            changes: { from: from + 1, to: from + 2, insert: checked ? ' ' : 'x' },
            selection: { anchor: from, head: from },
          });
        }
      }
      view.focus();
      return true;
    }

    const blockPreview = findElement(event.target, '[data-is-block-preview]');
    if (blockPreview && blockPreview.dataset.sourceFrom) {
      const pos = Number(blockPreview.dataset.sourceFrom);
      view.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    }

    return false;
  },

  click(event) {
    const link = findElement(event.target, 'a[data-inline-preview-link]');
    if (!link) return false;

    if ((event.metaKey || event.ctrlKey) && link.dataset.inlinePreviewLink) {
      event.preventDefault();
      event.stopPropagation();
      void openPreviewUrl(link.dataset.inlinePreviewLink);
      return true;
    }

    return false;
  },

  dblclick(event) {
    const image = findElement(event.target, '[data-inline-preview-image]');
    if (!image?.dataset.imageUrl) return false;

    event.preventDefault();
    event.stopPropagation();
    void openPreviewUrl(image.dataset.imageUrl);
    return true;
  },

  contextmenu(event, view) {
    const image = findElement(event.target, '[data-inline-preview-image]');
    if (!image?.dataset.imageUrl) return false;

    // Draft is an outline, not a place to edit images. Write and Revise both
    // are — this was limited to Revise, so the image menu was unreachable from
    // the stage where images are actually placed.
    const stage = getStage(view);
    if (stage !== 'revise' && stage !== 'write') return false;

    event.preventDefault();
    event.stopPropagation();
    const from = image.dataset.sourceFrom !== undefined ? Number(image.dataset.sourceFrom) : undefined;
    const to = image.dataset.sourceTo !== undefined ? Number(image.dataset.sourceTo) : undefined;
    showImageContextMenu(event.clientX, event.clientY, image.dataset.imageUrl, image.dataset.imageAlt || '', from, to);
    return true;
  }
});
