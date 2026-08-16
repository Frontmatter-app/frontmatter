/**
 * GitHub, behind `ForgePort`.
 *
 * Commits are built with the Git Data API — blob, tree, commit, then a ref
 * update — rather than the Contents API. Contents writes one file per call,
 * which for a multi-file change means several commits and no way to make them
 * atomic. The four-call dance produces exactly one commit containing
 * everything, and the ref update is where a concurrent writer is detected.
 */
import type { ForgePort, TokenProvider } from './ports';
import {
  ForgeAuthError,
  ForgeConflictError,
  ForgeRateLimitError,
  type Branch,
  type Collaborator,
  type CommitRequest,
  type CommitResult,
  type FileContent,
  type ForgeAccount,
  type Repo,
  type RepoPermission,
  type TreeEntry,
} from './types';

const API = 'https://api.github.com';

function permissionOf(raw: Record<string, boolean> | undefined): RepoPermission {
  if (raw?.admin) return 'admin';
  if (raw?.push) return 'write';
  return 'read';
}

export class GitHubForge implements ForgePort {
  readonly kind = 'github' as const;

  constructor(private readonly tokens: TokenProvider) {}

  private async request<T>(
    path: string,
    init: RequestInit & { rawPath?: boolean } = {},
  ): Promise<T> {
    const token = await this.tokens.getToken();
    if (!token) throw new ForgeAuthError('Connect a GitHub account first.');

    const response = await fetch(init.rawPath ? path : `${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    if (response.status === 401) throw new ForgeAuthError();

    // 403 is both "forbidden" and "rate limited"; the remaining-quota header is
    // what distinguishes them, and confusing the two produces a very
    // misleading error message.
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const reset = response.headers.get('x-ratelimit-reset');
        throw new ForgeRateLimitError(reset ? new Date(Number(reset) * 1000) : null);
      }
      throw new ForgeAuthError('Your GitHub token does not permit that.');
    }

    if (response.status === 404) return null as T;

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(
        (detail as { message?: string } | null)?.message ??
          `GitHub request failed (${response.status}).`,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async getAccount(): Promise<ForgeAccount | null> {
    try {
      const raw = await this.request<{
        id: number;
        login: string;
        name: string | null;
        email: string | null;
        avatar_url: string | null;
      } | null>('/user');
      if (!raw) return null;
      return {
        kind: 'github',
        id: String(raw.id),
        login: raw.login,
        name: raw.name,
        email: raw.email,
        avatarUrl: raw.avatar_url,
      };
    } catch (error) {
      if (error instanceof ForgeAuthError) return null;
      throw error;
    }
  }

  async listRepos(options: { search?: string; limit?: number } = {}): Promise<Repo[]> {
    const limit = options.limit ?? 100;
    const raw = await this.request<any[]>(
      `/user/repos?per_page=${Math.min(limit, 100)}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );
    const repos = (raw ?? []).map(toRepo);
    if (!options.search) return repos;
    const needle = options.search.toLowerCase();
    return repos.filter((repo) => repo.fullName.toLowerCase().includes(needle));
  }

  async getRepo(fullName: string): Promise<Repo | null> {
    const raw = await this.request<any>(`/repos/${fullName}`);
    return raw ? toRepo(raw) : null;
  }

  async listBranches(fullName: string): Promise<Branch[]> {
    const raw = await this.request<any[]>(`/repos/${fullName}/branches?per_page=100`);
    return (raw ?? []).map((branch) => ({
      name: branch.name,
      sha: branch.commit.sha,
      protected: Boolean(branch.protected),
    }));
  }

  async getRef(fullName: string, branch: string): Promise<string | null> {
    const raw = await this.request<any>(`/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`);
    return raw?.object?.sha ?? null;
  }

  async listTree(
    fullName: string,
    options: { branch?: string; path?: string; recursive?: boolean } = {},
  ): Promise<TreeEntry[]> {
    const branch = options.branch ?? (await this.defaultBranch(fullName));
    const sha = await this.getRef(fullName, branch);
    if (!sha) return [];

    const raw = await this.request<any>(
      `/repos/${fullName}/git/trees/${sha}${options.recursive ? '?recursive=1' : ''}`,
    );
    if (!raw) return [];

    // GitHub caps a recursive tree at 100k entries or 7MB and sets `truncated`.
    // Callers must not read an absent path as "the file does not exist".
    if (raw.truncated) {
      console.warn(`[forge] tree for ${fullName} was truncated by GitHub; listing is incomplete`);
    }

    const prefix = options.path ? options.path.replace(/^\/+|\/+$/g, '') + '/' : '';
    return (raw.tree ?? [])
      .filter((entry: any) => (prefix ? entry.path.startsWith(prefix) : true))
      .map((entry: any) => ({
        path: entry.path,
        type: entry.type === 'tree' ? ('directory' as const) : ('file' as const),
        sha: entry.sha,
        size: entry.size,
      }));
  }

  async getFile(fullName: string, path: string, branch?: string): Promise<FileContent | null> {
    const ref = branch ?? (await this.defaultBranch(fullName));
    const commitSha = await this.getRef(fullName, ref);
    if (!commitSha) return null;

    const raw = await this.request<any>(
      `/repos/${fullName}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`,
    );
    if (!raw || Array.isArray(raw) || raw.type !== 'file') return null;

    return {
      path,
      text: decodeBase64(raw.content ?? ''),
      sha: raw.sha,
      commitSha,
    };
  }

  async commit(fullName: string, request: CommitRequest): Promise<CommitResult> {
    const head = await this.getRef(fullName, request.branch);
    if (!head) throw new Error(`Branch "${request.branch}" does not exist in ${fullName}.`);

    // Detect a moved ref before doing any work, so a losing writer spends one
    // request rather than four.
    if (request.expectedHeadSha && head !== request.expectedHeadSha) {
      throw new ForgeConflictError(request.branch, request.expectedHeadSha, head);
    }

    const baseCommit = await this.request<any>(`/repos/${fullName}/git/commits/${head}`);
    const baseTreeSha = baseCommit.tree.sha;

    // A blob per changed file. Deletions are a null sha in the tree entry,
    // which is how the Git Data API expresses "remove this path".
    const treeEntries = await Promise.all(
      request.changes.map(async (change) => {
        if (change.content === null) {
          return { path: change.path, mode: '100644', type: 'blob', sha: null };
        }
        const blob = await this.request<any>(`/repos/${fullName}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
        });
        return { path: change.path, mode: '100644', type: 'blob', sha: blob.sha };
      }),
    );

    const tree = await this.request<any>(`/repos/${fullName}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });

    const commit = await this.request<any>(`/repos/${fullName}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: withCoAuthors(request.message, request.coAuthors),
        tree: tree.sha,
        parents: [head],
      }),
    });

    try {
      await this.request<any>(
        `/repos/${fullName}/git/refs/heads/${encodeURIComponent(request.branch)}`,
        {
          method: 'PATCH',
          // Never force. A rejected update is the conflict signal; forcing it
          // would silently discard whatever the other writer committed.
          body: JSON.stringify({ sha: commit.sha, force: false }),
        },
      );
    } catch (error) {
      // The branch moved between our check and this update. The commit object
      // itself is already stored and unreferenced — harmless, and GitHub
      // garbage-collects it.
      const current = await this.getRef(fullName, request.branch);
      throw new ForgeConflictError(request.branch, head, current);
    }

    return { sha: commit.sha, url: commit.html_url ?? `https://github.com/${fullName}/commit/${commit.sha}` };
  }

  async listCollaborators(fullName: string): Promise<Collaborator[]> {
    const raw = await this.request<any[]>(`/repos/${fullName}/collaborators?per_page=100`);
    return (raw ?? []).map((entry) => ({
      login: entry.login,
      id: String(entry.id),
      permission: permissionOf(entry.permissions),
      avatarUrl: entry.avatar_url ?? null,
    }));
  }

  private async defaultBranch(fullName: string): Promise<string> {
    const repo = await this.getRepo(fullName);
    return repo?.defaultBranch ?? 'main';
  }
}

function toRepo(raw: any): Repo {
  return {
    id: String(raw.id),
    fullName: raw.full_name,
    owner: raw.owner?.login ?? raw.full_name.split('/')[0],
    name: raw.name,
    defaultBranch: raw.default_branch ?? 'main',
    private: Boolean(raw.private),
    description: raw.description ?? null,
    cloneUrl: raw.clone_url,
    permission: permissionOf(raw.permissions),
    updatedAt: raw.updated_at ?? raw.pushed_at ?? new Date(0).toISOString(),
  };
}

/**
 * Appends `Co-authored-by:` trailers.
 *
 * Git requires a blank line before the trailer block, and duplicates are
 * dropped so a session that flushes repeatedly does not accumulate them.
 */
export function withCoAuthors(
  message: string,
  coAuthors: Array<{ name: string; email: string }> = [],
): string {
  if (coAuthors.length === 0) return message;

  const seen = new Set<string>();
  const trailers: string[] = [];
  for (const author of coAuthors) {
    const trailer = `Co-authored-by: ${author.name} <${author.email}>`;
    if (seen.has(trailer.toLowerCase())) continue;
    seen.add(trailer.toLowerCase());
    if (message.includes(trailer)) continue;
    trailers.push(trailer);
  }
  if (trailers.length === 0) return message;

  return `${message.trimEnd()}\n\n${trailers.join('\n')}\n`;
}

/** Base64 from the GitHub Contents API, which wraps lines at 60 characters. */
export function decodeBase64(encoded: string): string {
  const cleaned = encoded.replace(/\s/g, '');
  if (!cleaned) return '';
  const binary = atob(cleaned);
  // atob yields Latin-1; decoding as UTF-8 is what makes non-ASCII text survive.
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
