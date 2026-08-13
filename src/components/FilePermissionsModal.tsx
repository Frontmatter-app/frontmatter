import React, { useEffect, useState } from 'react';
import { Edit3, Eye, Shield } from 'lucide-react';
import { useData } from '../data/DataProvider';
import { usePlan } from '../billing/PlanProvider';
import { DsButton, DsModal, DsToggle } from '../design/components';
import type { TeamGroupsMap } from '../auth/teamPermissions';
import './filePermissionsModal.css';

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

const EMPTY: PermissionState = { visibleTo: [], writableBy: [], revisableBy: [] };

/** True when no list restricts anything, i.e. the file is open to everyone. */
export function isUnrestricted(perms: PermissionState): boolean {
  return (
    perms.visibleTo.length === 0 &&
    perms.writableBy.length === 0 &&
    perms.revisableBy.length === 0
  );
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function GroupToggles({
  title,
  description,
  icon,
  groups,
  selected,
  onChange,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  groups: TeamGroupsMap;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const entries = Object.entries(groups);

  return (
    <section className="permissions__section">
      <header className="permissions__section-header">
        <span className="permissions__section-icon">{icon}</span>
        <div>
          <h3 className="permissions__section-title">{title}</h3>
          <p className="permissions__section-description">{description}</p>
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="permissions__empty">This team has no groups yet.</p>
      ) : (
        <ul className="permissions__groups">
          {entries.map(([id, group]) => (
            <li key={id} className="permissions__group">
              <span className="permissions__group-name">{group.name}</span>
              <DsToggle
                checked={selected.includes(id)}
                onChange={() => onChange(toggle(selected, id))}
                label={`${group.name} — ${title}`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FilePermissionsModal({
  docId,
  docTitle,
  isOpen,
  onClose,
}: FilePermissionsModalProps) {
  const { teamDoc } = usePlan();
  const { cloudDocuments } = useData();

  const [perms, setPerms] = useState<PermissionState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups: TeamGroupsMap = (teamDoc?.groups as TeamGroupsMap) ?? {};

  useEffect(() => {
    if (!isOpen || !docId) return;
    let active = true;
    setLoaded(false);
    setError(null);

    void (async () => {
      try {
        const stored = await cloudDocuments.getFilePermissions(docId);
        if (!active) return;
        setPerms({
          visibleTo: stored?.visibleTo ?? [],
          writableBy: stored?.writableBy ?? [],
          revisableBy: stored?.revisableBy ?? [],
        });
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Could not load permissions.');
      } finally {
        if (active) setLoaded(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [isOpen, docId, cloudDocuments]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Clearing every list removes the restriction entirely.
      await cloudDocuments.setFilePermissions(docId, isUnrestricted(perms) ? null : perms);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save permissions.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DsModal
      open={isOpen}
      onClose={onClose}
      title="File permissions"
      subtitle={docTitle || 'Untitled'}
      dismissable={!saving}
      footer={
        <>
          <DsButton onClick={onClose} disabled={saving}>
            Cancel
          </DsButton>
          <DsButton variant="primary" onClick={handleSave} disabled={saving || !loaded}>
            {saving ? 'Saving…' : 'Save permissions'}
          </DsButton>
        </>
      }
    >
      {!loaded ? (
        <p className="permissions__empty">Loading permissions…</p>
      ) : (
        <>
          <p className="ds-hint" style={{ marginBottom: 'var(--ds-space-5)' }}>
            {isUnrestricted(perms)
              ? 'Everyone on the team can see and edit this file. Enable a group below to restrict it.'
              : 'Only the groups enabled below have access.'}
          </p>

          <GroupToggles
            title="Can see"
            description="Groups that see this file in the sidebar."
            icon={<Eye className="w-4 h-4" />}
            groups={groups}
            selected={perms.visibleTo}
            onChange={(visibleTo) => setPerms((p) => ({ ...p, visibleTo }))}
          />
          <GroupToggles
            title="Can edit"
            description="Groups that can change the contents."
            icon={<Edit3 className="w-4 h-4" />}
            groups={groups}
            selected={perms.writableBy}
            onChange={(writableBy) => setPerms((p) => ({ ...p, writableBy }))}
          />
          <GroupToggles
            title="Can revise"
            description="Groups that can use Revise mode."
            icon={<Shield className="w-4 h-4" />}
            groups={groups}
            selected={perms.revisableBy}
            onChange={(revisableBy) => setPerms((p) => ({ ...p, revisableBy }))}
          />

          {error && (
            <p className="ds-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </DsModal>
  );
}
