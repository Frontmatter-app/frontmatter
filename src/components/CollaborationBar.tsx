import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { registry } from '../yjs/DocumentRegistry';
import { PresenceData } from '../cloud/firestoreYjsProvider';
import { useData } from '../data/DataProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMemberInfo {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  role: 'owner' | 'member';
  updatedAt?: Date | null;
}

interface MergedMember {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  role: 'owner' | 'member';
  isActive: boolean;
  isSelf: boolean;
  color: string;
  updatedAt?: Date | null;
}

function formatLastSeen(date: Date | null | undefined): string {
  if (!date) return 'Unknown';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({
  member,
  size = 26,
  onClick,
}: {
  member: MergedMember;
  size?: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  const initials = member.displayName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const borderColor = (member.isSelf || member.isActive)
    ? 'var(--editor-success, #22c55e)'
    : 'rgba(255,255,255,0.12)';

  const dimmed = !member.isActive && !member.isSelf;

  return (
    <button
      onClick={onClick}
      title={`${member.displayName}${member.isSelf ? ' (you)' : ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${borderColor}`,
        overflow: 'visible',
        flexShrink: 0,
        position: 'relative',
        cursor: 'pointer',
        padding: 0,
        background: 'transparent',
        opacity: dimmed ? 0.45 : 1,
        transition: 'opacity 0.2s ease, border-color 0.2s ease, transform 0.15s ease',
        boxShadow:
          member.isActive && !member.isSelf
            ? `0 0 0 1px rgba(0,0,0,0.4), 0 0 7px ${member.color}44`
            : '0 0 0 1px rgba(0,0,0,0.3)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.14)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
      aria-label={`${member.displayName} — ${member.isActive ? 'active' : 'offline'}`}
    >
      <div style={{ width: size - 4, height: size - 4, borderRadius: '50%', overflow: 'hidden' }}>
        {member.photoURL ? (
          <img
            src={member.photoURL}
            alt={member.displayName}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background:
                member.isActive && !member.isSelf
                  ? `linear-gradient(135deg, ${member.color}55, ${member.color}22)`
                  : member.isSelf
                  ? 'linear-gradient(135deg, color-mix(in srgb, var(--editor-success, #22c55e) 25%, transparent), color-mix(in srgb, var(--editor-success, #22c55e) 15%, transparent))'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
              fontSize: size * 0.33,
              fontWeight: 700,
              color: dimmed ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.88)',
              fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: '-0.5px',
            }}
          >
            {initials}
          </div>
        )}
      </div>

      {/* Green presence dot for self or active remote users */}
      {(member.isSelf || member.isActive) && (
        <span
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--editor-success, #22c55e)',
            border: '1.5px solid #18181b',
            pointerEvents: 'none',
            animation: member.isActive && !member.isSelf
              ? 'presence-pulse 2s ease-out infinite'
              : undefined,
          }}
        />
      )}
    </button>
  );
}

// ─── Info Popover ─────────────────────────────────────────────────────────────

function MemberPopover({
  member,
  anchor,
  onClose,
}: {
  member: MergedMember;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const top = anchor.bottom + 8;
  const right = window.innerWidth - anchor.right - 4;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top,
        right,
        zIndex: 9999,
        minWidth: 220,
        background: 'rgba(18,18,21,0.97)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.2)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        animation: 'collab-pop-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
      }}
    >
      {/* Avatar + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            overflow: 'hidden',
            border: `2px solid ${
              member.isSelf
                ? 'var(--editor-success, #22c55e)'
                : member.isActive
                ? member.color
                : 'rgba(255,255,255,0.13)'
            }`,
            flexShrink: 0,
          }}
        >
          {member.photoURL ? (
            <img
              src={member.photoURL}
              alt={member.displayName}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.05)',
                fontSize: 13,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.8)',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              {member.displayName
                .split(' ')
                .map((p) => p[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.90)',
              fontFamily: 'Inter, system-ui, sans-serif',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {member.displayName}
            {member.isSelf && (
              <span style={{ color: 'rgba(255,255,255,0.38)', fontWeight: 400 }}> (you)</span>
            )}
          </div>
          {member.email && (
            <div
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.38)',
                fontFamily: 'Inter, system-ui, sans-serif',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 1,
              }}
            >
              {member.email}
            </div>
          )}
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            padding: '3px 8px',
            borderRadius: 20,
            background:
              member.role === 'owner' ? 'rgba(251,146,60,0.13)' : 'rgba(255,255,255,0.06)',
            color: member.role === 'owner' ? '#fb923c' : 'rgba(255,255,255,0.45)',
            border:
              member.role === 'owner'
                ? '1px solid rgba(251,146,60,0.22)'
                : '1px solid rgba(255,255,255,0.07)',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {member.role === 'owner' ? '✦ Owner' : 'Member'}
        </span>

        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            padding: '3px 8px',
            borderRadius: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background:
              member.isActive || member.isSelf
                ? 'color-mix(in srgb, var(--editor-success, #22c55e) 11%, transparent)'
                : 'rgba(255,255,255,0.04)',
            color:
              member.isActive || member.isSelf ? 'var(--editor-success, #4ade80)' : 'rgba(255,255,255,0.28)',
            border:
              member.isActive || member.isSelf
                ? '1px solid color-mix(in srgb, var(--editor-success, #22c55e) 18%, transparent)'
                : '1px solid rgba(255,255,255,0.06)',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              display: 'inline-block',
              background:
                member.isActive || member.isSelf
                  ? 'var(--editor-success, #4ade80)'
                  : 'rgba(255,255,255,0.22)',
            }}
          />
          {member.isActive || member.isSelf ? 'Active' : 'Offline'}
        </span>
      </div>

      {/* Activity Status / Last Seen */}
      <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
          Activity Status
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 4, fontFamily: 'Inter, system-ui, sans-serif' }}>
          {member.isActive || member.isSelf ? (
            <span style={{ color: 'var(--editor-success, #4ade80)', fontWeight: 500 }}>Online now</span>
          ) : (
            <span>Last active: <span style={{ color: 'rgba(255,255,255,0.9)' }}>{formatLastSeen(member.updatedAt)}</span></span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CollaborationBar({ documentId }: { documentId?: string | null }) {
  const { currentDocumentId } = useWorkspace();
  const { user } = useAuth();
  const { teamId, activeContext } = usePlan();
  const { teams, users } = useData();

  const docId = documentId ?? currentDocumentId;

  const [presence, setPresence] = useState<PresenceData[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberInfo[]>([]);
  const [selectedMember, setSelectedMember] = useState<{
    member: MergedMember;
    rect: DOMRect;
  } | null>(null);

  // ── Live presence ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!docId) {
      setPresence([]);
      return;
    }
    let unsub: (() => void) | null = null;
    let retries = 0;

    const setup = () => {
      const provider = registry.getProvider(docId);
      if (provider) {
        unsub = provider.onPresence((list) => setPresence(list));
      } else if (retries < 8) {
        retries++;
        setTimeout(setup, 800);
      }
    };
    setup();
    return () => {
      if (unsub) unsub();
    };
  }, [docId]);

  // ── Team roster from Firestore ──────────────────────────────────────────────
  useEffect(() => {
    if (!teamId || activeContext.type !== 'team') {
      setTeamMembers([]);
      return;
    }
    let cancelled = false;

    const fetchRoster = async () => {
      try {
        const team = await teams.get(teamId);
        if (!team || cancelled) return;
        const ownerId = team.ownerId || '';

        const uids = new Set<string>([ownerId]);
        Object.values(team.groups ?? {}).forEach((g) =>
          (g.members || []).forEach((u) => uids.add(u)),
        );
        (team.members ?? []).forEach((u) => uids.add(u));

        const infos: TeamMemberInfo[] = [];
        const profiles = await users.getMany(Array.from(uids).filter(Boolean));
        if (cancelled) return;
        for (const u of profiles) {
          infos.push({
            uid: u.id,
            displayName: u.displayName || u.email?.split('@')[0] || 'Member',
            email: u.email || null,
            photoURL: u.photoURL || null,
            role: u.id === ownerId ? 'owner' : 'member',
            updatedAt: null,
          });
        }

        if (!cancelled) {
          infos.sort((a, b) => {
            if (a.role === 'owner') return -1;
            if (b.role === 'owner') return 1;
            return a.displayName.localeCompare(b.displayName);
          });
          setTeamMembers(infos);
        }
      } catch (e) {
        console.warn('[CollaborationBar] Failed to fetch team members:', e);
      }
    };

    fetchRoster();
    return () => {
      cancelled = true;
    };
  }, [teamId, activeContext.type]);

  // ── Merge roster + live presence ────────────────────────────────────────────
  const activeUidSet = new Set(presence.map((p) => p.uid));

  const selfInfo: MergedMember | null = user
    ? {
        uid: user.id || '',
        displayName: user.display_name || user.email?.split('@')[0] || 'You',
        email: user.email || null,
        photoURL: user.avatar_url || null,
        role: teamMembers.find((m) => m.uid === user.id)?.role ?? 'member',
        isActive: true,
        isSelf: true,
        color: 'var(--editor-success, #22c55e)',
        updatedAt: new Date(),
      }
    : null;

  const remoteMembers: MergedMember[] = teamMembers
    .filter((m) => m.uid !== user?.id)
    .map((m) => ({
      ...m,
      isActive: activeUidSet.has(m.uid),
      isSelf: false,
      color: presence.find((p) => p.uid === m.uid)?.color ?? '#64748b',
    }))
    .sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

  const handleClick = useCallback(
    (member: MergedMember, e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setSelectedMember((prev) =>
        prev?.member.uid === member.uid ? null : { member, rect }
      );
    },
    []
  );

  // Only render in team context with a document open
  if (activeContext.type !== 'team' || !docId || !selfInfo) return null;

  const allMembers: MergedMember[] = [selfInfo, ...remoteMembers];
  const MAX = 5;
  const shown = allMembers.slice(0, MAX);
  const overflow = allMembers.length - MAX;
  const activeCount = remoteMembers.filter((m) => m.isActive).length;


  return (
    <>
      <style>{`
        @keyframes collab-fade-in {
          from { opacity: 0; transform: translateY(-5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes collab-pop-in {
          0% { opacity: 0; transform: scale(0.85) translateY(-4px); }
          70% { transform: scale(1.02) translateY(0.5px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes avatar-slide-in {
          from { opacity: 0; transform: translateX(8px) scale(0.9); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          position: 'relative',
          userSelect: 'none',
        }}
      >
        {/* Overlapping avatar stack */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {shown.map((member, i) => (
            <div
              key={member.uid}
              style={{
                marginLeft: i === 0 ? 0 : -9,
                zIndex: shown.length - i,
                position: 'relative',
                animation: `avatar-slide-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
                animationDelay: `${i * 0.05}s`,
                opacity: 0,
              }}
            >
              <Avatar
                member={member}
                size={26}
                onClick={(e) => handleClick(member, e)}
              />
            </div>
          ))}

          {/* Overflow chip */}
          {overflow > 0 && (
            <div
              style={{
                marginLeft: -9,
                zIndex: 0,
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.06)',
                border: '2px solid rgba(255,255,255,0.13)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.5)',
                fontFamily: 'Inter, system-ui, sans-serif',
                cursor: 'default',
              }}
              title={`${overflow} more member${overflow > 1 ? 's' : ''}`}
            >
              +{overflow}
            </div>
          )}
        </div>

        {/* "N active" label when others are live */}
        {activeCount > 0 && (
          <span
            style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.4)',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {activeCount} active
          </span>
        )}
      </div>

      {/* Member info popover */}
      {selectedMember && (
        <MemberPopover
          member={selectedMember.member}
          anchor={selectedMember.rect}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </>
  );
}
