export function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function getCollabColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  const baseColor = style.getPropertyValue('--editor-caret-color').trim() || '#0969da';
  const [, s, l] = hexToHsl(baseColor);
  const sat = Math.min(s * 1.3, 0.85);
  const light = l > 0.5 ? 0.55 : 0.45;
  return Array.from({ length: 10 }, (_, i) => hslToHex(i / 10, sat, light));
}

export interface SemanticColors {
  success: string;
  successBg: string;
  error: string;
  errorBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;
  annotation: string;
  annotationBg: string;
  accent: string;
  accentBg: string;
  border: string;
  muted: string;
}

/**
 * Derive semantic colors from an existing theme config using HSL rotation.
 * This keeps all semantic colors visually harmonious with the current theme
 * without requiring hardcoded values in each theme variant.
 */
export function getSemanticColors(caretColor: string, bgColor: string, textColor: string): SemanticColors {
  const [, cs, cl] = hexToHsl(caretColor);
  const [, , bl] = hexToHsl(bgColor);
  const [, , tl] = hexToHsl(textColor);
  const isDark = bl < 0.5;

  const s = Math.min(cs * 1.2, 0.7);
  const l = isDark ? 0.55 : 0.45;

  function bg(hue: number): string {
    return hslToHex(hue / 360, s * 0.35, isDark ? 0.1 : 0.92);
  }
  function fg(hue: number): string {
    return hslToHex(hue / 360, s, l);
  }

  return {
    error: fg(0),
    errorBg: bg(0),
    success: fg(120),
    successBg: bg(120),
    warning: fg(45),
    warningBg: bg(45),
    info: fg(210),
    infoBg: bg(210),
    annotation: fg(55),
    annotationBg: bg(55),
    accent: fg(270),
    accentBg: bg(270),
    border: hslToHex(0, 0, isDark ? 0.22 : 0.85),
    muted: hslToHex(0, 0, isDark ? 0.5 : 0.55),
  };
}
