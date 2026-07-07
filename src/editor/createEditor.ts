import {
  EditorView,
  drawSelection,
  keymap,
  highlightActiveLine,
  dropCursor
} from '@codemirror/view';
import { EditorState, Extension, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Table } from '@lezer/markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { inlinePreviewPlugin } from './extensions/inlinePreview';
import { inlinePreviewTheme } from './themes/marktype';
import { focusModeExtension } from './extensions/focusMode';
import { annotationsExtension, setAnnotationsEffect } from './extensions/annotationsExtension';
import { AnnotationManager } from '../yjs/annotations';
import { valeLintExtension, setValeAlertsEffect } from './extensions/valeLintExtension';
import { getThemeConfig, createFontTheme } from './themes/themeConfig';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';

export interface EditorHandle {
  view: EditorView;
  fontCompartment: Compartment;
  destroy: () => void;
  updateValeAlerts: (alerts: any[]) => void;
}

export function createEditor(
  parent: HTMLElement,
  ytext: Y.Text,
  providerAwareness: any,
  extensions: Extension[] = [],
  annotationManager?: AnnotationManager,
): EditorHandle {
  const config = getThemeConfig();
  const fontCompartment = new Compartment();

  // Balanced base configurations maximizing standard UX and tool tracking
  const baseExtensions = [
    history(),
    drawSelection(),
    dropCursor(),            // Visual support showing exactly where text/cursor drag layouts fall
    highlightActiveLine(),   // Highlights active rows; helps maintain context around blocks
    bracketMatching(),       // Seamless navigation for matching block tags like <note> or <tabs>
    EditorView.lineWrapping,
    search(),
    highlightSelectionMatches(),
    keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [Table],
    }),
    syntaxHighlighting(defaultHighlightStyle),
    inlinePreviewPlugin,
    inlinePreviewTheme,
    // Font configuration isolated for fast, fluid dynamic resizing runtime swaps
    fontCompartment.of(createFontTheme(config.fontFamily, config.fontSize, config.lineHeight)),
    focusModeExtension(),
    annotationsExtension(ytext),
    yCollab(ytext, providerAwareness),
    ...extensions,
  ];

  const view = new EditorView({
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: baseExtensions
    }),
    parent
  });

  let unobserveAnnotations: (() => void) | null = null;

  if (annotationManager) {
    // Initial sync transaction execution setup
    view.dispatch({
      effects: setAnnotationsEffect.of(annotationManager.getAnnotations())
    });

    // Capture reference to observer callback handler to avoid leaking closures
    const observerCallback = () => {
      // Defensive guard preventing updates to a detached or destroyed View instance
      if (!view.dom.isConnected) return;

      view.dispatch({
        effects: setAnnotationsEffect.of(annotationManager.getAnnotations())
      });
    };

    annotationManager.observe(observerCallback);

    // Store cleanup handle to invoke when tearing down the workspace module instance
    unobserveAnnotations = () => {
      if (typeof annotationManager.unobserve === 'function') {
        annotationManager.unobserve(observerCallback);
      }
    };
  }

  return {
    view,
    fontCompartment,
    destroy: () => {
      if (unobserveAnnotations) unobserveAnnotations();
      view.destroy();
    },
    updateValeAlerts: (alerts: any[]) => {
      view.dispatch({
        effects: setValeAlertsEffect.of(alerts),
      });
    },
  };
}
