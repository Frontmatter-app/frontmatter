/**
 * What this build of Frontmatter is allowed to do.
 *
 * The answer, in the open-source build, is everything. There is no feature
 * gate, no seat cap, and nothing to buy: a self-hosted Frontmatter has every
 * capability the hosted one has.
 *
 * That is not a placeholder awaiting real enforcement. It is the licensing
 * model. Frontmatter Cloud sells a key that grants access to *our servers* —
 * enforcement lives server-side, at the point where someone uses hardware we
 * pay for. Nothing is gated inside the binary, so there is nothing here for
 * anyone to patch out, and "free and open source" is true without asterisks.
 *
 * What this replaces: `plan`/`planStatus` read from a Firestore user document,
 * with `isAuthor`/`isTeam` booleans checked ad hoc across roughly fifteen files
 * — several of which granted entitlement merely for being in a team context,
 * and a coverage check that only logged a warning when a team owner's
 * subscription had lapsed.
 */

export interface Entitlements {
  /** Cloud sync and multi-device access. */
  canSync: boolean;
  /** Real-time collaborative editing. */
  canCollaborate: boolean;
  /** Seats available, or null for unlimited. */
  seatLimit: number | null;
  /** Human-readable tier, for display only. Never branch on this. */
  label: string;
}

export const UNLIMITED: Entitlements = {
  canSync: true,
  canCollaborate: true,
  seatLimit: null,
  label: 'Open source',
};

export interface EntitlementSource {
  get(): Entitlements;
}

/** The open-source build. Everything, always. */
export const openSourceEntitlements: EntitlementSource = {
  get: () => UNLIMITED,
};

let source: EntitlementSource = openSourceEntitlements;

export function getEntitlements(): Entitlements {
  return source.get();
}

/**
 * Swaps the source. Frontmatter Cloud installs one backed by a license key;
 * tests install fakes.
 */
export function setEntitlementSource(next: EntitlementSource): void {
  source = next;
}
