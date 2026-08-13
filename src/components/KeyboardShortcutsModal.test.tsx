import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutsModal, filterShortcutGroups } from './KeyboardShortcutsModal';
import { getShortcutGroups } from '../keyboard/shortcuts';

describe('filterShortcutGroups', () => {
  const groups = getShortcutGroups();

  it('returns everything for an empty query', () => {
    expect(filterShortcutGroups(groups, '')).toEqual(groups);
    expect(filterShortcutGroups(groups, '   ')).toEqual(groups);
  });

  it('matches on the description', () => {
    const result = filterShortcutGroups(groups, 'focus mode');
    expect(result.flatMap((g) => g.shortcuts).map((s) => s.description)).toContain(
      'Toggle focus mode',
    );
  });

  it('matches on the key combination', () => {
    const result = filterShortcutGroups(groups, 'B');
    expect(result.flatMap((g) => g.shortcuts).length).toBeGreaterThan(0);
  });

  it('matches on the category name', () => {
    const result = filterShortcutGroups(groups, 'Formatting');
    expect(result.every((g) => g.title === 'Formatting')).toBe(true);
  });

  it('drops groups left with nothing', () => {
    expect(filterShortcutGroups(groups, 'zzzznotashortcut')).toEqual([]);
  });

  it('is case insensitive', () => {
    expect(filterShortcutGroups(groups, 'BOLD')).toEqual(filterShortcutGroups(groups, 'bold'));
  });
});

describe('KeyboardShortcutsModal', () => {
  it('renders nothing while closed', () => {
    render(<KeyboardShortcutsModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists the shortcut groups', () => {
    render(<KeyboardShortcutsModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Keyboard Shortcuts');
    expect(screen.getByText('Formatting')).toBeInTheDocument();
  });

  it('narrows the list as you search', () => {
    render(<KeyboardShortcutsModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Search shortcuts'), {
      target: { value: 'whiteboard' },
    });

    expect(screen.getByText('Open Whiteboard')).toBeInTheDocument();
    expect(screen.queryByText('Bold')).toBeNull();
  });

  it('says so when a search matches nothing', () => {
    render(<KeyboardShortcutsModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Search shortcuts'), {
      target: { value: 'zzzznotashortcut' },
    });

    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
