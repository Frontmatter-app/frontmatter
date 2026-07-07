import { EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';
import { markdown, type MarkdownReferences } from './markdown';
import { resolveImageUrl } from '../../../images/imageService';

function attachImageLifecycleHandlers(img: HTMLImageElement, view: EditorView) {
  img.addEventListener('load', () => view.requestMeasure(), { once: true });
  img.addEventListener('error', () => {
    const ph = document.createElement('div');
    ph.className = 'cm-inline-preview-image-error';
    ph.textContent = `Image not found: ${img.alt || img.src}`;
    img.replaceWith(ph);
    view.requestMeasure();
  }, { once: true });
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly inline: boolean,
    readonly from?: number,
    readonly to?: number,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return (
      other.url === this.url &&
      other.alt === this.alt &&
      other.inline === this.inline &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  ignoreEvent() {
    return false;
  }

  get estimatedHeight() {
    return this.inline ? -1 : 220;
  }

  toDOM(view: EditorView) {
    if (this.inline) {
      const img = document.createElement('img');
      img.className = 'cm-inline-preview-image';
      img.src = resolveImageUrl(this.url);
      img.alt = this.alt;
      img.dataset.inlinePreviewImage = 'true';
      img.dataset.imageUrl = this.url;
      img.dataset.imageAlt = this.alt;
      if (this.from !== undefined) img.dataset.sourceFrom = String(this.from);
      if (this.to !== undefined) img.dataset.sourceTo = String(this.to);
      attachImageLifecycleHandlers(img, view);
      return img;
    }

    const container = document.createElement('div');
    container.className = 'cm-block-preview cm-block-image-preview inline-image-preview-container';
    if (this.from !== undefined) container.dataset.sourceFrom = String(this.from);
    if (this.to !== undefined) container.dataset.sourceTo = String(this.to);
    container.dataset.isBlockPreview = 'true';

    const img = document.createElement('img');
    img.className = 'cm-block-image-preview-media';
    img.src = resolveImageUrl(this.url);
    img.alt = this.alt;
    img.dataset.inlinePreviewImage = 'true';
    img.dataset.imageUrl = this.url;
    img.dataset.imageAlt = this.alt;
    if (this.from !== undefined) img.dataset.sourceFrom = String(this.from);
    if (this.to !== undefined) img.dataset.sourceTo = String(this.to);
    attachImageLifecycleHandlers(img, view);
    container.appendChild(img);

    if (this.alt) {
      const caption = document.createElement('div');
      caption.className = 'cm-block-image-preview-caption';
      caption.innerText = this.alt;
      container.appendChild(caption);
    }

    return container;
  }
}

export class TableWidget extends WidgetType {
  constructor(
    readonly rawMarkdown: string,
    readonly references: MarkdownReferences = {},
    readonly from?: number,
  ) {
    super();
  }

  eq(other: TableWidget) {
    return other.rawMarkdown === this.rawMarkdown && other.references === this.references && other.from === this.from;
  }

  ignoreEvent() {
    return false;
  }

  get estimatedHeight() {
    return 160;
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-block-preview cm-table-preview-wrap';
    if (this.from !== undefined) wrap.dataset.sourceFrom = String(this.from);
    wrap.dataset.isBlockPreview = 'true';

    const rendered = document.createElement('div');
    rendered.innerHTML = markdown.render(this.rawMarkdown, { references: this.references });
    const table = rendered.querySelector('table');
    if (!table) return wrap;

    table.classList.add('inline-table-preview', 'cm-table-preview');
    wrap.appendChild(table);
    return wrap;
  }
}

export class MathWidget extends WidgetType {
  constructor(
    readonly formula: string,
    readonly displayMode: boolean,
    readonly from?: number,
    readonly to?: number,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return (
      other.formula === this.formula &&
      other.displayMode === this.displayMode &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  ignoreEvent() {
    return false;
  }

  get estimatedHeight() {
    return this.displayMode ? 96 : -1;
  }

  toDOM() {
    const wrap = document.createElement(this.displayMode ? 'div' : 'span');
    wrap.className = this.displayMode ? 'cm-block-preview cm-math-preview-block' : 'cm-math-preview-inline';
    if (this.from !== undefined) wrap.dataset.sourceFrom = String(this.from);
    if (this.to !== undefined) wrap.dataset.sourceTo = String(this.to);
    if (this.displayMode) wrap.dataset.isBlockPreview = 'true';

    try {
      katex.render(this.formula, wrap, {
        displayMode: this.displayMode,
        throwOnError: false,
        trust: false,
        strict: 'warn',
      });
    } catch (error) {
      wrap.classList.add('cm-math-preview-error');
      wrap.textContent = this.formula;
      wrap.title = error instanceof Error ? error.message : 'Invalid math';
    }

    return wrap;
  }
}

export { DiagramWidget } from './diagramWidget';

export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from?: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from;
  }

  ignoreEvent() {
    return false;
  }

  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task-preview-checkbox';
    if (this.from !== undefined) box.dataset.sourceFrom = String(this.from);
    return box;
  }
}
