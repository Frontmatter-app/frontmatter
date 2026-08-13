import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NmButton, NmField, NmInput, NmModal } from '../design/components';

interface PromptState {
  title: string;
  description: string;
  defaultValue?: string;
  confirmLabel?: string;
  resolve: (value: string | null) => void;
}

let setPromptState: ((state: PromptState | null) => void) | null = null;

/**
 * Asks the user for a single line of text.
 *
 * Resolves to `null` when cancelled — and also when no dialog is mounted, so a
 * caller cannot hang or throw. Previously this dereferenced the setter
 * unconditionally and threw if `PromptDialog` was not on screen.
 */
export function showNativePrompt(
  title: string,
  description: string,
  defaultValue?: string,
  confirmLabel?: string,
): Promise<string | null> {
  if (!setPromptState) {
    console.error('[prompt] no PromptDialog is mounted; resolving as cancelled');
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    setPromptState?.({ title, description, defaultValue, confirmLabel, resolve });
  });
}

export function PromptDialog() {
  const [state, setState] = useState<PromptState | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPromptState = setState;
    return () => {
      setPromptState = null;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    setValue(state.defaultValue ?? '');
    // The modal moves focus to its panel on open; take it once that has run.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const close = useCallback(
    (result: string | null) => {
      state?.resolve(result);
      setState(null);
    },
    [state],
  );

  const submit = useCallback(() => close(value.trim() || null), [close, value]);

  if (!state) return null;

  return (
    <NmModal
      open
      onClose={() => close(null)}
      title={state.title}
      subtitle={state.description}
      footer={
        <>
          <NmButton onClick={() => close(null)}>Cancel</NmButton>
          <NmButton variant="primary" onClick={submit} disabled={!value.trim()}>
            {state.confirmLabel ?? 'Continue'}
          </NmButton>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) submit();
        }}
      >
        <NmField label={state.description}>
          {(props) => (
            <NmInput
              {...props}
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </NmField>
        {/* Lets Enter submit without a visible duplicate button. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </NmModal>
  );
}
