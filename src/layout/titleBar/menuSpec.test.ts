import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_MENUS, menuEventNames, menuItems, splitEventAndPayload } from './menuSpec';

/**
 * The in-window menu and the native menu must agree.
 *
 * Rust owns the routing table, so this reads it and checks that every event the
 * UI menu can emit is one Rust actually handles. A renamed event on either side
 * fails here rather than producing a menu item that silently does nothing.
 */
const menuEventsRs = readFileSync(
  join(process.cwd(), 'src-tauri', 'src', 'menu_events.rs'),
  'utf8',
);

/** Event names in the FORWARDED table, plus the ones handled by prefix. */
function rustRoutedEvents(): Set<string> {
  const forwarded = [...menuEventsRs.matchAll(/\("([a-z_]+)",\s*"([a-z-]+)"\)/g)].map(
    (match) => match[2],
  );
  const emitted = [...menuEventsRs.matchAll(/emit_to_focused\(app,\s*"([a-z-]+)"/g)].map(
    (match) => match[1],
  );
  return new Set([...forwarded, ...emitted]);
}

describe('application menu spec', () => {
  it('emits only events the Rust side routes', () => {
    const routed = rustRoutedEvents();
    const unrouted = menuEventNames().filter((event) => !routed.has(event));

    expect(
      unrouted,
      'these menu items would do nothing; add them to menu_events.rs or remove them',
    ).toEqual([]);
  });

  it('parses a project-export event into its command and payload', () => {
    expect(splitEventAndPayload('menu-export-project:blog')).toEqual([
      'menu-export-project',
      'blog',
    ]);
    expect(splitEventAndPayload('menu-save')).toEqual(['menu-save', undefined]);
  });

  it('covers every project type the exporter supports', () => {
    const payloads = menuItems()
      .map((item) => splitEventAndPayload(item.event)[1])
      .filter(Boolean);
    expect(payloads).toEqual(expect.arrayContaining(['docs', 'blog', 'book', 'slide']));
  });

  it('gives every item a label and a unique event', () => {
    const items = menuItems();
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
    }
    const events = items.map((i) => i.event);
    expect(new Set(events).size).toBe(events.length);
  });

  it('gives every menu a stable, unique id', () => {
    const ids = APP_MENUS.map((menu) => menu.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('marks document-only commands so they can be disabled', () => {
    const save = menuItems().find((item) => item.event === 'menu-save');
    expect(save?.needsDocument).toBe(true);
  });

  it('never leaves a menu group empty', () => {
    for (const menu of APP_MENUS) {
      expect(menu.groups.length).toBeGreaterThan(0);
      for (const group of menu.groups) {
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });
});
