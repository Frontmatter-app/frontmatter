import { showAlertDialog } from '../lib/tauriDialog';

export async function guardTeamAuth(
  isTeamContext: boolean,
  user: unknown,
  description: string,
): Promise<boolean> {
  if (isTeamContext && !user) {
    await showAlertDialog('Authentication Required', `Please sign in to ${description}.`);
    return false;
  }
  return true;
}

export async function guardTeamPermission(
  isTeamContext: boolean,
  hasPermission: boolean,
  actionName: string,
): Promise<boolean> {
  if (isTeamContext && !hasPermission) {
    await showAlertDialog(
      'Permission Denied',
      `You do not have permission to ${actionName} in this team workspace.`,
    );
    return false;
  }
  return true;
}
