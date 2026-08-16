import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishWizard } from './PublishWizard';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../filesystem/tauriCommands', () => ({ invoke, isWebPreview: false }));
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const DOCS_THEMES = [
  {
    id: 'default',
    name: 'Docs',
    description: 'Sidebar and TOC.',
    preview_type: 'html',
    screenshot: '/themes/docs/default/screenshot.png',
    source: 'bundled',
    author: 'Frontmatter',
    options: [{ key: 'repo_url', label: 'Source repository', type: 'text', default: '' }],
    path: '/themes/docs/default',
  },
  {
    id: 'plain',
    name: 'Plain',
    description: '',
    preview_type: 'html',
    screenshot: null,
    source: 'bundled',
    author: null,
    options: [],
    path: '/themes/docs/plain',
  },
];

const BLOG_THEMES = [
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Reverse-chronological.',
    preview_type: 'html',
    screenshot: null,
    source: 'bundled',
    author: null,
    options: [],
    path: '/themes/blog/editorial',
  },
];

/** Deliberately includes a key the exporter does not model. */
const VALUES = {
  title: 'My Site',
  description: null,
  base_url: '/',
  exclude: ['drafts/scratch.md'],
  my_own_key: 'keep me',
  custom: { repo_url: 'https://example.com', show_toc: true },
};

const CONFIG_PAYLOAD = {
  values: VALUES,
  config: { title: 'My Site' },
  path: '/ws/.app/config.yml',
};

const PUBLISH_RESULT = {
  success: true,
  output_dir: '/ws/.app/export',
  public_dir: '/ws/.app/export/public',
  preview_url: 'http://127.0.0.1:1111',
  page_count: 14,
  error: null,
};

function defaultBackend(command: string, args: Record<string, unknown>) {
  switch (command) {
    case 'list_theme_options':
      return Promise.resolve(args.projectType === 'blog' ? BLOG_THEMES : DOCS_THEMES);
    case 'read_project_config':
      return Promise.resolve(CONFIG_PAYLOAD);
    case 'save_project_settings':
      return Promise.resolve({ ...CONFIG_PAYLOAD, values: args.values });
    case 'export_project_zola':
      return Promise.resolve(PUBLISH_RESULT);
    default:
      return Promise.resolve(null);
  }
}

describe('PublishWizard', () => {
  // Each test starts from a known implementation. Clearing the mock instead of
  // replacing it leaves vitest tracking a rejection the component has already
  // handled, which fails the test despite the UI being correct.
  beforeEach(() => {
    invoke.mockImplementation(defaultBackend);
  });

  const open = (onClose = vi.fn()) => {
    render(<PublishWizard initialType="docs" onClose={onClose} />);
    return onClose;
  };

  const continueButton = () => screen.getByRole('button', { name: 'Continue' });

  /** Walks from the type step to `target`, choosing defaults on the way. */
  const advanceTo = async (target: 'theme' | 'settings' | 'publish') => {
    fireEvent.click(screen.getByRole('radio', { name: /Documentation/ }));
    await screen.findByRole('radio', { name: /Docs/ });
    if (target === 'theme') return;

    fireEvent.click(continueButton());
    await screen.findByText(/Editing/);
    if (target === 'settings') return;

    fireEvent.click(continueButton());
    await screen.findByText('Ready to publish');
  };

  describe('step 1 — type', () => {
    it('offers every site type with a description of what it produces', () => {
      open();

      expect(screen.getByText('What are you publishing?')).toBeInTheDocument();
      for (const name of [
        /Documentation/,
        /Blog/,
        /Book/,
        /Slides/,
        /Wiki/,
        /Portfolio/,
        /Changelog/,
        /Knowledge base/,
      ]) {
        expect(screen.getByRole('radio', { name })).toBeInTheDocument();
      }
      expect(screen.getByText(/Folders become a navigation sidebar/)).toBeInTheDocument();
      expect(screen.getByText(/lists what links back to it/)).toBeInTheDocument();
    });

    it.each([
      ['Wiki', 'wiki'],
      ['Portfolio', 'portfolio'],
      ['Changelog', 'changelog'],
      ['Knowledge base', 'kb'],
    ])('fetches themes for %s', async (label, slug) => {
      open();
      fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('list_theme_options', { projectType: slug }),
      );
    });

    it('advances to the theme step on choosing a type', async () => {
      open();
      fireEvent.click(screen.getByRole('radio', { name: /Blog/ }));

      expect(await screen.findByText('Pick a theme')).toBeInTheDocument();
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('list_theme_options', { projectType: 'blog' }),
      );
      expect(await screen.findByRole('radio', { name: /Editorial/ })).toBeInTheDocument();
    });
  });

  describe('step 2 — theme', () => {
    it('lists themes and preselects the first', async () => {
      open();
      await advanceTo('theme');

      const group = screen.getByRole('radiogroup', { name: 'Theme' });
      expect(within(group).getByRole('radio', { name: /Docs/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(within(group).getByRole('radio', { name: /Plain/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('renders a wireframe fallback for every type, including the new ones', async () => {
      for (const label of ['Wiki', 'Portfolio', 'Changelog', 'Knowledge base']) {
        const { unmount } = render(<PublishWizard initialType="docs" onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }));

        // The card renders from the theme list alone; a missing screenshot must
        // not leave a hole in the grid.
        expect(await screen.findByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
        unmount();
      }
    });

    it('shows a screenshot when the theme ships one, a fallback when it does not', async () => {
      open();
      await advanceTo('theme');
      const group = screen.getByRole('radiogroup', { name: 'Theme' });

      expect(
        within(within(group).getByRole('radio', { name: /Docs/ })).getByRole('presentation', {
          hidden: true,
        }),
      ).toHaveAttribute('src', 'asset:///themes/docs/default/screenshot.png');
      // A theme with no screenshot still renders a card, not a broken image.
      expect(
        within(within(group).getByRole('radio', { name: /Plain/ })).queryByRole('presentation', {
          hidden: true,
        }),
      ).toBeNull();
    });

    it('points theme authors at the guide instead of scaffolding in-app', async () => {
      open();
      await advanceTo('theme');

      expect(screen.getByText(/open a pull request against the themes/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Read the guide/ }));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('open_browser_url', {
          url: 'https://frontmatter.app/docs/themes',
        }),
      );
    });
  });

  describe('step 3 — settings', () => {
    it('lists every key in the config, including ones the app does not model', async () => {
      open();
      await advanceTo('settings');

      expect(screen.getByLabelText('Title')).toHaveValue('My Site');
      expect(screen.getByLabelText('Base URL')).toHaveValue('/');
      // Nothing about `my_own_key` is known to the exporter; it must still show.
      expect(screen.getByLabelText('My Own Key')).toHaveValue('keep me');
    });

    it('shows keys as fixed labels rather than editable inputs', async () => {
      open();
      await advanceTo('settings');

      const keyLabel = screen.getByText('my_own_key');
      expect(keyLabel.tagName).toBe('CODE');
    });

    it('edits a list one entry per line', async () => {
      open();
      await advanceTo('settings');

      const exclude = screen.getByLabelText('Exclude');
      expect(exclude).toHaveValue('drafts/scratch.md');

      fireEvent.change(exclude, { target: { value: 'drafts/scratch.md\nnotes/private.md' } });
      fireEvent.click(continueButton());

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'save_project_settings',
          expect.objectContaining({
            values: expect.objectContaining({
              exclude: ['drafts/scratch.md', 'notes/private.md'],
            }),
          }),
        ),
      );
    });

    it('renders nested values with the label the theme declared', async () => {
      open();
      await advanceTo('settings');

      expect(screen.getByLabelText('Source repository')).toHaveValue('https://example.com');
      // A boolean is a switch, not a text field.
      expect(screen.getByRole('switch', { name: 'Show Toc' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('saves edits when leaving the step, keeping unmodelled keys', async () => {
      open();
      await advanceTo('settings');

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
      fireEvent.click(continueButton());

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          'save_project_settings',
          expect.objectContaining({
            values: expect.objectContaining({ title: 'Renamed', my_own_key: 'keep me' }),
          }),
        ),
      );
    });

    it('stays on the step when the save is rejected', async () => {
      invoke.mockImplementation((command: string, args: Record<string, unknown>) =>
        command === 'save_project_settings'
          ? Promise.reject(new Error('These settings are not valid: invalid type'))
          : defaultBackend(command, args),
      );
      open();
      await advanceTo('settings');

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
      fireEvent.click(continueButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('not valid');
      expect(screen.getByLabelText('Title')).toBeInTheDocument();
      expect(screen.queryByText('Ready to publish')).toBeNull();
    });
  });

  describe('step 4 — publish', () => {
    it('summarises what is about to be built', async () => {
      open();
      await advanceTo('publish');

      expect(screen.getByText('My Site')).toBeInTheDocument();
      expect(screen.getByText('Documentation')).toBeInTheDocument();
      expect(screen.getByText('Docs')).toBeInTheDocument();
    });

    it('publishes with the chosen type and theme', async () => {
      open();
      await advanceTo('publish');
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('export_project_zola', {
          projectType: 'docs',
          themeName: 'default',
          preview: true,
        }),
      );
      expect(await screen.findByText('Published 14 pages')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save as \.zip/ })).toBeInTheDocument();
    });

    it('surfaces a build failure rather than reporting success', async () => {
      invoke.mockImplementation((command: string, args: Record<string, unknown>) =>
        command === 'export_project_zola'
          ? Promise.resolve({ ...PUBLISH_RESULT, success: false, error: 'zola build failed' })
          : defaultBackend(command, args),
      );
      open();
      await advanceTo('publish');

      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('zola build failed');
      expect(screen.queryByText(/Published 14 pages/)).toBeNull();
    });
  });

  describe('navigation', () => {
    it('goes back a step without losing the chosen type', async () => {
      open();
      fireEvent.click(screen.getByRole('radio', { name: /Book/ }));
      await screen.findByText('Pick a theme');

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(await screen.findByText('What are you publishing?')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Book/ })).toHaveAttribute('aria-checked', 'true');
    });

    it('cannot skip ahead to a step not yet reached', async () => {
      open();
      expect(screen.getByRole('button', { name: /4\s*Publish/ })).toBeDisabled();
    });

    it('reports the type it ended on so reopening restores it', async () => {
      const onClose = open();
      fireEvent.click(screen.getByRole('radio', { name: /Book/ }));
      await screen.findByText('Pick a theme');

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalledWith('book');
    });

    it('surfaces a failure to load themes', async () => {
      // Lazy rejection: mockRejectedValue creates the promise eagerly, which
      // registers as unhandled before the effect attaches its catch.
      invoke.mockImplementation((command: string, args: Record<string, unknown>) =>
        command === 'list_theme_options'
          ? Promise.reject(new Error('No workspace open'))
          : defaultBackend(command, args),
      );
      open();
      fireEvent.click(screen.getByRole('radio', { name: /Documentation/ }));

      expect(await screen.findByRole('alert')).toHaveTextContent('No workspace open');
    });
  });
});
