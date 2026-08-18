/**
 * Trading a claim for permission to be in a room.
 *
 * The grant is what the socket actually authenticates with. It names one room
 * and carries one bit of authority, so unlike the session token it was replaced
 * by, it cannot be pointed at somebody else's document.
 *
 * The room id comes back from the server rather than being computed here, and
 * that is deliberate: the id is a hash of a canonicalised coordinate, and two
 * implementations of a hash are two implementations to drift apart. A client
 * that computed its own would, on the day the two disagreed, put two people in
 * two rooms while showing both of them the same file.
 */
import { apiRequest } from '../api/client';
import type { RoomClaim, RoomCoordinate } from './roomClaim';

export type RoomAccess = 'read' | 'write';
export type RoomVerification = 'verified' | 'unverified';

export interface RoomGrant {
  roomId: string;
  token: string;
  access: RoomAccess;
  /** Whether the server confirmed the claim against the forge, or took it on trust. */
  verification: RoomVerification;
  /** Peers already in the room when the grant was issued. */
  peers: number;
  /** Epoch milliseconds after which the token is worthless. */
  expiresAt: number;
  /** Epoch milliseconds at which to ask for the next one. */
  renewAt: number;
}

interface GrantResponse {
  roomId: string;
  token: string;
  expiresIn: number;
  renewAfter: number;
  access: RoomAccess;
  verification: RoomVerification;
  peers: number;
}

export async function requestGrant(
  coordinate: RoomCoordinate,
  claim: RoomClaim,
  options: { signal?: AbortSignal } = {},
): Promise<RoomGrant> {
  const response = await apiRequest<GrantResponse>('/rooms/grant', {
    method: 'POST',
    body: {
      coordinate: {
        provider: coordinate.provider,
        host: coordinate.host,
        repo: coordinate.repo,
        branch: coordinate.branch,
        path: coordinate.path,
      },
      claim: {
        permission: claim.permission,
        login: claim.login,
        externalId: claim.externalId ?? null,
        repoId: claim.repoId ?? null,
      },
    },
    signal: options.signal,
  });

  const now = Date.now();
  return {
    roomId: response.roomId,
    token: response.token,
    access: response.access,
    verification: response.verification,
    peers: response.peers,
    expiresAt: now + response.expiresIn * 1000,
    // The renewal point is the server's to decide. Deriving it here from a
    // fraction we picked ourselves is how a client ends up renewing after its
    // token has already expired, which reads to the user as being thrown out
    // of the document at random.
    renewAt: now + response.renewAfter * 1000,
  };
}

/** Milliseconds until this grant should be replaced. Never negative. */
export function millisecondsUntilRenewal(grant: RoomGrant, now = Date.now()): number {
  return Math.max(0, grant.renewAt - now);
}

export function hasExpired(grant: RoomGrant, now = Date.now()): boolean {
  return now >= grant.expiresAt;
}
