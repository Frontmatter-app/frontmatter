/**
 * Open a repository from a connected git provider.
 *
 * The alternative it replaces is typing a clone URL into a prompt, which asks
 * the user to remember a string they can only get by visiting the provider —
 * and which fails opaquely for private repositories because the shelled-out
 * `git` had no credentials.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '../filesystem/tauriCommands';
import { forgeFor, useForgeConnection } from './useForgeConnection';
import { readToken } from './tokenStore';
import { ConnectForgePanel } from './ConnectForgePanel';
import type { Repo } from './types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'browsing' | 'cloning' | 'done' | 'failed';

export function RepoPickerModal({ isOpen, onClose }: Props) {
  const { status } = useForgeConnection('github');
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('browsing');
  const [message, setMessage] = useState<string | null>(null);
  const [clonedPath, setClonedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || status !== 'connected') return;
    let cancelled = false;
    setRepos(null);
    forgeFor('github')
      .listRepos({ limit: 100 })
      .then((result) => {
        if (!cancelled) setRepos(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setRepos([]);
          setMessage(error instanceof Error ? error.message : 'Could not list repositories.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, status]);

  const filtered = useMemo(() => {
    if (!repos) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(needle) ||
        (repo.description ?? '').toLowerCase().includes(needle),
    );
  }, [repos, query]);

  if (!isOpen) return null;

  const clone = async (repo: Repo) => {
    setPhase('cloning');
    setMessage(`Cloning ${repo.fullName}…`);

    const parent = await invoke<string | null>('pick_folder', {
      title: `Choose a folder for "${repo.name}"`,
    });
    if (!parent) {
      setPhase('browsing');
      setMessage(null);
      return;
    }

    // Read the token per clone rather than holding it: it is only needed for
    // the duration of one subprocess, and the Rust side passes it through the
    // environment so it never lands in `.git/config` or in `ps` output.
    const token = await readToken('github');

    try {
      const result = await invoke<{ path: string; success: boolean; error?: string }>('git_clone', {
        url: repo.cloneUrl,
        destination: `${parent}/${repo.name}`,
        token,
      });

      if (!result.success) {
        setPhase('failed');
        setMessage(result.error || 'Clone failed.');
        return;
      }
      setClonedPath(result.path);
      setPhase('done');
      setMessage(null);
    } catch (error) {
      setPhase('failed');
      setMessage(error instanceof Error ? error.message : 'Clone failed.');
    }
  };

  const openCloned = async () => {
    if (!clonedPath) return;
    await invoke('add_recent_project', { path: clonedPath });
    await invoke('open_folder_in_new_window_from_path', { path: clonedPath });
    onClose();
  };

  return (
    <div className="repo-picker__backdrop" role="dialog" aria-modal="true" aria-label="Open a repository">
      <div className="repo-picker">
        <header className="repo-picker__header">
          <h2>Open a repository</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {status !== 'connected' ? (
          <ConnectForgePanel kind="github" />
        ) : phase === 'done' ? (
          <div className="repo-picker__body">
            <p>Cloned to {clonedPath}</p>
            <button type="button" onClick={() => void openCloned()}>
              Open it
            </button>
          </div>
        ) : (
          <>
            <input
              className="repo-picker__search"
              type="search"
              placeholder="Search repositories"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={phase === 'cloning'}
              autoFocus
            />

            {message && <p className="repo-picker__message">{message}</p>}

            {filtered === null ? (
              <p className="repo-picker__message">Loading repositories…</p>
            ) : filtered.length === 0 ? (
              <p className="repo-picker__message">
                {query ? 'No repositories match that.' : 'No repositories found.'}
              </p>
            ) : (
              <ul className="repo-picker__list">
                {filtered.map((repo) => (
                  <li key={repo.id}>
                    <button
                      type="button"
                      className="repo-picker__item"
                      onClick={() => void clone(repo)}
                      disabled={phase === 'cloning'}
                    >
                      <span className="repo-picker__name">
                        {repo.fullName}
                        {repo.private && <span className="repo-picker__badge">Private</span>}
                        {/* Read-only access is worth showing before the user
                            invests in cloning something they cannot push to. */}
                        {repo.permission === 'read' && (
                          <span className="repo-picker__badge">Read-only</span>
                        )}
                      </span>
                      {repo.description && (
                        <span className="repo-picker__description">{repo.description}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
