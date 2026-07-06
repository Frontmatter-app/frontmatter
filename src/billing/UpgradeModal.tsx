import React, { useEffect, useState } from 'react';
import { usePlan } from './PlanProvider';
import { Sparkles, ShieldCheck, Check, X } from 'lucide-react';

export function UpgradeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [targetPlan, setTargetPlan] = useState<'author' | 'team'>('author');
  const { plan, upgradeToAuthor, upgradeToTeam, isLoading } = usePlan();

  useEffect(() => {
    const handleOpen = (e: any) => {
      if (e.detail?.plan) {
        setTargetPlan(e.detail.plan);
      }
      setIsOpen(true);
    };

    window.addEventListener('open-upgrade-modal', handleOpen);
    return () => window.removeEventListener('open-upgrade-modal', handleOpen);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="relative w-full max-w-4xl rounded-2xl border border-white/10 bg-zinc-900/90 text-white p-6 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Close button */}
        <button
          onClick={() => setIsOpen(false)}
          className="absolute top-4 right-4 text-neutral-400 hover:text-white transition cursor-pointer"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent flex items-center justify-center gap-2">
            <Sparkles className="w-8 h-8 text-amber-400" /> Choose Your MarkType Plan
          </h2>
          <p className="text-neutral-400 mt-2">No free trials, immediate access, fully premium capabilities.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto mb-6">
          {/* Author Plan */}
          <div className={`p-6 rounded-2xl border ${targetPlan === 'author' ? 'border-amber-500 bg-amber-500/5' : 'border-white/5 bg-white/[0.01]'} flex flex-col justify-between`}>
            <div>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold text-white">Author Plan</h3>
                  <p className="text-neutral-400 text-xs mt-1">For serious writers needing cloud portability</p>
                </div>
                <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-full text-xs font-semibold uppercase">Individual</span>
              </div>
              <div className="text-3xl font-extrabold mb-4">$9.99<span className="text-neutral-400 text-sm font-normal"> / month</span></div>
              <ul className="space-y-2.5 mb-6 text-sm text-neutral-300">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-amber-500" /> Live Cloud Document Sync</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-amber-500" /> Multi-Account Switching</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-amber-500" /> Access docs from any device</li>
                <li className="flex items-center gap-2 text-neutral-500"><X className="w-4 h-4" /> Real-time collaboration</li>
              </ul>
            </div>
            <button
              onClick={async () => {
                await upgradeToAuthor();
                setIsOpen(false);
              }}
              disabled={plan === 'author' || plan === 'team'}
              className="w-full py-2.5 bg-amber-500 text-black font-semibold rounded-xl hover:bg-amber-600 transition disabled:opacity-50 cursor-pointer"
            >
              {plan === 'author' ? 'Current Plan' : plan === 'team' ? 'Already Upgraded' : 'Get Author Plan'}
            </button>
          </div>

          {/* Team Plan */}
          <div className={`p-6 rounded-2xl border ${targetPlan === 'team' ? 'border-orange-500 bg-orange-500/5' : 'border-white/5 bg-white/[0.01]'} flex flex-col justify-between`}>
            <div>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold text-white">Team Plan</h3>
                  <p className="text-neutral-400 text-xs mt-1">For teams writing and co-editing together</p>
                </div>
                <span className="px-2.5 py-1 bg-orange-500/10 text-orange-400 rounded-full text-xs font-semibold uppercase">10 Seats</span>
              </div>
              <div className="text-3xl font-extrabold mb-4">$99.99<span className="text-neutral-400 text-sm font-normal"> / month</span></div>
              <ul className="space-y-2.5 mb-6 text-sm text-neutral-300">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-orange-500" /> Real-time Yjs Collaboration</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-orange-500" /> 10 Seats Included (Owner + 9 Guests)</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-orange-500" /> Owner's seat covers all invited guests</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-orange-500" /> Custom role & permission management</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-orange-500" /> Everything in Author Plan</li>
              </ul>
            </div>
            <button
              onClick={async () => {
                await upgradeToTeam();
                setIsOpen(false);
              }}
              disabled={plan === 'team'}
              className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-amber-700 transition disabled:opacity-50 cursor-pointer"
            >
              {plan === 'team' ? 'Current Plan' : 'Get Team Plan'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-neutral-500">
          Subscriptions renew automatically. You can cancel or manage your plan details at any time via the settings panel.
        </p>
      </div>
    </div>
  );
}
