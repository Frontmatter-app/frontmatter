import { User } from '../types';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Action = 'view' | 'create' | 'rename' | 'delete' | 'move';

const ROLE_PERMISSIONS: Record<Role, Action[]> = {
  owner: ['view', 'create', 'rename', 'delete', 'move'],
  admin: ['view', 'create', 'rename', 'delete', 'move'],
  editor: ['view', 'create', 'rename', 'move'],
  viewer: ['view'],
};

export function checkPermission(
  user: User | null,
  action: Action,
  path?: string
): boolean {
  if (!user) {
    return true;
  }

  const role: Role = (user.role as Role) || 'owner';
  const allowedActions = ROLE_PERMISSIONS[role];
  if (!allowedActions || !allowedActions.includes(action)) {
    return false;
  }

  if (path && user.restricted_paths) {
    const isRestricted = user.restricted_paths.some((restrictedPath) =>
      path.startsWith(restrictedPath)
    );
    if (isRestricted) {
      if (role !== 'owner' && role !== 'admin') {
        return false;
      }
    }
  }

  return true;
}
