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
    <section className="account__section">
      <div className="account__section-header">
        <h3 className="account__section-title">Workspaces</h3>
      </div>

      <ul className="account__list">
        <WorkspaceRow
          icon={<Layout className="w-4 h-4" />}
          name="Personal"
          subtitle="Private cloud docs and local folder"
          isActive={activeContext.type === 'personal'}
          isLoading={workspaceSwitchingId === 'personal'}
          isAnyLoading={isAnyLoading}
          onClick={() => onSwitchWorkspace({ type: 'personal' })}
        />

        {teams.map((t) => (
          <WorkspaceRow
            key={t.id}
            icon={<Users className="w-4 h-4" />}
            name={t.name}
            subtitle="Shared team cloud docs and local folder"
            isActive={activeContext.type === 'team' && activeContext.teamId === t.id}
            isLoading={workspaceSwitchingId === t.id}
            isAnyLoading={isAnyLoading}
            onClick={() => onSwitchWorkspace({ type: 'team', teamId: t.id, teamName: t.name })}
          />
        ))}
      </ul>
    </section>
  );
}

interface WorkspaceRowProps {
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
    <li className="account__list-item">
      <button
        type="button"
        className="account__row"
        aria-current={isActive}
        disabled={isAnyLoading || isActive}
        onClick={onClick}
      >
        <span className="account__row-icon">{icon}</span>
        <span className="account__row-text">
          <span className="account__row-title">
            <span>{name}</span>
          </span>
          <span className="account__row-subtitle">{subtitle}</span>
        </span>
        <span className="account__row-trailing">
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Opening…
            </>
          ) : isActive ? (
            <>
              Current
              <Check className="w-4 h-4 account__row-check" />
            </>
          ) : (
            'Open'
          )}
        </span>
      </button>
    </li>
  );
}
