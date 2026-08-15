import React, { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { Compartment } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import { createEditor, EditorHandle } from '../../editor/createEditor';
import { applyThemeVariablesToDOM, createFontTheme } from '../../editor/themes/themeConfig';
import { refreshInlinePreviewEffect } from '../../editor/extensions/inlinePreview/settingsRefresh';
import { useSettingsStore } from '../../settings/settingsStore';

const WIDTH_MAP: Record<string, string> = {
  narrow: '560px',
  medium: '720px',
  wide: '900px',
  full: '100%',
};

export function DraftView({ ydoc }: { ydoc: Y.Doc; title?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const spellCheckCompartmentRef = useRef<Compartment>(new Compartment());
  const { settings } = useSettingsStore();

  useEffect(() => {
    applyThemeVariablesToDOM();

    if (!containerRef.current || !ydoc) return;

    const awareness = new Awareness(ydoc);
    const draftTheme = EditorView.theme({
      '&': {
        height: '100%',
      },
      '.cm-scroller': {
        paddingTop: '16px',
        paddingBottom: '160px',
      },
      '.cm-content': {
        minHeight: '300px',
      },
    });

    const handle = createEditor(
      containerRef.current,
      ydoc.getText('draft'),
      awareness,
      [
        draftTheme,
        placeholder('Draft freely...'),
        spellCheckCompartmentRef.current.of(
          EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })
        ),
      ],
    );

    handleRef.current = handle;

    return () => {
      handle.destroy();
      awareness.destroy();
      handleRef.current = null;
    };
  }, [ydoc]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    handle.view.dispatch({
      effects: refreshInlinePreviewEffect.of(),
    });
  }, [settings.livePreview]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    handle.view.dispatch({
      effects: spellCheckCompartmentRef.current.reconfigure(
        EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })
      ),
    });
  }, [settings.spellCheck]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    handle.view.dispatch({
      effects: handle.fontCompartment.reconfigure(
        createFontTheme(settings.fontFamily, settings.fontSize, settings.lineHeight ?? '1.8')
      ),
    });
  }, [settings.fontFamily, settings.fontSize, settings.lineHeight]);

  const maxWidth = WIDTH_MAP[settings.editorWidth ?? 'medium'];

  return (
    <div className="w-full h-full frontmatter-editor-container">
      <div
        ref={containerRef}
        className="w-full h-full min-h-[300px] mx-auto"
        data-stage="draft"
        style={{ maxWidth }}
      />
    </div>
  );
}
