import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ChevronDown, RotateCcw, Trash2, GitBranch, FileText, Search, X, BookmarkPlus } from "lucide-react";
import { cn } from "../../lib/utils";
import { SnapshotMeta } from "../../types";
import { GitCommit } from "../../git/types";

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatWordCount(count?: number | null): string {
  if (count == null) return "";
  return `${count.toLocaleString()} words`;
}

interface HistoryPanelProps {
  stage: string;
  activeVersionId: string | null;
  snapshots: SnapshotMeta[];
  onSetActiveVersion: (id: string | null) => void;
  onRestore: (snapId: string) => void;
  onDelete: (snapId: string) => void;
  onClearHistory: () => void;
  onCreateSnapshot?: (label?: string) => void;
  gitCommits?: GitCommit[];
  onRestoreFromGit?: (commitHash: string) => void;
}

interface HistoryEntry {
  id: string;
  type: "local" | "git";
  label: string;
  sublabel: string;
  date: Date;
  isoDate: string;
  wordCount?: number | null;
  shortHash?: string;
  author?: string;
  data: SnapshotMeta | GitCommit;
}

export function HistoryPanel({
  stage, activeVersionId, snapshots,
  onSetActiveVersion, onRestore, onDelete, onClearHistory,
  onCreateSnapshot,
  gitCommits = [],
  onRestoreFromGit,
}: HistoryPanelProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; type: "local" | "git" } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIndexRef = useRef<number>(-1);

  if (stage !== "write" && stage !== "revise") return null;

  // ── Build merged history ──────────────────────────────────────────────────
  const localEntries = useMemo<HistoryEntry[]>(() =>
    snapshots.map((snap, i) => ({
      id: snap.id,
      type: "local" as const,
      label: snap.label || `Version ${snapshots.length - i}`,
      sublabel: `${formatRelativeTime(new Date(snap.created_at))}${snap.author ? ` · ${snap.author}` : ""}`,
      date: new Date(snap.created_at),
      isoDate: snap.created_at,
      wordCount: snap.word_count,
      author: snap.author,
      data: snap,
    })),
    [snapshots]
  );

  const gitEntries = useMemo<HistoryEntry[]>(() =>
    gitCommits.map(commit => ({
      id: commit.hash,
      type: "git" as const,
      label: commit.message,
      sublabel: `${commit.author} · ${formatRelativeTime(new Date(commit.date))}`,
      date: new Date(commit.date),
      isoDate: commit.date,
      shortHash: commit.shortHash,
      author: commit.author,
      data: commit,
    })),
    [gitCommits]
  );

  const mergedHistory = useMemo(() => {
    return [...localEntries, ...gitEntries].sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [localEntries, gitEntries]);

  const selectedEntry = activeVersionId === null ? null : mergedHistory.find(e => e.id === activeVersionId);
  const hasHistory = mergedHistory.length > 0;

  const filteredLocal = useMemo(() => {
    if (!searchQuery.trim()) return localEntries;
    const q = searchQuery.toLowerCase();
    return localEntries.filter(e => e.label.toLowerCase().includes(q) || e.sublabel.toLowerCase().includes(q));
  }, [localEntries, searchQuery]);

  const filteredGit = useMemo(() => {
    if (!searchQuery.trim()) return gitEntries;
    const q = searchQuery.toLowerCase();
    return gitEntries.filter(e => e.label.toLowerCase().includes(q) || e.sublabel.toLowerCase().includes(q));
  }, [gitEntries, searchQuery]);

  const filteredHistory = useMemo(() => [...filteredGit, ...filteredLocal], [filteredGit, filteredLocal]);

  useEffect(() => { selectedIndexRef.current = -1; }, [searchQuery]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showHistory) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndexRef.current = Math.min(selectedIndexRef.current + 1, filteredHistory.length - 1);
      const items = listRef.current?.querySelectorAll("[data-history-item]");
      items?.[selectedIndexRef.current]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndexRef.current = Math.max(selectedIndexRef.current - 1, 0);
      const items = listRef.current?.querySelectorAll("[data-history-item]");
      items?.[selectedIndexRef.current]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && selectedIndexRef.current >= 0 && selectedIndexRef.current < filteredHistory.length) {
      e.preventDefault();
      const entry = filteredHistory[selectedIndexRef.current];
      onSetActiveVersion(entry.id);
      setShowHistory(false);
    } else if (e.key === "Escape") {
      setShowHistory(false);
    }
  }, [showHistory, filteredHistory, onSetActiveVersion, onRestoreFromGit]);

  const renderEntry = (entry: HistoryEntry, idx: number) => {
    const isActive = activeVersionId === entry.id;
    return (
      <div
        key={entry.id}
        data-history-item
        onClick={() => {
          selectedIndexRef.current = idx;
          onSetActiveVersion(entry.id);
          setShowHistory(false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, id: entry.id, type: entry.type });
        }}
        className="px-3 py-2 text-xs border-b last:border-b-0 cursor-pointer select-none text-right flex items-start justify-end gap-2 transition"
        style={{
          borderColor: 'var(--editor-fenced-code-border, #d0d7de)',
          backgroundColor: isActive ? 'var(--editor-secondary-bg)' : 'transparent',
          color: isActive ? 'var(--editor-caret-color)' : 'var(--editor-text-color)',
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--editor-secondary-bg)'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
        title={entry.isoDate}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{entry.label}</div>
          <div className="flex items-center justify-end gap-1.5 mt-0.5 flex-wrap">
            {entry.type === "local" && entry.wordCount != null && (
              <span
                className="text-[9px] font-medium px-1 py-0.5 rounded"
                style={{
                  background: 'var(--editor-secondary-bg)',
                  color: 'var(--editor-deleted-text-color)',
                }}
              >
                {entry.wordCount.toLocaleString()} w
              </span>
            )}
            {entry.type === "git" && entry.shortHash && (
              <span
                className="text-[9px] font-mono font-medium px-1 py-0.5 rounded"
                style={{
                  background: 'rgba(124,58,237,0.08)',
                  color: '#7c3aed',
                }}
              >
                {entry.shortHash}
              </span>
            )}
            <span className="text-[10px]" style={{ color: 'var(--editor-deleted-text-color)' }}>
              {entry.sublabel}
            </span>
          </div>
        </div>
        <div className="flex-shrink-0 mt-0.5">
          {entry.type === "git" ? (
            <GitBranch className="w-3 h-3" style={{ color: '#7c3aed' }} />
          ) : (
            <FileText className="w-3 h-3" style={{ color: 'var(--editor-caret-color)' }} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1.5 mb-6 relative" style={{ color: 'var(--editor-text-color)' }}>
      <h4 className="text-[10px] font-bold tracking-wider text-right" style={{ color: 'var(--editor-deleted-text-color)' }}>
        History
      </h4>

      {/* Trigger button */}
      <button
        onClick={() => {
          setShowHistory(!showHistory);
          if (!showHistory) setTimeout(() => searchInputRef.current?.focus(), 50);
        }}
        className="flex items-center justify-end gap-1.5 w-full px-2.5 py-1.5 text-xs font-medium rounded-md transition"
        style={{ color: 'var(--editor-text-color)', border: '1px solid transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--editor-secondary-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <span className={cn("text-right", activeVersionId ? "font-semibold" : "")}
          style={{ color: activeVersionId ? 'var(--editor-caret-color)' : undefined }}
        >
          {selectedEntry ? selectedEntry.label : "Latest Version"}
        </span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 transition-transform flex-shrink-0", showHistory && "rotate-180")}
          style={{ color: 'var(--editor-deleted-text-color)' }}
        />
      </button>

      {/* Dropdown */}
      {showHistory && (
        <div
          className="absolute top-full left-0 right-0 mt-1 rounded-xl shadow-xl z-20 max-h-80 flex flex-col border"
          style={{
            backgroundColor: 'var(--editor-bg-color)',
            borderColor: 'var(--editor-fenced-code-border, #d0d7de)',
            color: 'var(--editor-text-color)',
          }}
          onKeyDown={handleKeyDown}
        >
          {/* Search */}
          <div
            className="px-2 py-1.5 border-b flex items-center gap-1.5"
            style={{ borderColor: 'var(--editor-fenced-code-border, #d0d7de)' }}
          >
            <Search className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--editor-deleted-text-color)' }} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history..."
              className="flex-1 text-xs bg-transparent border-none outline-none"
              style={{ color: 'var(--editor-text-color)' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="flex-shrink-0 p-0.5 rounded transition"
                style={{ color: 'var(--editor-deleted-text-color)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--editor-secondary-bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <X className="w-3 h-3" />
              </button>
            )}
            {/* This callback was accepted, destructured and never rendered, so
                naming a version was only ever possible for cloud documents —
                and named versions are the ones automatic pruning spares. */}
            {onCreateSnapshot && (
              <button
                onClick={() => { void onCreateSnapshot(); }}
                title="Save a named checkpoint of the current document"
                className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition"
                style={{ color: 'var(--editor-caret-color)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--editor-secondary-bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <BookmarkPlus className="w-3 h-3" /> Checkpoint
              </button>
            )}
          </div>

          {/* List */}
          <div ref={listRef} className="overflow-y-auto flex-1 max-h-60">
            {!hasHistory && !searchQuery && (
              <div className="px-3 py-4 text-[10px] text-right" style={{ color: 'var(--editor-deleted-text-color)' }}>
                <div className="font-medium mb-1">No history yet</div>
                <div className="opacity-70">
                  Versions are saved automatically as you edit
                  {onCreateSnapshot ? ", or save a named checkpoint above." : "."}
                </div>
              </div>
            )}

            {/* Latest Version (always shown) */}
            <div
              onClick={() => { onSetActiveVersion(null); setShowHistory(false); }}
              data-history-item
              className="px-3 py-2 text-xs border-b hover:bg-opacity-50 cursor-pointer font-semibold text-right transition"
              style={{
                borderColor: 'var(--editor-fenced-code-border, #d0d7de)',
                backgroundColor: activeVersionId === null ? 'var(--editor-secondary-bg)' : 'transparent',
                color: activeVersionId === null ? 'var(--editor-caret-color)' : 'var(--editor-text-color)',
              }}
            >
              <div className="font-medium">Latest Version (Current)</div>
              <div className="text-[10px] mt-0.5 opacity-60">Current document state</div>
            </div>

            {/* Git Commits section */}
            {filteredGit.length > 0 && (
              <>
                <div
                  className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider border-b flex items-center justify-end gap-1"
                  style={{
                    borderColor: 'var(--editor-fenced-code-border, #d0d7de)',
                    backgroundColor: 'var(--editor-secondary-bg)',
                    color: '#7c3aed',
                  }}
                >
                  <GitBranch className="w-2.5 h-2.5" />
                  Git Commits
                </div>
                {filteredGit.map((entry, idx) => renderEntry(entry, idx))}
              </>
            )}

            {/* Local Snapshots section */}
            {filteredLocal.length > 0 && (
              <>
                <div
                  className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider border-b flex items-center justify-end gap-1"
                  style={{
                    borderColor: 'var(--editor-fenced-code-border, #d0d7de)',
                    backgroundColor: 'var(--editor-secondary-bg)',
                    color: 'var(--editor-caret-color)',
                  }}
                >
                  <FileText className="w-2.5 h-2.5" />
                  Local Snapshots
                </div>
                {filteredLocal.map((entry, idx) => renderEntry(entry, filteredGit.length + idx))}
              </>
            )}

            {/* Empty search result */}
            {searchQuery && filteredHistory.length === 0 && (
              <div className="px-3 py-3 text-[10px] text-right" style={{ color: 'var(--editor-deleted-text-color)' }}>
                No matching history entries
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context menu — local */}
      {contextMenu && contextMenu.type === "local" && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setContextMenu(null)} />
          <div
            style={{
              position: "fixed",
              top: `${Math.min(contextMenu.y, window.innerHeight - 140)}px`,
              left: `${Math.min(contextMenu.x, window.innerWidth - 190)}px`,
              backgroundColor: 'var(--editor-bg-color)',
              borderColor: 'var(--editor-fenced-code-border, #d0d7de)',
              color: 'var(--editor-text-color)',
            }}
            onClick={(e) => e.stopPropagation()}
            className="border rounded-xl shadow-2xl p-1.5 z-[9999] flex flex-col gap-0.5 w-44 font-sans text-xs"
          >
            <button
              onClick={() => { onRestore(contextMenu.id); setContextMenu(null); }}
              className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-opacity-80 transition font-medium cursor-pointer"
              style={{ color: 'var(--editor-text-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--editor-secondary-bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restore Version
            </button>
            <button
              onClick={() => { onDelete(contextMenu.id); setContextMenu(null); }}
              className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg transition font-medium cursor-pointer"
              style={{ color: 'var(--editor-deleted-strike-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--editor-deleted-bg-color)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Version
            </button>
            <div className="h-px my-1" style={{ backgroundColor: 'var(--editor-fenced-code-border, #d0d7de)' }} />
            <button
              onClick={() => { onClearHistory(); setContextMenu(null); }}
              className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg transition font-medium cursor-pointer"
              style={{ color: 'var(--editor-deleted-strike-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--editor-deleted-bg-color)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear All History
            </button>
          </div>
        </>
      )}

      {/* Context menu — git */}
      {contextMenu && contextMenu.type === "git" && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setContextMenu(null)} />
          <div
            style={{
              position: "fixed",
              top: `${Math.min(contextMenu.y, window.innerHeight - 100)}px`,
              left: `${Math.min(contextMenu.x, window.innerWidth - 160)}px`,
              backgroundColor: 'var(--editor-bg-color)',
              borderColor: 'var(--editor-fenced-code-border, #d0d7de)',
              color: 'var(--editor-text-color)',
            }}
            onClick={(e) => e.stopPropagation()}
            className="border rounded-xl shadow-2xl p-1.5 z-[9999] flex flex-col gap-0.5 w-40 font-sans text-xs"
          >
            <button
              onClick={() => {
                if (confirm("Restore this file to the selected commit state? This will replace your current document content with the version from that commit.")) {
                  onRestoreFromGit?.(contextMenu.id);
                }
                setContextMenu(null);
              }}
              className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-opacity-80 transition font-medium cursor-pointer"
              style={{ color: 'var(--editor-text-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--editor-secondary-bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restore from commit
            </button>
          </div>
        </>
      )}
    </div>
  );
}