import type { ObjectSearchResult } from '../../types';

export type PickerScope = 'file' | 'folder' | 'workspace';

export interface SearchItem {
  result: ObjectSearchResult;
  action: 'ref' | 'exec';
}

export interface ReferencePickerState {
  active: boolean;
  loading: boolean;
  query: string;
  from: number;
  to: number;
  allItems: SearchItem[];
  items: SearchItem[];
  selectedIndex: number;
}
