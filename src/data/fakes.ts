import type {
  AgreementsPort,
  CloudDocumentsPort,
  DataPorts,
  InvitesPort,
  TeamsPort,
  UsersPort,
} from './ports';
import type {
  AgreementDoc,
  CloudDocumentDoc,
  InviteDoc,
  TeamDoc,
  Unsubscribe,
  UserDoc,
  Watcher,
} from './types';

export interface FakeSeed {
  teams?: TeamDoc[];
  users?: UserDoc[];
  cloudDocuments?: CloudDocumentDoc[];
  agreements?: AgreementDoc[];
  invites?: InviteDoc[];
}

/** Minimal observable store: notifies watchers whenever a key is written. */
class Store<T extends { id?: string }> {
  private readonly items = new Map<string, T>();
  private readonly watchers = new Map<string, Set<Watcher<T>>>();

  constructor(seed: T[] = [], key: (item: T) => string = (i) => i.id!) {
    for (const item of seed) this.items.set(key(item), item);
  }

  get(id: string): T | null {
    return this.items.get(id) ?? null;
  }

  all(): T[] {
    return [...this.items.values()];
  }

  set(id: string, value: T): void {
    this.items.set(id, value);
    this.notify(id);
  }

  patch(id: string, changes: Partial<T>): void {
    const current = this.items.get(id);
    if (!current) return;
    this.items.set(id, { ...current, ...changes });
    this.notify(id);
  }

  watch(id: string, onChange: Watcher<T>): Unsubscribe {
    const set = this.watchers.get(id) ?? new Set();
    set.add(onChange);
    this.watchers.set(id, set);
    // Firestore delivers the current value immediately; match that.
    onChange(this.get(id));
    return () => set.delete(onChange);
  }

  private notify(id: string): void {
    for (const watcher of this.watchers.get(id) ?? []) watcher(this.get(id));
  }
}

/**
 * In-memory implementation of every port.
 *
 * Used by tests to render components that need data without a Firebase project,
 * and by the data layer's own test suite as the reference behaviour each real
 * adapter must match.
 */
export function createFakePorts(seed: FakeSeed = {}): DataPorts & { seed: FakeSeed } {
  const teams = new Store<TeamDoc>(seed.teams ?? []);
  const users = new Store<UserDoc>(seed.users ?? []);
  const documents = new Store<CloudDocumentDoc>(seed.cloudDocuments ?? []);
  const agreements = new Store<AgreementDoc & { id?: string }>(
    (seed.agreements ?? []).map((a) => ({ ...a, id: `${a.teamId}_${a.uid}` })),
  );
  const invites = new Store<InviteDoc>(seed.invites ?? []);

  const teamsPort: TeamsPort = {
    async get(teamId) {
      return teams.get(teamId);
    },
    watch(teamId, onChange) {
      return teams.watch(teamId, onChange);
    },
    async create(input) {
      const id = `team_${teams.all().length + 1}`;
      const agreementDocId = `agreement_${id}`;
      documents.set(agreementDocId, {
        id: agreementDocId,
        title: 'Agreement',
        content: JSON.stringify({ markdown: input.agreementMarkdown }),
        isAgreement: true,
      });
      teams.set(id, {
        id,
        name: input.name,
        description: input.description,
        ownerId: input.ownerId,
        members: [],
        agreementDocId,
        agreementVersion: 1,
      });
      const owner = users.get(input.ownerId);
      users.set(input.ownerId, {
        ...(owner ?? { id: input.ownerId }),
        ownedTeamId: id,
        teamId: id,
        teamMemberships: [...(owner?.teamMemberships ?? []), id],
      });
      return id;
    },
    async listMembers(teamId) {
      const team = teams.get(teamId);
      if (!team) return [];
      const groupIdsFor = (uid: string) =>
        Object.entries(team.groups ?? {})
          .filter(([, group]) => (group.members ?? []).includes(uid))
          .map(([groupId]) => groupId);

      return (team.members ?? []).map((uid) => {
        const user = users.get(uid);
        return {
          uid,
          groupIds: groupIdsFor(uid),
          displayName: user?.displayName ?? null,
          email: user?.email ?? null,
          photoURL: user?.photoURL ?? null,
        };
      });
    },
    async listMemberMetrics(teamId) {
      const team = teams.get(teamId);
      if (!team) return {};
      return Object.fromEntries(
        (team.members ?? []).map((uid) => [uid, users.get(uid)?.metrics ?? null]),
      );
    },
    async updateGroups(teamId, groups) {
      teams.patch(teamId, { groups });
    },
    async removeMember(teamId, uid) {
      const team = teams.get(teamId);
      if (team) teams.patch(teamId, { members: team.members.filter((m) => m !== uid) });
      const user = users.get(uid);
      if (user) {
        users.patch(uid, {
          teamId: null,
          teamMemberships: (user.teamMemberships ?? []).filter((t) => t !== teamId),
        });
      }
    },
  };

  const usersPort: UsersPort = {
    async get(uid) {
      return users.get(uid);
    },
  };

  const cloudDocumentsPort: CloudDocumentsPort = {
    async get(documentId) {
      return documents.get(documentId);
    },
    async getText(documentId) {
      const record = documents.get(documentId);
      if (!record) return null;
      return unwrapContent(record.content);
    },
    async getFilePermissions(documentId) {
      return documents.get(documentId)?.filePermissions ?? null;
    },
    async setFilePermissions(documentId, permissions) {
      documents.patch(documentId, { filePermissions: permissions });
    },
  };

  const agreementsPort: AgreementsPort = {
    watch(teamId, uid, onChange) {
      return agreements.watch(`${teamId}_${uid}`, onChange);
    },
    async sign(agreement) {
      agreements.set(`${agreement.teamId}_${agreement.uid}`, {
        ...agreement,
        id: `${agreement.teamId}_${agreement.uid}`,
      });
    },
  };

  const invitesPort: InvitesPort = {
    // Mirrors the backend's /invite-details: resolves the token against the
    // seeded invite, then joins the team and its agreement document, which is
    // what the real endpoint assembles server-side.
    async getByToken(token) {
      const match = invites.all().find((i) => i.token === token);
      if (!match) throw new Error('This invitation link is no longer valid.');

      const team = teams.get(match.teamId);
      const agreementDoc = team?.agreementDocId ? documents.get(team.agreementDocId) : null;

      return {
        teamId: match.teamId,
        teamName: team?.name ?? null,
        invitedEmail: match.email ?? '',
        groupId: null,
        agreementVersion: team?.agreementVersion ?? 1,
        agreementContent: agreementDoc?.content ?? null,
      };
    },
  };

  return {
    teams: teamsPort,
    users: usersPort,
    cloudDocuments: cloudDocumentsPort,
    agreements: agreementsPort,
    invites: invitesPort,
    seed,
  };
}

/**
 * Stored bodies are either a JSON envelope written by the sync layer or a raw
 * string. Shared so the fake and the Firestore adapter cannot disagree.
 */
export function unwrapContent(content: string | undefined): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return parsed.markdown || parsed.draft || '';
    }
  } catch {
    // Not JSON: the raw string is the content.
  }
  return content;
}
