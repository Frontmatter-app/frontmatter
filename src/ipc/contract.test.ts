import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildContract, OUTPUT } from '../../scripts/generate-ipc.mjs';
import { IPC_COMMANDS } from './generated';

/**
 * Keeps the TypeScript view of the IPC boundary honest.
 *
 * The contract is generated from the `#[tauri::command]` definitions, so any
 * command that is renamed, removed, or has its arguments changed on the Rust
 * side fails here — inside the `predev` / `prebuild` gate — instead of
 * rejecting at runtime in front of a user.
 */
describe('IPC contract', () => {
  it('matches the Rust command definitions', () => {
    const generated = buildContract();
    const checkedIn = readFileSync(OUTPUT, 'utf8');

    expect(
      checkedIn,
      'src/ipc/generated.ts is stale — run `npm run ipc:gen`',
    ).toBe(generated);
  });

  it('registers a non-trivial number of commands', () => {
    // Guards against the parser silently matching nothing.
    expect(IPC_COMMANDS.length).toBeGreaterThan(90);
  });

  it('exposes every command name exactly once', () => {
    expect(new Set(IPC_COMMANDS).size).toBe(IPC_COMMANDS.length);
  });

  it('uses snake_case command names', () => {
    for (const name of IPC_COMMANDS) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('camelCases every argument, as the Tauri bridge expects', () => {
    const contract = buildContract();
    const argsBlock = /export interface IpcArgsMap \{([\s\S]*?)\n\}/.exec(contract)?.[1] ?? '';
    const argNames = [...argsBlock.matchAll(/[{;]\s*([a-zA-Z0-9_]+)\??:/g)].map((m) => m[1]);

    expect(argNames.length).toBeGreaterThan(0);
    const snakeCased = argNames.filter((n) => n.includes('_'));
    expect(snakeCased, 'arguments must be camelCase to reach Rust').toEqual([]);
  });
});
