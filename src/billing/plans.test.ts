import { describe, expect, it } from 'vitest';
import { PLANS, planAction } from './plans';

describe('PLANS', () => {
  it('describes every plan fully', () => {
    for (const plan of PLANS) {
      expect(plan.name.length).toBeGreaterThan(0);
      expect(plan.tagline.length).toBeGreaterThan(0);
      expect(plan.priceLabel).toMatch(/^\$/);
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });

  it('uses unique ids', () => {
    const ids = PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('planAction', () => {
  it('offers an upgrade to someone on the free plan', () => {
    expect(planAction('author', 'free')).toEqual({
      label: 'Upgrade to Author',
      disabled: false,
    });
    expect(planAction('team', null).disabled).toBe(false);
  });

  it('marks the plan the user already has', () => {
    expect(planAction('author', 'author')).toEqual({ label: 'Current plan', disabled: true });
    expect(planAction('team', 'team')).toEqual({ label: 'Current plan', disabled: true });
  });

  it('never offers a lower plan as a purchase', () => {
    // A Team subscriber could previously click "Get Author Plan".
    expect(planAction('author', 'team')).toEqual({
      label: 'Included in your plan',
      disabled: true,
    });
    expect(planAction('author', 'enterprise').disabled).toBe(true);
    expect(planAction('team', 'enterprise').disabled).toBe(true);
  });

  it('still offers Team to an Author subscriber', () => {
    expect(planAction('team', 'author')).toEqual({
      label: 'Upgrade to Team',
      disabled: false,
    });
  });

  it('treats an unknown plan as free rather than blocking every upgrade', () => {
    expect(planAction('author', 'something-else' as never).disabled).toBe(false);
  });
});
