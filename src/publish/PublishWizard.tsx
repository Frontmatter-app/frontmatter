import React from 'react';
import { Loader2 } from 'lucide-react';
import { DsButton, DsModal } from '../design/components';
import { StepPublish } from './StepPublish';
import { StepSettings } from './StepSettings';
import { StepTheme } from './StepTheme';
import { StepType } from './StepType';
import { STEPS, usePublish, type Step } from './usePublish';
import { PUBLISH_TYPE_INFO, type PublishType } from './publishTypes';
import './publishWizard.css';

interface PublishWizardProps {
  initialType: PublishType;
  /** Receives the type the wizard ended on, so reopening restores it. */
  onClose: (lastType: PublishType) => void;
}

const STEP_META: Record<Step, { label: string; title: string; description: string }> = {
  type: {
    label: 'Type',
    title: 'What are you publishing?',
    description: 'This decides how your documents are arranged and which themes are offered.',
  },
  theme: {
    label: 'Theme',
    title: 'Pick a theme',
    description: 'The theme controls layout and styling. You can change it and publish again.',
  },
  settings: {
    label: 'Settings',
    title: 'Site settings',
    description:
      "These are the values in your workspace's config.yml. Keys are fixed — the site is built from them — but every value is yours to change.",
  },
  publish: {
    label: 'Publish',
    title: 'Ready to publish',
    description: 'Check it over, then build the site.',
  },
};

export function PublishWizard({ initialType, onClose }: PublishWizardProps) {
  const p = usePublish({ initialType });

  const index = STEPS.indexOf(p.step);
  const publishing = p.busy === 'publishing';
  const finished = p.result?.success === true;
  const meta = STEP_META[p.step];

  const close = () => onClose(p.type);

  // Leaving the settings step writes any edits, so a value typed and then
  // advanced past is not quietly lost.
  const goNext = async () => {
    if (p.step === 'settings' && p.settingsDirty) {
      const saved = await p.saveSettings();
      if (!saved) return;
    }
    const next = STEPS[index + 1];
    if (next) p.setStep(next);
  };

  const goBack = () => {
    const previous = STEPS[index - 1];
    if (previous) p.setStep(previous);
  };

  const canAdvance =
    p.step === 'type' ||
    (p.step === 'theme' && Boolean(p.selectedTheme)) ||
    p.step === 'settings';

  return (
    <DsModal
      open
      wide
      onClose={close}
      title={meta.title}
      subtitle={meta.description}
      dismissable={!publishing}
      footer={
        <>
          <ol className="wizard__dots" aria-hidden="true">
            {STEPS.map((s, i) => (
              <li key={s} data-state={i === index ? 'current' : i < index ? 'done' : 'todo'} />
            ))}
          </ol>
          <span className="wizard__spacer" />

          {finished ? (
            <DsButton variant="primary" onClick={close}>
              Done
            </DsButton>
          ) : (
            <>
              <DsButton onClick={index === 0 ? close : goBack} disabled={publishing}>
                {index === 0 ? 'Cancel' : 'Back'}
              </DsButton>
              {p.step === 'publish' ? (
                <DsButton
                  variant="primary"
                  disabled={publishing || !p.selectedTheme}
                  onClick={() => void p.publish(true)}
                >
                  {publishing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…
                    </>
                  ) : (
                    'Publish'
                  )}
                </DsButton>
              ) : (
                <DsButton
                  variant="primary"
                  disabled={!canAdvance || p.busy === 'saving'}
                  onClick={() => void goNext()}
                >
                  {p.busy === 'saving' ? 'Saving…' : 'Continue'}
                </DsButton>
              )}
            </>
          )}
        </>
      }
    >
      <nav className="wizard__steps" aria-label="Progress">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className="wizard__step"
            data-state={i === index ? 'current' : i < index ? 'done' : 'todo'}
            // Only steps already visited are reachable by click; skipping ahead
            // would land on a theme list that has not been chosen from yet.
            disabled={i > index || publishing || finished}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => p.setStep(s)}
          >
            <span className="wizard__step-number">{i + 1}</span>
            {STEP_META[s].label}
          </button>
        ))}
      </nav>

      {p.error && (
        <p className="ds-error publish__message" role="alert">
          {p.error}
        </p>
      )}
      {p.notice && !p.error && <p className="publish__message publish__message--ok">{p.notice}</p>}

      <div className="wizard__panel">
        {p.step === 'type' && (
          <StepType
            selected={p.type}
            onSelect={(type) => {
              p.setType(type);
              p.setStep('theme');
            }}
          />
        )}

        {p.step === 'theme' && (
          <StepTheme
            themes={p.themes}
            loading={p.themesLoading}
            selected={p.selectedTheme}
            onSelect={p.setSelectedTheme}
            type={p.type}
          />
        )}

        {p.step === 'settings' && (
          <StepSettings
            values={p.values}
            theme={p.activeTheme}
            path={p.configPath}
            onChange={p.setValues}
          />
        )}

        {p.step === 'publish' && (
          <StepPublish
            type={p.type}
            theme={p.activeTheme}
            values={p.values}
            result={p.result}
            publishing={publishing}
            zipping={p.busy === 'zipping'}
            onSaveArchive={() => void p.saveArchive()}
            onPublishAgain={() => {
              p.setResult(null);
              p.setNotice(null);
              p.setStep('type');
            }}
          />
        )}
      </div>
    </DsModal>
  );
}

export { PUBLISH_TYPE_INFO };
