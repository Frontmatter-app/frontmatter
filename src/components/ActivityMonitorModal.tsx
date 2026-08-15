import React, { useState, useEffect } from 'react';
import { useData } from '../data/DataProvider';
import { usePlan } from '../billing/PlanProvider';
import { RecentActivityDashboard } from '../settings/metrics/RecentActivityDashboard';
import { TeamHealthView, type TeamMemberSummary } from '../settings/metrics/TeamHealthView';
import { useDocHealth } from '../settings/metrics/useDocHealth';
import { UserMetricsData } from '../settings/metrics/metricsSync';
import { useSettingsStore } from '../settings/settingsStore';
import { X, User, Users, ChevronLeft } from 'lucide-react';

interface ActivityMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDocument?: (id: string) => void;
}

export function ActivityMonitorModal({ isOpen, onClose, onOpenDocument }: ActivityMonitorModalProps) {
  const { teamId, isTeam, isTeamOwner, ownedTeamId } = usePlan();
  const { teams } = useData();
  const { settings } = useSettingsStore();
  const isDark = settings.themeType.startsWith('github_dark');

  const [activeTab, setActiveTab] = useState<'my' | 'team'>('my');
  const [selectedMember, setSelectedMember] = useState<TeamMemberSummary | null>(null);
  const [members, setMembers] = useState<TeamMemberSummary[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // One scan serves both tabs. The documentation set does not change depending
  // on which tab is looking at it, and scanning it twice would double the cost
  // of opening the dashboard.
  const health = useDocHealth(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !isTeam) {
      if (isOpen) setMembers([]);
      return;
    }

    const fetchTarget = teamId || ownedTeamId;
    if (!fetchTarget) {
      if (isOpen) setMembers([]);
      return;
    }

    let active = true;
    setLoadingMembers(true);
    setMembers([]);

    const fetchTeamMembers = async () => {
      try {
        const team = await teams.get(fetchTarget);
        if (team && active) {
          // Roster from the team's membership records; metrics from the backend,
          // which authorizes the caller as the team owner. Both used to come from
          // other people's users/{uid} documents, readable by anyone signed in.
          const [roster, metrics] = await Promise.all([
            teams.listMembers(fetchTarget),
            teams.listMemberMetrics(fetchTarget).catch(() => ({} as Record<string, unknown | null>)),
          ]);
          const list: TeamMemberSummary[] = roster.map(member => ({
            uid: member.uid,
            email: member.email || 'No email',
            displayName: member.displayName || 'Anonymous User',
            role: member.uid === team.ownerId ? 'Team Owner' : 'Team Member',
            metrics: (metrics[member.uid] as UserMetricsData | undefined) || null,
          }));
          if (active) {
            setMembers(list);
          }
        } else if (active) {
          setMembers([]);
        }
      } catch (e) {
        console.error('[ActivityMonitor] Failed to load team members for activity monitor:', e);
        setMembers([]);
      } finally {
        if (active) setLoadingMembers(false);
      }
    };

    fetchTeamMembers();

    return () => {
      active = false;
    };
  }, [isOpen, teamId, ownedTeamId, isTeam]);

  if (!isOpen) return null;

  const glassStyle: React.CSSProperties = {
    background: isDark ? 'rgba(15, 18, 25, 0.97)' : 'rgba(252, 252, 253, 0.99)',
    borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)',
    color: 'var(--editor-text-color)',
    boxShadow: isDark
      ? '0 24px 64px 0 rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)'
      : '0 24px 64px 0 rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.9)',
  };

  const tabStyle = (tab: 'my' | 'team') =>
    activeTab === tab
      ? {
          background: isDark ? 'rgba(255,255,255,0.10)' : '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          color: isDark ? '#3fd23f' : '#046104',
        }
      : { opacity: 0.65 };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-4xl h-[85vh] rounded-[22px] border shadow-2xl flex flex-col overflow-hidden text-[var(--editor-text-color)]"
        style={glassStyle}
      >
        {/* HEADER */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)' }}
        >
          <div className="flex items-center gap-4">
            <span className="font-bold text-sm tracking-wide uppercase" style={{ opacity: 0.85 }}>
              Activity Monitor
            </span>

            {isTeamOwner && (
              <div
                className="flex rounded-xl p-0.5 border"
                style={{
                  background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                  borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                }}
              >
                <button
                  onClick={() => {
                    setActiveTab('my');
                    setSelectedMember(null);
                  }}
                  style={tabStyle('my')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer hover:opacity-100"
                >
                  <User className="w-3.5 h-3.5" aria-hidden />
                  My Activity
                </button>
                <button
                  onClick={() => setActiveTab('team')}
                  style={tabStyle('team')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer hover:opacity-100"
                >
                  <Users className="w-3.5 h-3.5" aria-hidden />
                  Team
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer"
            style={{
              background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
              border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(0,0,0,0.09)',
            }}
            aria-label="Close activity monitor"
          >
            <X className="w-4 h-4 opacity-75" aria-hidden />
          </button>
        </div>

        {/* CANVAS */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          {activeTab === 'my' && (
            <RecentActivityDashboard
              showDocHealth
              docHealth={health}
              onOpenDocument={onOpenDocument}
            />
          )}

          {activeTab === 'team' && (
            selectedMember ? (
              <div className="flex flex-col gap-4">
                <button
                  onClick={() => setSelectedMember(null)}
                  className="flex items-center gap-1 px-3 py-1.5 w-max rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 hover:bg-black/10 text-[10px] font-bold transition cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
                  Back to team
                </button>
                <RecentActivityDashboard
                  metricsOverride={selectedMember.metrics || undefined}
                  displayNameOverride={selectedMember.displayName}
                />
              </div>
            ) : (
              <TeamHealthView
                health={health}
                members={members}
                loadingMembers={loadingMembers}
                isDark={isDark}
                onInspectMember={setSelectedMember}
                onOpenDocument={onOpenDocument}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
