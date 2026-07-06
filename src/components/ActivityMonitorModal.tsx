import React, { useState, useEffect } from 'react';
import { useAuth, db } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { doc, getDoc } from 'firebase/firestore';
import { RecentActivityDashboard } from '../settings/metrics/RecentActivityDashboard';
import { UserMetricsData } from '../settings/metrics/metricsSync';
import { useSettingsStore } from '../settings/settingsStore';
import { 
  X, 
  User, 
  Users, 
  ChevronLeft, 
  Award,
  ArrowRight,
  TrendingUp
} from 'lucide-react';

interface ActivityMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TeamMember {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  metrics: UserMetricsData | null;
}

export function ActivityMonitorModal({ isOpen, onClose }: ActivityMonitorModalProps) {
  const { user } = useAuth();
  const { teamId, isTeam, isTeamOwner, ownedTeamId } = usePlan();
  const { settings } = useSettingsStore();
  const isDark = settings.themeType.startsWith('github_dark');

  // Navigation tab: 'my' | 'team'
  const [activeTab, setActiveTab] = useState<'my' | 'team'>('my');
  
  // Selected team member to inspect details
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // Team members state
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Esc keyboard key listener to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Populate team members list for inspection
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
        const teamSnap = await getDoc(doc(db, 'teams', fetchTarget));
        if (teamSnap.exists() && active) {
          const teamData = teamSnap.data();
          const memberIds = [teamData.ownerId, ...(teamData.members || [])];
          const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
          
          const list: TeamMember[] = [];
          for (const mId of uniqueMemberIds) {
            const userSnap = await getDoc(doc(db, 'users', mId));
            if (userSnap.exists()) {
              const uData = userSnap.data();
              list.push({
                uid: mId,
                email: uData.email || 'No email',
                displayName: uData.displayName || 'Anonymous User',
                role: mId === teamData.ownerId ? 'Team Owner' : 'Team Member',
                metrics: (uData.metrics as UserMetricsData | undefined) || null
              });
            }
          }
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

  const getMiniCellColor = (count: number) => {
    if (count === 0) return 'bg-black/5 dark:bg-white/5';
    if (count < 3) return 'bg-emerald-500/20';
    if (count < 6) return 'bg-emerald-500/40';
    if (count < 10) return 'bg-emerald-500/75';
    return 'bg-emerald-400';
  };

  const glassStyle: React.CSSProperties = {
    background: isDark ? 'rgba(15, 18, 25, 0.97)' : 'rgba(252, 252, 253, 0.99)',
    borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)',
    color: 'var(--editor-text-color)',
    boxShadow: isDark
      ? '0 24px 64px 0 rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)'
      : '0 24px 64px 0 rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.9)',
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      
      {/* GLASS WINDOW BOX */}
      <div 
        className="w-full max-w-4xl h-[85vh] rounded-[22px] border shadow-2xl flex flex-col overflow-hidden text-[var(--editor-text-color)]"
        style={glassStyle}
      >
        
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)' }}>
          <div className="flex items-center gap-4">
            <span className="font-bold text-sm tracking-wide uppercase" style={{ opacity: 0.85 }}>Activity Monitor</span>
            
             {/* Tab Toggle - Only visible to team owners / admins */}
             {isTeamOwner && (
              <div className="flex rounded-xl p-0.5 border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                <button
                  onClick={() => {
                    setActiveTab('my');
                    setSelectedMember(null);
                  }}
                  style={activeTab === 'my' ? { background: isDark ? 'rgba(255,255,255,0.10)' : '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.12)', color: '#3b82f6' } : { opacity: 0.65 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer hover:opacity-100"
                >
                  <User className="w-3.5 h-3.5" />
                  My Activity
                </button>
                <button
                  onClick={() => setActiveTab('team')}
                  style={activeTab === 'team' ? { background: isDark ? 'rgba(255,255,255,0.10)' : '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.12)', color: '#3b82f6' } : { opacity: 0.65 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer hover:opacity-100"
                >
                  <Users className="w-3.5 h-3.5" />
                  Team Activity
                </button>
              </div>
            )}
          </div>
          
          <button 
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer"
            style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)', border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(0,0,0,0.09)' }}
          >
            <X className="w-4 h-4 opacity-75" />
          </button>
        </div>

        {/* MODAL CANVAS */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          
          {/* A. MY ACTIVITY VIEW */}
          {activeTab === 'my' && (
            <RecentActivityDashboard />
          )}

          {/* B. TEAM ACTIVITY VIEW */}
          {activeTab === 'team' && (
            <div className="flex flex-col gap-4">
              
              {selectedMember ? (
                // 1. INSPECT MEMBER DETAILS
                <div className="flex flex-col gap-4">
                  <button
                    onClick={() => setSelectedMember(null)}
                    className="flex items-center gap-1 px-3 py-1.5 w-max rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 hover:bg-black/10 text-[10px] font-bold transition cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Back to Team Members list
                  </button>
                  <RecentActivityDashboard 
                    metricsOverride={selectedMember.metrics || undefined} 
                    displayNameOverride={selectedMember.displayName}
                  />
                </div>
              ) : (
                // 2. MEMBER LIST GRID
                <div className="flex flex-col gap-3">
                  <div className="pb-2 border-b border-black/5 dark:border-white/5 mb-1.5">
                    <h3 className="text-sm font-bold opacity-80 uppercase tracking-wide">Team Activity Dashboard</h3>
                    <p className="text-[11px] opacity-60">Select any writer below to monitor their consistency heatmap and writing speed metrics.</p>
                  </div>
                  
                  {loadingMembers ? (
                    <div className="text-center py-12 text-xs opacity-60">Loading team statistics...</div>
                  ) : members.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-12 h-12 rounded-full bg-blue-500/10 dark:bg-white/5 border border-blue-500/20 flex items-center justify-center">
                        <Users className="w-6 h-6 text-blue-500" />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-bold opacity-80">No team members to display</p>
                        <p className="text-[11px] opacity-60 mt-1">Create or join a team to start monitoring collaboration activity.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {members.map((member) => {
                        const mData = member.metrics;
                        let activeDaysCount = 0;
                        let miniHistory: number[] = [];
                        if (mData) {
                          const dates = Object.keys(mData.heatmap).sort().slice(-14);
                          miniHistory = dates.map(d => mData.heatmap[d] || 0);
                          const heatmapValues = Object.values(mData.heatmap) as number[];
                          activeDaysCount = heatmapValues.filter(v => v > 0).length;
                        }

                        return (
                          <div 
                            key={member.uid} 
                            className="p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-200"
                          style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' }}
                          >
                            {/* Member Details */}
                            <div className="flex items-center gap-3.5">
                              <div className="w-9 h-9 rounded-full bg-blue-500/10 dark:bg-white/5 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                                {member.displayName.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-xs font-bold flex items-center gap-1.5">
                                  {member.displayName}
                                  {member.role.toLowerCase().includes('owner') && <Award className="w-3.5 h-3.5 text-amber-500" />}
                                </span>
                                <span className="text-[9px] opacity-55 leading-none mt-0.5">{member.email}</span>
                                <span className="text-[8px] px-1.5 py-0.2 w-max bg-black/5 dark:bg-white/5 rounded border border-black/5 text-gray-400 font-bold uppercase mt-1">{member.role}</span>
                              </div>
                            </div>

                            {/* Summary Indices */}
                            <div className="flex gap-5 text-[10px]">
                              <div className="flex flex-col">
                                <span className="opacity-55 text-[8px] uppercase font-bold">Average WPM</span>
                                <span className="font-bold text-emerald-500 mt-0.5">{mData ? `${mData.typingSpeed.avgWpm} WPM` : '—'}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="opacity-55 text-[8px] uppercase font-bold">Deep Work</span>
                                <span className="font-bold text-purple-500 mt-0.5">{mData ? `${mData.focusSessions.totalCount} sessions` : '—'}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="opacity-55 text-[8px] uppercase font-bold">Active Days</span>
                                <span className="font-bold text-blue-500 mt-0.5">{activeDaysCount} days</span>
                              </div>
                            </div>

                            {/* Mini 14 days grid */}
                            <div className="flex items-center gap-4">
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-[8px] opacity-55 uppercase font-bold">Recent activity</span>
                                <div className="flex gap-[2.5px]">
                                  {miniHistory.length > 0 ? (
                                    miniHistory.map((val, idx) => (
                                      <div 
                                        key={idx} 
                                        className={`w-3.5 h-3.5 rounded-[1px] ${getMiniCellColor(val)}`}
                                        title={`Day ${idx + 1}: ${val} edits`}
                                      />
                                    ))
                                  ) : (
                                    <span className="text-[9px] italic opacity-50">No history</span>
                                  )}
                                </div>
                              </div>

                              {/* Inspect details button */}
                              <button
                                onClick={() => setSelectedMember(member)}
                                className="cursor-pointer p-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center transition border border-blue-500/10"
                                title="Inspect Activity Heatmap & Metrics"
                              >
                                <ArrowRight className="w-4 h-4" />
                              </button>
                            </div>

                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              )}

            </div>
          )}

        </div>

      </div>
      
    </div>
  );
}
