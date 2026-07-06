import { guardTeamAuth, guardTeamPermission } from '../auth/permissionGuards';
import type { EffectiveTeamPermissions } from '../auth/teamPermissions';

export const canCreateInCurrentContext = async (
  isTeamContext: boolean,
  user: unknown,
  teamPerms: EffectiveTeamPermissions,
): Promise<boolean> => {
  if (!(await guardTeamAuth(isTeamContext, user, 'create files in a team workspace.'))) return false;
  if (!(await guardTeamPermission(isTeamContext, teamPerms.createFiles, 'create files'))) return false;
  return true;
};

export const canOpenLocalInCurrentContext = async (
  isTeamContext: boolean,
  user: unknown,
  teamPerms: EffectiveTeamPermissions,
): Promise<boolean> => {
  if (!(await guardTeamAuth(isTeamContext, user, 'open local files in a team workspace.'))) return false;
  if (!(await guardTeamPermission(isTeamContext, teamPerms.openLocalFiles, 'open local files'))) return false;
  return true;
};

export const canAddLocalToCurrentTeam = async (
  isTeamContext: boolean,
  user: unknown,
  teamPerms: EffectiveTeamPermissions,
): Promise<boolean> => {
  if (!(await guardTeamAuth(isTeamContext, user, 'add files to a team workspace.'))) return false;
  if (!(await guardTeamPermission(isTeamContext, teamPerms.addToTeam, 'add files to the team'))) return false;
  return true;
};
