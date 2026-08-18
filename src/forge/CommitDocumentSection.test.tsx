/**
 * The commit section's states.
 *
 * What is worth testing here is not the happy path but the several ways a
 * document cannot be committed. Each has to produce a sentence: a Commit button
 * that is missing without explanation, or present and inert, is the outcome
 * this section exists to avoid.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

const isConnected = vi.fn(async () => true);
const commitDocument = vi.fn(async () => ({ status: 'committed', commit: { sha: 'abc1234def', url: 'https://example.test/c' }, text: '' }));
const attachGitDocument = vi.fn(async () => ({}));
const getGitDocument = vi.fn(() => ({ base: { commit: 'sha', text: 'committed\n' } }));

vi.mock('./tokenStore', () => ({ isConnected: (...args: any[]) => isConnected(...(args as [])) }));
vi.mock('./useForgeConnection', () => ({ forgeFor: () => ({ kind: 'github' }) }));
vi.mock('../yjs/DocumentRegistry', () => ({
  registry: {
    attachGitDocument: (...args: any[]) => attachGitDocument(...(args as [])),
    getGitDocument: (...args: any[]) => getGitDocument(...(args as [])),
    commitDocument: (...args: any[]) => commitDocument(...(args as [])),
  },
}));

const repoRoot = vi.fn(async () => '/repo' as string | null);
const remoteUrl = vi.fn(async () => 'https://github.com/acme/docs.git');
const currentBranch = vi.fn(async () => 'main');

vi.mock('../git/gitCommands', () => ({
  getRepoRoot: () => repoRoot(),
  getRemoteUrl: () => remoteUrl(),
  getCurrentBranch: () => currentBranch(),
}));

import { CommitDocumentSection } from './CommitDocumentSection';
import { forgetRepositoryContext } from './workspaceRepository';

function renderSection(text = 'committed\nand more\n') {
  const ydoc = new Y.Doc();
  ydoc.getText('markdown').insert(0, text);
  return render(
    <CommitDocumentSection
      workspacePath="/repo"
      documentId="doc-1"
      filePath="/repo/notes/today.md"
      ydoc={ydoc}
      active
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The repository lookup is cached across callers, so without this each test
  // would be answered with the previous test's repository and the mocks above
  // would look ignored.
  forgetRepositoryContext();
  isConnected.mockResolvedValue(true);
  repoRoot.mockResolvedValue('/repo');
  remoteUrl.mockResolvedValue('https://github.com/acme/docs.git');
  currentBranch.mockResolvedValue('main');
  getGitDocument.mockReturnValue({ base: { commit: 'sha', text: 'committed\n' } });
  attachGitDocument.mockResolvedValue({});
});

describe('when the document can be committed', () => {
  it('names the repository, branch and path it would write to', async () => {
    renderSection();
    expect(await screen.findByText('acme/docs')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('notes/today.md')).toBeInTheDocument();
  });

  it('commits the typed message', async () => {
    renderSection();
    const button = await screen.findByRole('button', { name: 'Commit' });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Commit message'), {
      target: { value: 'Rewrite the opening' },
    });
    fireEvent.click(button);

    expect(commitDocument).toHaveBeenCalledWith('doc-1', 'Rewrite the opening');
    expect(await screen.findByText('abc1234')).toBeInTheDocument();
  });

  it('falls back to a message rather than refusing an empty box', async () => {
    renderSection();
    const button = await screen.findByRole('button', { name: 'Commit' });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    expect(commitDocument).toHaveBeenCalledWith('doc-1', 'Update today.md');
  });

  it('offers nothing to commit when the document matches the branch', async () => {
    renderSection('committed\n');
    expect(await screen.findByText(/Up to date with the branch/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled();
  });
});

describe('when it cannot', () => {
  it('explains a provider that is not connected, instead of a dead button', async () => {
    isConnected.mockResolvedValue(false);
    renderSection();

    expect(await screen.findByText(/Connect a git provider/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
  });

  it('explains a repository with no remote', async () => {
    remoteUrl.mockResolvedValue('');
    renderSection();
    expect(await screen.findByText(/no remote/)).toBeInTheDocument();
  });

  it('explains a detached HEAD', async () => {
    currentBranch.mockResolvedValue('HEAD');
    renderSection();
    expect(await screen.findByText(/detached HEAD/)).toBeInTheDocument();
  });

  it('offers a retry when the repository could not be read', async () => {
    attachGitDocument.mockResolvedValue(null);
    renderSection();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says nothing at all about a document with no file of its own', async () => {
    const ydoc = new Y.Doc();
    const { container } = render(
      <CommitDocumentSection
        workspacePath="/repo"
        documentId="doc-1"
        filePath={null}
        ydoc={ydoc}
        active
      />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('reporting what a commit did', () => {
  it('surfaces a failure', async () => {
    commitDocument.mockResolvedValue({
      status: 'failed',
      error: new Error('The connection to your git provider is no longer valid.'),
    } as any);
    renderSection();

    const button = await screen.findByRole('button', { name: 'Commit' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByText(/no longer valid/)).toBeInTheDocument();
  });

  it('says when the document changed as part of committing it', async () => {
    // Somebody who is not told the branch was merged in will wonder who edited
    // their text.
    commitDocument.mockResolvedValue({
      status: 'reconciled',
      commit: { sha: 'fed7654321', url: 'https://example.test/c' },
      text: '',
      rejected: [],
    } as any);
    renderSection();

    const button = await screen.findByRole('button', { name: 'Commit' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByText(/after merging changes from the branch/)).toBeInTheDocument();
  });

  it('warns loudly when a change from the branch could not be placed', async () => {
    commitDocument.mockResolvedValue({
      status: 'reconciled',
      commit: { sha: 'fed7654321', url: 'https://example.test/c' },
      text: '',
      rejected: ['a paragraph somebody else wrote'],
    } as any);
    renderSection();

    const button = await screen.findByRole('button', { name: 'Commit' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByText(/could not be placed/)).toBeInTheDocument();
  });
});
