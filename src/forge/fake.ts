/**
 * In-memory forge, for tests.
 *
 * The second implementation every port is required to have. It models the one
 * behaviour that matters most and is hardest to exercise against a real
 * provider: **a branch moving under a writer.** `advanceBranch` simulates
 * somebody else pushing, so reconciliation can be tested deterministically
 * rather than by racing two network clients.
 */
import type { ForgePort } from './ports';
import {
  ForgeConflictError,
  type Branch,
  type Collaborator,
  type CommitRequest,
  type CommitResult,
  type FileContent,
  type ForgeAccount,
  type Repo,
  type TreeEntry,
} from './types';

interface FakeBranch {
  sha: string;
  files: Map<string, string>;
}

export class FakeForge implements ForgePort {
  readonly kind = 'github' as const;

  account: ForgeAccount | null = {
    kind: 'github',
    id: '1',
    login: 'testuser',
    name: 'Test User',
    email: 'test@example.com',
    avatarUrl: null,
  };

  collaborators: Collaborator[] = [
    { login: 'testuser', id: '1', permission: 'admin', avatarUrl: null },
  ];

  readonly commits: Array<{ repo: string; request: CommitRequest; sha: string }> = [];

  private repos = new Map<string, Repo>();
  private branches = new Map<string, Map<string, FakeBranch>>();
  private counter = 0;

  constructor(seed: { repo: string; branch?: string; files?: Record<string, string> } | null = null) {
    if (seed) {
      this.addRepo(seed.repo, seed.branch ?? 'main', seed.files ?? {});
    }
  }

  addRepo(fullName: string, branch = 'main', files: Record<string, string> = {}): void {
    const [owner, name] = fullName.split('/');
    this.repos.set(fullName, {
      id: String(++this.counter),
      fullName,
      owner,
      name,
      defaultBranch: branch,
      private: false,
      description: null,
      cloneUrl: `https://github.com/${fullName}.git`,
      permission: 'write',
      updatedAt: new Date().toISOString(),
    });
    this.branches.set(
      fullName,
      new Map([[branch, { sha: this.nextSha(), files: new Map(Object.entries(files)) }]]),
    );
  }

  /** Simulates someone else pushing to the branch. */
  advanceBranch(fullName: string, branch: string, files: Record<string, string>): string {
    const target = this.branchOf(fullName, branch);
    for (const [path, content] of Object.entries(files)) target.files.set(path, content);
    target.sha = this.nextSha();
    return target.sha;
  }

  private nextSha(): string {
    return `sha${String(++this.counter).padStart(38, '0')}`;
  }

  private branchOf(fullName: string, branch: string): FakeBranch {
    const found = this.branches.get(fullName)?.get(branch);
    if (!found) throw new Error(`unknown branch ${fullName}@${branch}`);
    return found;
  }

  async getAccount(): Promise<ForgeAccount | null> {
    return this.account;
  }

  async listRepos(options: { search?: string } = {}): Promise<Repo[]> {
    const all = [...this.repos.values()];
    if (!options.search) return all;
    const needle = options.search.toLowerCase();
    return all.filter((repo) => repo.fullName.toLowerCase().includes(needle));
  }

  async getRepo(fullName: string): Promise<Repo | null> {
    return this.repos.get(fullName) ?? null;
  }

  async listBranches(fullName: string): Promise<Branch[]> {
    const branches = this.branches.get(fullName);
    if (!branches) return [];
    return [...branches.entries()].map(([name, data]) => ({
      name,
      sha: data.sha,
      protected: false,
    }));
  }

  async getRef(fullName: string, branch: string): Promise<string | null> {
    return this.branches.get(fullName)?.get(branch)?.sha ?? null;
  }

  async listTree(
    fullName: string,
    options: { branch?: string; path?: string } = {},
  ): Promise<TreeEntry[]> {
    const repo = this.repos.get(fullName);
    if (!repo) return [];
    const target = this.branchOf(fullName, options.branch ?? repo.defaultBranch);
    const prefix = options.path ? options.path.replace(/^\/+|\/+$/g, '') + '/' : '';
    return [...target.files.keys()]
      .filter((path) => (prefix ? path.startsWith(prefix) : true))
      .map((path) => ({ path, type: 'file' as const, sha: `blob-${path}` }));
  }

  async getFile(fullName: string, path: string, branch?: string): Promise<FileContent | null> {
    const repo = this.repos.get(fullName);
    if (!repo) return null;
    const target = this.branchOf(fullName, branch ?? repo.defaultBranch);
    const text = target.files.get(path);
    if (text === undefined) return null;
    return { path, text, sha: `blob-${path}`, commitSha: target.sha };
  }

  async commit(fullName: string, request: CommitRequest): Promise<CommitResult> {
    const target = this.branchOf(fullName, request.branch);

    if (request.expectedHeadSha && target.sha !== request.expectedHeadSha) {
      throw new ForgeConflictError(request.branch, request.expectedHeadSha, target.sha);
    }

    for (const change of request.changes) {
      if (change.content === null) target.files.delete(change.path);
      else target.files.set(change.path, change.content);
    }
    target.sha = this.nextSha();
    this.commits.push({ repo: fullName, request, sha: target.sha });
    return { sha: target.sha, url: `https://example.test/${fullName}/commit/${target.sha}` };
  }

  async listCollaborators(): Promise<Collaborator[]> {
    return this.collaborators;
  }
}
