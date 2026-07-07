import { EditorView, WidgetType } from '@codemirror/view';

let mermaidId = 0;
let mermaidModulePromise: Promise<typeof import('mermaid').default> | null = null;

async function getMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then(module => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'var(--editor-font-family, system-ui)',
      });
      return module.default;
    });
  }
  return mermaidModulePromise;
}

export class DiagramWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly diagramType: string,
    readonly from?: number,
    readonly to?: number,
  ) {
    super();
  }

  eq(other: DiagramWidget) {
    return (
      other.source === this.source &&
      other.diagramType === this.diagramType &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  ignoreEvent() {
    return false;
  }

  get estimatedHeight() {
    return 260;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-block-preview cm-diagram-preview';
    if (this.from !== undefined) wrap.dataset.sourceFrom = String(this.from);
    if (this.to !== undefined) wrap.dataset.sourceTo = String(this.to);
    wrap.dataset.isBlockPreview = 'true';

    const body = document.createElement('div');
    body.className = 'cm-diagram-preview-body';
    body.textContent = 'Rendering diagram...';
    wrap.appendChild(body);

    const id = `marktype-mermaid-${Date.now()}-${mermaidId++}`;
    getMermaid()
      .then(mermaid => mermaid.render(id, this.source))
      .then(({ svg }) => {
        if (!wrap.isConnected) return;
        body.innerHTML = svg;
        view.requestMeasure();
      })
      .catch((error) => {
        if (!wrap.isConnected) return;
        body.classList.add('cm-diagram-preview-error');
        body.textContent = error instanceof Error ? error.message : 'Invalid Mermaid diagram';
        view.requestMeasure();
      });

    return wrap;
  }
}
