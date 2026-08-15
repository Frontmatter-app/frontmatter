import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { useAuth } from '../auth/AuthProvider';
import { db } from '../auth/firebase';
import { createCheckoutSession, createPortalSession } from './creemService';
import { create } from 'zustand';
import type { TeamGroupsMap } from '../auth/teamPermissions';
import { invoke } from '../filesystem/tauriCommands';


export type PlanType = 'free' | 'author' | 'team' | 'enterprise';
export type PlanStatus = 'active' | 'past_due' | 'canceled' | null;

export interface ActiveContextType {
  type: 'personal' | 'team';
  teamId?: string;
  teamName?: string;
}

interface PlanContextType {
  plan: PlanType;
  planStatus: PlanStatus;
  isAuthor: boolean;
  isTeam: boolean;
  isTeamOwner: boolean;
  teamId: string | null;
  isLoading: boolean;
  teamMemberships: string[];
  ownedTeamId: string | null;
  activeContext: ActiveContextType;
  teamDoc: { groups?: TeamGroupsMap; [key: string]: any } | null;
  switchWorkspace: (context: ActiveContextType) => Promise<void>;
  upgradeToAuthor: () => Promise<void>;
  upgradeToTeam: () => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

const PlanContext = createContext<PlanContextType>({
  plan: 'free',
  planStatus: null,
  isAuthor: false,
  isTeam: false,
  isTeamOwner: false,
  teamId: null,
  isLoading: true,
  teamMemberships: [],
  ownedTeamId: null,
  activeContext: { type: 'personal' },
  teamDoc: null,
  switchWorkspace: async () => {},
  upgradeToAuthor: async () => {},
  upgradeToTeam: async () => {},
  openBillingPortal: async () => {},
});

// No hardcoded fallbacks: the previous defaults were the exact inverse of the
// backend's, so an unconfigured build sent buyers to the wrong Creem product and
// the webhook then granted the wrong plan. Both sides now read the same env vars.
export const AUTHOR_PRODUCT_ID = import.meta.env.VITE_CREEM_AUTHOR_PRD_ID || '';
export const TEAM_PRODUCT_ID = import.meta.env.VITE_CREEM_TEAM_PRD_ID || '';

export const usePlanStore = create<{
  plan: PlanType;
  planStatus: PlanStatus;
  isAuthor: boolean;
  isTeam: boolean;
  isTeamOwner: boolean;
  teamId: string | null;
  activeContext: ActiveContextType;
  setPlanState: (state: {
    plan: PlanType;
    planStatus: PlanStatus;
    isAuthor: boolean;
    isTeam: boolean;
    isTeamOwner: boolean;
    teamId: string | null;
    activeContext: ActiveContextType;
  }) => void;
}>((set) => ({
  plan: 'free',
  planStatus: null,
  isAuthor: false,
  isTeam: false,
  isTeamOwner: false,
  teamId: null,
  activeContext: { type: 'personal' },
  setPlanState: (state) => set(state),
}));

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [plan, setPlan] = useState<PlanType>('free');
  const [planStatus, setPlanStatus] = useState<PlanStatus>(null);
  const [teamMemberships, setTeamMemberships] = useState<string[]>([]);
  const [ownedTeamId, setOwnedTeamId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [teamDoc, setTeamDoc] = useState<{ groups?: TeamGroupsMap; [key: string]: any } | null>(null);

  // Active Context State (Personal vs Team)
  // Priority: URL param (injected by Rust when opening a new workspace window) > localStorage
  const [activeContext, setActiveContext] = useState<ActiveContextType>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlCtx = params.get('workspace_context');
      if (urlCtx) return JSON.parse(urlCtx);
    } catch (e) {}
    const saved = localStorage.getItem('marktype_active_context');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return { type: 'personal' };
  });

  // Switching workspaces now happens in-place in the current window.
  const switchWorkspace = async (context: ActiveContextType) => {
    try {
      const lastWorkspace = await invoke<string | null>('get_last_workspace', {
        workspaceContextJson: JSON.stringify(context),
      });
      const workspaceToOpen = lastWorkspace || await invoke<string>('get_default_workspace', {
        workspaceContextJson: JSON.stringify(context),
      });

      const result = await invoke<{ path: string; is_valid: boolean } | null>('open_workspace', {
        path: workspaceToOpen,
      });

      if (result && result.is_valid) {
        setActiveContext(context);
      }
    } catch (e) {
      console.error('[PlanProvider] Failed to switch workspace in-place:', e);
      setActiveContext(context);
    }
  };

  // Persist active context
  useEffect(() => {
    localStorage.setItem('marktype_active_context', JSON.stringify(activeContext));
  }, [activeContext]);

  // Derived properties based on context
  const teamId = activeContext.type === 'team' ? activeContext.teamId || null : null;
  
  const isTeamOwner = activeContext.type === 'team'
    ? ownedTeamId === activeContext.teamId
    : plan === 'team' && planStatus === 'active';

  // The billing webhook normalises 'paid'/'completed' to 'active' before it
  // writes, so 'active' is the only status that grants entitlement.
  const hasPaidStatus = planStatus === 'active';

  const isAuthor =
    ((plan === 'author' || plan === 'team' || plan === 'enterprise') && hasPaidStatus) ||
    activeContext.type === 'team';

  const isTeam =
    ((plan === 'team' || plan === 'enterprise') && hasPaidStatus) ||
    activeContext.type === 'team';

  // Sync state to Zustand
  useEffect(() => {
    usePlanStore.getState().setPlanState({
      plan,
      planStatus,
      isAuthor,
      isTeam,
      isTeamOwner,
      teamId,
      activeContext,
    });
  }, [plan, planStatus, isAuthor, isTeam, isTeamOwner, teamId, activeContext]);

  // Subscribe to user Firestore data
  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      setPlan('free');
      setPlanStatus(null);
      setTeamMemberships([]);
      setOwnedTeamId(null);
      setActiveContext({ type: 'personal' });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const userDocRef = doc(db, 'users', user.id);
    const unsubscribeUser = onSnapshot(userDocRef, async (userSnap) => {
      if (!userSnap.exists()) {
        setPlan('free');
        setPlanStatus(null);
        setTeamMemberships([]);
        setOwnedTeamId(null);
        setIsLoading(false);
        return;
      }

      const userData = userSnap.data();
      const userPlan = (userData.plan as PlanType) || 'free';
      const userPlanStatus = (userData.planStatus as PlanStatus) || null;
      
      // Fallback migrating values
      const userMemberships: string[] = userData.teamMemberships || (userData.teamId ? [userData.teamId] : []);
      const userOwnedTeamId: string | null = userData.ownedTeamId || (userPlan === 'team' ? userData.teamId || null : null);

      setPlan(userPlan);
      setPlanStatus(userPlanStatus);
      setTeamMemberships(userMemberships);
      setOwnedTeamId(userOwnedTeamId);
      setIsLoading(false);
    }, (error) => {
      console.warn('Firestore user listen failed:', error);
      setPlan('free');
      setPlanStatus(null);
      setTeamMemberships([]);
      setOwnedTeamId(null);
      setIsLoading(false);
    });

    return () => unsubscribeUser();
  }, [user, authLoading]);

  // Subscribe to active team doc to expose groups and other team data
  useEffect(() => {
    if (activeContext.type !== 'team' || !activeContext.teamId) {
      setTeamDoc(null);
      return;
    }
    const teamRef = doc(db, 'teams', activeContext.teamId);
    const unsub = onSnapshot(teamRef, (snap) => {
      setTeamDoc(snap.exists() ? snap.data() : null);
    }, () => setTeamDoc(null));
    return () => unsub();
  }, [activeContext]);

  // Perform coverage checks on active team in background if user is member but not owner
  useEffect(() => {
    if (activeContext.type === 'team' && activeContext.teamId && ownedTeamId !== activeContext.teamId) {
      const checkTeamCoverage = async () => {
        try {
          const teamDocRef = doc(db, 'teams', activeContext.teamId!);
          const teamSnap = await getDoc(teamDocRef);
          if (teamSnap.exists()) {
            const teamData = teamSnap.data();
            const ownerId = teamData.ownerId;
            const ownerDocRef = doc(db, 'users', ownerId);
            const ownerSnap = await getDoc(ownerDocRef);
            if (ownerSnap.exists()) {
              const ownerData = ownerSnap.data();
              if (ownerData.plan !== 'team' || ownerData.planStatus !== 'active') {
                console.warn('[PlanProvider] Team owner subscription is inactive.');
              }
            }
          }
        } catch (e) {
          console.error('[PlanProvider] Failed to verify team coverage:', e);
        }
      };
      checkTeamCoverage();
    }
  }, [activeContext, ownedTeamId]);

  const upgradeToAuthor = async () => {
    if (!AUTHOR_PRODUCT_ID) throw new Error('VITE_CREEM_AUTHOR_PRD_ID is not configured.');
    await createCheckoutSession(AUTHOR_PRODUCT_ID);
  };

  const upgradeToTeam = async () => {
    if (!TEAM_PRODUCT_ID) throw new Error('VITE_CREEM_TEAM_PRD_ID is not configured.');
    await createCheckoutSession(TEAM_PRODUCT_ID);
  };

  const openBillingPortal = async () => {
    await createPortalSession();
  };

  return (
    <PlanContext.Provider
      value={{
        plan,
        planStatus,
        isAuthor,
        isTeam,
        isTeamOwner,
        teamId,
        isLoading,
        teamMemberships,
        ownedTeamId,
        activeContext,
        teamDoc,
        switchWorkspace,
        upgradeToAuthor,
        upgradeToTeam,
        openBillingPortal,
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}
