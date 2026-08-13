import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeExportModal } from './ThemeExportModal';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../filesystem/tauriCommands', () => ({ invoke, isWebPreview: false }));

const THEMES = [
  { id: 'default', name: 'Docs', description: 'Sidebar and TOC.', preview_type: 'html' },
  { id: 'base', name: 'Base', description: '', preview_type: 'html' },
];

describe('ThemeExportModal', () => {
  // Each test starts from a known implementation. Clearing the mock instead of
  // replacing it leaves vitest tracking a rejection the component has already
  // handled, which fails the test despite the UI being correct.
  beforeEach(() => {
    invoke.mockImplementation(() => Promise.resolve(THEMES));
  });

  const open = (onExport = vi.fn().mockResolvedValue(undefined)) => {
    render(<ThemeExportModal type="docs" onClose={vi.fn()} onExport={onExport} />);
    return onExport;
  };

  it('asks the backend for themes of the chosen project type', async () => {
    invoke.mockResolvedValue(THEMES);
    open();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('list_theme_options', { projectType: 'docs' }),
    );
  });

  it('lists the themes and preselects the first', async () => {
    invoke.mockResolvedValue(THEMES);
    open();

    const first = await screen.findByRole('radio', { name: /Docs/ });
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Base/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('publishes with the selected theme', async () => {
    invoke.mockResolvedValue(THEMES);
    const onExport = open();

    fireEvent.click(await screen.findByRole('radio', { name: /Base/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith('base'));
  });

  it('explains when no theme exists for the target', async () => {
    invoke.mockResolvedValue([]);
    open();
    expect(await screen.findByText(/No themes found/)).toBeInTheDocument();
  });

  it('cannot publish when there is nothing to publish with', async () => {
    invoke.mockResolvedValue([]);
    open();
    await screen.findByText(/No themes found/);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('surfaces a failure to load themes', async () => {
    // Lazy rejection: mockRejectedValue creates the promise eagerly, which
    // registers as unhandled before the effect attaches its catch.
    invoke.mockImplementation(() => Promise.reject(new Error('No workspace open')));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('No workspace open');
  });

  it('surfaces a failed export instead of closing silently', async () => {
    invoke.mockResolvedValue(THEMES);
    open(vi.fn().mockImplementation(() => Promise.reject(new Error('zola build failed'))));

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('zola build failed');
  });

  it('cannot be dismissed mid-publish', async () => {
    invoke.mockResolvedValue(THEMES);
    let release: () => void = () => {};
    open(vi.fn().mockImplementation(() => new Promise<void>((r) => { release = r; })));

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull(),
    );
    release();
  });
});
