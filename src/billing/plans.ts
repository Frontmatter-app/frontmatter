/**
 * Plans offered in the upgrade dialog.
 *
 * Held as data so the call-to-action logic — which plan you already have,
 * which is a downgrade, which is unavailable — is testable without rendering.
 */

export type PlanId = 'author' | 'team';
export type CurrentPlan = PlanId | 'free' | 'enterprise' | null;

export interface PlanFeature {
  label: string;
  /** False renders as an explicit exclusion rather than being omitted. */
  included: boolean;
}

export interface PlanSpec {
  id: PlanId;
  name: string;
  tagline: string;
  badge: string;
  priceLabel: string;
  period: string;
  features: PlanFeature[];
}

export const PLANS: PlanSpec[] = [
  {
    id: 'author',
    name: 'Author',
    tagline: 'For writers who need their work on every device.',
    badge: 'Individual',
    priceLabel: '$9.99',
    period: 'per month',
    features: [
      { label: 'Live cloud document sync', included: true },
      { label: 'Multi-account switching', included: true },
      { label: 'Access documents from any device', included: true },
      { label: 'Real-time collaboration', included: false },
    ],
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'For teams writing and editing together.',
    badge: '10 seats',
    priceLabel: '$99.99',
    period: 'per month',
    features: [
      { label: 'Real-time collaborative editing', included: true },
      { label: '10 seats: owner plus nine guests', included: true },
      { label: "The owner's seat covers every invited guest", included: true },
      { label: 'Custom roles and permissions', included: true },
      { label: 'Everything in Author', included: true },
    ],
  },
];

/** Rank used to decide whether a plan is an upgrade on the current one. */
const RANK: Record<string, number> = {
  free: 0,
  author: 1,
  team: 2,
  enterprise: 3,
};

export interface PlanAction {
  label: string;
  disabled: boolean;
}

/**
 * The call to action for `plan` given what the user already has.
 *
 * A plan at or below the current one is never offered as a purchase — the
 * previous dialog let a Team subscriber click "Get Author Plan" on a button
 * whose label said "Already Upgraded".
 */
export function planAction(plan: PlanId, current: CurrentPlan): PlanAction {
  const currentRank = RANK[current ?? 'free'] ?? 0;
  const planRank = RANK[plan];

  if (currentRank === planRank) return { label: 'Current plan', disabled: true };
  if (currentRank > planRank) return { label: 'Included in your plan', disabled: true };
  return { label: `Upgrade to ${plan === 'author' ? 'Author' : 'Team'}`, disabled: false };
}
