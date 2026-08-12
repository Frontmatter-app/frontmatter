/**
 * Historical entry point for the Tauri bridge.
 *
 * The implementation now lives in `src/ipc`, where the command names, argument
 * shapes, and result types are generated from the Rust definitions. This module
 * re-exports it so existing call sites pick up contract checking unchanged.
 */
export { invoke, IPC_COMMANDS } from '../ipc/invoke';
export type { IpcCommand, IpcArgs, IpcResult } from '../ipc/invoke';

export const isWebPreview = false;
