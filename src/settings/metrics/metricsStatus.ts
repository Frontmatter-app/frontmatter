/**
 * Three states a documentation number can be in.
 *
 * Reserved for state, and never reused as a series colour — a hue that means
 * "critical" in one panel cannot mean "passives" in the next one. Every use
 * ships with an icon and a written label, because the amber fill does not
 * clear 3:1 on a light surface and is not meant to carry the meaning on its
 * own. Fill and ink are separate for the same reason: the fill is a marker,
 * the ink has to be readable.
 */

export type HealthStatus = "good" | "warning" | "critical";

export interface StatusTokens {
  /** Marker fill. Identical in both themes so a state never changes hue. */
  fill: string;
  /** Text and icon colour, darkened for light surfaces where the fill is too pale. */
  ink: { light: string; dark: string };
  /** Always rendered next to the number. Never colour alone. */
  label: string;
}

export const STATUS: Record<HealthStatus, StatusTokens> = {
  good: {
    fill: "#0ca30c",
    ink: { light: "#046104", dark: "#3fd23f" },
    label: "Healthy",
  },
  warning: {
    fill: "#fab219",
    ink: { light: "#8a5a00", dark: "#fac83f" },
    label: "Needs attention",
  },
  critical: {
    fill: "#d03b3b",
    ink: { light: "#a11f1f", dark: "#f07070" },
    label: "Broken",
  },
};

export function statusInk(status: HealthStatus, isDark: boolean): string {
  return isDark ? STATUS[status].ink.dark : STATUS[status].ink.light;
}

/**
 * Grades a defect count.
 *
 * Zero is the only healthy number for something like a broken link, so the
 * thresholds are deliberately unforgiving rather than scaled to how large the
 * workspace is — twenty broken links is not acceptable because there are four
 * hundred pages.
 */
export function gradeDefects(count: number, warnAt = 1, criticalAt = 10): HealthStatus {
  if (count >= criticalAt) return "critical";
  if (count >= warnAt) return "warning";
  return "good";
}

/** Staleness has its own shape: some stale pages are normal, most are not. */
export function gradeStaleness(stale: number, total: number): HealthStatus {
  if (total === 0) return "good";
  const share = stale / total;
  if (share >= 0.3) return "critical";
  if (share > 0) return "warning";
  return "good";
}

export function gradeReadability(grade: number, target: number): HealthStatus {
  if (grade === 0) return "good";
  if (grade > target + 3) return "critical";
  if (grade > target) return "warning";
  return "good";
}
