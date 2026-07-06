import { EditorView } from '@codemirror/view';

export interface FormatCommand {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  apply: (view: EditorView) => void;
}

export type FormatCommandGroup = FormatCommand[];
