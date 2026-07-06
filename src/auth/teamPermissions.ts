/**
 * teamPermissions.ts
 *
 * Derives the current user's effective permissions within their active team
 * workspace by reading the groups map from the team document. Permissions are
 * the UNION of all groups the user belongs to — if any group allows it, they
 * can do it.
 */
import { useMemo } from 'react';
import { useAuth } from './AuthProvider';
import { usePlan } from '../billing/PlanProvider';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GroupPermissions {
  openLocalFiles: boolean;
  createFiles: boolean;
  createFolders: boolean;
  renameFiles: boolean;
  deleteFiles: boolean;
  export: boolean;
  addToTeam: boolean;
  offlineAccess: boolean;
  gitInit: boolean;
  gitCommit: boolean;
  gitPush: boolean;
  gitPull: boolean;
  gitBranch: boolean;
}

export interface TeamGroup {
  name: string;
  members: string[]; // UIDs
  permissions: GroupPermissions;
}

export interface TeamGroupsMap {
  [groupId: string]: TeamGroup;
}

export interface FilePermissions {
  visibleTo?: string[];   // groupIds — empty/absent = visible to all
  writableBy?: string[];  // groupIds — empty/absent = writable by all
  revisableBy?: string[]; // groupIds — empty/absent = revisable by all
}

export interface EffectiveTeamPermissions extends GroupPermissions {
  isTeamContext: boolean;
  isTeamOwner: boolean;
  myGroupIds: string[];
  canSeeFile: (filePerms?: FilePermissions) => boolean;
  canWriteFile: (filePerms?: FilePermissions) => boolean;
  canReviseFile: (filePerms?: FilePermissions) => boolean;
}

// ── Default permissions ────────────────────────────────────────────────────────

/** When in team context but no groups exist yet, team owners get full access */
const OWNER_PERMS: GroupPermissions = {
  openLocalFiles: true,
  createFiles: true,
  createFolders: true,
  renameFiles: true,
  deleteFiles: true,
  export: true,
  addToTeam: true,
  offlineAccess: true,
  gitInit: true,
  gitCommit: true,
  gitPush: true,
  gitPull: true,
  gitBranch: true,
};

const MEMBER_DEFAULT_PERMS: GroupPermissions = {
  openLocalFiles: false,
  createFiles: false,
  createFolders: false,
  renameFiles: false,
  deleteFiles: false,
  export: false,
  addToTeam: false,
  offlineAccess: true,
  gitInit: false,
  gitCommit: false,
  gitPush: false,
  gitPull: false,
  gitBranch: false,
};

const PERSONAL_PERMS: GroupPermissions = {
  openLocalFiles: true,
  createFiles: true,
  createFolders: true,
  renameFiles: true,
  deleteFiles: true,
  export: true,
  addToTeam: false,
  offlineAccess: true,
  gitInit: true,
  gitCommit: true,
  gitPush: true,
  gitPull: true,
  gitBranch: true,
};

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Returns the current user's effective team permissions.
 * Must be called inside PlanProvider and AuthProvider.
 */
export function useTeamPermissions(): EffectiveTeamPermissions {
  const { user } = useAuth();
  const { activeContext, isTeamOwner, teamDoc } = usePlan();

  return useMemo(() => {
    const isTeamContext = activeContext.type === 'team';
    const uid = user?.id ?? '';

    if (!isTeamContext) {
      return {
        ...PERSONAL_PERMS,
        isTeamContext: false,
        isTeamOwner: false,
        myGroupIds: [],
        canSeeFile: () => true,
        canWriteFile: () => true,
        canReviseFile: () => true,
      };
    }

    if (!user) {
      return {
        openLocalFiles: false,
        createFiles: false,
        createFolders: false,
        renameFiles: false,
        deleteFiles: false,
        export: false,
        addToTeam: false,
        offlineAccess: false,
        gitInit: false,
        gitCommit: false,
        gitPush: false,
        gitPull: false,
        gitBranch: false,
        isTeamContext: true,
        isTeamOwner: false,
        myGroupIds: [],
        canSeeFile: () => false,
        canWriteFile: () => false,
        canReviseFile: () => false,
      };
    }

    // Team owner always gets full access
    if (isTeamOwner) {
      return {
        ...OWNER_PERMS,
        isTeamContext: true,
        isTeamOwner: true,
        myGroupIds: ['__owner__'],
        canSeeFile: () => true,
        canWriteFile: () => true,
        canReviseFile: () => true,
      };
    }

    // Derive from groups map
    const groups: TeamGroupsMap = teamDoc?.groups ?? {};
    const myGroupIds = Object.entries(groups)
      .filter(([, g]) => g.members.includes(uid))
      .map(([id]) => id);

    // Union of all group permissions
    const effective: GroupPermissions =
      myGroupIds.length === 0
        ? { ...MEMBER_DEFAULT_PERMS }
        : {
            openLocalFiles: myGroupIds.some(id => groups[id]?.permissions.openLocalFiles),
            createFiles: myGroupIds.some(id => groups[id]?.permissions.createFiles),
            createFolders: myGroupIds.some(id => groups[id]?.permissions.createFolders),
            renameFiles: myGroupIds.some(id => groups[id]?.permissions.renameFiles),
            deleteFiles: myGroupIds.some(id => groups[id]?.permissions.deleteFiles),
            export: myGroupIds.some(id => groups[id]?.permissions.export),
            addToTeam: myGroupIds.some(id => groups[id]?.permissions.addToTeam),
            offlineAccess: myGroupIds.some(id => groups[id]?.permissions.offlineAccess),
            gitInit: myGroupIds.some(id => groups[id]?.permissions.gitInit),
            gitCommit: myGroupIds.some(id => groups[id]?.permissions.gitCommit),
            gitPush: myGroupIds.some(id => groups[id]?.permissions.gitPush),
            gitPull: myGroupIds.some(id => groups[id]?.permissions.gitPull),
            gitBranch: myGroupIds.some(id => groups[id]?.permissions.gitBranch),
          };

    /**
     * Returns true if the user can see the file.
     * If filePerms.visibleTo is empty/absent, everyone can see it.
     */
    const canSeeFile = (filePerms?: FilePermissions): boolean => {
      if (!filePerms?.visibleTo || filePerms.visibleTo.length === 0) return true;
      return myGroupIds.some(gid => filePerms.visibleTo!.includes(gid));
    };

    const canWriteFile = (filePerms?: FilePermissions): boolean => {
      if (!filePerms?.writableBy || filePerms.writableBy.length === 0) return true;
      return myGroupIds.some(gid => filePerms.writableBy!.includes(gid));
    };

    const canReviseFile = (filePerms?: FilePermissions): boolean => {
      if (!filePerms?.revisableBy || filePerms.revisableBy.length === 0) return true;
      return myGroupIds.some(gid => filePerms.revisableBy!.includes(gid));
    };

    return {
      ...effective,
      isTeamContext: true,
      isTeamOwner: false,
      myGroupIds,
      canSeeFile,
      canWriteFile,
      canReviseFile,
    };
  }, [activeContext, isTeamOwner, teamDoc, user]);
}
