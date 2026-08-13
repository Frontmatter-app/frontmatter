import React, { useCallback, useEffect, useId, useRef } from 'react';
import './system.css';

/**
 * Design-system primitives.
 *
 * Every modal and menu in the app is built from these, so behaviour that is
 * easy to forget — focus trapping, Escape to close, `aria-checked` on a custom
 * toggle — is implemented once here rather than per surface.
 */

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

export interface DsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
}

export function DsButton({
  variant = 'default',
  size = 'md',
  iconOnly = false,
  className = '',
  type = 'button',
  ...rest
}: DsButtonProps) {
  const classes = [
    'ds-button',
    variant !== 'default' && `ds-button--${variant}`,
    size === 'sm' && 'ds-button--sm',
    iconOnly && 'ds-button--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...rest} />;
}

export interface DsFieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => React.ReactNode;
}

/** Label, control, and message wired together for screen readers. */
export function DsField({ label, hint, error, children }: DsFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className="ds-field">
      <label className="ds-label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': message ? messageId : undefined,
      })}
      {message && (
        <span id={messageId} className={error ? 'ds-error' : 'ds-hint'}>
          {message}
        </span>
      )}
    </div>
  );
}

export const DsInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function DsInput({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`ds-input ${className}`.trim()} {...rest} />;
  },
);

export const DsTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function DsTextarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`ds-textarea ${className}`.trim()} {...rest} />;
});

export interface DsToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

/**
 * A switch, not a checkbox: `role="switch"` with `aria-checked`, so assistive
 * technology announces on/off rather than checked/unchecked.
 */
export function DsToggle({ checked, onChange, disabled, label }: DsToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ds-toggle"
      onClick={() => onChange(!checked)}
    />
  );
}

export function DsSurface({
  variant = 'raised',
  className = '',
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'raised' | 'sunken' | 'flat' }) {
  const modifier = variant === 'raised' ? '' : `ds-surface--${variant}`;
  return <div className={`ds-surface ${modifier} ${className}`.trim()} {...rest} />;
}

export interface DsModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Set false for a modal the user must answer. Defaults to true. */
  dismissable?: boolean;
}

/**
 * A modal dialog.
 *
 * Closes on Escape and on backdrop click, restores focus to whatever was
 * focused before it opened, and keeps Tab inside the panel while it is open.
 */
export function DsModal({
  open,
  onClose,
  title,
  subtitle,
  wide,
  footer,
  children,
  dismissable = true,
}: DsModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const requestClose = useCallback(() => {
    if (dismissable) onClose();
  }, [dismissable, onClose]);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    // Focus the panel so Escape and Tab are handled from the start.
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, requestClose]);

  if (!open) return null;

  return (
    <div
      className="ds-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`ds-modal ${wide ? 'ds-modal--wide' : ''}`.trim()}
      >
        <header className="ds-modal__header">
          <div>
            <h2 id={titleId} className="ds-modal__title">
              {title}
            </h2>
            {subtitle && <p className="ds-modal__subtitle">{subtitle}</p>}
          </div>
          {dismissable && (
            <DsButton variant="ghost" iconOnly aria-label="Close" onClick={onClose}>
              ✕
            </DsButton>
          )}
        </header>

        <div className="ds-modal__body">{children}</div>

        {footer && <footer className="ds-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function DsMenu({ className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="menu" className={`ds-menu ${className}`.trim()} {...rest} />;
}

export interface DsMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shortcut?: string;
  danger?: boolean;
}

export function DsMenuItem({
  shortcut,
  danger,
  children,
  className = '',
  ...rest
}: DsMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`ds-menu__item ${danger ? 'ds-menu__item--danger' : ''} ${className}`.trim()}
      {...rest}
    >
      {children}
      {shortcut && <span className="ds-menu__shortcut">{shortcut}</span>}
    </button>
  );
}

export function DsMenuSeparator() {
  return <hr className="ds-menu__separator" />;
}

export function DsMenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="ds-menu__label">{children}</div>;
}
