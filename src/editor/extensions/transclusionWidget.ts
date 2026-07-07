import { EditorView, WidgetType } from '@codemirror/view';
import { isBlockExecuting } from './transclusionExecution';
import { handleTransclusionAction } from './transclusionActions';
import type { ResolvedObject } from './transclusionTypes';

class StatusWidget extends WidgetType {
  constructor(
    private type: 'ref' | 'exec',
    private uuid: string,
    private name: string,
    private status: 'sync' | 'out-of-sync' | 'not-found',
    private object?: ResolvedObject
  ) {
    super();
  }

  eq(other: StatusWidget) {
    return other.uuid === this.uuid && other.status === this.status && other.type === this.type;
  }

  toDOM(view: EditorView) {
    const bar = document.createElement('div');
    bar.className =
      'cm-transclusion-status-bar flex items-center justify-between px-3 py-1 rounded-t-md text-[11px] font-sans select-none border-t border-x';

    const textEl = document.createElement('span');
    textEl.className = 'flex items-center gap-1.5';

    const typeLabel = this.type === 'ref' ? 'Reference' : 'Execution Output';

    if (this.status === 'sync') {
      bar.style.cssText = 'border-color: var(--editor-success); background-color: var(--editor-success-bg);';
      textEl.style.color = 'var(--editor-success)';
      textEl.innerHTML = `<span style="width:6px;height:6px;background-color:var(--editor-success);border-radius:9999px;display:inline-block"></span> ${typeLabel}: <strong style="color:var(--editor-text-color)">${this.name}</strong> (Synced)`;
    } else if (this.status === 'out-of-sync') {
      bar.style.cssText = 'border-color: var(--editor-warning); background-color: var(--editor-warning-bg);';
      textEl.style.color = 'var(--editor-warning)';
      const warningLabel = this.type === 'ref' ? 'Reference modified' : 'Source changed';
      textEl.innerHTML = `<span>🔄</span> ${typeLabel}: <strong style="color:var(--editor-text-color)">${this.name}</strong> (${warningLabel})`;
    } else {
      bar.style.cssText = 'border-color: var(--editor-error); background-color: var(--editor-error-bg);';
      textEl.style.color = 'var(--editor-error)';
      textEl.innerHTML = `<span>⚠</span> Reference block not found in workspace`;
    }

    bar.appendChild(textEl);

    if (this.status !== 'not-found') {
      const isExecuting = isBlockExecuting(this.uuid);
      const button = document.createElement('button');

      if (isExecuting) {
        button.innerHTML = `<span class="exec-spinner"></span>`;
        button.disabled = true;
        button.style.cssText = 'padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: not-allowed; border: none; background: var(--editor-border); color: var(--editor-muted);';
      } else {
        const label =
          this.status === 'out-of-sync'
            ? (this.type === 'ref' ? 'Sync' : 'Re-run')
            : (this.type === 'ref' ? 'Sync' : 'Run');
        button.textContent = label;
        const isOutOfSync = this.status === 'out-of-sync';
        button.style.cssText = `padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; background: ${isOutOfSync ? 'var(--editor-warning)' : 'var(--editor-border)'}; color: ${isOutOfSync ? 'white' : 'var(--editor-text-color)'};`;
        button.addEventListener('click', (e) => {
          e.preventDefault();
          button.disabled = true;
          button.innerHTML = `<span class="exec-spinner"></span>`;
          handleTransclusionAction(view, this.type, this.uuid);
        });
      }
      bar.appendChild(button);
    }

    return bar;
  }

  ignoreEvent() {
    return true;
  }
}

export default StatusWidget;
