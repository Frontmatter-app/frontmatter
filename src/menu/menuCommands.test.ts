import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HANDLED_ELSEWHERE, MENU_COMMANDS, handledMenuEvents } from './menuCommands';

/**
 * Keeps the native menu and the frontend in agreement.
 *
 * Rust owns the routing table; this reads it and checks both directions, so a
 * menu item cannot ship without a handler, and a handler cannot linger after
 * its menu item is removed.
 */
const menuEventsRs = readFileSync(
  join(process.cwd(), 'src-tauri', 'src', 'menu_events.rs'),
  'utf8',
);
const menuRs = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'menu.rs'), 'utf8');

/** Event names in the FORWARDED table. */
function forwardedEvents(): string[] {
  const table = /const FORWARDED[^=]*=\s*&\[([\s\S]*?)\n\];/.exec(menuEventsRs)?.[1] ?? '';
  return [...table.matchAll(/\("([a-z_]+)",\s*"([a-z-]+)"\)/g)].map((m) => m[2]);
}

/** Menu ids declared in menu.rs via MenuItem::with_id. */
function declaredMenuIds(): string[] {
  return [...menuRs.matchAll(/with_id\(\s*app,\s*"([a-z_0-9]+)"/g)].map((m) => m[1]);
}

describe('native menu contract', () => {
  it('finds the routing table', () => {
    expect(forwardedEvents().length).toBeGreaterThan(10);
  });

  it('has a frontend handler for every forwarded event', () => {
    const handled = new Set(handledMenuEvents());
    const missing = forwardedEvents().filter((event) => !handled.has(event));

    expect(
      missing,
      'these menu items would do nothing; add a handler in menuCommands.ts',
    ).toEqual([]);
  });

  it('has no handler left over for an event the menu no longer sends', () => {
    // menu-export-project is routed by prefix rather than the table.
    const routed = new Set([...forwardedEvents(), 'menu-export-project']);
    const orphaned = handledMenuEvents().filter((event) => !routed.has(event));

    expect(orphaned, 'these handlers are unreachable from the menu').toEqual([]);
  });

  it('routes every menu id declared in menu.rs', () => {
    const routedIds = new Set([
      ...[...menuEventsRs.matchAll(/\("([a-z_]+)",\s*"[a-z-]+"\)/g)].map((m) => m[1]),
      // Handled by name or prefix in the match arm.
      ...[...menuEventsRs.matchAll(/^\s*"([a-z_]+)" =>/gm)].map((m) => m[1]),
      'open_recent_none',
    ]);

    const unrouted = declaredMenuIds().filter(
      (id) => !routedIds.has(id) && !id.startsWith('open_recent_') && !id.startsWith('export_project_'),
    );

    expect(unrouted, 'these menu ids have no branch in menu_events.rs').toEqual([]);
  });

  it('does not claim to handle the same event twice', () => {
    const both = Object.keys(MENU_COMMANDS).filter((event) => event in HANDLED_ELSEWHERE);
    expect(both, 'an event is both in MENU_COMMANDS and HANDLED_ELSEWHERE').toEqual([]);
  });

  it('names a real owner for every delegated event', () => {
    for (const [event, owner] of Object.entries(HANDLED_ELSEWHERE)) {
      expect(owner, `${event} has no owner`).toMatch(/\w+\/\w+/);
    }
  });
});
