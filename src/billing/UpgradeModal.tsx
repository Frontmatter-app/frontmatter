import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { usePlan } from './PlanProvider';
import { PLANS, planAction, type PlanId } from './plans';
import { DsButton, DsModal } from '../design/components';
import './upgradeModal.css';

export function UpgradeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<PlanId>('author');
  const [pending, setPending] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { plan, upgradeToAuthor, upgradeToTeam } = usePlan();

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const requested = (event as CustomEvent<{ plan?: PlanId }>).detail?.plan;
      if (requested) setHighlighted(requested);
      setError(null);
      setIsOpen(true);
    };
    window.addEventListener('open-upgrade-modal', handleOpen);
    return () => window.removeEventListener('open-upgrade-modal', handleOpen);
  }, []);

  const upgrade = async (id: PlanId) => {
    setPending(id);
    setError(null);
    try {
      await (id === 'author' ? upgradeToAuthor() : upgradeToTeam());
      setIsOpen(false);
    } catch (e) {
      // Checkout failures used to close the dialog as if they had succeeded.
      setError(e instanceof Error ? e.message : 'Could not start checkout. Please try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <DsModal
      open={isOpen}
      onClose={() => setIsOpen(false)}
      title="Choose your plan"
      subtitle="Immediate access, no trial. Cancel or change your plan any time in Settings."
      wide
      dismissable={pending === null}
    >
      {error && (
        <p className="ds-error" role="alert" style={{ marginBottom: 'var(--ds-space-4)' }}>
          {error}
        </p>
      )}

      <div className="plans">
        {PLANS.map((spec) => {
          const action = planAction(spec.id, plan as never);
          const isPending = pending === spec.id;

          return (
            <section
              key={spec.id}
              className="plans__card"
              data-highlighted={highlighted === spec.id}
              aria-labelledby={`plan-${spec.id}`}
            >
              <header className="plans__header">
                <div>
                  <h3 id={`plan-${spec.id}`} className="plans__name">
                    {spec.name}
                  </h3>
                  <p className="plans__tagline">{spec.tagline}</p>
                </div>
                <span className="plans__badge">{spec.badge}</span>
              </header>

              <p className="plans__price">
                {spec.priceLabel}
                <span className="plans__period"> {spec.period}</span>
              </p>

              <ul className="plans__features">
                {spec.features.map((feature) => (
                  <li
                    key={feature.label}
                    className="plans__feature"
                    data-included={feature.included}
                  >
                    {feature.included ? (
                      <Check className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <X className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>{feature.label}</span>
                  </li>
                ))}
              </ul>

              <DsButton
                variant={highlighted === spec.id ? 'primary' : 'default'}
                disabled={action.disabled || pending !== null}
                onClick={() => upgrade(spec.id)}
              >
                {isPending ? 'Starting checkout…' : action.label}
              </DsButton>
            </section>
          );
        })}
      </div>
    </DsModal>
  );
}
