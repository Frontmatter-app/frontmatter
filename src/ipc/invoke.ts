import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { IpcArgs, IpcCommand, IpcResult } from './generated';

export type { IpcCommand, IpcArgs, IpcResult };
export { IPC_COMMANDS } from './generated';

/**
 * Commands taking no arguments may be called with none; the rest must supply
 * theirs.
 */
type ArgsParam<C extends IpcCommand> = IpcArgs<C> extends Record<string, never>
  ? [args?: IpcArgs<C>]
  : [args: IpcArgs<C>];

/**
 * Calls a Rust command over the Tauri bridge.
 *
 * The command name and its arguments are checked against the generated
 * contract, so renaming or removing a command on the Rust side becomes a
 * TypeScript error instead of a runtime rejection.
 *
 * Two forms exist while the codebase migrates:
 *
 *   invoke('git_add', { path, files })    // name + args + result all checked
 *   invoke<GitStatus>('git_status', ...)  // legacy: name checked, result asserted
 *
 * The second overload matches when an explicit result type is supplied. Prefer
 * the first; reach for a cast only when the generated result is `unknown`,
 * which means the command returns a custom Rust struct.
 */
export function invoke<C extends IpcCommand>(
  cmd: C,
  ...args: ArgsParam<C>
): Promise<IpcResult<C>>;
export function invoke<R>(cmd: IpcCommand, args?: Record<string, unknown>): Promise<R>;
export function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return tauriInvoke(cmd, args);
}
