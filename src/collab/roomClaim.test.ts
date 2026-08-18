import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeForge } from '../forge/fake';
import { buildClaim, forgetClaims } from './roomClaim';

const REPO = { provider: 'github' as const, host: 'github.com', repo: 'acme/handbook' };

function forgeWith(permission: 'read' | 'write' | 'admin' = 'write') {
  const forge = new FakeForge({ repo: 'acme/handbook' });
  const original = forge.getRepo.bind(forge);
  forge.getRepo = async (fullName: string) => {
    const repo = await original(fullName);
    return repo ? { ...repo, permission } : null;
  };
  return forge;
}

beforeEach(() => forgetClaims());

describe('building a claim', () => {
  it('reports the account and the permission the forge gave', async () => {
    const claim = await buildClaim(forgeWith('write'), REPO);
    expect(claim).toEqual({
      permission: 'write',
      login: 'testuser',
      externalId: '1',
      repoId: expect.any(String),
    });
  });

  it('reports read access as read', async () => {
    // The case that must never be quietly upgraded: a reviewer.
    const claim = await buildClaim(forgeWith('read'), REPO);
    expect(claim?.permission).toBe('read');
  });
});

describe('when the forge cannot answer', () => {
  it('claims nothing when the account is unavailable', async () => {
    // Offline, or a revoked token. Claiming write here would be inventing
    // access on behalf of somebody who may not have it.
    const forge = forgeWith();
    forge.getAccount = async () => null;
    expect(await buildClaim(forge, REPO)).toBeNull();
  });

  it('claims nothing for a repository the account cannot see', async () => {
    const forge = forgeWith();
    expect(await buildClaim(forge, { ...REPO, repo: 'someone/private' })).toBeNull();
  });

  it('claims nothing when the forge throws', async () => {
    const forge = forgeWith();
    forge.getRepo = async () => {
      throw new Error('network down');
    };
    expect(await buildClaim(forge, REPO)).toBeNull();
  });
});

describe('caching', () => {
  it('asks the forge once for a repository, not once per file', async () => {
    const forge = forgeWith();
    const getRepo = vi.spyOn(forge, 'getRepo');

    await buildClaim(forge, REPO);
    await buildClaim(forge, REPO);
    await buildClaim(forge, REPO);

    expect(getRepo).toHaveBeenCalledTimes(1);
  });

  it('keeps separate entries for separate repositories', async () => {
    const forge = forgeWith();
    forge.addRepo('acme/other');
    const getRepo = vi.spyOn(forge, 'getRepo');

    await buildClaim(forge, REPO);
    await buildClaim(forge, { ...REPO, repo: 'acme/other' });

    expect(getRepo).toHaveBeenCalledTimes(2);
  });

  it('does not share an entry between two hosts', async () => {
    // A self-hosted instance and the public one can hold repositories with the
    // same name and different permissions.
    const forge = forgeWith();
    const getRepo = vi.spyOn(forge, 'getRepo');

    await buildClaim(forge, REPO);
    await buildClaim(forge, { ...REPO, host: 'git.acme.com' });

    expect(getRepo).toHaveBeenCalledTimes(2);
  });

  it('can be asked again on demand', async () => {
    const forge = forgeWith();
    const getRepo = vi.spyOn(forge, 'getRepo');

    await buildClaim(forge, REPO);
    await buildClaim(forge, REPO, { refresh: true });

    expect(getRepo).toHaveBeenCalledTimes(2);
  });

  it('forgets everything when asked', async () => {
    // Signing out must not leave a cached claim asserting access that has
    // already been taken away.
    const forge = forgeWith();
    const getRepo = vi.spyOn(forge, 'getRepo');

    await buildClaim(forge, REPO);
    forgetClaims();
    await buildClaim(forge, REPO);

    expect(getRepo).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    const forge = forgeWith();
    forge.getAccount = async () => null;
    await buildClaim(forge, REPO);

    forge.getAccount = async () => ({
      kind: 'github' as const,
      id: '1',
      login: 'testuser',
      name: null,
      email: null,
      avatarUrl: null,
    });
    expect(await buildClaim(forge, REPO)).not.toBeNull();
  });
});
