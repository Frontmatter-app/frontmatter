/**
 * Telling the server where a document lives, and what we may do with it.
 *
 * The server cannot ask the forge itself: it holds nobody's token, deliberately
 * — `forge/ports.ts` states that a compromised sync server must not be able to
 * write to anybody's repository, and the way that promise is kept is by never
 * giving it the means. So the client, which does hold a token, asks on its own
 * behalf and reports the answer.
 *
 * A claim is therefore *not* a credential and buys no trust on its own. It buys
 * latency: a peer joins immediately instead of waiting on a forge round trip
 * inside the socket handshake. What makes it safe is that the server verifies
 * it afterwards, out of band, and may only ever lower what it granted.
 *
 * The claim is cached per repository, because a person opening ten files in one
 * repository should cause one permission lookup rather than ten, and because
 * repository permissions change on the scale of days rather than keystrokes.
 */
import type { ForgePort } from '../forge/ports';
import type { ForgeKind, RepoPermission } from '../forge/types';

export interface RoomCoordinate {
  provider: ForgeKind;
  host: string;
  repo: string;
  branch: string;
  path: string;
}

export interface RoomClaim {
  permission: RepoPermission;
  login: string;
  /** The forge's own user id, stable across a rename. */
  externalId?: string;
  /** The forge's own repository id, likewise. */
  repoId?: string;
}

/** How long a repository's permission is reused before being asked again. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

interface CachedClaim {
  claim: RoomClaim;
  expiresAt: number;
}

const cache = new Map<string, CachedClaim>();

/** Keyed by provider *and* host, so two forges cannot share an entry. */
function cacheKey(coordinate: Pick<RoomCoordinate, 'provider' | 'host' | 'repo'>): string {
  return `${coordinate.provider}:${coordinate.host}:${coordinate.repo.toLowerCase()}`;
}

/**
 * Asks the forge what this account may do with this repository.
 *
 * Resolves null when the answer cannot be obtained — offline, a rejected token,
 * a repository the account cannot see. Null means "do not claim anything",
 * which leaves the document local rather than joining a room on a guess.
 */
export async function buildClaim(
  forge: ForgePort,
  coordinate: Pick<RoomCoordinate, 'provider' | 'host' | 'repo'>,
  options: { refresh?: boolean } = {},
): Promise<RoomClaim | null> {
  const key = cacheKey(coordinate);

  if (!options.refresh) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.claim;
  }

  const [account, repo] = await Promise.all([
    forge.getAccount().catch(() => null),
    forge.getRepo(coordinate.repo).catch(() => null),
  ]);

  // Without an account there is nobody to attribute the claim to, and without
  // a repository there is no permission to report. Either way, guessing would
  // mean claiming write access nobody confirmed.
  if (!account || !repo) {
    cache.delete(key);
    return null;
  }

  const claim: RoomClaim = {
    permission: repo.permission,
    login: account.login,
    externalId: account.id,
    repoId: repo.id,
  };

  cache.set(key, { claim, expiresAt: Date.now() + CLAIM_TTL_MS });
  return claim;
}

/**
 * Drops cached permissions.
 *
 * Called when the connection changes — signing out, reconnecting a provider —
 * because a cached claim outliving its token would keep asserting access that
 * has already been taken away.
 */
export function forgetClaims(): void {
  cache.clear();
}
