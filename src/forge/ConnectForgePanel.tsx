/**
 * Connect a git provider.
 *
 * Built from the design-system primitives rather than raw elements, so the
 * controls are actually controls — a previous version used bare `<button>`
 * tags, which render as plain text against this stylesheet and were easy to
 * miss entirely.
 *
 * The device code is the whole interface: it is shown large, monospaced and
 * selectable, because the user has to read it off one screen and type it into
 * another.
 */
import React from 'react';
import { DsButton } from '../design/components';
import { useForgeConnection } from './useForgeConnection';
import type { ForgeKind } from './types';
import './connectForge.css';

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
    const minutes = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
    const seconds = secondsLeft !== null ? secondsLeft % 60 : 0;

    return (
      <div className="forge-panel">
        <h4 className="forge-panel__title">Finish connecting {label}</h4>
        <p className="forge-panel__hint">
          Enter this code at{' '}
          <a href={grant.verificationUri} target="_blank" rel="noreferrer">
            {grant.verificationUri.replace(/^https?:\/\//, '')}
          </a>
          . Your browser should already be there.
        </p>

        <output className="forge-panel__code" aria-live="polite">
          {grant.userCode}
        </output>

        <p className="forge-panel__hint">
          {secondsLeft !== null && secondsLeft > 0
            ? `Waiting for you to authorise — expires in ${minutes}:${String(seconds).padStart(2, '0')}`
            : 'Waiting for you to authorise…'}
        </p>

        <div className="forge-panel__actions">
          <DsButton variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </DsButton>
        </div>
      </div>
    );
  }

  if (status === 'connected' && account) {
    return (
      <div className="forge-panel">
        <h4 className="forge-panel__title">{label}</h4>

        <div className="forge-panel__account">
          {account.avatarUrl && (
            <img className="forge-panel__avatar" src={account.avatarUrl} alt="" />
          )}
          <div className="forge-panel__identity">
            <span className="forge-panel__name">{account.name || account.login}</span>
            <span className="forge-panel__login">@{account.login}</span>
          </div>
        </div>

        <span className="forge-panel__status">
          <span className="forge-panel__dot" aria-hidden="true" />
          Connected
        </span>

        <p className="forge-panel__hint">
          Commits are made from this machine as this account. The token is held in your operating
          system keychain and is never sent to the collaboration server.
        </p>

        <div className="forge-panel__actions">
          <DsButton variant="danger" size="sm" onClick={() => void disconnect()}>
            Disconnect
          </DsButton>
        </div>
      </div>
    );
  }

  return (
    <div className="forge-panel">
      <h4 className="forge-panel__title">{label}</h4>
      {error && <p className="forge-panel__error">{error}</p>}
      <p className="forge-panel__hint">
        Connect an account to open repositories and commit from Frontmatter. You will be shown a
        short code to enter at {label}.
      </p>
      <div className="forge-panel__actions">
        <DsButton variant="primary" size="sm" onClick={() => void connect()} disabled={status === 'connecting'}>
          {status === 'connecting' ? 'Starting…' : `Connect ${label}`}
        </DsButton>
      </div>
    </div>
  );
}
