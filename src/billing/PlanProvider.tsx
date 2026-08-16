/**
 * Capability state for the app.
 *
 * Previously this subscribed to a Firestore user document and derived
 * `isAuthor` / `isTeam` from `plan` and `planStatus`. There is no Firestore any
 * more, and no plan to read: the open-source build has every capability.
 *
 * The context keeps its previous shape on purpose. Roughly forty modules read
 * `usePlan()` or `usePlanStore`, and rewriting them all to ask a different
 * question would be a large, risky diff that changes no behaviour — every one
 * of those checks now passes. The shape stays; what fills it is a constant.
 *
 * Team fields are present but empty. Teams return in the git-backed phase,
 * derived from repository collaborators and a checked-in
 * `.frontmatter/permissions.toml` rather than from a `teams` collection.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { create } from 'zustand';
import { getEntitlements } from './entitlements';
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
}

const PlanContext = createContext<PlanContextType>({
  plan: 'free',
  planStatus: null,
  isAuthor: true,
  isTeam: true,
  isTeamOwner: true,
  teamId: null,
  isLoading: false,
  teamMemberships: [],
  ownedTeamId: null,
  activeContext: { type: 'personal' },
  teamDoc: null,
  switchWorkspace: async () => {},
});

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
  // Non-React readers (DocumentRegistry, documentSync, the editor hooks) read
  // these synchronously, so they must be permissive from the first tick rather
  // than after an effect has run.
  isAuthor: true,
  isTeam: true,
  isTeamOwner: true,
  teamId: null,
  activeContext: { type: 'personal' },
  setPlanState: (state) => set(state),
}));

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const entitlements = getEntitlements();

  const [activeContext, setActiveContext] = useState<ActiveContextType>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('workspace_context');
      if (fromUrl) return JSON.parse(fromUrl);
    } catch {
      // Malformed parameter; fall through to storage.
    }
    const saved = localStorage.getItem('frontmatter_active_context');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Corrupt value; personal is the safe default.
      }
    }
    return { type: 'personal' };
  });

  useEffect(() => {
    localStorage.setItem('frontmatter_active_context', JSON.stringify(activeContext));
  }, [activeContext]);

  const isAuthor = entitlements.canSync;
  const isTeam = entitlements.canCollaborate;
  const teamId = activeContext.type === 'team' ? activeContext.teamId || null : null;

  useEffect(() => {
    usePlanStore.getState().setPlanState({
      plan: 'free',
      planStatus: null,
      isAuthor,
      isTeam,
      isTeamOwner: true,
      teamId,
      activeContext,
    });
  }, [isAuthor, isTeam, teamId, activeContext]);

  const switchWorkspace = async (context: ActiveContextType) => {
    try {
      const lastWorkspace = await invoke<string | null>('get_last_workspace', {
        workspaceContextJson: JSON.stringify(context),
      });
      const workspaceToOpen =
        lastWorkspace ||
        (await invoke<string>('get_default_workspace', {
          workspaceContextJson: JSON.stringify(context),
        }));

      const result = await invoke<{ path: string; is_valid: boolean } | null>('open_workspace', {
        path: workspaceToOpen,
      });

      if (result && result.is_valid) setActiveContext(context);
    } catch (error) {
      console.error('[PlanProvider] Could not switch workspace in place:', error);
      setActiveContext(context);
    }
  };

  return (
    <PlanContext.Provider
      value={{
        plan: 'free',
        planStatus: null,
        isAuthor,
        isTeam,
        isTeamOwner: true,
        teamId,
        isLoading: false,
        teamMemberships: [],
        ownedTeamId: null,
        activeContext,
        teamDoc: null,
        switchWorkspace,
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}
