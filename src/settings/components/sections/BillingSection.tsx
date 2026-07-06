import React, { useState } from 'react';
import { CreditCard, Crown, Users, ExternalLink, Sparkles, Mail, Shield, ShieldCheck } from 'lucide-react';
import { usePlan } from '../../../billing/PlanProvider';

export function BillingSection() {
  const { plan, planStatus, isAuthor, isTeam, isTeamOwner, teamId, upgradeToAuthor, upgradeToTeam, openBillingPortal } = usePlan();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [inviteError, setInviteError] = useState('');

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <CreditCard className="w-5 h-5 text-amber-500" /> Plan &amp; Billing
      </h3>

      <div className="mb-5 p-5 rounded-2xl border border-black/5 dark:border-white/8 bg-black/3 dark:bg-white/2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Crown className={`w-4 h-4 ${plan === 'team' ? 'text-orange-400' : plan === 'author' ? 'text-amber-400' : 'text-neutral-400'}`} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: plan === 'team' ? '#fb923c' : plan === 'author' ? '#f59e0b' : undefined }}>
                {plan === 'team' ? (isTeamOwner ? 'Team Owner' : 'Team Member') : plan === 'author' ? 'Author' : plan === 'enterprise' ? 'Enterprise' : 'Free'}
              </span>
              {planStatus === 'active' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 uppercase">Active</span>}
              {planStatus === 'past_due' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20 uppercase">Past Due</span>}
            </div>
            <p className="text-xs opacity-50">
              {plan === 'team' && isTeamOwner && 'Your seat covers up to 9 invited team members.'}
              {plan === 'team' && !isTeamOwner && "You are covered by your team owner's subscription."}
              {plan === 'author' && 'Cloud sync & multi-device access enabled.'}
              {plan === 'free' && 'Local editing only. Upgrade to unlock cloud features.'}
            </p>
          </div>
          {isAuthor && (
            <button onClick={openBillingPortal} className="flex items-center gap-1.5 py-1.5 px-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-semibold text-xs hover:bg-black/10 dark:hover:bg-white/10 transition cursor-pointer">
              <ExternalLink className="w-3.5 h-3.5" /> Manage Billing
            </button>
          )}
        </div>
      </div>

      {plan === 'free' && (
        <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={upgradeToAuthor} className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-left hover:bg-amber-500/10 transition cursor-pointer group">
            <div className="flex items-center gap-2 mb-1"><Sparkles className="w-4 h-4 text-amber-400" /><span className="font-bold text-sm">Author Plan</span></div>
            <p className="text-xs opacity-60 mb-2">Cloud sync + multi-device access</p>
            <span className="text-lg font-extrabold text-amber-500">$9.99<span className="text-xs font-normal opacity-60">/mo</span></span>
          </button>
          <button onClick={upgradeToTeam} className="p-4 rounded-2xl border border-orange-500/30 bg-orange-500/5 text-left hover:bg-orange-500/10 transition cursor-pointer group">
            <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-orange-400" /><span className="font-bold text-sm">Team Plan</span></div>
            <p className="text-xs opacity-60 mb-2">Real-time collaboration, 10 seats</p>
            <span className="text-lg font-extrabold text-orange-500">$99.99<span className="text-xs font-normal opacity-60">/mo</span></span>
          </button>
        </div>
      )}

      {plan === 'author' && (
        <div className="mb-5">
          <button onClick={upgradeToTeam} className="w-full p-4 rounded-2xl border border-orange-500/30 bg-orange-500/5 text-left hover:bg-orange-500/10 transition cursor-pointer flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-orange-400" /><span className="font-bold text-sm">Upgrade to Team Plan</span></div>
              <p className="text-xs opacity-60">Real-time collaboration for up to 10 people</p>
            </div>
            <span className="text-lg font-extrabold text-orange-500 ml-4 whitespace-nowrap">$99.99<span className="text-xs font-normal opacity-60">/mo</span></span>
          </button>
        </div>
      )}

      {isTeam && isTeamOwner && teamId && (
        <div className="border border-black/5 dark:border-white/5 rounded-2xl p-5">
          <span className="text-xs font-bold text-gray-400 block mb-4 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Team Management</span>
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!inviteEmail.trim()) return;
            setInviteStatus('loading'); setInviteError('');
            try {
              window.dispatchEvent(new CustomEvent('billing-invite-member', { detail: { email: inviteEmail.trim() } }));
              setInviteStatus('success'); setInviteEmail('');
            } catch (err: any) { setInviteStatus('error'); setInviteError(err.message || 'Failed to send invite.'); }
          }} className="mb-4">
            <label className="text-[11px] font-bold text-gray-400 uppercase block mb-2">Invite Team Member</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input type="email" placeholder="teammate@company.com" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs outline-none focus:border-blue-500" />
                <Mail className="w-4 h-4 opacity-40 absolute left-3 top-2.5" />
              </div>
              <button type="submit" disabled={inviteStatus === 'loading'}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold text-xs rounded-xl transition cursor-pointer disabled:opacity-50">
                {inviteStatus === 'loading' ? 'Inviting...' : 'Invite'}
              </button>
            </div>
            {inviteStatus === 'error' && <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> {inviteError}</p>}
            {inviteStatus === 'success' && <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Invite sent successfully!</p>}
          </form>
        </div>
      )}

      {isTeam && !isTeamOwner && (
        <div className="p-4 rounded-2xl border border-blue-500/10 bg-blue-500/3 text-xs">
          <p className="font-semibold mb-1 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-blue-400" /> Covered by Team Subscription</p>
          <p className="opacity-60">Your access is provided by your team owner. You don't need a personal plan.</p>
        </div>
      )}
    </div>
  );
}
