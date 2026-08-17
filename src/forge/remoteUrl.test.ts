import { describe, expect, it } from 'vitest';
import { isSameRepository, parseRemoteUrl } from './remoteUrl';

describe('parseRemoteUrl', () => {
  it('parses the https form git clone writes', () => {
    expect(parseRemoteUrl('https://github.com/acme/docs.git')).toMatchObject({
      kind: 'github',
      owner: 'acme',
      name: 'docs',
      fullName: 'acme/docs',
    });
  });

  it('parses https without the .git suffix', () => {
    expect(parseRemoteUrl('https://github.com/acme/docs')?.fullName).toBe('acme/docs');
  });

  it('tolerates a trailing slash', () => {
    expect(parseRemoteUrl('https://github.com/acme/docs.git/')?.fullName).toBe('acme/docs');
  });

  it('parses the scp-like form, which is not a URL at all', () => {
    // `git@github.com:acme/docs.git` — the default for SSH remotes, and it
    // throws if handed to the URL parser.
    expect(parseRemoteUrl('git@github.com:acme/docs.git')).toMatchObject({
      kind: 'github',
      fullName: 'acme/docs',
    });
  });

  it('parses an explicit ssh:// URL', () => {
    expect(parseRemoteUrl('ssh://git@github.com/acme/docs.git')?.fullName).toBe('acme/docs');
  });

  it('parses the git:// protocol', () => {
    expect(parseRemoteUrl('git://github.com/acme/docs.git')?.fullName).toBe('acme/docs');
  });

  it('ignores credentials embedded in the URL', () => {
    // Older tooling wrote tokens into the remote. The repository identity must
    // not change because of who is authenticating.
    expect(parseRemoteUrl('https://user@github.com/acme/docs.git')?.fullName).toBe('acme/docs');
    expect(parseRemoteUrl('https://user:token@github.com/acme/docs.git')?.fullName).toBe(
      'acme/docs',
    );
  });

  it('keeps GitLab nested groups in the owner', () => {
    // GitLab allows subgroups, so the name is the last segment and everything
    // before it is the owner — taking segments[0] would address the wrong repo.
    expect(parseRemoteUrl('https://gitlab.com/group/subgroup/docs.git')).toMatchObject({
      kind: 'gitlab',
      owner: 'group/subgroup',
      name: 'docs',
      fullName: 'group/subgroup/docs',
    });
  });

  it('recognises gitlab.com', () => {
    expect(parseRemoteUrl('https://gitlab.com/acme/docs.git')?.kind).toBe('gitlab');
  });

  it('infers the software behind a self-hosted host', () => {
    // Better than refusing: a wrong guess surfaces as a failed API call, which
    // is recoverable. Refusing to parse tells someone their repository is
    // unsupported when the adapter would have worked.
    expect(parseRemoteUrl('https://gitlab.acme.internal/team/docs.git')?.kind).toBe('gitlab');
    expect(parseRemoteUrl('https://gitea.acme.internal/team/docs.git')?.kind).toBe('gitea');
    expect(parseRemoteUrl('https://forgejo.acme.dev/team/docs.git')?.kind).toBe('gitea');
  });

  it('is case insensitive about the host', () => {
    expect(parseRemoteUrl('https://GitHub.com/acme/docs.git')?.kind).toBe('github');
  });

  it('returns null for a host it cannot place', () => {
    expect(parseRemoteUrl('https://example.com/acme/docs.git')).toBeNull();
  });

  it('returns null for a path with no owner', () => {
    expect(parseRemoteUrl('https://github.com/docs.git')).toBeNull();
  });

  it('returns null for empty or nonsense input', () => {
    expect(parseRemoteUrl('')).toBeNull();
    expect(parseRemoteUrl('   ')).toBeNull();
    expect(parseRemoteUrl('not a url at all')).toBeNull();
  });

  it('returns null for a local path, which is what a remote-less repo has', () => {
    expect(parseRemoteUrl('/Users/someone/projects/docs')).toBeNull();
  });
});

describe('isSameRepository', () => {
  it('matches the same repository across URL forms', () => {
    // The same repo cloned over SSH and over HTTPS must be recognised as one,
    // or a workspace would look unrelated to the repository it came from.
    expect(
      isSameRepository('https://github.com/acme/docs.git', 'git@github.com:acme/docs.git'),
    ).toBe(true);
  });

  it('ignores case in the repository name', () => {
    expect(
      isSameRepository('https://github.com/Acme/Docs.git', 'https://github.com/acme/docs'),
    ).toBe(true);
  });

  it('does not match different repositories', () => {
    expect(
      isSameRepository('https://github.com/acme/docs.git', 'https://github.com/acme/website.git'),
    ).toBe(false);
  });

  it('does not match the same path on different hosts', () => {
    expect(
      isSameRepository('https://github.com/acme/docs.git', 'https://gitlab.com/acme/docs.git'),
    ).toBe(false);
  });

  it('is false when either side is unparseable', () => {
    expect(isSameRepository('https://github.com/acme/docs.git', 'nonsense')).toBe(false);
  });
});
