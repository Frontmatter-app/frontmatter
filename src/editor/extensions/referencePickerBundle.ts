import type { Extension } from '@codemirror/state';
import { tooltips } from '@codemirror/view';
import { referencePickerField } from './referencePickerCore';
import { referencePickerSearchPlugin } from './referencePickerSearch';
import { referencePickerTooltip } from './referencePickerTooltip';
import { referencePickerKeymap, referencePickerTheme } from './referencePickerKeymap';

/**
 * Built on demand rather than at module scope.
 *
 * `tooltips({ parent: document.body })` used to run on import, so merely
 * importing anything that reached this module required a live DOM — which made
 * the editor features impossible to load in a test process, and evaluated
 * `document.body` before it was guaranteed to exist.
 */
export function referencePickerExtension(): Extension[] {
  return [
    tooltips({ parent: document.body }),
    referencePickerField,
    referencePickerSearchPlugin,
    referencePickerTooltip,
    referencePickerKeymap,
    referencePickerTheme,
  ];
}
