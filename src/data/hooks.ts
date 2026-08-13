import { useEffect, useState } from 'react';
import { useData } from './DataProvider';
import type { TeamDoc, Unsubscribe, Watcher } from './types';

/** Result of a subscription: the value, plus whether it has arrived yet. */
export interface Subscription<T> {
  value: T | null;
  loading: boolean;
  error: Error | null;
}

const IDLE = { value: null, loading: false, error: null } as const;

/**
 * Subscribes to a single record.
 *
 * `subscribe` is called only while `enabled`; passing `null` for a key disables
 * the subscription and clears the value, which is the common case when no team
 * or document is selected.
 */
export function useWatched<T>(
  subscribe: ((onChange: Watcher<T>) => Unsubscribe) | null,
  deps: unknown[],
): Subscription<T> {
  const [state, setState] = useState<Subscription<T>>(IDLE);

  useEffect(() => {
    if (!subscribe) {
      setState(IDLE);
      return;
    }

    let active = true;
    setState({ value: null, loading: true, error: null });

    const unsubscribe = subscribe((value, error) => {
      if (!active) return;
      setState({ value, loading: false, error: error ?? null });
    });

    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/** Watches one team, or nothing when `teamId` is absent. */
export function useTeam(teamId: string | null | undefined): Subscription<TeamDoc> {
  const { teams } = useData();
  return useWatched<TeamDoc>(
    teamId ? (onChange) => teams.watch(teamId, onChange) : null,
    [teamId, teams],
  );
}

export interface TeamItem {
  id: string;
  name: string;
}

/**
 * Resolves display names for several teams at once, sorted by name.
 *
 * A team document that is missing or unreadable still yields an entry so the
 * membership list never silently loses a row.
 */
export function useTeamNames(teamIds: string[], enabled = true): TeamItem[] {
  const { teams } = useData();
  const [items, setItems] = useState<TeamItem[]>([]);
  const key = teamIds.join(',');

  useEffect(() => {
    if (!enabled || teamIds.length === 0) {
      setItems([]);
      return;
    }

    const unsubscribes = teamIds.map((id) =>
      teams.watch(id, (team) => {
        setItems((previous) => {
          const rest = previous.filter((t) => t.id !== id);
          const name = team?.name || 'Unnamed Team';
          return [...rest, { id, name }].sort((a, b) => a.name.localeCompare(b.name));
        });
      }),
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, teams]);

  return items;
}
