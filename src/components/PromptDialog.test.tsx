import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptDialog, showNativePrompt } from './PromptDialog';

describe('PromptDialog', () => {
  it('renders nothing until asked', () => {
    render(<PromptDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resolves with the entered value', async () => {
    render(<PromptDialog />);
    const answer = showNativePrompt('New Folder', 'Enter folder name');

    const input = await screen.findByLabelText('Enter folder name');
    fireEvent.change(input, { target: { value: 'chapters' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await expect(answer).resolves.toBe('chapters');
  });

  it('trims surrounding whitespace', async () => {
    render(<PromptDialog />);
    const answer = showNativePrompt('New Folder', 'Enter folder name');

    fireEvent.change(await screen.findByLabelText('Enter folder name'), {
      target: { value: '  notes  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await expect(answer).resolves.toBe('notes');
  });

  it('resolves null when cancelled', async () => {
    render(<PromptDialog />);
    const answer = showNativePrompt('New Folder', 'Enter folder name');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await expect(answer).resolves.toBeNull();
  });

  it('resolves null on Escape', async () => {
    render(<PromptDialog />);
    const answer = showNativePrompt('New Folder', 'Enter folder name');

    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });

    await expect(answer).resolves.toBeNull();
  });

  it('cannot be confirmed while empty', async () => {
    render(<PromptDialog />);
    showNativePrompt('New Folder', 'Enter folder name');

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('starts from the supplied default', async () => {
    render(<PromptDialog />);
    showNativePrompt('Clone Repository', 'Repository URL', 'https://');

    const input = await screen.findByLabelText('Repository URL');
    // The default is applied in an effect once the dialog opens.
    await waitFor(() => expect(input).toHaveValue('https://'));
  });

  it('uses a custom confirm label when given', async () => {
    render(<PromptDialog />);
    showNativePrompt('Clone Repository', 'Repository URL', '', 'Clone');

    expect(await screen.findByRole('button', { name: 'Clone' })).toBeInTheDocument();
  });

  it('closes after answering', async () => {
    render(<PromptDialog />);
    const answer = showNativePrompt('New Folder', 'Enter folder name');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await answer;

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('resolves null instead of throwing when no dialog is mounted', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(showNativePrompt('Orphan', 'No dialog')).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
