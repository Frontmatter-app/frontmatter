import type { PickerScope } from './referencePickerTypes';

let _currentDocPath = '';
let _pickerScope: PickerScope = 'file';

export function setPickerDocumentPath(path: string) {
  _currentDocPath = path;
}

export function getPickerDocumentPath(): string {
  return _currentDocPath;
}

export function getPickerScope(): PickerScope {
  return _pickerScope;
}

export function setPickerScope(scope: PickerScope) {
  _pickerScope = scope;
}
