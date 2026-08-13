import { describe, expect, it } from 'vitest';
import { classifyAuthError, isCancellation } from './authErrors';

/** Shapes a Firebase Auth rejection. */
const fbError = (code: string) => Object.assign(new Error(code), { code });

describe('classifyAuthError', () => {
  it('treats a closed popup as a cancellation', () => {
    expect(classifyAuthError(fbError('auth/popup-closed-by-user')).kind).toBe('cancelled');
    expect(isCancellation(fbError('auth/cancelled-popup-request'))).toBe(true);
  });

  it('flags a missing Firebase configuration', () => {
    const failure = classifyAuthError(fbError('auth/configuration-not-found'));
    expect(failure.kind).toBe('not-configured');
    expect(failure.message).toMatch(/not available in this build/i);
  });

  it('explains a rejected credential in plain language', () => {
    const failure = classifyAuthError(fbError('auth/invalid-email'));
    expect(failure.kind).toBe('rejected');
    expect(failure.message).toBe('That email address is not valid.');
  });

  it('tells the user a sign-in link has expired', () => {
    expect(classifyAuthError(fbError('auth/expired-action-code')).message).toMatch(/expired/i);
  });

  it('classifies network failures as unavailable', () => {
    const failure = classifyAuthError(fbError('auth/network-request-failed'));
    expect(failure.kind).toBe('unavailable');
    expect(failure.message).toMatch(/connection/i);
  });

  it('recognises our own timeout message', () => {
    expect(classifyAuthError(new Error('Authentication timed out.')).kind).toBe('unavailable');
  });

  it('recognises a failed state check as a rejection', () => {
    const failure = classifyAuthError(new Error('Security verification failed.'));
    expect(failure.kind).toBe('rejected');
    expect(failure.message).toMatch(/start the sign-in again/i);
  });

  it('never leaks an error code into the user-facing message', () => {
    for (const code of [
      'auth/invalid-email',
      'auth/network-request-failed',
      'auth/internal-error',
      'auth/some-code-we-have-never-seen',
    ]) {
      expect(classifyAuthError(fbError(code)).message).not.toMatch(/auth\//);
    }
  });

  it('falls back to a generic message but keeps the code for logs', () => {
    const failure = classifyAuthError(fbError('auth/some-code-we-have-never-seen'));
    expect(failure.kind).toBe('unknown');
    expect(failure.code).toBe('auth/some-code-we-have-never-seen');
    expect(failure.message).toBe('Sign-in failed. Please try again.');
  });

  it('handles values that are not Errors at all', () => {
    expect(classifyAuthError(undefined).kind).toBe('unknown');
    expect(classifyAuthError('boom').kind).toBe('unknown');
    expect(classifyAuthError(null).message).toBe('Sign-in failed. Please try again.');
  });
});
