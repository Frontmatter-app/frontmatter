/**
 * The application menu, as data.
 *
 * Both the native menu (src-tauri/src/menu.rs) and the in-window menu emit the
 * same `menu-*` events, so a command has exactly one handler regardless of
 * where it was invoked. `menuSpec.test.ts` checks that every event named here
 * is one the Rust side actually routes, so a menu item cannot quietly do
 * nothing.
 */

export interface MenuItemSpec {
  /** Tauri event emitted when chosen. */
  event: string;
  label: string;
  /** Display form of the accelerator, e.g. "⌘S". */
  shortcut?: string;
  /** Disabled unless a document is open. */
  needsDocument?: boolean;
  /** Disabled unless a workspace is open. */
  needsWorkspace?: boolean;
  danger?: boolean;
}

export interface MenuGroupSpec {
  /** Optional heading shown above the group. */
  label?: string;
  items: MenuItemSpec[];
}

export interface MenuSpec {
  id: string;
  label: string;
  groups: MenuGroupSpec[];
}

const mod = '⌘';

export const APP_MENUS: MenuSpec[] = [
  {
    id: 'file',
    label: 'File',
    groups: [
      {
        items: [
          { event: 'menu-new-file', label: 'New File', shortcut: `${mod}N` },
          { event: 'menu-new-folder', label: 'New Folder', shortcut: `${mod}⇧N`, needsWorkspace: true },
        ],
      },
      {
        items: [
          { event: 'menu-open-file', label: 'Open File…', shortcut: `${mod}O` },
          { event: 'menu-open-folder', label: 'Open Folder…', shortcut: `${mod}⇧O` },
        ],
      },
      {
        items: [
          { event: 'menu-save', label: 'Save', shortcut: `${mod}S`, needsDocument: true },
          { event: 'menu-save-as', label: 'Save As…', shortcut: `${mod}⇧S`, needsDocument: true },
          { event: 'menu-toggle-auto-save', label: 'Toggle Auto Save' },
        ],
      },
      {
        label: 'Export',
        items: [
          { event: 'menu-export-file-markdown', label: 'Copy as Markdown', needsDocument: true },
          { event: 'menu-export-file-html', label: 'Export as HTML…', needsDocument: true },
          { event: 'menu-export-file-pdf', label: 'Export as PDF…', needsDocument: true },
        ],
      },
    ],
  },
  {
    id: 'project',
    label: 'Project',
    groups: [
      {
        label: 'Publish as a site',
        items: [
          { event: 'menu-export-project:docs', label: 'Documentation Site…', needsWorkspace: true },
          { event: 'menu-export-project:blog', label: 'Blog…', needsWorkspace: true },
          { event: 'menu-export-project:book', label: 'Book…', needsWorkspace: true },
          { event: 'menu-export-project:slide', label: 'Slide Deck…', needsWorkspace: true },
        ],
      },
      {
        items: [{ event: 'menu-clone-repository', label: 'Clone Repository…' }],
      },
    ],
  },
  {
    id: 'view',
    label: 'View',
    groups: [
      {
        items: [
          { event: 'menu-settings', label: 'Settings…', shortcut: `${mod},` },
        ],
      },
    ],
  },
];

/**
 * Project export items encode their target after a colon, because Rust routes
 * them all through one `menu-export-project` event with the type as payload.
 */
export function splitEventAndPayload(event: string): [string, string | undefined] {
  const separator = event.indexOf(':');
  if (separator === -1) return [event, undefined];
  return [event.slice(0, separator), event.slice(separator + 1)];
}

/** Every distinct Tauri event the menu can emit. */
export function menuEventNames(menus: MenuSpec[] = APP_MENUS): string[] {
  const names = new Set<string>();
  for (const menu of menus) {
    for (const group of menu.groups) {
      for (const item of group.items) {
        names.add(splitEventAndPayload(item.event)[0]);
      }
    }
  }
  return [...names].sort();
}

/** Flattened items, for tests and for keyboard navigation. */
export function menuItems(menus: MenuSpec[] = APP_MENUS): MenuItemSpec[] {
  return menus.flatMap((menu) => menu.groups.flatMap((group) => group.items));
}
