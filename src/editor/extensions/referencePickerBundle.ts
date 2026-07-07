import { tooltips } from '@codemirror/view';
import { referencePickerField } from './referencePickerCore';
import { referencePickerSearchPlugin } from './referencePickerSearch';
import { referencePickerTooltip } from './referencePickerTooltip';
import { referencePickerKeymap, referencePickerTheme } from './referencePickerKeymap';

export const referencePickerExtension = [
  tooltips({ parent: document.body }),
  referencePickerField,
  referencePickerSearchPlugin,
  referencePickerTooltip,
  referencePickerKeymap,
  referencePickerTheme,
];
