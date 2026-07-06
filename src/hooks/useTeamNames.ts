import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../auth/firebase';

export interface TeamItem {
  id: string;
  name: string;
}

export function useTeamNames(teamMemberships: string[], isOpen: boolean) {
  const [teams, setTeams] = useState<TeamItem[]>([]);

  useEffect(() => {
    if (!isOpen || !teamMemberships || teamMemberships.length === 0) {
      setTeams([]);
      return;
    }

    const unsubscribes = teamMemberships.map((tId) => {
      const teamDocRef = doc(db, 'teams', tId);
      return onSnapshot(
        teamDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setTeams((prev) => {
              const filtered = prev.filter((t) => t.id !== tId);
              return [...filtered, { id: tId, name: data.name || 'Unnamed Team' }].sort(
                (a, b) => a.name.localeCompare(b.name)
              );
            });
          } else {
            // Fallback for non-existent team document
            setTeams((prev) => {
              const filtered = prev.filter((t) => t.id !== tId);
              return [...filtered, { id: tId, name: 'Unnamed Team' }].sort(
                (a, b) => a.name.localeCompare(b.name)
              );
            });
          }
        },
        (err) => {
          console.warn(`[useTeamNames] failed to listen to team ${tId}:`, err);
        }
      );
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [isOpen, teamMemberships]);

  return teams;
}
