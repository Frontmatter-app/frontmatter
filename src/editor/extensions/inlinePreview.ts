import { docMetaField } from './inlinePreview/markdownAnalysis';
import { blockDecorationsField } from './inlinePreview/blockDecorations';
import { inlineMarkPlugin } from './inlinePreview/inlineDecorations';
import { inlinePreviewInteractions } from './inlinePreview/interactions';
import { resolvedObjectsField, transclusionDecoField, transclusionPlugin, transclusionTheme } from './transclusionRenderer';

export { docMetaField } from './inlinePreview/markdownAnalysis';
export { blockDecorationsField } from './inlinePreview/blockDecorations';
export { inlineMarkPlugin } from './inlinePreview/inlineDecorations';
export { inlinePreviewInteractions } from './inlinePreview/interactions';
export { referencePickerField, referencePickerExtension, documentPathFacet } from './referencePicker';
export { resolvedObjectsField, transclusionDecoField, transclusionPlugin, transclusionTheme } from './transclusionRenderer';

export const inlinePreviewPlugin = [
  docMetaField,
  blockDecorationsField,
  inlineMarkPlugin,
  inlinePreviewInteractions,
  // Transclusion: order matters — cache field first, then deco field, then async loader
  resolvedObjectsField,
  transclusionDecoField,
  transclusionPlugin,
  transclusionTheme,
  // NOTE: referencePickerExtension is NOT included here.
  // It is only added by createEditor() so @ only works in Write mode.
];
