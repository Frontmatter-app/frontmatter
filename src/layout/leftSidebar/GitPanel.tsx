import React, { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { useGitStore } from '../../git/gitStore';
import { useGitStatus } from '../../git/useGitStatus';
import { useTeamPermissions } from '../../auth/teamPermissions';
import { useSettingsStore } from '../../settings/settingsStore';
import { initRepo, stageFiles, unstageFiles, commitChanges, pushChanges, pullChanges,
  getCurrentBranch, hasRemote, getGitBranches, checkoutBranch, createBranch, addRemote, getRemoteUrl } from '../../git/gitCommands';
import { showAlertDialog } from '../../lib/tauriDialog';
import { BranchSection, RemoteSection, ChangesSection } from './gitPanelSections';

export function GitPanel() {
  const { workspacePath, currentDocumentId, documents } = useWorkspace();
  const store = useGitStore();
  const reportGitError = useCallback(async (action: string, error: any) => {
    const raw = String(error);
    console.error(`[Git] ${action} failed:`, error);
    store.setError(raw);
    let friendly = raw;
    if (raw.includes('nothing added to commit but untracked files present')) friendly = 'Stage your files before committing.';
    else if (raw.includes('no changes added to commit')) friendly = 'No changes staged for commit.';
    else if (raw.includes('pathspec') && raw.includes('did not match any files')) friendly = 'No matching files found.';
    else if (raw.includes('could not resolve HEAD')) friendly = 'No commits yet in this repository.';
    else if (raw.includes('non-fast-forward') || raw.includes('fetch first')) friendly = 'Your branch is behind. Pull first.';
    await showAlertDialog(`Git ${action} Failed`, friendly);
  }, [store]);
  const currentDoc = documents.find(d => d.id === currentDocumentId);
  const { settings } = useSettingsStore();
  const vc = settings.versionControl;
  const { refresh } = useGitStatus(workspacePath, currentDoc?.file_path || null);
  const teamPerms = useTeamPermissions();
  const isTeamOwner = teamPerms.isTeamOwner;
  const isTeamContext = teamPerms.isTeamContext;

  const [gitOpen, setGitOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(true);
  const [commitMessage, setCommitMessage] = useState('');
  const [currentBranch, setCurrentBranch] = useState('main');
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([]);
  const [branchSectionOpen, setBranchSectionOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [remoteExists, setRemoteExists] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteSectionOpen, setRemoteSectionOpen] = useState(false);
  const [addRemoteUrl, setAddRemoteUrl] = useState('');
  const [addingRemote, setAddingRemote] = useState(false);
  const [commitAction, setCommitAction] = useState<'commit' | 'commit_push'>('commit');
  const [commitDropdownOpen, setCommitDropdownOpen] = useState(false);

  const canInit   = !isTeamContext || isTeamOwner || teamPerms.gitInit;
  const canCommit = !isTeamContext || isTeamOwner || teamPerms.gitCommit;
  const canPush   = !isTeamContext || isTeamOwner || teamPerms.gitPush;
  const canPull   = !isTeamContext || isTeamOwner || teamPerms.gitPull;
  const canBranch = !isTeamContext || isTeamOwner || teamPerms.gitBranch;

  const loadGitInfo = useCallback(async () => {
    if (store.repoStatus !== 'repo' || !workspacePath) return;
    try {
      setCurrentBranch(await getCurrentBranch(workspacePath));
      setBranches(await getGitBranches(workspacePath));
      const exists = await hasRemote(workspacePath);
      setRemoteExists(exists);
      if (exists) setRemoteUrl(await getRemoteUrl(workspacePath));
    } catch {}
  }, [store.repoStatus, workspacePath]);

  useEffect(() => { loadGitInfo(); }, [loadGitInfo, store.status]);

  const stageFile = useCallback(async (fp: string) => {
    if (!workspacePath) return;
    try { await stageFiles(workspacePath, [fp]); store.setError(null); refresh(); }
    catch (e) { reportGitError('Stage File', e); }
  }, [workspacePath, refresh, store, reportGitError]);

  const unstageFile = useCallback(async (fp: string) => {
    if (!workspacePath) return;
    try { await unstageFiles(workspacePath, [fp]); store.setError(null); refresh(); }
    catch (e) { reportGitError('Unstage File', e); }
  }, [workspacePath, refresh, store, reportGitError]);

  const stageAll = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workspacePath) return;
    try { await stageFiles(workspacePath, []); store.setError(null); refresh(); }
    catch (e) { reportGitError('Stage All', e); }
  }, [workspacePath, refresh, store, reportGitError]);

  const unstageAll = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workspacePath) return;
    try { await unstageFiles(workspacePath, []); store.setError(null); refresh(); }
    catch (e) { reportGitError('Unstage All', e); }
  }, [workspacePath, refresh, store, reportGitError]);

  const handleCommitAction = async () => {
    if (!workspacePath || !commitMessage.trim() || !canCommit) return;
    store.setIsCommitting(true);
    try {
      await commitChanges(workspacePath, commitMessage.trim());
      setCommitMessage(''); store.setError(null);
      if (commitAction === 'commit_push' && remoteExists && canPush) {
        store.setIsPushing(true);
        await pushChanges(workspacePath);
      }
      refresh();
    } catch (e) { reportGitError(commitAction === 'commit' ? 'Commit' : 'Commit & Push', e); }
    finally { store.setIsCommitting(false); store.setIsPushing(false); }
  };

  const push = async () => {
    if (!workspacePath || !canPush) return;
    store.setIsPushing(true);
    try { await pushChanges(workspacePath); store.setError(null); refresh(); }
    catch (e) { reportGitError('Push', e); }
    finally { store.setIsPushing(false); }
  };

  const pull = async () => {
    if (!workspacePath || !canPull) return;
    store.setIsPulling(true);
    try { await pullChanges(workspacePath); store.setError(null); refresh(); }
    catch (e) { reportGitError('Pull', e); }
    finally { store.setIsPulling(false); }
  };

  const handleSwitchBranch = async (name: string) => {
    if (!workspacePath) return;
    try { await checkoutBranch(workspacePath, name); setBranchSectionOpen(false); store.setError(null); loadGitInfo(); refresh(); }
    catch (e) { reportGitError('Switch Branch', e); }
  };

  const handleCreateBranch = async () => {
    if (!workspacePath || !newBranchName.trim()) return;
    try {
      await createBranch(workspacePath, newBranchName.trim());
      await checkoutBranch(workspacePath, newBranchName.trim());
      setNewBranchName(''); setBranchSectionOpen(false); store.setError(null); loadGitInfo(); refresh();
    } catch (e) { reportGitError('Create Branch', e); }
  };

  const handleAddRemote = async () => {
    if (!workspacePath || !addRemoteUrl.trim()) return;
    setAddingRemote(true);
    try { await addRemote(workspacePath, 'origin', addRemoteUrl.trim()); setAddRemoteUrl(''); setRemoteSectionOpen(false); store.setError(null); loadGitInfo(); refresh(); }
    catch (e) { reportGitError('Add Remote', e); }
    finally { setAddingRemote(false); }
  };

  if (!vc.enabled) return null;

  if (store.repoStatus === 'git-not-found' || store.repoStatus === 'not-repo') {
    if (isTeamContext && !isTeamOwner && !canInit) return null;
    return (
      <div className="border-t border-gray-200/80 pt-4 mt-4 flex-shrink-0">
        <button onClick={async () => { if (!workspacePath) return; try { await initRepo(workspacePath); store.setRepoStatus('checking'); refresh(); } catch {} }}
          className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-gray-500 rounded-lg hover:bg-black/5 transition cursor-pointer">
          <span>Initialize Git Repository</span>
        </button>
      </div>
    );
  }

  if (store.repoStatus !== 'repo') return null;

  const status = store.status;
  const entries = status?.entries ?? [];
  const staged = entries.filter(e => e.staged);
  const unstaged = entries.filter(e => !e.staged);
  const hasChanges = entries.length > 0;
  const hasStaged = staged.length > 0;
  const aheadCount = status?.ahead ?? 0;
  const behindCount = status?.behind ?? 0;
  const needsPull = behindCount > 0;
  const needsPush = aheadCount > 0;

  return (
    <div className="border-t border-gray-200/80 pt-4 mt-4 flex-shrink-0 flex flex-col">
      <button onClick={() => setGitOpen(o => !o)}
        className="flex items-center justify-between w-full px-2 py-1 rounded-md hover:bg-black/5 transition cursor-pointer">
        <div className="flex items-center gap-2">
          {gitOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
          <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase">Version Control</span>
        </div>
      </button>
      {gitOpen && (
        <div className="flex flex-col pl-4 mt-2 gap-2 text-xs">
          {store.error && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-red-600 bg-red-50">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{store.error}</span>
            </div>
          )}
          <BranchSection {...{ branchSectionOpen, setBranchSectionOpen, currentBranch, branches, canBranch, newBranchName, setNewBranchName, onSwitchBranch: handleSwitchBranch, onCreateBranch: handleCreateBranch }} />
          <RemoteSection {...{ remoteExists, remoteSectionOpen, setRemoteSectionOpen, addRemoteUrl, setAddRemoteUrl, addingRemote, onAddRemote: handleAddRemote, needsPull, needsPush, behindCount, aheadCount, canPull, canPush, isTeamContext, isPulling: store.isPulling, isPushing: store.isPushing, onPull: pull, onPush: push }} />
          <ChangesSection {...{ changesOpen, setChangesOpen, staged, unstaged, hasChanges, hasStaged, canCommit, commitMessage, setCommitMessage, commitAction, setCommitAction, commitDropdownOpen, setCommitDropdownOpen, isCommitting: store.isCommitting, isPushing: store.isPushing, onStageAll: stageAll, onUnstageAll: unstageAll, onStageFile: stageFile, onUnstageFile: unstageFile, onCommit: handleCommitAction }} />
        </div>
      )}
    </div>
  );
}
