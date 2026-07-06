import { keymap } from '@codemirror/view';
import { boldCommand, italicCommand, codeCommand, linkCommand } from './commands';

export const formattingKeymap = keymap.of([
  { key: 'Mod-b', run: (view) => { boldCommand.apply(view); return true; } },
  { key: 'Mod-i', run: (view) => { italicCommand.apply(view); return true; } },
  { key: 'Mod-e', run: (view) => { codeCommand.apply(view); return true; } },
  { key: 'Mod-k', run: (view) => { linkCommand.apply(view); return true; } },
]);
