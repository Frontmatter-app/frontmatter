import React, { useEffect, useState } from 'react';
import { useData } from '../data/DataProvider';
import { usePlan } from '../billing/PlanProvider';
import { Shield, X, Eye, Edit3, RotateCcw } from 'lucide-react';
import type { TeamGroupsMap, FilePermissions } from '../auth/teamPermissions';


interface FilePermissionsModalProps {
  docId: string;
  docTitle?: string;
  isOpen: boolean;
  onClose: () => void;
}

interface PermissionState {
  visibleTo: string[];
  writableBy: string[];
  revisableBy: string[];
}

function GroupCheckboxList({
  label,
  icon,
  description,
  groups,
  selected,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  description: string;
  groups: TeamGroupsMap;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const groupEntries = Object.entries(groups);
  const allSelected = selected.length === 0;

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[var(--editor-text-color)] opacity-60">{icon}</span>
        <span className="text-xs font-bold text-[var(--editor-text-color)] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[11px] text-[var(--editor-text-color)] opacity-50 mb-3">{description}</p>

      {/* "All groups" option */}
      <label className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition mb-1">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onChange([])}
          className="w-3.5 h-3.5 accent-blue-500"
        />
        <span className="text-xs text-[var(--editor-text-color)] italic opacity-70">All groups (no restriction)</span>
      </label>

      {groupEntries.map(([id, group]) => (
        <label key={id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition">
          <input
            type="checkbox"
            checked={!allSelected && selected.includes(id)}
            onChange={() => toggle(id)}
            className="w-3.5 h-3.5 accent-blue-500"
          />
          <span className="text-xs text-[var(--editor-text-color)]">{group.name}</span>
          <span className="ml-auto text-[10px] text-[var(--editor-text-color)] opacity-40">{group.members.length} member{group.members.length !== 1 ? 's' : ''}</span>
        </label>
      ))}

      {groupEntries.length === 0 && (
        <p className="text-[11px] text-[var(--editor-text-color)] opacity-40 italic px-2">No groups created yet.</p>
      )}
    </div>
  );
}

export function FilePermissionsModal({ docId, docTitle, isOpen, onClose }: FilePermissionsModalProps) {
  const { teamDoc, activeContext } = usePlan();
  const { cloudDocuments } = useData();
  const [perms, setPerms] = useState<PermissionState>({ visibleTo: [], writableBy: [], revisableBy: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const groups: TeamGroupsMap = teamDoc?.groups ?? {};

  // Load existing permissions
  useEffect(() => {
    if (!isOpen || !docId) return;
    setLoaded(false);
    setError('');
    cloudDocuments
      .getFilePermissions(docId)
      .then(fp => {
        setPerms({
          visibleTo: fp?.visibleTo ?? [],
          writableBy: fp?.writableBy ?? [],
          revisableBy: fp?.revisableBy ?? [],
        });
        setLoaded(true);
      })
      .catch(e => { setError(e.message); setLoaded(true); });
  }, [isOpen, docId, cloudDocuments]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const allClear = perms.visibleTo.length === 0 && perms.writableBy.length === 0 && perms.revisableBy.length === 0;
      await cloudDocuments.setFilePermissions(docId, allClear ? null : perms);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{
          background: 'var(--editor-secondary-bg, #1a1a1a)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-white/8">
          <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/25 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4.5 h-4.5 text-purple-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--editor-text-color)]">File Permissions</h2>
            <p className="text-[11px] text-[var(--editor-text-color)] opacity-50 truncate">{docTitle || 'Untitled'}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer text-[var(--editor-text-color)] opacity-50 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[65vh] overflow-y-auto">
          {!loaded ? (
            <div className="text-xs text-[var(--editor-text-color)] opacity-50 text-center py-8">Loading permissions…</div>
          ) : (
            <>
              <p className="text-[11px] text-[var(--editor-text-color)] opacity-50 mb-5 leading-relaxed">
                Restrict which groups can see, write to, or revise this file. Leave all unchecked to allow all groups.
              </p>

              <GroupCheckboxList
                label="Visible To"
                icon={<Eye className="w-3.5 h-3.5" />}
                description="Which groups can see this file in the sidebar."
                groups={groups}
                selected={perms.visibleTo}
                onChange={v => setPerms(p => ({ ...p, visibleTo: v }))}
              />

              <GroupCheckboxList
                label="Can Write"
                icon={<Edit3 className="w-3.5 h-3.5" />}
                description="Which groups can edit the content of this file."
                groups={groups}
                selected={perms.writableBy}
                onChange={v => setPerms(p => ({ ...p, writableBy: v }))}
              />

              <GroupCheckboxList
                label="Can Revise"
                icon={<Shield className="w-3.5 h-3.5" />}
                description="Which groups can use Revise mode on this file."
                groups={groups}
                selected={perms.revisableBy}
                onChange={v => setPerms(p => ({ ...p, revisableBy: v }))}
              />

              {error && (
                <p className="text-xs text-red-400 mt-2">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-white/8">
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[var(--editor-text-color)] opacity-60 hover:opacity-100 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !loaded}
            className="px-5 py-2 bg-purple-500 hover:bg-purple-600 text-white text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-50 shadow-lg shadow-purple-500/20"
          >
            {saving ? 'Saving…' : 'Save Permissions'}
          </button>
        </div>
      </div>
    </div>
  );
}
