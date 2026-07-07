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
      const stage = getStage(view);
      event.preventDefault();
      event.stopPropagation();

      if (stage === 'write') {
        const pos = Number(image.dataset.sourceFrom);
        view.dispatch({
          selection: { anchor: pos, head: pos },
          scrollIntoView: true,
        });
        view.focus();
      }
      return true;
    }

    const checkbox = findElement(event.target, '.cm-task-preview-checkbox');
    if (checkbox) {
      event.preventDefault();
      event.stopPropagation();

      const sourceFrom = checkbox.dataset.sourceFrom;
      if (sourceFrom) {
        const pos = Number(sourceFrom);
        const lineObj = view.state.doc.lineAt(pos);
        const raw = lineObj.text;
        const checked = raw.includes('[x]') || raw.includes('[X]');
        const newText = checked
          ? raw.replace(/\[x\]/i, '[ ]')
          : raw.replace('[ ]', '[x]');
        if (newText !== raw) {
          view.dispatch({
            changes: { from: lineObj.from, to: lineObj.to, insert: newText },
            selection: { anchor: pos, head: pos },
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

    const stage = getStage(view);
    if (stage !== 'revise') return false;

    event.preventDefault();
    event.stopPropagation();
    const from = image.dataset.sourceFrom !== undefined ? Number(image.dataset.sourceFrom) : undefined;
    const to = image.dataset.sourceTo !== undefined ? Number(image.dataset.sourceTo) : undefined;
    showImageContextMenu(event.clientX, event.clientY, image.dataset.imageUrl, image.dataset.imageAlt || '', from, to);
    return true;
  }
});
