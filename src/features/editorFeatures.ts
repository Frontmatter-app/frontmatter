import type * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import { inlinePreviewPlugin } from '../editor/extensions/inlinePreview';
import { inlinePreviewTheme } from '../editor/themes/marktype';
import { focusModeExtension } from '../editor/extensions/focusMode';
import { annotationsExtension } from '../editor/extensions/annotationsExtension';
import type { AnnotationManager } from '../yjs/annotations';
import type { FeatureContext, FeatureModule } from './types';

/**
 * What the shell hands each editor feature at activation time.
 */
export interface EditorFeatureContext extends FeatureContext {
  ytext: Y.Text;
  awareness: unknown;
  annotationManager?: AnnotationManager;
}

type EditorFeature = FeatureModule<EditorFeatureContext>;

/**
 * Optional editor features.
 *
 * Each entry owns exactly one capability and is reachable only through this
 * list — `createEditor` never imports them directly. Delete a feature's line
 * here (and its directory) and the editor still builds; anything that depended
 * on it is skipped, not crashed.
 *
 * Baseline editing — history, search, keymaps, Markdown parsing — is not
 * listed, because an editor without it is not an editor.
 */
export const editorFeatures: EditorFeature[] = [
  {
    id: 'inline-preview',
    name: 'Inline Preview',
    editor: () => [inlinePreviewPlugin, inlinePreviewTheme],
    selfTest: () => {
      if (!inlinePreviewPlugin) throw new Error('inline preview plugin missing');
    },
  },
  {
    id: 'focus-mode',
    name: 'Focus Mode',
    editor: () => [focusModeExtension()],
    selfTest: () => {
      if (!focusModeExtension()) throw new Error('focus mode produced no extension');
    },
  },
  {
    id: 'annotations',
    name: 'Annotations',
    editor: (ctx) => [annotationsExtension(ctx.ytext)],
    selfTest: () => {
      if (typeof annotationsExtension !== 'function') {
        throw new Error('annotations extension is not a factory');
      }
    },
  },
  {
    id: 'collab',
    name: 'Live Collaboration',
    editor: (ctx) => [yCollab(ctx.ytext, ctx.awareness)],
    selfTest: () => {
      if (typeof yCollab !== 'function') throw new Error('yCollab is not a factory');
    },
  },
];
