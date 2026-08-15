import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { useData } from '../data/DataProvider';
import type { InviteDetails } from '../data/types';
import { markdown } from '../editor/extensions/inlinePreview/markdown';
import { Mail, Check, LogOut, ShieldAlert, Users, Compass } from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { showAlertDialog } from '../lib/tauriDialog';

export function InviteLandingScreen() {
  const { user, signInWithGoogle, logout } = useAuth();
  const { switchWorkspace } = usePlan();
  const { invites } = useData();

  const [token, setToken] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<InviteDetails | null>(null);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [agreementContent, setAgreementContent] = useState<string>('');
  
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. Detect token query parameter on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tk = params.get('token');
    if (tk) {
      setToken(tk);
    }
  }, []);

  // 2. Fetch invitation data if token is active
  useEffect(() => {
    if (!token) {
      setInviteLoading(false);
      return;
    }

    setInviteLoading(true);
    let active = true;

    // One-shot backend lookup. The agreement text arrives with it: an invitee is
    // not a team member yet, so they can read neither the team nor its agreement
    // document directly — the previous client-side fetch of both always failed.
    invites
      .getByToken(token)
      .then((details) => {
        if (!active) return;
        setInviteData(details);
        setAgreementContent(details.agreementContent ?? '');
        setErrorMsg(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setInviteData(null);
        setErrorMsg(err.message || 'Invalid or expired invitation link.');
      })
      .finally(() => {
        if (active) setInviteLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, invites]);

  // Handle scroll check
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      if (scrollHeight - scrollTop - clientHeight < 15) {
        setScrolledToBottom(true);
      }
    }
  };

  useEffect(() => {
    if (agreementContent && scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      if (scrollHeight <= clientHeight + 10) {
        setScrolledToBottom(true);
      }
    }
  }, [agreementContent]);

  // Decline Invite
  const handleDecline = () => {
    // Clear URL parameters
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
    setToken(null);
  };

  // Join Team
  const handleJoin = async () => {
    if (!token || !user || !isChecked || !inviteData) return;

    setJoining(true);
    setErrorMsg(null);

    try {
      const firebaseAuth = getAuth();
      const idToken = firebaseAuth.currentUser ? await firebaseAuth.currentUser.getIdToken() : null;

      const baseUrl = import.meta.env.VITE_MODAL_BASE_URL || '';
      if (!baseUrl) {
        throw new Error('VITE_MODAL_BASE_URL is not configured.');
      }

      const response = await fetch(`${baseUrl}/join-team`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ token })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server returned error: ${errorText}`);
      }

      const result = await response.json();
      
      // Successfully joined! Switch to the team context
      switchWorkspace({
        type: 'team',
        teamId: result.teamId,
        teamName: result.teamName
      });

      // Clear token from URL
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
      setToken(null);

      showAlertDialog('Joined Team', `Successfully joined "${result.teamName}" team workspace!`);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Failed to join team.');
    } finally {
      setJoining(false);
    }
  };

  if (!token) return null;

  if (inviteLoading) {
    return (
      <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-zinc-950 text-white">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xs text-neutral-400">Verifying invitation link...</p>
        </div>
      </div>
    );
  }

  // Handle Invalid/Error States
  if (errorMsg || !inviteData) {
    return (
      <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-zinc-950 text-white p-4">
        <div className="w-full max-w-sm rounded-3xl border border-white/5 bg-zinc-900 p-6 text-center shadow-2xl">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="font-bold text-sm text-neutral-200">Invitation Error</h3>
          <p className="text-xs text-neutral-400 mt-2 mb-6">
            {errorMsg || 'This invitation link is invalid, expired, or has been revoked.'}
          </p>
          <button
            onClick={handleDecline}
            className="w-full py-2 bg-white/5 hover:bg-white/10 text-xs font-semibold rounded-xl border border-white/10 transition cursor-pointer"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // An already-used or expired invite never resolves now — /invite-details returns
  // 410 and the message lands in `errorMsg`, handled by the error branch above.

  // Verify signed in email matches
  const emailMismatch = user && user.email.toLowerCase() !== inviteData.invitedEmail.toLowerCase();

  const renderedHtml = markdown.render(agreementContent || 'Loading team terms of agreement...');

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-zinc-950/95 backdrop-blur-xl p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-900/90 text-white p-8 shadow-2xl flex flex-col my-8 max-h-[85vh]">
        
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mx-auto mb-3">
            <Compass className="w-6 h-6 animate-pulse" />
          </div>
          <h2 className="text-xl font-extrabold tracking-tight">You've been invited!</h2>
          <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed max-w-md mx-auto">
            You've been invited to join the <strong>"{inviteData.teamName}"</strong> workspace as a member.
          </p>
        </div>

        {/* Auth State Gate */}
        {!user ? (
          <div className="flex-1 flex flex-col items-center justify-center py-10 bg-black/20 border border-white/5 rounded-2xl p-6">
            <Mail className="w-8 h-8 opacity-40 mb-3" />
            <p className="text-xs text-neutral-400 text-center mb-6 max-w-xs">
              To accept this invitation, please authenticate first. Sign in with the email address: <strong>{inviteData.invitedEmail}</strong>.
            </p>
            <button
              onClick={() => {
                // Not setErrorMsg: that state replaces the whole screen with
                // "this invite is invalid", which a failed sign-in does not mean.
                void signInWithGoogle().catch((e) =>
                  showAlertDialog('Sign-in failed', e instanceof Error ? e.message : 'Please try again.'),
                );
              }}
              className="py-2.5 px-6 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg transition cursor-pointer"
            >
              Sign In with Google
            </button>
          </div>
        ) : emailMismatch ? (
          <div className="flex-1 flex flex-col items-center justify-center py-10 bg-black/20 border border-white/5 rounded-2xl p-6">
            <ShieldAlert className="w-8 h-8 text-amber-500 mb-3" />
            <h4 className="font-bold text-xs text-neutral-200">Email Mismatch</h4>
            <p className="text-xs text-neutral-400 text-center mt-2 mb-6 max-w-xs leading-relaxed">
              This invite was sent to <strong>{inviteData.invitedEmail}</strong>, but you are signed in as <strong>{user.email}</strong>.<br />
              Please sign out and sign in with the correct account.
            </p>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  await logout();
                }}
                className="flex items-center gap-1 py-2 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
              <button
                onClick={handleDecline}
                className="py-2 px-4 bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-bold rounded-xl border border-white/5 transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Agreement Terms Render */}
            <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-2 text-left">
              Step 1: Read the Team Agreement
            </div>
            <div 
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto min-h-0 bg-black/20 border border-white/5 rounded-2xl p-5 mb-6 text-xs text-neutral-300 leading-relaxed scrollbar-thin select-text"
            >
              {agreementContent ? (
                <div 
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  className="prose prose-invert max-w-none text-left"
                />
              ) : (
                <div className="italic text-neutral-500 p-2">No agreement document is required for this team, or it is loading...</div>
              )}
            </div>

            {/* Accept / Join UI */}
            <div className="border-t border-white/5 pt-5 flex flex-col gap-4">
              {!scrolledToBottom && agreementContent && (
                <p className="text-[10px] text-amber-400/90 text-center font-medium">
                  Please scroll to the bottom of the agreement to enable joining.
                </p>
              )}

              <div className="flex items-center justify-between flex-wrap gap-4">
                <label className={`flex items-center gap-2.5 text-xs font-medium cursor-pointer transition select-none ${!agreementContent || scrolledToBottom ? 'text-neutral-200' : 'text-neutral-500 pointer-events-none'}`}>
                  <input
                    type="checkbox"
                    disabled={agreementContent ? !scrolledToBottom : false}
                    checked={isChecked}
                    onChange={(e) => setIsChecked(e.target.checked)}
                    className="w-4 h-4 rounded border-white/10 bg-white/5 text-amber-500 focus:ring-0 cursor-pointer disabled:opacity-30"
                  />
                  <span>I agree to join this team and sign their terms.</span>
                </label>

                <div className="flex gap-2">
                  <button
                    onClick={handleDecline}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-neutral-300 font-bold text-xs rounded-xl border border-white/5 transition cursor-pointer"
                  >
                    Decline
                  </button>
                  <button
                    onClick={handleJoin}
                    disabled={!isChecked || joining}
                    className="px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-black font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 active:scale-[0.98]"
                  >
                    {joining ? 'Joining...' : (
                      <>
                        <Check className="w-4 h-4" /> Join Team
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
