/**
 * Reading a forge target out of a git remote.
 *
 * The bridge between the two halves of the app. A workspace is a directory on
 * disk with a git remote; `ForgePort` addresses repositories as `owner/name` on
 * a named provider. This is what turns one into the other, and therefore what
 * lets the app know whether an open folder is backed by a forge at all.
 *
 * Remote URLs come in more shapes than people expect, and getting this wrong
 * fails in a confusing direction — the repository looks unrecognised even
 * though it is sitting right there.
 */
import type { ForgeKind } from './types';

export interface ForgeTarget {
  kind: ForgeKind;
  owner: string;
  name: string;
  /** `owner/name`, the form every ForgePort method takes. */
  fullName: string;
  /** The provider host, so self-hosted instances stay distinguishable. */
  host: string;
}

const KNOWN_HOSTS: Record<string, ForgeKind> = {
  'github.com': 'github',
  'www.github.com': 'github',
  'gitlab.com': 'gitlab',
  'www.gitlab.com': 'gitlab',
};

/**
 * Parses a git remote URL.
 *
 * Handles the forms git actually produces:
 *
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo
 *   https://user@github.com/owner/repo.git      (credentials in the URL)
 *   git@github.com:owner/repo.git               (scp-like syntax)
 *   ssh://git@github.com/owner/repo.git
 *   git://github.com/owner/repo.git
 *   https://gitlab.com/group/subgroup/repo.git  (nested groups)
 *
 * Returns null for anything it cannot place, which is the honest answer for a
 * local-only repository or an unrecognised host.
 */
export function parseRemoteUrl(raw: string): ForgeTarget | null {
  const url = raw.trim();
  if (!url) return null;

  let host: string;
  let path: string;

  // scp-like: `git@host:owner/repo.git`. Not a URL, so it must be matched
  // before anything tries to parse it as one.
  const scpLike = /^(?:([^@/]+)@)?([^:/]+):(.+)$/.exec(url);
  if (scpLike && !url.includes('://')) {
    host = scpLike[2];
    path = scpLike[3];
  } else {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }

  const segments = path
    .replace(/\.git\/?$/i, '')
    .split('/')
    .filter(Boolean);

  // Needs at least an owner and a name. GitLab allows nested subgroups, so the
  // name is the last segment and the owner is everything before it.
  if (segments.length < 2) return null;

  const name = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join('/');
  const normalisedHost = host.toLowerCase();

  const kind = KNOWN_HOSTS[normalisedHost] ?? inferSelfHosted(normalisedHost);
  if (!kind) return null;

  return { kind, owner, name, fullName: `${owner}/${name}`, host: normalisedHost };
}

/**
 * Guesses the software behind an unrecognised host.
 *
 * A self-hosted instance is usually named after what it runs, and guessing from
 * the hostname is better than refusing outright — the alternative is telling
 * someone their repository is unsupported when the adapter would work fine. A
 * wrong guess surfaces as a failed API call, which is recoverable; refusing to
 * parse is not.
 */
function inferSelfHosted(host: string): ForgeKind | null {
  if (host.includes('gitlab')) return 'gitlab';
  if (host.includes('gitea') || host.includes('forgejo')) return 'gitea';
  if (host.includes('github')) return 'github';
  return null;
}

/** Whether two remotes point at the same repository, ignoring URL form. */
export function isSameRepository(a: string, b: string): boolean {
  const left = parseRemoteUrl(a);
  const right = parseRemoteUrl(b);
  if (!left || !right) return false;
  return left.host === right.host && left.fullName.toLowerCase() === right.fullName.toLowerCase();
}
