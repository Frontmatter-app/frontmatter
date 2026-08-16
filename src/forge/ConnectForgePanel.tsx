/**
 * Connect a git provider.
 *
 * The device code is the whole interface: it is shown large and selectable,
 * because the user has to read it off one screen and type it into another. A
 * code the user has to squint at is the difference between this flow feeling
 * fine and feeling broken.
 */
import React from 'react';
import { useForgeConnection } from './useForgeConnection';
import type { ForgeKind } from './types';

const LABELS: Record<ForgeKind, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
};

export function ConnectForgePanel({ kind = 'github' as ForgeKind }) {
  const { status, account, grant, error, secondsLeft, connect, cancel, disconnect } =
    useForgeConnection(kind);
  const label = LABELS[kind];

  if (status === 'checking') {
    return <p className="forge-panel__hint">Checking connection…</p>;
  }

  if (status === 'awaitingUser' && grant) {
    return (
      <div className="forge-panel">
        <h3>Finish connecting {label}</h3>
        <p className="forge-panel__hint">
          Enter this code at{' '}
          <a href={grant.verificationUri} target="_blank" rel="noreferrer">
            {grant.verificationUri.replace(/^https?:\/\//, '')}
          </a>
          . Your browser should have opened there already.
        </p>

        {/* Selectable and monospaced: this exists to be read aloud or copied. */}
        <output className="forge-panel__code" aria-live="polite">
          {grant.userCode}
        </output>

        {secondsLeft !== null && (
          <p className="forge-panel__hint">
            {secondsLeft > 0
              ? `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
              : 'Expired — start again.'}
          </p>
        )}

        <p className="forge-panel__hint">Waiting for you to authorise…</p>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (status === 'connected' && account) {
    return (
      <div className="forge-panel">
        <h3>{label}</h3>
        <div className="forge-panel__account">
          {account.avatarUrl && <img src={account.avatarUrl} alt="" width={32} height={32} />}
          <div>
            <strong>{account.name || account.login}</strong>
            <span className="forge-panel__login">@{account.login}</span>
          </div>
        </div>
        <p className="forge-panel__hint">
          Commits are made from this machine using this account. The token is held in your
          operating system keychain and is never sent to the collaboration server.
        </p>
        <button type="button" onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="forge-panel">
      <h3>{label}</h3>
      {error && <p className="forge-panel__error">{error}</p>}
      <p className="forge-panel__hint">
        Connect an account to open repositories and commit from Frontmatter. You will be shown a
        short code to enter at {label}.
      </p>
      <button type="button" onClick={() => void connect()} disabled={status === 'connecting'}>
        {status === 'connecting' ? 'Starting…' : `Connect ${label}`}
      </button>
    </div>
  );
}
