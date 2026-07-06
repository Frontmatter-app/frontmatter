import { EditorView } from '@codemirror/view';
import { normalizeMarkdownUrl } from './markdown';
import { getAssetUrl } from './widgets';
import { useExcalidrawStore } from '../../../excalidraw/excalidrawStore';
import * as Y from 'yjs';

function isSafePreviewUrl(rawUrl: string) {
  return normalizeMarkdownUrl(rawUrl) !== '';
}

async function openPreviewUrl(rawUrl: string) {
  if (!isSafePreviewUrl(rawUrl)) return;

  const resolvedUrl = getAssetUrl(normalizeMarkdownUrl(rawUrl));
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_browser_url', { url: resolvedUrl });
  } catch {
    window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
  }
}

async function downloadImage(imageUrl: string, imageAlt: string) {
  try {
    const resolvedUrl = getAssetUrl(normalizeMarkdownUrl(imageUrl));
    const response = await fetch(resolvedUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    
    let filename = 'download';
    if (imageUrl) {
      const cleanUrl = imageUrl.split(/[?#]/)[0];
      const parts = cleanUrl.split('/');
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart.includes('.')) {
        filename = lastPart;
      } else {
        filename = imageAlt || 'image';
        filename = filename.replace(/[/\\?%*:|"<>]/g, '-');
        if (!filename.includes('.')) {
          filename += '.png';
        }
      }
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error('[inlinePreview] downloadImage error:', error);
  }
}

let activeMenu: HTMLDivElement | null = null;
let _currentDocumentId: string | null = null;
let _annManager: any = null;
let _authorId: string = '';
let _ydoc: any = null;

export function setCurrentExcalidrawDocumentId(id: string | null) {
  _currentDocumentId = id;
}
export function setImageAnnotationManager(mgr: any) { _annManager = mgr; }
export function setImageAuthorId(id: string) { _authorId = id; }
export function setImageYdoc(doc: any) { _ydoc = doc; }

function renderNoteInput(menu: HTMLDivElement, imageUrl: string, imageAlt: string, from: number, to: number, close: () => void) {
  menu.innerHTML = '';
  menu.style.width = '260px';
  menu.style.padding = '0';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px 0;font-size:13px;font-weight:600;color:var(--editor-text-color,#e0e0e0)';
  header.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.75;flex-shrink:0"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Add Note</span>`;
  menu.appendChild(header);

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Write your note...';
  textarea.style.cssText = 'width:calc(100% - 28px);margin:10px 14px 8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(128,128,128,0.2);background:rgba(128,128,128,0.06);color:var(--editor-text-color,#e0e0e0);font-size:13px;font-family:inherit;resize:none;outline:none;min-height:72px';
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveBtn.click();
    if (e.key === 'Escape') { close(); return; }
  });
  setTimeout(() => textarea.focus(), 50);
  menu.appendChild(textarea);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;padding:0 14px 10px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'padding:5px 12px;border-radius:8px;border:1px solid rgba(128,128,128,0.2);background:transparent;color:var(--editor-text-color,#e0e0e0);cursor:pointer;font-size:12px;font-weight:500';
  cancelBtn.addEventListener('click', close);
  btnRow.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'padding:5px 16px;border-radius:8px;border:none;background:#4a6cf7;color:#fff;cursor:pointer;font-size:12px;font-weight:500';
  saveBtn.addEventListener('click', async () => {
    const noteText = textarea.value.trim();
    if (!noteText || !_annManager || !_ydoc) { close(); return; }
    try {
      const ytext = _ydoc.getText('markdown');
      const selectedText = _ydoc.getText('markdown').toString().slice(from, to);
      const startPos = Y.createRelativePositionFromTypeIndex(ytext, from, -1);
      const endPos = Y.createRelativePositionFromTypeIndex(ytext, to, -1);
      _annManager.addAnnotation(
        Math.random().toString(36).substring(2, 9),
        _currentDocumentId,
        _authorId,
        startPos,
        endPos,
        selectedText || `![${imageAlt || ''}](${imageUrl})`,
        noteText,
      );
    } catch (e) {
      console.error('[Image Note] Failed to save:', e);
    }
    close();
  });
  btnRow.appendChild(saveBtn);
  menu.appendChild(btnRow);

  // Force reposition for new width
  const rect = menu.getBoundingClientRect();
  let x = rect.left;
  let y = rect.top;
  if (x + 260 > window.innerWidth - 8) x = window.innerWidth - 268;
  if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
}

function showImageContextMenu(clientX: number, clientY: number, imageUrl: string, imageAlt: string, from?: number, to?: number) {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }

  const menu = document.createElement('div');
  activeMenu = menu;
  
  menu.style.position = 'fixed';
  menu.style.width = '180px';
  menu.style.zIndex = '99999';
  menu.style.borderRadius = '14px';
  menu.style.overflow = 'hidden';
  menu.style.background = 'color-mix(in srgb, var(--editor-bg-color, #ffffff) 88%, transparent)';
  menu.style.backdropFilter = 'blur(24px) saturate(1.6)';
  menu.style.setProperty('-webkit-backdrop-filter', 'blur(24px) saturate(1.6)');
  menu.style.border = '1px solid rgba(128,128,128,0.14)';
  menu.style.boxShadow = '0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)';
  menu.style.animation = 'contextMenuIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)';
  menu.style.transformOrigin = 'top left';
  menu.style.fontFamily = 'var(--font-sans, system-ui, sans-serif)';
  menu.style.padding = '4px 0';
  menu.style.userSelect = 'none';

  const menuWidth = 200;
  const menuHeight = 130;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = clientX + 6;
  let y = clientY + 6;
  if (x + menuWidth > vw - 12) x = clientX - menuWidth - 6;
  if (y + menuHeight > vh - 12) y = clientY - menuHeight - 6;
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;

  const createItem = (text: string, iconSvg: string, onClick: () => void) => {
    const btn = document.createElement('button');
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '10px';
    btn.style.width = '100%';
    btn.style.padding = '9px 14px';
    btn.style.fontSize = '13.5px';
    btn.style.fontWeight = '500';
    btn.style.color = 'var(--editor-text-color, #111827)';
    btn.style.cursor = 'pointer';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.textAlign = 'left';
    btn.style.transition = 'background 0.08s';

    btn.innerHTML = `${iconSvg}<span>${text}</span>`;

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(128,128,128,0.09)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onClick !== showNoteSubmenu) closeMenu();
      onClick();
    });
    return btn;
  };

  const closeMenu = () => {
    if (activeMenu === menu) {
      menu.remove();
      activeMenu = null;
    }
    document.removeEventListener('mousedown', handleOutsideClick);
    document.removeEventListener('keydown', handleKeyDown);
  };

  const showNoteSubmenu = () => {
    document.removeEventListener('mousedown', handleOutsideClick);
    document.removeEventListener('keydown', handleKeyDown);
    renderNoteInput(menu, imageUrl, imageAlt, from ?? 0, to ?? 0, closeMenu);
  };

  const handleOutsideClick = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      closeMenu();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeMenu();
    }
  };

  const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75; flex-shrink: 0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
  const annotateIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75; flex-shrink: 0;"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  const noteIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75; flex-shrink: 0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  menu.appendChild(createItem('Download Image', downloadIcon, () => {
    void downloadImage(imageUrl, imageAlt);
  }));

menu.appendChild(createItem('Annotate Image', annotateIcon, () => {
    if (_currentDocumentId) {
      useExcalidrawStore.getState().open({
        mode: 'annotate-image',
        imageUrl,
        imageAlt,
        documentId: _currentDocumentId,
      });
    }
  }));

  menu.appendChild(createItem('Add Note', noteIcon, showNoteSubmenu));

  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
  }, 50);
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
