import React, { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertCircle, GitBranch, Link, Plus, Check, X } from 'lucide-react';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { useGitStore } from '../../git/gitStore';
import { useGitStatus } from '../../git/useGitStatus';
import { useTeamPermissions } from '../../auth/teamPermissions';
import { useSettingsStore } from '../../settings/settingsStore';
import {
  initRepo, stageFiles, unstageFiles, commitChanges, pushChanges, pullChanges,
  getCurrentBranch, hasRemote, getGitBranches, checkoutBranch, createBranch,
  addRemote, getRemoteUrl,
} from '../../git/gitCommands';
import { showAlertDialog } from '../../lib/tauriDialog';

export function GitPanel() {
  const { workspacePath, currentDocumentId, documents } = useWorkspace();
  const store = useGitStore();

  const reportGitError = useCallback(async (action: string, error: any) => {
    const rawError = String(error);
    console.error(`[Git Control Error] Failed to ${action}:`, error);
    store.setError(rawError);

    let friendly = rawError;
    if (rawError.includes('nothing added to commit but untracked files present')) {
      friendly = 'You have untracked changes. Click the "+" button on your files under "Changes" to stage them before committing.';
    } else if (rawError.includes('no changes added to commit')) {
      friendly = 'No changes are currently staged for commit. Click the "+" button on your files under "Changes" to stage them.';
    } else if (rawError.includes('pathspec') && rawError.includes('did not match any files')) {
      friendly = 'No changes or matched pathspec found in the repository.';
    } else if (rawError.includes('could not resolve HEAD')) {
      friendly = 'No commits have been made to this repository yet.';
    } else if (rawError.includes('non-fast-forward') || rawError.includes('fetch first')) {
      friendly = 'Your local branch is behind. Please run Pull first to fetch remote updates.';
    }

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

  const canCommit = !isTeamContext || isTeamOwner || teamPerms.gitCommit;
  const canPush   = !isTeamContext || isTeamOwner || teamPerms.gitPush;
  const canPull   = !isTeamContext || isTeamOwner || teamPerms.gitPull;
  const canBranch = !isTeamContext || isTeamOwner || teamPerms.gitBranch;

  const loadGitInfo = useCallback(async () => {
    if (store.repoStatus !== 'repo' || !workspacePath) return;
    try {
      const b = await getCurrentBranch(workspacePath);
      setCurrentBranch(b);
      const bList = await getGitBranches(workspacePath);
      setBranches(bList);
      const exists = await hasRemote(workspacePath);
      setRemoteExists(exists);
      if (exists) {
        const url = await getRemoteUrl(workspacePath);
        setRemoteUrl(url);
      }
    } catch {}
  }, [store.repoStatus, workspacePath]);

  useEffect(() => {
    loadGitInfo();
  }, [loadGitInfo, store.status]);

  const stageFile = useCallback(async (filePath: string) => {
    if (!workspacePath) return;
    try {
      await stageFiles(workspacePath, [filePath]);
      store.setError(null);
      refresh();
    } catch (e) {
      reportGitError('Stage File', e);
    }
  }, [workspacePath, refresh, store, reportGitError]);

  const unstageFile = useCallback(async (filePath: string) => {
    if (!workspacePath) return;
    try {
      await unstageFiles(workspacePath, [filePath]);
      store.setError(null);
      refresh();
    } catch (e) {
      reportGitError('Unstage File', e);
    }
  }, [workspacePath, refresh, store, reportGitError]);

  const stageAll = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workspacePath) return;
    try {
      await stageFiles(workspacePath, []);
      store.setError(null);
      refresh();
    } catch (e) {
      reportGitError('Stage All', e);
    }
  }, [workspacePath, refresh, store, reportGitError]);

  const unstageAll = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workspacePath) return;
    try {
      await unstageFiles(workspacePath, []);
      store.setError(null);
      refresh();
    } catch (e) {
      reportGitError('Unstage All', e);
    }
  }, [workspacePath, refresh, store, reportGitError]);

  const handleCommitAction = async () => {
    if (!workspacePath || !commitMessage.trim() || !canCommit) return;
    store.setIsCommitting(true);
    try {
      await commitChanges(workspacePath, commitMessage.trim());
      setCommitMessage('');
      store.setError(null);
      if (commitAction === 'commit_push' && remoteExists && canPush) {
        store.setIsPushing(true);
        await pushChanges(workspacePath);
      }
      refresh();
    } catch (e) {
      reportGitError(commitAction === 'commit' ? 'Commit' : 'Commit & Push', e);
    } finally {
      store.setIsCommitting(false);
      store.setIsPushing(false);
    }
  };

  const push = async () => {
    if (!workspacePath || !canPush) return;
    store.setIsPushing(true);
    try {
      await pushChanges(workspacePath);
      store.setError(null);
      refresh();
    } catch (e) {
      reportGitError('Push', e);
    } finally {
      store.setIsPushing(false);
    }
  };

  const pull = async () => {
    if (!workspacePath || !canPull) return;
    store.setIsPulling(true);
    try {
      await pullChanges(workspacePath);
      store.setError(null);
      refresh();
    } catch (e) {
      reportGitError('Pull', e);
    } finally {
      store.setIsPulling(false);
    }
  };

  const handleSwitchBranch = async (name: string) => {
    if (!workspacePath) return;
    try {
      await checkoutBranch(workspacePath, name);
      setBranchSectionOpen(false);
      store.setError(null);
      loadGitInfo();
      refresh();
    } catch (e) {
      reportGitError('Switch Branch', e);
    }
  };

  const handleCreateBranch = async () => {
    if (!workspacePath || !newBranchName.trim()) return;
    try {
      await createBranch(workspacePath, newBranchName.trim());
      await checkoutBranch(workspacePath, newBranchName.trim());
      setNewBranchName('');
      setBranchSectionOpen(false);
      store.setError(null);
      loadGitInfo();
      refresh();
    } catch (e) {
      reportGitError('Create Branch', e);
    }
  };

  const handleAddRemote = async () => {
    if (!workspacePath || !addRemoteUrl.trim()) return;
    setAddingRemote(true);
    try {
      await addRemote(workspacePath, 'origin', addRemoteUrl.trim());
      setAddRemoteUrl('');
      setRemoteSectionOpen(false);
      store.setError(null);
      loadGitInfo();
      refresh();
    } catch (e) {
      reportGitError('Add Remote', e);
    } finally {
      setAddingRemote(false);
    }
  };

  if (!vc.enabled) return null;

  // ── Empty State ─────────────────────────────────────────────────────────────
  if (store.repoStatus === 'git-not-found' || store.repoStatus === 'not-repo') {
    if (isTeamContext && !isTeamOwner) return null;
    return (
      <div className="border-t border-gray-200/80 pt-4 mt-4 flex-shrink-0">
        <button
          onClick={async () => {
            if (!workspacePath) return;
            try { await initRepo(workspacePath); store.setRepoStatus('checking'); refresh(); } catch {}
          }}
          className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-gray-500 rounded-lg hover:bg-black/5 transition cursor-pointer"
        >
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
      {/* Main Collapsible Header */}
      <button
        onClick={() => setGitOpen(o => !o)}
        className="flex items-center justify-between w-full px-2 py-1 rounded-md hover:bg-black/5 transition cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {gitOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
          <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase">Version Control</span>
        </div>
      </button>

      {gitOpen && (
        <div className="flex flex-col pl-4 mt-2 gap-2 text-xs">
          {/* Error display */}
          {store.error && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-red-600 bg-red-50">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{store.error}</span>
            </div>
          )}

          {/* Branch Section */}
          <div className="flex flex-col">
            <button
              onClick={() => { setBranchSectionOpen(!branchSectionOpen); setRemoteSectionOpen(false); }}
              className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer text-[11px] font-medium"
            >
              <GitBranch className="w-3.5 h-3.5 text-gray-400" />
              <span>Branch: </span>
              <span className="font-semibold underline decoration-dotted">{currentBranch}</span>
            </button>

            {branchSectionOpen && (
              <div className="flex flex-col gap-1.5 mt-1.5 pl-5 bg-gray-50/50 p-2 rounded-md border border-gray-100">
                <div className="flex flex-col max-h-24 overflow-y-auto gap-1">
                  {branches.map(b => (
                    <button
                      key={b.name}
                      onClick={() => handleSwitchBranch(b.name)}
                      disabled={b.current}
                      className="flex items-center justify-between w-full text-[10px] text-left text-gray-600 hover:text-gray-900 py-0.5 disabled:text-blue-600 disabled:font-semibold cursor-pointer"
                    >
                      <span>{b.name}</span>
                      {b.current && <Check className="w-3 h-3 text-blue-500" />}
                    </button>
                  ))}
                </div>

                {canBranch && (
                  <div className="flex gap-1 border-t border-gray-100 pt-1.5 mt-1">
                    <input
                      value={newBranchName}
                      onChange={e => setNewBranchName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreateBranch(); }}
                      placeholder="New branch..."
                      className="flex-1 px-1.5 py-0.5 text-[10px] border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={handleCreateBranch}
                      className="px-1.5 py-0.5 bg-gray-900 hover:bg-gray-800 text-white rounded text-[9px] font-medium cursor-pointer"
                    >
                      Create
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sync / Remote Section */}
          {remoteExists ? (
            (needsPull || needsPush) && (
              <div className="flex items-center justify-between py-1 bg-gray-50/50 px-2 rounded-lg border border-gray-100">
                <span className="text-[11px] text-gray-500 font-medium">
                  Sync: {needsPull && `↓ ${behindCount}`} {needsPush && `↑ ${aheadCount}`}
                </span>
                <div className="flex gap-1.5">
                  {needsPull && canPull && (
                    <button onClick={pull} disabled={store.isPulling} className="px-2 py-1 bg-white border border-gray-200 hover:bg-gray-50 rounded text-[10px] font-semibold text-gray-700 cursor-pointer">
                      {store.isPulling ? '...' : 'Pull'}
                    </button>
                  )}
                  {needsPush && canPush && (
                    <button onClick={push} disabled={store.isPushing} className="px-2 py-1 bg-gray-900 hover:bg-gray-800 text-white rounded text-[10px] font-semibold cursor-pointer">
                      {store.isPushing ? '...' : 'Push'}
                    </button>
                  )}
                </div>
              </div>
            )
          ) : (
            !isTeamContext && (
              <div className="flex flex-col">
                <button
                  onClick={() => { setRemoteSectionOpen(!remoteSectionOpen); setBranchSectionOpen(false); }}
                  className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 cursor-pointer font-medium"
                >
                  <Plus className="w-3 h-3" />
                  <Link className="w-3 h-3 text-gray-400" />
                  <span>Set Remote Repository</span>
                </button>

                {remoteSectionOpen && (
                  <div className="flex gap-1.5 mt-1.5 pl-5 bg-gray-50/50 p-2 rounded-md border border-gray-100">
                    <input
                      value={addRemoteUrl}
                      onChange={e => setAddRemoteUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddRemote(); }}
                      placeholder="https://github.com/user/repo.git"
                      className="flex-1 px-2 py-1 text-[10px] border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={handleAddRemote}
                      disabled={addingRemote || !addRemoteUrl.trim()}
                      className="px-2 py-1 bg-gray-900 hover:bg-gray-800 text-white rounded text-[10px] font-medium cursor-pointer"
                    >
                      {addingRemote ? '...' : 'Add'}
                    </button>
                  </div>
                )}
              </div>
            )
          )}

          {/* Changes Collapsible */}
          <div className="flex flex-col">
            <div
              onClick={() => setChangesOpen(!changesOpen)}
              className="flex items-center justify-between w-full py-1 hover:bg-black/5 rounded-md px-1 transition-colors cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5 font-medium text-gray-700">
                {changesOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                <span>Changes</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-semibold">
                  {entries.length}
                </span>
                {unstaged.length > 0 && (
                  <button onClick={stageAll} title="Stage All" className="text-gray-400 hover:text-gray-600 cursor-pointer">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                {staged.length > 0 && (
                  <button onClick={unstageAll} title="Unstage All" className="text-gray-400 hover:text-gray-600 cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {changesOpen && hasChanges && (
              <div className="flex flex-col gap-1.5 mt-1.5 pl-2">
                {staged.map(entry => (
                  <div key={entry.path} className="flex items-center justify-between py-0.5 group">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      <span className="text-[11px] text-gray-700 truncate" title={entry.path}>{entry.path}</span>
                    </div>
                    <button onClick={() => unstageFile(entry.path)} className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                      Unstage
                    </button>
                  </div>
                ))}

                {unstaged.map(entry => (
                  <div key={entry.path} className="flex items-center justify-between py-0.5 group">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                      <span className="text-[11px] text-gray-600 truncate" title={entry.path}>{entry.path}</span>
                    </div>
                    <button onClick={() => stageFile(entry.path)} className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                      Stage
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Commit inputs (only shown when there are staged files) */}
          {hasStaged && canCommit && (
            <div className="flex flex-col gap-1.5 mt-1">
              <input
                value={commitMessage}
                onChange={e => setCommitMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCommitAction(); }}
                placeholder="Commit message..."
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
              />
              <div className="relative flex w-full">
                <button
                  onClick={handleCommitAction}
                  disabled={store.isCommitting || store.isPushing || !commitMessage.trim()}
                  className="flex-1 bg-gray-900 hover:bg-gray-800 text-white text-[11px] font-medium py-1.5 px-3 rounded-l-md disabled:opacity-50 transition cursor-pointer text-center"
                >
                  {store.isCommitting || store.isPushing ? 'Processing...' : (commitAction === 'commit' ? 'Commit' : 'Commit & Push')}
                </button>
                <button
                  onClick={() => setCommitDropdownOpen(!commitDropdownOpen)}
                  className="bg-gray-900 hover:bg-gray-800 text-white border-l border-gray-800 px-2 rounded-r-md transition cursor-pointer flex items-center justify-center"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>

                {commitDropdownOpen && (
                  <div className="absolute right-0 bottom-full mb-1 bg-white border border-gray-200 rounded-md shadow-lg z-30 py-1 w-36 text-xs">
                    <button
                      onClick={() => { setCommitAction('commit'); setCommitDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 cursor-pointer ${commitAction === 'commit' ? 'font-semibold text-blue-600' : 'text-gray-700'}`}
                    >
                      Commit
                    </button>
                    <button
                      onClick={() => { setCommitAction('commit_push'); setCommitDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 cursor-pointer ${commitAction === 'commit_push' ? 'font-semibold text-blue-600' : 'text-gray-700'}`}
                    >
                      Commit & Push
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
