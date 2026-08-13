import { EditorView, WidgetType } from '@codemirror/view';
import { markdown, type MarkdownReferences } from './markdown';
import { resolveImageUrl } from '../../../images/imageService';

/**
 * KaTeX is ~270 kB and only needed once a document actually contains math, so
 * it is fetched on first use rather than shipped in the initial bundle.
 *
 * `toDOM` must return synchronously, so the formula is rendered as plain text
 * and upgraded in place when the module arrives.
 */
let katexModule: typeof import('katex').default | null = null;
let katexPromise: Promise<typeof import('katex').default> | null = null;

function loadKatex(): Promise<typeof import('katex').default> {
  if (!katexPromise) {
    katexPromise = import('katex').then((module) => {
      katexModule = module.default;
      return katexModule;
    });
  }
  return katexPromise;
}

interface MathRenderOptions {
  displayMode: boolean;
  throwOnError: boolean;
  trust: boolean;
  strict: 'warn';
}

function renderMath(
  katexInstance: typeof import('katex').default,
  formula: string,
  target: HTMLElement,
  options: MathRenderOptions,
): void {
  try {
    katexInstance.render(formula, target, options);
    target.classList.remove('cm-math-preview-error');
  } catch (error) {
    target.classList.add('cm-math-preview-error');
    target.textContent = formula;
    target.title = error instanceof Error ? error.message : 'Invalid math';
  }
}

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

    const options: MathRenderOptions = {
      displayMode: this.displayMode,
      throwOnError: false,
      trust: false,
      strict: 'warn',
    };

    if (katexModule) {
      renderMath(katexModule, this.formula, wrap, options);
      return wrap;
    }

    // Show the source until KaTeX loads, then swap in the typeset output.
    wrap.textContent = this.formula;
    loadKatex()
      .then((katexInstance) => {
        if (wrap.isConnected) renderMath(katexInstance, this.formula, wrap, options);
      })
      .catch(() => {
        wrap.classList.add('cm-math-preview-error');
        wrap.title = 'Could not load the math renderer';
      });

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
