import { EditorView } from '@codemirror/view';
import { getSemanticColors } from '../../lib/colors';

export interface EditorThemeConfig {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  textColor: string;
  backgroundColor: string;
  caretColor: string;
  selectionBgColor: string;
  secondaryBgColor: string;
  noteBgColor: string;
  
  // Diff preview specific styles
  deletedTextColor: string;
  deletedStrikeColor: string;
  deletedBgColor: string;
  addedTextColor: string;
  addedBgColor: string;

  // Markdown typography and semantic elements
  headingFontFamily: string;
  headingColor: string;
  strongColor: string;
  emphasisColor: string;
  inlineCodeBg: string;
  inlineCodeColor: string;
  fencedCodeBg: string;
  fencedCodeBorder: string;
  blockquoteBorderColor: string;
  blockquoteColor: string;
  linkColor: string;
}

export const githubLightDefault: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#24292f',
  backgroundColor: '#ffffff',
  secondaryBgColor: '#f6f8fa',
  noteBgColor: '#fff8c5',
  caretColor: '#0969da',
  selectionBgColor: 'rgba(84,174,255,0.4)',
  deletedTextColor: '#57606a',
  deletedStrikeColor: '#cf222e',
  deletedBgColor: '#ffebe9',
  addedTextColor: '#1a7f37',
  addedBgColor: '#dafbe1',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#24292f',
  strongColor: '#24292f',
  emphasisColor: '#57606a',
  inlineCodeBg: 'rgba(175,184,193,0.2)',
  inlineCodeColor: '#24292f',
  fencedCodeBg: '#f6f8fa',
  fencedCodeBorder: '#d0d7de',
  blockquoteBorderColor: '#d0d7de',
  blockquoteColor: '#57606a',
  linkColor: '#0969da',
};

export const githubLightHighContrast: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#0e1116',
  backgroundColor: '#ffffff',
  secondaryBgColor: '#e7ecf0',
  noteBgColor: '#fcf7be',
  caretColor: '#0349b4',
  selectionBgColor: 'rgba(54,140,249,0.4)',
  deletedTextColor: '#0e1116',
  deletedStrikeColor: '#a0111f',
  deletedBgColor: '#fff0ee',
  addedTextColor: '#0e1116',
  addedBgColor: '#bcf5cc',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#0e1116',
  strongColor: '#0e1116',
  emphasisColor: '#0e1116',
  inlineCodeBg: 'rgba(172,182,192,0.2)',
  inlineCodeColor: '#0e1116',
  fencedCodeBg: '#e7ecf0',
  fencedCodeBorder: '#20252c',
  blockquoteBorderColor: '#20252c',
  blockquoteColor: '#0e1116',
  linkColor: '#0349b4',
};

export const githubLightColorblind: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#24292f',
  backgroundColor: '#ffffff',
  secondaryBgColor: '#f6f8fa',
  noteBgColor: '#fff8c5',
  caretColor: '#0969da',
  selectionBgColor: 'rgba(84,174,255,0.4)',
  deletedTextColor: '#57606a',
  deletedStrikeColor: '#b15e00',
  deletedBgColor: '#fff1e5',
  addedTextColor: '#1a7f37',
  addedBgColor: '#dafbe1',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#24292f',
  strongColor: '#24292f',
  emphasisColor: '#57606a',
  inlineCodeBg: 'rgba(175,184,193,0.2)',
  inlineCodeColor: '#24292f',
  fencedCodeBg: '#f6f8fa',
  fencedCodeBorder: '#d0d7de',
  blockquoteBorderColor: '#d0d7de',
  blockquoteColor: '#57606a',
  linkColor: '#0969da',
};

export const githubDarkDefault: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#c9d1d9',
  backgroundColor: '#0d1117',
  secondaryBgColor: '#161b22',
  noteBgColor: 'rgba(187,128,9,0.15)',
  caretColor: '#1f6feb',
  selectionBgColor: 'rgba(56,139,253,0.4)',
  deletedTextColor: '#8b949e',
  deletedStrikeColor: '#da3633',
  deletedBgColor: 'rgba(248,81,73,0.15)',
  addedTextColor: '#3fb950',
  addedBgColor: 'rgba(63,185,80,0.15)',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#c9d1d9',
  strongColor: '#c9d1d9',
  emphasisColor: '#8b949e',
  inlineCodeBg: 'rgba(110,118,129,0.4)',
  inlineCodeColor: '#c9d1d9',
  fencedCodeBg: '#161b22',
  fencedCodeBorder: '#30363d',
  blockquoteBorderColor: '#30363d',
  blockquoteColor: '#8b949e',
  linkColor: '#58a6ff',
};

export const githubDarkHighContrast: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#f0f3f6',
  backgroundColor: '#0a0c10',
  secondaryBgColor: '#272b33',
  noteBgColor: 'rgba(224,155,19,0.15)',
  caretColor: '#409eff',
  selectionBgColor: 'rgba(64,158,255,0.4)',
  deletedTextColor: '#f0f3f6',
  deletedStrikeColor: '#ff6a69',
  deletedBgColor: 'rgba(255,106,105,0.15)',
  addedTextColor: '#3fb950',
  addedBgColor: 'rgba(63,185,80,0.15)',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#f0f3f6',
  strongColor: '#f0f3f6',
  emphasisColor: '#bdc4cc',
  inlineCodeBg: 'rgba(158,167,179,0.4)',
  inlineCodeColor: '#f0f3f6',
  fencedCodeBg: '#272b33',
  fencedCodeBorder: '#7a828e',
  blockquoteBorderColor: '#7a828e',
  blockquoteColor: '#bdc4cc',
  linkColor: '#71b7ff',
};

export const githubDarkColorblind: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#c9d1d9',
  backgroundColor: '#0d1117',
  secondaryBgColor: '#161b22',
  noteBgColor: 'rgba(187,128,9,0.15)',
  caretColor: '#1f6feb',
  selectionBgColor: 'rgba(56,139,253,0.4)',
  deletedTextColor: '#8b949e',
  deletedStrikeColor: '#b15e00',
  deletedBgColor: 'rgba(219,109,40,0.15)',
  addedTextColor: '#3fb950',
  addedBgColor: 'rgba(63,185,80,0.15)',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#c9d1d9',
  strongColor: '#c9d1d9',
  emphasisColor: '#8b949e',
  inlineCodeBg: 'rgba(110,118,129,0.4)',
  inlineCodeColor: '#c9d1d9',
  fencedCodeBg: '#161b22',
  fencedCodeBorder: '#30363d',
  blockquoteBorderColor: '#30363d',
  blockquoteColor: '#8b949e',
  linkColor: '#58a6ff',
};

export const githubDarkDimmed: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#adbac7',
  backgroundColor: '#22272e',
  secondaryBgColor: '#2d333b',
  noteBgColor: 'rgba(174,124,20,0.15)',
  caretColor: '#316dca',
  selectionBgColor: 'rgba(65,132,228,0.4)',
  deletedTextColor: '#768390',
  deletedStrikeColor: '#c93c37',
  deletedBgColor: 'rgba(229,83,75,0.15)',
  addedTextColor: '#3fb950',
  addedBgColor: 'rgba(63,185,80,0.15)',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#adbac7',
  strongColor: '#adbac7',
  emphasisColor: '#768390',
  inlineCodeBg: 'rgba(99,110,123,0.4)',
  inlineCodeColor: '#adbac7',
  fencedCodeBg: '#2d333b',
  fencedCodeBorder: '#444c56',
  blockquoteBorderColor: '#444c56',
  blockquoteColor: '#768390',
  linkColor: '#539bf5',
};

export const githubLightLegacy: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#24292e',
  backgroundColor: '#ffffff',
  secondaryBgColor: '#f6f8fa',
  noteBgColor: '#fff5b1',
  caretColor: '#0366d6',
  selectionBgColor: '#dbedff',
  deletedTextColor: '#586069',
  deletedStrikeColor: '#d73a49',
  deletedBgColor: '#ffeef0',
  addedTextColor: '#176f2c',
  addedBgColor: '#dcffe4',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#24292e',
  strongColor: '#24292e',
  emphasisColor: '#586069',
  inlineCodeBg: '#f1f2f4',
  inlineCodeColor: '#24292e',
  fencedCodeBg: '#f6f8fa',
  fencedCodeBorder: '#e1e4e8',
  blockquoteBorderColor: '#e1e4e8',
  blockquoteColor: '#6a737d',
  linkColor: '#0366d6',
};

export const githubDarkLegacy: EditorThemeConfig = {
  fontFamily: '"Inter", sans-serif',
  fontSize: '16px',
  lineHeight: '1.6',
  textColor: '#e1e4e8',
  backgroundColor: '#24292e',
  secondaryBgColor: '#1f2428',
  noteBgColor: 'rgba(255,234,127,0.15)',
  caretColor: '#2188ff',
  selectionBgColor: 'rgba(33,136,255,0.4)',
  deletedTextColor: '#959da5',
  deletedStrikeColor: '#ea4a5a',
  deletedBgColor: 'rgba(234,74,90,0.15)',
  addedTextColor: '#3fb950',
  addedBgColor: 'rgba(63,185,80,0.15)',
  headingFontFamily: '"Inter", sans-serif',
  headingColor: '#e1e4e8',
  strongColor: '#e1e4e8',
  emphasisColor: '#959da5',
  inlineCodeBg: 'rgba(149,157,165,0.4)',
  inlineCodeColor: '#e1e4e8',
  fencedCodeBg: '#1f2428',
  fencedCodeBorder: '#1b1f23',
  blockquoteBorderColor: '#444d56',
  blockquoteColor: '#959da5',
  linkColor: '#79b8ff',
};

export const defaultThemeConfig = githubLightDefault;

// Singleton storage for current active configuration
let activeThemeConfig = { ...githubLightDefault };

// Try to load initial saved custom theme if active
try {
  const saved = localStorage.getItem('marktype_custom_theme');
  if (saved) {
    activeThemeConfig = { ...activeThemeConfig, ...JSON.parse(saved) };
  }
} catch (e) {}

export function getThemeConfig(): EditorThemeConfig {
  return activeThemeConfig;
}

export function updateThemeConfig(newConfig: Partial<EditorThemeConfig>) {
  activeThemeConfig = { ...activeThemeConfig, ...newConfig };
  try {
    localStorage.setItem('marktype_custom_theme', JSON.stringify(activeThemeConfig));
  } catch (e) {}
  applyThemeVariablesToDOM();
}

/**
 * Generates the CSS variable definitions based on the current theme config.
 */
export function getThemeCSSVariables(config: EditorThemeConfig = activeThemeConfig): string {
  const semantic = getSemanticColors(config.caretColor, config.backgroundColor, config.textColor);
  return `
    --editor-font-family: ${config.fontFamily};
    --editor-font-size: ${config.fontSize};
    --editor-line-height: ${config.lineHeight};
    --editor-text-color: ${config.textColor};
    --editor-bg-color: ${config.backgroundColor};
    --editor-secondary-bg: ${config.secondaryBgColor};
    --editor-note-bg: ${config.noteBgColor};
    --editor-caret-color: ${config.caretColor};
    --editor-selection-bg: ${config.selectionBgColor};
    
    --editor-deleted-text-color: ${config.deletedTextColor};
    --editor-deleted-strike-color: ${config.deletedStrikeColor};
    --editor-deleted-bg-color: ${config.deletedBgColor};
    --editor-added-text-color: ${config.addedTextColor};
    --editor-added-bg-color: ${config.addedBgColor};
    
    --editor-heading-font-family: ${config.headingFontFamily};
    --editor-heading-color: ${config.headingColor};
    --editor-strong-color: ${config.strongColor};
    --editor-emphasis-color: ${config.emphasisColor};
    --editor-inline-code-bg: ${config.inlineCodeBg};
    --editor-inline-code-color: ${config.inlineCodeColor};
    --editor-fenced-code-bg: ${config.fencedCodeBg};
    --editor-fenced-code-border: ${config.fencedCodeBorder};
    --editor-blockquote-border: ${config.blockquoteBorderColor};
    --editor-blockquote-color: ${config.blockquoteColor};
    --editor-link-color: ${config.linkColor};

    --editor-success: ${semantic.success};
    --editor-success-bg: ${semantic.successBg};
    --editor-error: ${semantic.error};
    --editor-error-bg: ${semantic.errorBg};
    --editor-warning: ${semantic.warning};
    --editor-warning-bg: ${semantic.warningBg};
    --editor-info: ${semantic.info};
    --editor-info-bg: ${semantic.infoBg};
    --editor-annotation: ${semantic.annotation};
    --editor-annotation-bg: ${semantic.annotationBg};
    --editor-accent: ${semantic.accent};
    --editor-accent-bg: ${semantic.accentBg};
    --editor-border: ${semantic.border};
    --editor-muted: ${semantic.muted};
  `;
}

/**
 * Dynamically applies the CSS variables to document root or editor container
 */
export function applyThemeVariablesToDOM() {
  if (typeof document === 'undefined') return;
  const styleId = 'marktype-theme-variables';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.innerHTML = `
    :root, body, .marktype-editor-container {
      ${getThemeCSSVariables()}
    }
    /* Apply selected font across the entire app, including sidebars */
    body, #root {
      font-family: var(--editor-font-family);
    }
  `;
}

// Initial application
applyThemeVariablesToDOM();

// CodeMirror base theme (colors, layout — stable, doesn't change per-font).
// Font-specific styles are handled via createFontTheme() + Compartment so they
// can be reconfigured live without rebuilding the entire editor.
export const marktypeTheme = EditorView.theme({
  "&": {
    color: 'var(--editor-text-color)',
    backgroundColor: 'transparent',
  },
  ".cm-content": {
    padding: "24px 0",
    maxWidth: "800px",
    margin: "0 auto",
  },
  "&.cm-focused": {
    outline: "none"
  },
  ".cm-line": {
    caretColor: 'var(--editor-caret-color)',
    padding: "0"
  },
  ".cm-selectionBackground": {
    backgroundColor: 'var(--editor-selection-bg) !important'
  },
  ".cm-cursor": {
    borderLeftColor: 'var(--editor-caret-color)'
  },
  ".cm-deleted-segment": {
    color: 'var(--editor-deleted-text-color)',
    textDecoration: 'line-through var(--editor-deleted-strike-color) 2px',
    backgroundColor: 'var(--editor-deleted-bg-color)',
    padding: '0 2px',
    borderRadius: '2px',
    cursor: 'pointer',
    position: 'relative'
  },
  ".cm-added-segment": {
    backgroundColor: 'var(--editor-added-bg-color)',
    color: 'var(--editor-added-text-color)',
    padding: '0 2px',
    borderRadius: '2px',
    position: 'relative'
  },
  ".cm-diff-delete-line": {
    backgroundColor: 'var(--editor-deleted-bg-color)',
    cursor: 'pointer'
  },
  ".cm-diff-insert-line": {
    backgroundColor: 'var(--editor-added-bg-color)'
  },
  ".cm-gutter-diff-delete .cm-gutterElement > span::before": {
    content: "'-'",
    color: 'var(--editor-deleted-strike-color)',
    fontWeight: 'bold',
    fontSize: '12px',
    fontFamily: 'monospace',
    padding: '0 4px'
  },
  ".cm-gutter-diff-insert .cm-gutterElement > span::before": {
    content: "'+'",
    color: 'var(--editor-added-text-color)',
    fontWeight: 'bold',
    fontSize: '12px',
    fontFamily: 'monospace',
    padding: '0 4px'
  }
});

/**
 * Creates a CodeMirror theme extension with literal font values baked in.
 * Use with a Compartment so it can be reconfigured live when the user changes
 * fonts without destroying and rebuilding the entire editor.
 */
export function createFontTheme(fontFamily: string, fontSize: string, lineHeight: string) {
  return EditorView.theme({
    "&": {
      fontFamily,
      fontSize,
      lineHeight,
    },
    ".cm-content": {
      fontFamily,
      fontSize,
      lineHeight,
    },
    ".cm-line": {
      fontFamily,
      fontSize,
      lineHeight,
    }
  });
}
