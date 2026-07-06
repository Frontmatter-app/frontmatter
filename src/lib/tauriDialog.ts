import { invoke } from '@tauri-apps/api/core';
import { showNativePrompt } from '../components/PromptDialog';

// Check if running inside Tauri
const isTauri = typeof window !== 'undefined' && (
  typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ||
  typeof (window as any).__TAURI__ !== 'undefined'
);

/**
 * Shows a premium native confirmation dialog.
 * Falls back to standard window.confirm in non-Tauri environments.
 */
export async function showConfirmDialog(title: string, description: string): Promise<boolean> {
  if (isTauri) {
    try {
      return await invoke<boolean>('show_confirm_dialog', { title, description });
    } catch (e) {
      console.warn('[Dialog] Failed to use Rust confirm dialog, falling back to window.confirm:', e);
    }
  }
  return window.confirm(`${title}\n\n${description}`);
}

/**
 * Shows a native alert/error dialog.
 * Falls back to standard window.alert in non-Tauri environments.
 */
export async function showAlertDialog(title: string, description: string): Promise<void> {
  if (isTauri) {
    try {
      await invoke<void>('show_alert_dialog', { title, description });
      return;
    } catch (e) {
      console.warn('[Dialog] Failed to use Rust alert dialog, falling back to window.alert:', e);
    }
  }
  window.alert(`${title}\n\n${description}`);
}

/**
 * Shows a prompt dialog for text input.
 * Uses a React modal since window.prompt() doesn't work in Tauri v2 webviews.
 */
export async function showPromptDialog(title: string, description: string, defaultValue?: string): Promise<string | null> {
  return showNativePrompt(title, description, defaultValue);
}
