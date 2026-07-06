import React, { createContext, useContext } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { useTeamPermissions, EffectiveTeamPermissions } from '../auth/teamPermissions';
import { getCurrentUserName } from '../lib/userName';

interface SidebarContextValue {
  user: ReturnType<typeof useAuth>['user'];
  teamName: string | undefined;
  isTeamContext: boolean;
  isTeamOwner: boolean;
  isAuthor: boolean;
  teamPerms: EffectiveTeamPermissions;
  currentUserName: string;
}

const SidebarCtx = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { activeContext, isTeamOwner, isAuthor } = usePlan();
  const teamPerms = useTeamPermissions();

  const isTeamContext = activeContext.type === 'team';
  const teamName = activeContext.teamName;
  const currentUserName = getCurrentUserName(user);

  return (
    <SidebarCtx.Provider value={{ user, teamName, isTeamContext, isTeamOwner, isAuthor, teamPerms, currentUserName }}>
      {children}
    </SidebarCtx.Provider>);
}

export function useSidebarContext(): SidebarContextValue {
  const ctx = useContext(SidebarCtx);
  if (!ctx) throw new Error('useSidebarContext must be used within SidebarProvider');
  return ctx;
}
