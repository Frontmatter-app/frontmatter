import React from 'react';
import { Check, Layout, Users, Loader2 } from 'lucide-react';
import { TeamItem } from '../hooks/useTeamNames';
import { ActiveContextType } from '../billing/PlanProvider';

interface WorkspaceListProps {
  activeContext: ActiveContextType;
  teams: TeamItem[];
  isAnyLoading: boolean;
  workspaceSwitchingId: string | null;
  onSwitchWorkspace: (context: { type: 'personal' | 'team'; teamId?: string; teamName?: string }) => void;
}

export function WorkspaceList({ activeContext, teams, isAnyLoading, workspaceSwitchingId, onSwitchWorkspace }: WorkspaceListProps) {
  return (
    <div className="mb-4 pt-3" style={{ borderTop: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)' }}>
      <div className="text-[9px] font-bold uppercase tracking-widest mb-2 px-1" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}>
        Active Account Workspaces
      </div>

      <div className="space-y-1">
        <WorkspaceRow
          icon={<Layout className="w-4 h-4 flex-shrink-0" />}
          name="Personal Workspace"
          subtitle="Private cloud docs & local folder"
          isActive={activeContext.type === 'personal'}
          isLoading={workspaceSwitchingId === 'personal'}
          isAnyLoading={isAnyLoading}
          onClick={() => onSwitchWorkspace({ type: 'personal' })}
        />

        {teams.map((t) => {
          const wsProps: WorkspaceRowProps = {
            icon: <Users className="w-4 h-4 flex-shrink-0" />,
            name: `${t.name} Workspace`,
            subtitle: "Shared team cloud docs & local folder",
            isActive: activeContext.type === 'team' && activeContext.teamId === t.id,
            isLoading: workspaceSwitchingId === t.id,
            isAnyLoading,
            onClick: () => onSwitchWorkspace({ type: 'team', teamId: t.id, teamName: t.name }),
          };
          return <WorkspaceRow key={t.id} {...wsProps} />;
        })}
      </div>
    </div>
  );
}

interface WorkspaceRowProps {
  key?: React.Key;
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  isActive: boolean;
  isLoading: boolean;
  isAnyLoading: boolean;
  onClick: () => void;
}

function WorkspaceRow({ icon, name, subtitle, isActive, isLoading, isAnyLoading, onClick }: WorkspaceRowProps) {
  return (
    <div
      onClick={() => { if (!isAnyLoading) onClick(); }}
      className={`flex items-center justify-between p-2.5 rounded-xl border transition-all duration-200 cursor-pointer group ${isAnyLoading ? 'opacity-60 pointer-events-none' : ''}`}
      style={{
        borderColor: isActive ? 'color-mix(in srgb, var(--editor-caret-color, #1f6feb) 25%, transparent)' : 'transparent',
        background: isActive ? 'color-mix(in srgb, var(--editor-caret-color, #1f6feb) 6%, transparent)' : 'transparent',
        color: isActive ? 'var(--editor-caret-color, #1f6feb)' : 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 80%, transparent)',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)';
          e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 3%, transparent)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {icon}
        <div className="min-w-0 text-left">
          <div className="text-xs font-semibold">{name}</div>
          <div className="text-[10px] truncate" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}>
            {subtitle}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)' }} />
        ) : isActive ? (
          <Check className="w-4 h-4 flex-shrink-0" />
        ) : (
          <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}>
            Open
          </span>
        )}
      </div>
    </div>
  );
}
