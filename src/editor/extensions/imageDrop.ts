import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { ingestImage } from '../../images/imageService';
import type { ImageContext } from '../../images/imageTypes';

/**
 * Paste and drag-drop of images into the editor.
 *
 * Neither existed: paste was handled as `navigator.clipboard.readText()`, so a
 * copied image was silently dropped, and the only `onDrop` handlers in the app
 * were the sidebar's file-tree reordering. Inserting an image required the
 * toolbar's file picker, which is mounted only in the write view.
 *
 * Both paths go through `ingestImage`, so they get the same validation,
 * downscaling, and content-addressed storage as every other route in.
 */

function imageFilesFrom(items: DataTransferItemList | null, files: FileList | null): File[] {
  const out: File[] = [];

  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
  }

  // Dropped files arrive here rather than in `items` on some platforms.
  if (out.length === 0 && files) {
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) out.push(file);
    }
  }

  return out;
}

async function insertImages(
  view: EditorView,
  files: File[],
  getContext: () => ImageContext | null,
  at?: number,
): Promise<void> {
  const context = getContext();
  if (!context) return;

  for (const file of files) {
    // A placeholder keeps the caret position meaningful while the upload runs,
    // and gives the user something to delete if it fails.
    const placeholder = `![Uploading ${file.name}…]()`;
    const insertAt = at ?? view.state.selection.main.head;

    view.dispatch({
      changes: { from: insertAt, insert: placeholder },
      selection: { anchor: insertAt + placeholder.length },
    });

    try {
      const result = await ingestImage(file, context, file.name);
      const markdown = `![${file.name.replace(/\.[^.]+$/, '')}](${result.url})`;

      // Re-find the placeholder: the document may have moved underneath us
      // while the upload was in flight, including by a collaborator.
      const current = view.state.doc.toString();
      const index = current.indexOf(placeholder);
      if (index === -1) continue;

      view.dispatch({
        changes: { from: index, to: index + placeholder.length, insert: markdown },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      const current = view.state.doc.toString();
      const index = current.indexOf(placeholder);
      if (index === -1) continue;
      view.dispatch({
        changes: { from: index, to: index + placeholder.length, insert: `![${message}]()` },
      });
      console.error('[images] Insert failed:', err);
    }
  }
}

/**
 * @param getContext Resolved per event rather than captured, because a
 *   document's cloud status and folder can both change while the editor lives.
 */
export function imageDropExtension(getContext: () => ImageContext | null): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = imageFilesFrom(event.clipboardData?.items ?? null, null);
      if (files.length === 0) return false;
      // Only claim the event once an image is actually present, so pasting text
      // keeps its default behaviour.
      event.preventDefault();
      void insertImages(view, files, getContext);
      return true;
    },

    drop(event, view) {
      const files = imageFilesFrom(
        event.dataTransfer?.items ?? null,
        event.dataTransfer?.files ?? null,
      );
      if (files.length === 0) return false;
      event.preventDefault();

      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined;
      void insertImages(view, files, getContext, at);
      return true;
    },

    dragover(event) {
      // Without this the browser refuses the drop outright.
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  });
}
