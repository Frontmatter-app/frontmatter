import { ViewPlugin, Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { StateEffect, StateField, Extension, EditorState } from '@codemirror/state';
import type { ValeAlert } from '../types';
import { getValeActionText, getValeLocationText } from '../review/reviewIssues';

export const setValeAlertsEffect = StateEffect.define<ValeAlert[]>();

export const valeAlertState = StateField.define<ValeAlert[]>({
  create() {
    return [];
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setValeAlertsEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const errorDeco = Decoration.mark({ class: 'cm-vale-error' });
const warningDeco = Decoration.mark({ class: 'cm-vale-warning' });
const suggestionDeco = Decoration.mark({ class: 'cm-vale-suggestion' });

export const valeLintTheme = EditorView.theme({
  '.cm-vale-error': {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderBottom: '2px wavy rgba(239, 68, 68, 0.8)',
  },
  '.cm-vale-warning': {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderBottom: '2px wavy rgba(245, 158, 11, 0.8)',
  },
  '.cm-vale-suggestion': {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderBottom: '2px wavy rgba(59, 130, 246, 0.8)',
  },
});

const TOOLTIP_CLASS = 'cm-vale-tooltip';
let activeTooltip: HTMLDivElement | null = null;

function showTooltip(view: EditorView, pos: number, alert: ValeAlert) {
  hideTooltip();

  const tooltip = document.createElement('div');
  tooltip.className = `${TOOLTIP_CLASS} fixed z-[9999] rounded-xl border border-black/10 dark:border-white/10 p-3 shadow-2xl text-xs max-w-xs`;
  tooltip.style.background = 'var(--editor-bg-color)';
  tooltip.style.color = 'var(--editor-text-color)';

  const severityColor =
    alert.severity === 'error'
      ? 'text-rose-500'
      : alert.severity === 'warning'
        ? 'text-amber-500'
        : 'text-blue-500';
  const actionText = getValeActionText(alert);
  const matchText = alert.match || '';

  tooltip.innerHTML = `
    <div class="flex items-center gap-1.5 mb-1.5">
      <span class="font-bold text-[10px] uppercase tracking-wider ${severityColor}">${alert.severity}</span>
      <span class="text-[9px] opacity-60 font-mono">${alert.rule}</span>
    </div>
    <div class="font-semibold text-[11px] mb-1">${escapeHtml(alert.message)}</div>
    ${alert.description ? `<div class="text-[10px] opacity-75 mb-2 leading-relaxed">${escapeHtml(alert.description)}</div>` : ''}
    ${matchText ? `<div class="text-[10px] opacity-70 mb-2 border-l border-black/10 dark:border-white/10 pl-2 italic">"${escapeHtml(matchText)}"</div>` : ''}
    ${actionText ? `<div class="text-[10px] opacity-80 mb-2"><span class="font-semibold">Suggested fix:</span> ${escapeHtml(actionText)}</div>` : ''}
    ${alert.link ? `<div class="text-[9px] opacity-70 mb-2 break-all">${escapeHtml(alert.link)}</div>` : ''}
    <div class="text-[9px] opacity-50 font-mono">${escapeHtml(getValeLocationText(alert))}</div>
  `;

  const coords = view.coordsAtPos(pos);
  tooltip.style.left = `${coords.left + window.scrollX}px`;
  tooltip.style.top = `${coords.bottom + window.scrollY + 8}px`;

  document.body.appendChild(tooltip);
  activeTooltip = tooltip;

  const hide = (e: MouseEvent) => {
    if (!tooltip.contains(e.target as Node)) {
      hideTooltip();
      document.removeEventListener('mousedown', hide);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', hide), 0);
}

function hideTooltip() {
  if (activeTooltip && activeTooltip.parentNode) {
    activeTooltip.parentNode.removeChild(activeTooltip);
  }
  activeTooltip = null;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getAlertRange(doc: EditorState['doc'], alert: ValeAlert) {
  if (alert.line < 1 || alert.line > doc.lines) return null;

  const line = doc.line(alert.line);
  const lineText = doc.sliceString(line.from, line.to);
  const lineLength = line.to - line.from;
  const rawStart = alert.span?.[0] ?? 1;
  const rawEnd = alert.span?.[1] ?? lineLength;
  const spanStart = Math.max(0, rawStart - 1);
  const spanEnd = Math.max(spanStart + 1, rawEnd);
  let from = Math.max(line.from, line.from + spanStart);
  let to = Math.min(line.to, line.from + spanEnd);

  const match = alert.match?.trim();
  if (match) {
    const exactIndex = lineText.indexOf(match);

    if (exactIndex >= 0) {
      from = line.from + exactIndex;
      to = Math.min(line.to, from + match.length);
    }
  }

  if (from >= to || from < line.from || to > line.to) return null;
  return { from, to };
}

export const valeLintExtension = (enabled: boolean): Extension => {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      active: boolean;

      constructor(view: EditorView) {
        this.active = enabled;
        this.decorations = this.buildDeco(view);
      }

      update(update: any) {
        if (
          update.docChanged ||
          update.state.field(valeAlertState, false) !==
            update.startState.field(valeAlertState, false)
        ) {
          this.decorations = this.buildDeco(update.view);
        }
      }

      buildDeco(view: EditorView) {
        if (!this.active) return Decoration.none;

        const builder: any[] = [];
        const alerts = view.state.field(valeAlertState, false) || [];
        const doc = view.state.doc;

        for (const alert of alerts) {
          const range = getAlertRange(doc, alert);
          if (!range) continue;

          let deco: Decoration;
          if (alert.severity === 'error') {
            deco = errorDeco;
          } else if (alert.severity === 'warning') {
            deco = warningDeco;
          } else {
            deco = suggestionDeco;
          }

          builder.push(deco.range(range.from, range.to));
        }

        builder.sort((a, b) => a.from - b.from);
        return Decoration.set(builder, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

  const clickHandler = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target =
        event.target instanceof Element
          ? event.target
          : (event.target as Node | null)?.parentElement;
      const hasDecoration = target?.closest(
        '.cm-vale-error, .cm-vale-warning, .cm-vale-suggestion',
      );
      if (!hasDecoration) {
        hideTooltip();
        return false;
      }

      const pos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.posAtDOM(hasDecoration);
      const alerts = view.state.field(valeAlertState, false) || [];
      const clicked = alerts.find((a) => {
        const range = getAlertRange(view.state.doc, a);
        return range ? pos >= range.from && pos <= range.to : false;
      });

      if (clicked) {
        showTooltip(view, pos, clicked);
      }

      return false;
    },
  });

  return [valeAlertState, plugin, valeLintTheme, clickHandler];
};
