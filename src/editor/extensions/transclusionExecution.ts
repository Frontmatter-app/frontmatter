import { invoke } from '../../filesystem/tauriCommands';

const executingBlocks = new Set<string>();

export function isBlockExecuting(uuid: string): boolean {
  return executingBlocks.has(uuid);
}

export function normalizeLanguage(lang: string): string {
  const clean = lang.trim().toLowerCase();
  if (clean.includes('=') || clean.startsWith('chain') || clean.startsWith('id') || clean.startsWith('ref')) {
    return '';
  }
  if (['python', 'py'].includes(clean)) return 'python';
  if (['javascript', 'js', 'node'].includes(clean)) return 'javascript';
  if (['typescript', 'ts'].includes(clean)) return 'typescript';
  if (['bash', 'sh', 'zsh', 'shell'].includes(clean)) return 'bash';
  if (['ruby', 'rb'].includes(clean)) return 'ruby';
  if (['go', 'golang'].includes(clean)) return 'go';
  if (['rust', 'rs'].includes(clean)) return 'rust';
  if (['php'].includes(clean)) return 'php';
  return clean;
}

export function detectLanguage(code: string, currentLang?: string): string {
  if (currentLang && currentLang.trim()) {
    const normalized = normalizeLanguage(currentLang);
    if (normalized) return normalized;
  }
  const text = code.trim();
  if (text.includes('console.log') || text.includes('const ') || text.includes('let ') || text.includes('require(')) {
    return 'javascript';
  }
  if (text.includes('print(') || text.includes('def ') || text.includes('import ') || text.includes('elif ')) {
    return 'python';
  }
  return '';
}

export async function executeBlockAndGetOutput(uuid: string, wsObj: any): Promise<string | null> {
  executingBlocks.add(uuid);
  try {
    const code = wsObj.content || '';
    const lang = detectLanguage(code, wsObj.object_type?.language);

    const runtimes = await invoke<any[]>('list_runtimes');

    const runtime = runtimes.find((r) => {
      const rl = normalizeLanguage(r.language);
      return lang ? rl === lang : false;
    }) ?? runtimes.find((r) => {
      return r.is_default;
    });

    if (!runtime || !runtime.executable_path || !runtime.executable_path.trim()) {
      const displayLang = lang || 'this language';
      await invoke('show_alert_dialog', {
        title: 'Runtime Not Configured',
        description: `No compiler/interpreter path has been set for "${displayLang}". Please go to Settings -> Code Execution to configure it.`,
      });
      return null;
    }

    const executionResult = await invoke<any>('execute_block', {
      request: {
        object_uuid: uuid,
        language: lang,
        code,
        runtime_path: runtime.executable_path,
        session_id: wsObj.object_type?.session || null,
        continue_of: wsObj.object_type?.continue_of || null,
        working_dir: null,
      },
    });

    if (executionResult.success) {
      return executionResult.stdout;
    } else {
      return executionResult.stderr || 'Process exited with non-zero status.';
    }
  } catch (e: any) {
    const errMsg = typeof e === 'string' ? e : e.message || JSON.stringify(e);
    await invoke('show_alert_dialog', {
      title: 'Execution Failed',
      description: `Could not run code block: ${errMsg}`,
    });
    return null;
  } finally {
    executingBlocks.delete(uuid);
  }
}
