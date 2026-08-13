import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NmButton, NmField, NmInput, NmModal, NmToggle } from './components';

describe('NmToggle', () => {
  it('is a switch, so it announces on/off rather than checked', () => {
    render(<NmToggle checked={false} onChange={() => {}} label="Auto save" />);
    const toggle = screen.getByRole('switch', { name: 'Auto save' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('reports the flipped value', () => {
    const onChange = vi.fn();
    render(<NmToggle checked={false} onChange={onChange} label="Auto save" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not fire while disabled', () => {
    const onChange = vi.fn();
    render(<NmToggle checked onChange={onChange} disabled label="Auto save" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('NmField', () => {
  it('links the label to the control', () => {
    render(
      <NmField label="Workspace name">
        {(props) => <NmInput {...props} defaultValue="Docs" />}
      </NmField>,
    );
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Docs');
  });

  it('marks the control invalid and points at the message', () => {
    render(
      <NmField label="Email" error="That address is not valid">
        {(props) => <NmInput {...props} />}
      </NmField>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('That address is not valid');
  });

  it('describes the control with a hint when there is no error', () => {
    render(
      <NmField label="Token" hint="Found in your account settings">
        {(props) => <NmInput {...props} />}
      </NmField>,
    );
    expect(screen.getByLabelText('Token')).toHaveAccessibleDescription(
      'Found in your account settings',
    );
  });
});

describe('NmModal', () => {
  const open = (props: Partial<React.ComponentProps<typeof NmModal>> = {}) =>
    render(
      <NmModal open onClose={props.onClose ?? (() => {})} title="Export project" {...props}>
        <NmButton>Inside</NmButton>
      </NmModal>,
    );

  it('renders nothing when closed', () => {
    render(
      <NmModal open={false} onClose={() => {}} title="Hidden">
        body
      </NmModal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a labelled modal dialog', () => {
    open();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Export project');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores Escape when it must be answered', () => {
    const onClose = vi.fn();
    open({ onClose, dismissable: false });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('omits the close button when it must be answered', () => {
    open({ dismissable: false });
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('restores focus to the trigger when it closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = open();
    unmount();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
