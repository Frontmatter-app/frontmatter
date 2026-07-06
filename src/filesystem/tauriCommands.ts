import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export const isWebPreview = false;

export async function invoke<T>(cmd: string, args: any = {}): Promise<T> {
  return tauriInvoke(cmd, args);
}

