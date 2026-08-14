import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; display_name: string; email?: string; avatar_url?: string },
  savedAccounts: [] as Array<{ uid: string; email: string; displayName: string; photoURL: string | null; lastUsed: string }>,
  authEvents: [] as Array<{ type: 'error' | 'info'; message: string }>,
  clearAuthEvents: vi.fn(),
  signInWithGoogle: vi.fn(async () => {}),
  sendMagicLink: vi.fn(async () => {}),
  switchAccount: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  logoutAll: vi.fn(async () => {}),
  removeSavedAccount: vi.fn(async () => {}),
}));

const plan = vi.hoisted(() => ({
  plan: 'free' as string,
  teamMemberships: [] as string[],
  activeContext: { type: 'personal' } as { type: 'personal' | 'team'; teamId?: string },
  switchWorkspace: vi.fn(async () => {}),
}));

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../billing/PlanProvider', () => ({ usePlan: () => plan }));
vi.mock('../hooks/useTeamNames', () => ({ useTeamNames: () => [] }));
vi.mock('../lib/tauriDialog', () => ({
  showConfirmDialog: vi.fn(async () => true),
  showAlertDialog: vi.fn(async () => {}),
}));
// The desktop build has no hosted return URL, so keep the email path visible.
vi.mock('../auth/magicLink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/magicLink')>()),
  magicLinkContinueUrl: () => 'https://app.example.com/',
}));

import { AccountSwitcherModal, MAX_SAVED_ACCOUNTS } from './AccountSwitcherModal';
import { showConfirmDialog } from '../lib/tauriDialog';

const account = (uid: string, displayName: string) => ({
  uid,
  displayName,
  email: `${uid}@example.com`,
  photoURL: null,
  lastUsed: new Date().toISOString(),
});

beforeEach(() => {
  auth.user = null;
  auth.savedAccounts = [];
  auth.authEvents = [];
  plan.plan = 'free';
  plan.activeContext = { type: 'personal' };
});

afterEach(() => vi.clearAllMocks());

describe('AccountSwitcherModal, signed out', () => {
  it('renders nothing while closed', () => {
    render(<AccountSwitcherModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers a way to sign in, which the modal previously did not', () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Sign in');
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeEnabled();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('says the first sign-in creates the account, since there is no separate sign-up', () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText(/creates your account/i)).toBeInTheDocument();
  });

  it('rejects a malformed address before calling Firebase', () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));

    expect(auth.sendMagicLink).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter a valid email address.');
  });

  it('confirms where the link went', async () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'someone@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));

    await waitFor(() => expect(auth.sendMagicLink).toHaveBeenCalledWith('someone@example.com'));
    expect(await screen.findByRole('status')).toHaveTextContent('someone@example.com');
  });

  it('reports a failed send in the dialog rather than throwing it away', async () => {
    auth.sendMagicLink.mockRejectedValueOnce(new Error('Too many attempts.'));
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'someone@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));

    expect(await screen.findByText('Too many attempts.')).toBeInTheDocument();
  });

  it('still lists saved accounts, so a signed-out window can get back in', () => {
    auth.savedAccounts = [account('u1', 'Ada Lovelace')];
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);
    // Anchored, so this matches the row and not "Remove Ada Lovelace…".
    expect(screen.getByRole('button', { name: /^Ada Lovelace/ })).toBeInTheDocument();
  });
});

describe('AccountSwitcherModal, signed in', () => {
  beforeEach(() => {
    auth.user = { id: 'u1', display_name: 'Ada Lovelace', email: 'ada@example.com' };
    auth.savedAccounts = [account('u1', 'Ada Lovelace'), account('u2', 'Grace Hopper')];
  });

  it('shows the active account and its plan', () => {
    plan.plan = 'author';
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Account');
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Author')).toBeInTheDocument();
  });

  it('lists other accounts but not the one already active', () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^Grace Hopper/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ada Lovelace/ })).toBeNull();
  });

  it('marks the current workspace and does not offer to reopen it', () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);
    const personal = screen.getByRole('button', { name: /Personal/ });
    expect(personal).toHaveAttribute('aria-current', 'true');
    expect(personal).toBeDisabled();
  });

  it('switches account on the matching number key', async () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: '1' });
    await waitFor(() => expect(auth.switchAccount).toHaveBeenCalledWith('u2'));
  });

  it('ignores number keys once the modal is closed', () => {
    const { rerender } = render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);
    rerender(<AccountSwitcherModal isOpen={false} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: '1' });
    expect(auth.switchAccount).not.toHaveBeenCalled();
  });

  it('confirms before removing a saved account', async () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove Grace Hopper/ }));

    await waitFor(() => expect(auth.removeSavedAccount).toHaveBeenCalledWith('u2'));
    expect(showConfirmDialog).toHaveBeenCalled();
  });

  it('keeps signing out of this account separate from signing out of all', async () => {
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
    expect(auth.logoutAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /sign out of all/i }));
    await waitFor(() => expect(auth.logoutAll).toHaveBeenCalled());
  });

  it('does not offer "sign out of all" for a single account', () => {
    auth.savedAccounts = [account('u1', 'Ada Lovelace')];
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^sign out$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign out of all/i })).toBeNull();
  });

  it('enforces the saved-account limit the settings panel advertises', () => {
    auth.savedAccounts = Array.from({ length: MAX_SAVED_ACCOUNTS }, (_, i) =>
      account(`u${i + 1}`, `User ${i + 1}`),
    );
    auth.user = { id: 'u1', display_name: 'User 1' };
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /add account/i })).toBeDisabled();
    expect(screen.getByText(/Remove one to add another/)).toBeInTheDocument();
  });

  it('surfaces an auth error as an alert', () => {
    auth.authEvents = [{ type: 'error', message: 'Could not reach the sign-in service.' }];
    render(<AccountSwitcherModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the sign-in service.');
  });
});
