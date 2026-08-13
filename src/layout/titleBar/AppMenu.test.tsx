import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppMenu } from './AppMenu';

const emit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tauri-apps/api/event', () => ({ emit }));

describe('AppMenu', () => {
  beforeEach(() => emit.mockClear());

  const open = (label: string, props = { hasDocument: true, hasWorkspace: true }) => {
    render(<AppMenu {...props} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
  };

  it('exposes the menu bar to assistive technology', () => {
    render(<AppMenu hasDocument hasWorkspace />);
    expect(screen.getByRole('menubar', { name: 'Application' })).toBeInTheDocument();
  });

  it('opens a menu and marks the trigger expanded', () => {
    open('File');
    expect(screen.getByRole('button', { name: 'File' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: /New File/ })).toBeInTheDocument();
  });

  it('dispatches the command event when an item is chosen', () => {
    open('File');
    fireEvent.click(screen.getByRole('menuitem', { name: /^Save\s*⌘S$/ }));
    expect(emit).toHaveBeenCalledWith('menu-save', undefined);
  });

  it('sends the project type as the payload for an export', () => {
    open('Project');
    fireEvent.click(screen.getByRole('menuitem', { name: /Blog/ }));
    expect(emit).toHaveBeenCalledWith('menu-export-project', 'blog');
  });

  it('disables document commands when nothing is open', () => {
    open('File', { hasDocument: false, hasWorkspace: true });
    expect(screen.getByRole('menuitem', { name: /^Save\s*⌘S$/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /New File/ })).toBeEnabled();
  });

  it('disables workspace commands when no folder is open', () => {
    open('Project', { hasDocument: true, hasWorkspace: false });
    expect(screen.getByRole('menuitem', { name: /Blog/ })).toBeDisabled();
  });

  it('closes on Escape without dispatching anything', () => {
    open('File');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it('closes when the pointer goes down outside', () => {
    open('File');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('closes the menu after running a command', () => {
    open('File');
    fireEvent.click(screen.getByRole('menuitem', { name: /New File/ }));
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
