import { create } from "zustand";
import { 
  updateThemeConfig, 
  githubLightDefault,
  githubLightHighContrast,
  githubLightColorblind,
  githubDarkDefault,
  githubDarkHighContrast,
  githubDarkColorblind,
  githubDarkDimmed,
  githubLightLegacy,
  githubDarkLegacy,
  EditorThemeConfig
} from "../editor/themes/themeConfig";



export type GitHubThemeId = 
  | "github_light_default"
  | "github_light_high_contrast"
  | "github_light_colorblind"
  | "github_dark_default"
  | "github_dark_high_contrast"
  | "github_dark_colorblind"
  | "github_dark_dimmed"
  | "github_light_legacy"
  | "github_dark_legacy"
  | "custom";

export interface LivePreviewElementSettings {
  headings: boolean;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  inlineCode: boolean;
  links: boolean;
  images: boolean;
  checkboxes: boolean;
  tables: boolean;
  fencedCode: boolean;
  math: boolean;
  diagrams: boolean;
  blockquotes: boolean;
  blockTags: boolean;
}

export type LivePreviewElementKey = keyof LivePreviewElementSettings;
export type LivePreviewHideSyntaxKey = Exclude<LivePreviewElementKey, "tables" | "fencedCode" | "diagrams">;
export type LivePreviewHideSyntaxSettings = Record<LivePreviewHideSyntaxKey, boolean>;

export interface LivePreviewSettings extends LivePreviewElementSettings {
  hideSyntax: LivePreviewHideSyntaxSettings;
}

export interface VersionControlSettings {
  enabled: boolean;
}

export interface Settings {
  autoSave: boolean;
  autoSync: boolean;
  themeType: GitHubThemeId;
  customColors: {
    textColor: string;
    backgroundColor: string;
    secondaryBgColor: string;
    noteBgColor: string;
    caretColor: string;
    selectionBgColor: string;
    linkColor: string;
  };
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  editorWidth: "narrow" | "medium" | "wide" | "full";
  typewriterMode: boolean;
  spellCheck: boolean;
  showProseLint: boolean;
  iconStyle: "clean" | "minimal" | "bold";
  livePreview: LivePreviewSettings;
  versionControl: VersionControlSettings;
}

interface SettingsStore {
  settings: Settings;
  isSettingsOpen: boolean;
  activeSettingsCategory: string;
  updateSettings: (newSettings: Partial<Settings>) => void;
  openSettings: (category?: string) => void;
  closeSettings: () => void;
}

export const DEFAULT_LIVE_PREVIEW_HIDE_SYNTAX: LivePreviewHideSyntaxSettings = {
  headings: false,
  bold: false,
  italic: false,
  strikethrough: false,
  inlineCode: false,
  links: true,
  images: true,
  checkboxes: true,
  math: true,
  blockquotes: false,
  blockTags: true,
};

export const DEFAULT_LIVE_PREVIEW: LivePreviewSettings = {
  headings: true,
  bold: true,
  italic: true,
  strikethrough: true,
  inlineCode: true,
  links: true,
  images: true,
  checkboxes: true,
  tables: true,
  fencedCode: true,
  math: true,
  diagrams: true,
  blockquotes: true,
  blockTags: true,
  hideSyntax: { ...DEFAULT_LIVE_PREVIEW_HIDE_SYNTAX },
};

export const DEFAULT_VERSION_CONTROL: VersionControlSettings = {
  enabled: false,
};

export const DEFAULT_SETTINGS: Settings = {
  autoSave: true,
  autoSync: true,
  themeType: "github_light_default",
  customColors: {
    textColor: "#24292f",
    backgroundColor: "#ffffff",
    secondaryBgColor: "#f6f8fa",
    noteBgColor: "#fff8c5",
    caretColor: "#0969da",
    selectionBgColor: "rgba(84,174,255,0.4)",
    linkColor: "#0969da",
  },
  fontFamily: '"Inter", sans-serif',
  fontSize: "16px",
  lineHeight: "1.6",
  editorWidth: "medium",
  typewriterMode: false,
  spellCheck: true,
  showProseLint: true,
  iconStyle: "clean",
  livePreview: { ...DEFAULT_LIVE_PREVIEW },
  versionControl: { ...DEFAULT_VERSION_CONTROL },
};

export function applyThemeFromSettings(settings: Settings) {
  let themeObj: Partial<EditorThemeConfig> = {};
  switch (settings.themeType) {
    case "github_light_default":
      themeObj = { ...githubLightDefault };
      break;
    case "github_light_high_contrast":
      themeObj = { ...githubLightHighContrast };
      break;
    case "github_light_colorblind":
      themeObj = { ...githubLightColorblind };
      break;
    case "github_dark_default":
      themeObj = { ...githubDarkDefault };
      break;
    case "github_dark_high_contrast":
      themeObj = { ...githubDarkHighContrast };
      break;
    case "github_dark_colorblind":
      themeObj = { ...githubDarkColorblind };
      break;
    case "github_dark_dimmed":
      themeObj = { ...githubDarkDimmed };
      break;
    case "github_light_legacy":
      themeObj = { ...githubLightLegacy };
      break;
    case "github_dark_legacy":
      themeObj = { ...githubDarkLegacy };
      break;
    case "custom":
      themeObj = {
        ...githubLightDefault,
        textColor: settings.customColors.textColor,
        backgroundColor: settings.customColors.backgroundColor,
        secondaryBgColor: settings.customColors.secondaryBgColor,
        noteBgColor: settings.customColors.noteBgColor,
        caretColor: settings.customColors.caretColor,
        selectionBgColor: settings.customColors.selectionBgColor,
        linkColor: settings.customColors.linkColor,
      };
      break;
    default:
      themeObj = { ...githubLightDefault };
  }
  
  // Apply font + spacing settings
  themeObj.fontFamily = settings.fontFamily;
  themeObj.headingFontFamily = settings.fontFamily;
  themeObj.fontSize = settings.fontSize;
  themeObj.lineHeight = settings.lineHeight ?? "1.6";
  
  updateThemeConfig(themeObj);
}

const loadSettings = (): Settings => {
  try {
    const saved = localStorage.getItem("marktype_settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      // Deep merge nested livePreview object
      if (parsed.livePreview) {
        merged.livePreview = { ...DEFAULT_LIVE_PREVIEW, ...parsed.livePreview };
        merged.livePreview.hideSyntax = {
          ...DEFAULT_LIVE_PREVIEW_HIDE_SYNTAX,
          ...(parsed.livePreview.hideSyntax ?? {}),
        };
      }
      if (parsed.versionControl) {
        merged.versionControl = { ...DEFAULT_VERSION_CONTROL, ...parsed.versionControl };
      }
      // Apply theme on load
      applyThemeFromSettings(merged);
      return merged;
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  // Apply default theme
  applyThemeFromSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: loadSettings(),
  isSettingsOpen: false,
  activeSettingsCategory: "general",
  openSettings: (category) => set({ isSettingsOpen: true, activeSettingsCategory: category || "general" }),
  closeSettings: () => set({ isSettingsOpen: false }),
  updateSettings: (newSettings) => {
    set((state) => {
      const updated = { ...state.settings, ...newSettings };
      try {
        localStorage.setItem("marktype_settings", JSON.stringify(updated));
      } catch (e) {}
      applyThemeFromSettings(updated);
      return { settings: updated };
    });
  },

}));

// Helper functions for non-React contexts
export const getSettings = () => useSettingsStore.getState().settings;
export const updateSettings = (newSettings: Partial<Settings>) =>
  useSettingsStore.getState().updateSettings(newSettings);
