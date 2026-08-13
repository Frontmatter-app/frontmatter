import { describe, expect, it, vi } from 'vitest';
import { createFakePorts, unwrapContent } from './fakes';

/**
 * The fake is what every UI test renders against, so its behaviour has to match
 * what Firestore actually does — notably delivering the current value on
 * subscribe, and reporting a missing record as `null` rather than throwing.
 */
describe('unwrapContent', () => {
  it('reads the markdown field of a JSON envelope', () => {
    expect(unwrapContent(JSON.stringify({ markdown: '# Hi', draft: '' }))).toBe('# Hi');
  });

  it('falls back to the draft field', () => {
    expect(unwrapContent(JSON.stringify({ markdown: '', draft: 'wip' }))).toBe('wip');
  });

  it('returns a raw string unchanged', () => {
    expect(unwrapContent('plain text')).toBe('plain text');
  });

  it('treats missing content as empty', () => {
    expect(unwrapContent(undefined)).toBe('');
  });
});

describe('fake ports', () => {
  it('reports a missing record as null rather than throwing', async () => {
    const ports = createFakePorts();
    await expect(ports.teams.get('nope')).resolves.toBeNull();
    await expect(ports.users.get('nope')).resolves.toBeNull();
    await expect(ports.cloudDocuments.getText('nope')).resolves.toBeNull();
  });

  it('delivers the current value immediately on watch', () => {
    const ports = createFakePorts({
      teams: [{ id: 't1', name: 'Docs Team', ownerId: 'u1', members: [] }],
    });
    const seen = vi.fn();

    ports.teams.watch('t1', seen);

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ name: 'Docs Team' }));
  });

  it('delivers null immediately for a record that does not exist', () => {
    const seen = vi.fn();
    createFakePorts().teams.watch('missing', seen);
    expect(seen).toHaveBeenCalledWith(null);
  });

  it('pushes updates to watchers and stops after unsubscribe', async () => {
    const ports = createFakePorts({
      teams: [{ id: 't1', name: 'Before', ownerId: 'u1', members: [] }],
    });
    const seen = vi.fn();

    const unsubscribe = ports.teams.watch('t1', seen);
    const writers = { name: 'Writers', members: [], permissions: {} as never };
    await ports.teams.updateGroups('t1', { g1: writers });

    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ groups: { g1: writers } }),
    );

    unsubscribe();
    await ports.teams.updateGroups('t1', {});
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('creates a team with its agreement document and links the owner', async () => {
    const ports = createFakePorts({ users: [{ id: 'u1', email: 'a@b.c' }] });

    const teamId = await ports.teams.create({
      ownerId: 'u1',
      name: 'Writers',
      description: 'The writing team',
      agreementMarkdown: '# Terms',
    });

    const team = await ports.teams.get(teamId);
    expect(team?.name).toBe('Writers');
    expect(team?.agreementVersion).toBe(1);

    await expect(ports.cloudDocuments.getText(team!.agreementDocId!)).resolves.toBe('# Terms');

    const owner = await ports.users.get('u1');
    expect(owner?.ownedTeamId).toBe(teamId);
    expect(owner?.teamMemberships).toContain(teamId);
  });

  it('removes a member from both the team and the user profile', async () => {
    const ports = createFakePorts({
      teams: [{ id: 't1', name: 'T', ownerId: 'u1', members: ['u2'] }],
      users: [{ id: 'u2', teamId: 't1', teamMemberships: ['t1'] }],
    });

    await ports.teams.removeMember('t1', 'u2');

    expect((await ports.teams.get('t1'))?.members).toEqual([]);
    const user = await ports.users.get('u2');
    expect(user?.teamId).toBeNull();
    expect(user?.teamMemberships).toEqual([]);
  });

  it('skips profiles that do not exist when resolving many', async () => {
    const ports = createFakePorts({ users: [{ id: 'u1' }, { id: 'u2' }] });
    await expect(ports.users.getMany(['u1', 'missing', 'u2'])).resolves.toHaveLength(2);
  });

  it('signs an agreement and notifies the watcher', async () => {
    const ports = createFakePorts();
    const seen = vi.fn();
    ports.agreements.watch('t1', 'u1', seen);

    expect(seen).toHaveBeenLastCalledWith(null);

    await ports.agreements.sign({
      teamId: 't1',
      uid: 'u1',
      signedAt: '2026-01-01T00:00:00Z',
      agreementVersion: 1,
    });

    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ agreementVersion: 1 }));
  });

  it('finds an invite by token', () => {
    const ports = createFakePorts({
      invites: [{ id: 'i1', token: 'abc', teamId: 't1' }],
    });
    const seen = vi.fn();

    ports.invites.watchByToken('abc', seen);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ teamId: 't1' }));

    ports.invites.watchByToken('wrong', seen);
    expect(seen).toHaveBeenLastCalledWith(null);
  });
});
