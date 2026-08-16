import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../filesystem/tauriCommands';
import type { ProjectConfigPayload } from '../ipc/generated';
import type {
  ConfigValues,
  ProjectConfig,
  PublishResult,
  PublishType,
  ThemeOption,
} from './publishTypes';

export const STEPS = ['type', 'theme', 'settings', 'publish'] as const;
export type Step = (typeof STEPS)[number];

interface UsePublishOptions {
  initialType: PublishType;
}

/**
 * State for the publish wizard: the theme list for the chosen type, the
 * workspace config as an editable tree, and the actions that write.
 *
 * Themes are refetched on every type change rather than cached — listing is
 * two `read_dir` calls, and a stale list would hide a theme just added.
 */
export function usePublish({ initialType }: UsePublishOptions) {
  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<PublishType>(initialType);

  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [themesLoading, setThemesLoading] = useState(true);

  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [values, setValues] = useState<ConfigValues | null>(null);
  const [savedValues, setSavedValues] = useState<ConfigValues | null>(null);
  const [configPath, setConfigPath] = useState('');

  const [busy, setBusy] = useState<null | 'publishing' | 'zipping' | 'saving'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  // The theme recorded in config.yml only preselects the first list that
  // arrives, so a later refetch cannot yank the user's current choice.
  const restoredRef = useRef(false);

  const applyPayload = useCallback((payload: ProjectConfigPayload) => {
    const next = (payload.values ?? {}) as ConfigValues;
    setConfig(payload.config as ProjectConfig);
    setValues(next);
    setSavedValues(next);
    setConfigPath(payload.path);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const payload = await invoke('read_project_config', {});
        if (active && payload) applyPayload(payload);
      } catch (e) {
        if (active) setError(messageOf(e, 'Could not read config.yml.'));
      }
    })();
    return () => {
      active = false;
    };
  }, [applyPayload]);

  const loadThemes = useCallback(async (forType: PublishType, preferred?: string | null) => {
    setThemesLoading(true);
    try {
      const list = ((await invoke('list_theme_options', { projectType: forType })) ??
        []) as ThemeOption[];
      setThemes(list);
      setSelectedTheme((current) => {
        const wanted = preferred ?? current;
        if (wanted && list.some((t) => t.id === wanted)) return wanted;
        return list[0]?.id ?? null;
      });
      setError(null);
    } catch (e) {
      setThemes([]);
      setSelectedTheme(null);
      setError(messageOf(e, 'Could not load themes.'));
    } finally {
      setThemesLoading(false);
    }
  }, []);

  useEffect(() => {
    const remembered = restoredRef.current ? null : config?.theme ?? null;
    restoredRef.current = true;
    void loadThemes(type, remembered);
  }, [type, loadThemes, config?.theme]);

  const activeTheme = themes.find((t) => t.id === selectedTheme) ?? null;
  const settingsDirty = JSON.stringify(values) !== JSON.stringify(savedValues);

  /** Writes the edited tree back, keeping keys the exporter does not model. */
  const saveSettings = useCallback(async (): Promise<boolean> => {
    if (!values) return true;
    setBusy('saving');
    try {
      const payload = await invoke('save_project_settings', { values });
      if (payload) applyPayload(payload);
      setError(null);
      return true;
    } catch (e) {
      setError(messageOf(e, 'Could not save these settings.'));
      return false;
    } finally {
      setBusy(null);
    }
  }, [values, applyPayload]);

  const publish = useCallback(
    async (preview: boolean) => {
      if (!selectedTheme) return;
      setBusy('publishing');
      setError(null);
      setNotice(null);
      try {
        const res = (await invoke('export_project_zola', {
          projectType: type,
          themeName: selectedTheme,
          preview,
        })) as PublishResult;

        setResult(res);
        if (!res.success && res.error) setError(res.error);
      } catch (e) {
        setError(messageOf(e, 'Publishing failed.'));
      } finally {
        setBusy(null);
      }
    },
    [selectedTheme, type],
  );

  const saveArchive = useCallback(async () => {
    setBusy('zipping');
    setError(null);
    try {
      const saved = await invoke('save_site_archive', {
        suggestedName: (values?.title as string | undefined) ?? type,
      });
      // A cancelled save dialog returns null, which is not a failure.
      if (saved) setNotice(`Saved to ${saved}`);
    } catch (e) {
      setError(messageOf(e, 'Could not save the archive.'));
    } finally {
      setBusy(null);
    }
  }, [values, type]);

  return {
    step,
    setStep,
    type,
    setType,
    themes,
    themesLoading,
    selectedTheme,
    setSelectedTheme,
    activeTheme,
    config,
    values,
    setValues,
    settingsDirty,
    configPath,
    busy,
    error,
    setError,
    notice,
    setNotice,
    result,
    setResult,
    saveSettings,
    publish,
    saveArchive,
  };
}

function messageOf(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
