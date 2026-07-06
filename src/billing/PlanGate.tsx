import React from 'react';
import { usePlan } from './PlanProvider';
import { Sparkles, ShieldCheck } from 'lucide-react';

interface PlanGateProps {
  requiredPlan: 'author' | 'team';
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function PlanGate({ requiredPlan, fallback, children }: PlanGateProps) {
  const { isAuthor, isTeam, isLoading } = usePlan();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-neutral-400 text-sm">
        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mr-2" />
        Verifying authorization...
      </div>
    );
  }

  const hasAccess = requiredPlan === 'author' ? isAuthor : isTeam;

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  // Premium glassmorphic upgrade prompt fallback
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl shadow-2xl max-w-md mx-auto my-6">
      <div className="p-3 bg-amber-500/10 rounded-full text-amber-400 mb-4 animate-pulse">
        {requiredPlan === 'team' ? <ShieldCheck className="w-8 h-8" /> : <Sparkles className="w-8 h-8" />}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">
        Unlock {requiredPlan === 'team' ? 'Real-Time Collaboration' : 'Cloud Sync'}
      </h3>
      <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
        This feature requires the{' '}
        <span className="text-amber-400 font-medium capitalize">
          {requiredPlan} Plan
        </span>
        . Upgrade now to sync your projects across all devices, switch accounts, and write with your team.
      </p>
      <button
        onClick={() => {
          // Open the upgrade modal or redirect to checkout
          const event = new CustomEvent('open-upgrade-modal', { detail: { plan: requiredPlan } });
          window.dispatchEvent(event);
        }}
        className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-black font-semibold text-sm rounded-xl transition duration-200 shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20 active:scale-95 cursor-pointer"
      >
        View Pricing Options
      </button>
    </div>
  );
}
