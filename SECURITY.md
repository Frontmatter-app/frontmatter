# Security policy

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately to **security@frontmatter.app**, or through GitHub's
[private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository.

Please include what you can:

- What the issue is and roughly how severe you think it is
- Steps to reproduce, or a proof of concept
- Affected version or commit, and whether it is the desktop app, the
  collaboration server, or a self-hosted deployment
- Anything you think would make a good fix

**What to expect:** acknowledgement within 3 working days, an assessment with a
rough timeline within 10, and credit in the advisory when the fix ships, unless
you would rather stay anonymous. If we disagree that something is a
vulnerability, we will explain why rather than going quiet.

Please give us reasonable time to ship a fix before disclosing publicly. We will
not pursue legal action over good-faith research that respects other people's
data and does not degrade the service for others.

## Supported versions

Fixes land on the latest release. There are no long-term support branches yet.
Self-hosters should track releases.

## Scope

**In scope**

- The desktop application in this repository
- The collaboration server under `server/`, including its account signup,
  login, password reset, and session handling
- Anything that lets one user read or write another user's documents
- Anything that lets a read-only collaborator write
- Credential handling: tokens, license keys, OAuth flows
- Supply-chain issues in our build or release process

**Out of scope**

- Vulnerabilities in third-party dependencies with no exploitable path in
  Frontmatter — report those upstream, though we would like to know
- Findings from a self-hosted deployment that has been configured insecurely in
  a way our documentation warns against
- Social engineering, physical attacks, or denial of service by volume
- Missing hardening headers with no demonstrated impact

## Threat model for self-hosters

If you run your own collaboration server, some of the security burden becomes
yours. Design accordingly:

**The server holds no git provider tokens, by design.** Commits are made by
clients using their own OAuth credentials, which stay in the user's OS keychain
and are never sent to the server. A compromised collaboration server therefore
cannot write to your repositories. If you fork Frontmatter and move committing
server-side, you take on that custody problem — encrypt tokens at rest, prefer
short-lived installation tokens, and scope them to individual repositories.

**The server does hold document content in memory and in snapshots.** A
compromised server can read and alter anything being actively edited on it.

**Authorization is resolved server-side, and must stay that way.** The
collaboration socket checks read access before accepting a connection and write
access before applying an update. A client that appears read-only in the UI is
not thereby prevented from sending writes — the server is what stops it. Keep
that check in place in any fork.

**Run it behind TLS.** The websocket carries document content and bearer tokens.
Use `wss://` for anything that leaves localhost.

**Snapshots are unencrypted document content.** Whatever store you configure —
local volume, S3, R2 — treat it with the same sensitivity as the documents
themselves, and set access policy accordingly.

**Keep the server off the public internet unless you mean it.** The default
configuration is built for a trusted network. Put an authenticating proxy in
front of it if it is exposed.

## Hardening the desktop app

- Frontmatter builds are unsigned during pre-release. Verify checksums.
- The app runs the system `git` binary and the bundled Zola binary as
  subprocesses. Both come from your `PATH` or the app bundle respectively — a
  compromised `git` on `PATH` compromises the app.
- Workspaces are ordinary directories. Opening an untrusted workspace means
  rendering untrusted markdown; we treat preview rendering as a security
  boundary and want to hear about escapes from it.
