import React, { useCallback, useEffect, useId, useRef } from 'react';
import './neumorphic.css';

/**
 * Neumorphic primitives.
 *
 * Every modal and menu in the app is built from these, so behaviour that is
 * easy to forget — focus trapping, Escape to close, `aria-checked` on a custom
 * toggle — is implemented once here rather than per surface.
 */

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

export interface NmButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
}

export function NmButton({
  variant = 'default',
  size = 'md',
  iconOnly = false,
  className = '',
  type = 'button',
  ...rest
}: NmButtonProps) {
  const classes = [
    'nm-button',
    variant !== 'default' && `nm-button--${variant}`,
    size === 'sm' && 'nm-button--sm',
    iconOnly && 'nm-button--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...rest} />;
}

export interface NmFieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => React.ReactNode;
}

/** Label, control, and message wired together for screen readers. */
export function NmField({ label, hint, error, children }: NmFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className="nm-field">
      <label className="nm-label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': message ? messageId : undefined,
      })}
      {message && (
        <span id={messageId} className={error ? 'nm-error' : 'nm-hint'}>
          {message}
        </span>
      )}
    </div>
  );
}

export const NmInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function NmInput({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`nm-input ${className}`.trim()} {...rest} />;
  },
);

export const NmTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function NmTextarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`nm-textarea ${className}`.trim()} {...rest} />;
});

export interface NmToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

/**
 * A switch, not a checkbox: `role="switch"` with `aria-checked`, so assistive
 * technology announces on/off rather than checked/unchecked.
 */
export function NmToggle({ checked, onChange, disabled, label }: NmToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="nm-toggle"
      onClick={() => onChange(!checked)}
    />
  );
}

export function NmSurface({
  variant = 'raised',
  className = '',
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'raised' | 'sunken' | 'flat' }) {
  const modifier = variant === 'raised' ? '' : `nm-surface--${variant}`;
  return <div className={`nm-surface ${modifier} ${className}`.trim()} {...rest} />;
}

export interface NmModalProps {
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
export function NmModal({
  open,
  onClose,
  title,
  subtitle,
  wide,
  footer,
  children,
  dismissable = true,
}: NmModalProps) {
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
      className="nm-overlay"
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
        className={`nm-modal ${wide ? 'nm-modal--wide' : ''}`.trim()}
      >
        <header className="nm-modal__header">
          <div>
            <h2 id={titleId} className="nm-modal__title">
              {title}
            </h2>
            {subtitle && <p className="nm-modal__subtitle">{subtitle}</p>}
          </div>
          {dismissable && (
            <NmButton variant="ghost" iconOnly aria-label="Close" onClick={onClose}>
              ✕
            </NmButton>
          )}
        </header>

        <div className="nm-modal__body">{children}</div>

        {footer && <footer className="nm-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function NmMenu({ className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="menu" className={`nm-menu ${className}`.trim()} {...rest} />;
}

export interface NmMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shortcut?: string;
  danger?: boolean;
}

export function NmMenuItem({
  shortcut,
  danger,
  children,
  className = '',
  ...rest
}: NmMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`nm-menu__item ${danger ? 'nm-menu__item--danger' : ''} ${className}`.trim()}
      {...rest}
    >
      {children}
      {shortcut && <span className="nm-menu__shortcut">{shortcut}</span>}
    </button>
  );
}

export function NmMenuSeparator() {
  return <hr className="nm-menu__separator" />;
}

export function NmMenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="nm-menu__label">{children}</div>;
}
