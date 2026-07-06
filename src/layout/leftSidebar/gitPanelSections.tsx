import React from 'react';
import { GitBranch, Check, Plus, Link, ChevronDown, ChevronRight, X } from 'lucide-react';

interface BranchSectionProps {
  branchSectionOpen: boolean;
  setBranchSectionOpen: (v: boolean) => void;
  currentBranch: string;
  branches: { name: string; current: boolean }[];
  canBranch: boolean;
  newBranchName: string;
  setNewBranchName: (v: string) => void;
  onSwitchBranch: (name: string) => void;
  onCreateBranch: () => void;
}

export function BranchSection(props: BranchSectionProps) {
  const { branchSectionOpen, setBranchSectionOpen, currentBranch, branches,
    canBranch, newBranchName, setNewBranchName, onSwitchBranch, onCreateBranch } = props;
  return (
    <div className="flex flex-col">
      <button
        onClick={() => { setBranchSectionOpen(!branchSectionOpen); }}
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
              <button key={b.name} onClick={() => onSwitchBranch(b.name)} disabled={b.current}
                className="flex items-center justify-between w-full text-[10px] text-left text-gray-600 hover:text-gray-900 py-0.5 disabled:text-blue-600 disabled:font-semibold cursor-pointer"
              >
                <span>{b.name}</span>
                {b.current && <Check className="w-3 h-3 text-blue-500" />}
              </button>
            ))}
          </div>
          {canBranch && (
            <div className="flex gap-1 border-t border-gray-100 pt-1.5 mt-1">
              <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onCreateBranch(); }} placeholder="New branch..."
                className="flex-1 px-1.5 py-0.5 text-[10px] border border-gray-200 rounded focus:outline-none focus:border-blue-400" />
              <button onClick={onCreateBranch}
                className="px-1.5 py-0.5 bg-gray-900 hover:bg-gray-800 text-white rounded text-[9px] font-medium cursor-pointer"
              >Create</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RemoteSectionProps {
  remoteExists: boolean; remoteSectionOpen: boolean; setRemoteSectionOpen: (v: boolean) => void;
  addRemoteUrl: string; setAddRemoteUrl: (v: string) => void; addingRemote: boolean; onAddRemote: () => void;
  needsPull: boolean; needsPush: boolean; behindCount: number; aheadCount: number;
  canPull: boolean; canPush: boolean; isTeamContext: boolean;
  isPulling: boolean; isPushing: boolean; onPull: () => void; onPush: () => void;
}

export function RemoteSection(props: RemoteSectionProps) {
  const { remoteExists, remoteSectionOpen, setRemoteSectionOpen, addRemoteUrl, setAddRemoteUrl,
    addingRemote, onAddRemote, needsPull, needsPush, behindCount, aheadCount,
    canPull, canPush, isTeamContext, isPulling, isPushing, onPull, onPush } = props;
  if (remoteExists) {
    if (!needsPull && !needsPush) return null;
    return (
      <div className="flex items-center justify-between py-1 bg-gray-50/50 px-2 rounded-lg border border-gray-100">
        <span className="text-[11px] text-gray-500 font-medium">Sync: {needsPull && `↓ ${behindCount}`} {needsPush && `↑ ${aheadCount}`}</span>
        <div className="flex gap-1.5">
          {needsPull && canPull && <button onClick={onPull} disabled={isPulling} className="px-2 py-1 bg-white border border-gray-200 hover:bg-gray-50 rounded text-[10px] font-semibold text-gray-700 cursor-pointer">{isPulling ? '...' : 'Pull'}</button>}
          {needsPush && canPush && <button onClick={onPush} disabled={isPushing} className="px-2 py-1 bg-gray-900 hover:bg-gray-800 text-white rounded text-[10px] font-semibold cursor-pointer">{isPushing ? '...' : 'Push'}</button>}
        </div>
      </div>
    );
  }
  if (isTeamContext) return null;
  return (
    <div className="flex flex-col">
      <button onClick={() => { setRemoteSectionOpen(!remoteSectionOpen); }}
        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 cursor-pointer font-medium">
        <Plus className="w-3 h-3" /><Link className="w-3 h-3 text-gray-400" /><span>Set Remote Repository</span>
      </button>
      {remoteSectionOpen && (
        <div className="flex gap-1.5 mt-1.5 pl-5 bg-gray-50/50 p-2 rounded-md border border-gray-100">
          <input value={addRemoteUrl} onChange={e => setAddRemoteUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onAddRemote(); }} placeholder="https://github.com/user/repo.git"
            className="flex-1 px-2 py-1 text-[10px] border border-gray-200 rounded focus:outline-none focus:border-blue-400" />
          <button onClick={onAddRemote} disabled={addingRemote || !addRemoteUrl.trim()}
            className="px-2 py-1 bg-gray-900 hover:bg-gray-800 text-white rounded text-[10px] font-medium cursor-pointer">
            {addingRemote ? '...' : 'Add'}
          </button>
        </div>
      )}
    </div>
  );
}

interface ChangesSectionProps {
  changesOpen: boolean; setChangesOpen: (v: boolean) => void;
  staged: { path: string }[]; unstaged: { path: string }[];
  hasChanges: boolean; hasStaged: boolean; canCommit: boolean;
  commitMessage: string; setCommitMessage: (v: string) => void;
  commitAction: 'commit' | 'commit_push'; setCommitAction: (v: 'commit' | 'commit_push') => void;
  commitDropdownOpen: boolean; setCommitDropdownOpen: (v: boolean) => void;
  isCommitting: boolean; isPushing: boolean;
  onStageAll: (e: React.MouseEvent) => void; onUnstageAll: (e: React.MouseEvent) => void;
  onStageFile: (path: string) => void; onUnstageFile: (path: string) => void; onCommit: () => void;
}

export function ChangesSection(props: ChangesSectionProps) {
  const { changesOpen, setChangesOpen, staged, unstaged, hasChanges, hasStaged,
    canCommit, commitMessage, setCommitMessage, commitAction, setCommitAction,
    commitDropdownOpen, setCommitDropdownOpen, isCommitting, isPushing,
    onStageAll, onUnstageAll, onStageFile, onUnstageFile, onCommit } = props;
  return (
    <div className="flex flex-col">
      <div onClick={() => setChangesOpen(!changesOpen)}
        className="flex items-center justify-between w-full py-1 hover:bg-black/5 rounded-md px-1 transition-colors cursor-pointer select-none">
        <div className="flex items-center gap-1.5 font-medium text-gray-700">
          {changesOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
          <span>Changes</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-semibold">{staged.length + unstaged.length}</span>
          {unstaged.length > 0 && <button onClick={onStageAll} title="Stage All" className="text-gray-400 hover:text-gray-600 cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>}
          {staged.length > 0 && <button onClick={onUnstageAll} title="Unstage All" className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>
      {changesOpen && hasChanges && (
        <div className="flex flex-col gap-1.5 mt-1.5 pl-2">
          {staged.map(entry => (
            <div key={entry.path} className="flex items-center justify-between py-0.5 group">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                <span className="text-[11px] text-gray-700 truncate">{entry.path}</span>
              </div>
              <button onClick={() => onUnstageFile(entry.path)} className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer opacity-0 group-hover:opacity-100">Unstage</button>
            </div>
          ))}
          {unstaged.map(entry => (
            <div key={entry.path} className="flex items-center justify-between py-0.5 group">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                <span className="text-[11px] text-gray-600 truncate">{entry.path}</span>
              </div>
              <button onClick={() => onStageFile(entry.path)} className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer opacity-0 group-hover:opacity-100">Stage</button>
            </div>
          ))}
        </div>
      )}
      {hasStaged && canCommit && (
        <div className="flex flex-col gap-1.5 mt-1">
          <input value={commitMessage} onChange={e => setCommitMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onCommit(); }} placeholder="Commit message..."
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-blue-400" />
          <div className="relative flex w-full">
            <button onClick={onCommit} disabled={isCommitting || isPushing || !commitMessage.trim()}
              className="flex-1 bg-gray-900 hover:bg-gray-800 text-white text-[11px] font-medium py-1.5 px-3 rounded-l-md disabled:opacity-50 transition cursor-pointer text-center">
              {isCommitting || isPushing ? 'Processing...' : (commitAction === 'commit' ? 'Commit' : 'Commit & Push')}
            </button>
            <button onClick={() => setCommitDropdownOpen(!commitDropdownOpen)}
              className="bg-gray-900 hover:bg-gray-800 text-white border-l border-gray-800 px-2 rounded-r-md transition cursor-pointer flex items-center justify-center">
              <ChevronDown className="w-3 h-3" />
            </button>
            {commitDropdownOpen && (
              <div className="absolute right-0 bottom-full mb-1 bg-white border border-gray-200 rounded-md shadow-lg z-30 py-1 w-36 text-xs">
                <button onClick={() => { setCommitAction('commit'); setCommitDropdownOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 cursor-pointer ${commitAction === 'commit' ? 'font-semibold text-blue-600' : 'text-gray-700'}`}>Commit</button>
                <button onClick={() => { setCommitAction('commit_push'); setCommitDropdownOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 cursor-pointer ${commitAction === 'commit_push' ? 'font-semibold text-blue-600' : 'text-gray-700'}`}>Commit & Push</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
