import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DsButton, DsField, DsInput } from '../design/components';
import { magicLinkContinueUrl, isProbablyEmail } from '../auth/magicLink';

interface AccountSignInPanelProps {
  busy: boolean;
  signingIn: boolean;
  onGoogle: () => void;
  onMagicLink: (email: string) => Promise<void>;
}

/**
 * The signed-out half of the account modal.
 *
 * There is no separate sign-up: the first successful sign-in creates the
 * account and its user document, so this says so rather than sending people
 * looking for a register button that does not exist.
 */
export function AccountSignInPanel({ busy, signingIn, onGoogle, onMagicLink }: AccountSignInPanelProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Email links need a hosted URL to return to, which the desktop build only
  // has when one is configured. Hiding the field beats failing on submit.
  const emailAvailable = magicLinkContinueUrl() !== null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!isProbablyEmail(address)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setSending(true);
    try {
      await onMagicLink(address);
      setSentTo(address);
      setEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the link. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="account__signin">
      <p className="account__signin-lead">
        Sign in to sync your documents, work with a team, and pick up where you left off on
        another device. Signing in for the first time creates your account.
      </p>

      <DsButton variant="primary" onClick={onGoogle} disabled={busy}>
        {signingIn ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Opening Google…
          </>
        ) : (
          'Continue with Google'
        )}
      </DsButton>

      {emailAvailable && (
        <>
          <div className="account__divider">or</div>

          <form className="account__signin-form" onSubmit={handleSubmit} noValidate>
            <DsField label="Email" error={error ?? undefined}>
              {(props) => (
                <DsInput
                  {...props}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  disabled={busy || sending}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                />
              )}
            </DsField>
            <DsButton type="submit" disabled={busy || sending || !email.trim()}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send link'}
            </DsButton>
          </form>

          {sentTo && !error && (
            <p className="account__note" role="status">
              Sign-in link sent to {sentTo}. Open it on this device to finish.
            </p>
          )}
        </>
      )}

      <p className="account__note">
        You can keep using Frontmatter without an account — documents stay on this device only.
      </p>
    </div>
  );
}
