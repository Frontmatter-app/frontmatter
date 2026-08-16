# Frontmatter

**A markdown writing app where your documents are files in your own git repository.**

Frontmatter is a desktop writing environment for people who write seriously in
markdown — documentation, books, blogs, knowledge bases. It has a real editor, a
draft → write → revise workflow, prose linting, real-time collaboration, and a
static-site publisher.

What makes it different is where your writing lives. There is no proprietary
vault, no export button, no database you cannot read. **Your documents are plain
markdown files in a git repository you control**, and collaborative editing
commits to it.

Free and open source under the [AGPL-3.0](LICENSE). Self-host the collaboration
layer, or use [Frontmatter Cloud](https://frontmatter.app) and let us run it.

> **Status:** the git-backed collaboration described below is being built in the
> open. See [Roadmap](#roadmap) for what works today and what is in progress.

---

## Why

| | Frontmatter |
|---|---|
| **vs. Obsidian** | Real-time collaboration, and sync is your own repo rather than a paid proprietary service |
| **vs. Notion / Google Docs** | Plain markdown in a repo you own, with real version control — not an export button |
| **vs. HackMD / Outline** | They collaborate, but *their* database is the source of truth. Here git is |
| **vs. VS Code + Live Share** | That is a code tool. This has writing stages, prose linting, annotations, suggestions, and publishing themes |

---

## Features

**Editor** — CodeMirror 6 with inline live preview, KaTeX math, Mermaid
diagrams, syntax-highlighted code fences, callout blocks, and `@`-referenceable
blocks you can transclude across documents.

**Workflow** — three stages with different affordances. *Draft* for structure,
*Write* for prose, *Revise* for editing passes with annotations and tracked
suggestions.

**Prose linting** — readability scoring, offline grammar checking via
[Harper](https://github.com/automattic/harper), and inclusive-language checks.
No text leaves your machine.

**Collaboration** — real-time multi-cursor editing built on
[Yjs](https://yjs.dev), with presence, comment threads, and suggested edits.

**Publishing** — build a static site from your workspace across eight site
types (docs, blog, book, slides, wiki, portfolio, changelog, knowledge base),
each with themes, powered by a bundled [Zola](https://www.getzola.org).

**Local-first** — a SQLite index per workspace, a file watcher that reconciles
changes made outside the app, full-text search, and version snapshots.

---

## Getting started

### Requirements

- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) stable
- Platform prerequisites for [Tauri 2](https://v2.tauri.app/start/prerequisites/)
- `git` on your `PATH` (Frontmatter drives the system `git` binary)

### Run it

```bash
# --recursive matters: the publishing themes are a submodule.
git clone --recursive https://github.com/frontmatter-app/frontmatter.git
cd frontmatter

npm install
./scripts/fetch-zola.sh     # downloads the bundled site generator (~34 MB)

npm run tauri dev
```

Already cloned without `--recursive`? `git submodule update --init` fills in
`themes/`.

You do **not** need a `.env` file, a Firebase project, or an account. An empty
config gives you the full local app. Copy [`.env.example`](.env.example) to
`.env` only when you want to point the app at a collaboration server.

### Build a release

```bash
npm run tauri build
```

Both `npm run dev` and `npm run build` run the full test suite first
(`predev` / `prebuild`). A failing test or a stale IPC contract stops the build
on purpose.

---

## Self-hosting the collaboration layer

Collaboration runs through a server that holds the live document state and
persists it. It is part of this repository and carries the same AGPL license as
the app — there is no separate "enterprise" server.

```bash
docker compose up
```

Then in Frontmatter: **Settings → Account → Server URL** → `http://localhost:8000`,
and create an account. Pointing the app at your own server is a UI action, not a
rebuild.

The default configuration needs **no cloud accounts and no third-party
services**. It is one process you can put on a VM:

- **Accounts** are handled by the server itself — email and password, magic
  links, verification and reset. Sign in with GitHub/GitLab, or plug in your own
  OIDC provider (Keycloak, Authentik, Zitadel, Okta) if you prefer.
- **Storage** is SQLite by default — one file — with Postgres available when you
  outgrow it. Snapshots go to a local volume.
- **Your documents never live here.** They are files in your git repository. The
  server holds live editing state and nothing else. It never receives your git
  credentials: commits are made by the app, from your machine.

See [SELF_HOSTING.md](SELF_HOSTING.md) for deployment, identity, and storage
options.

**Frontmatter Cloud** is this same server, hosted by us, sold with a one-year
license key. The key gates access to our servers — it does not unlock features
in the binary. The self-hosted build has every feature, with no seat cap.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Desktop app (Tauri 2)                          │
│                                                 │
│  React 19 + CodeMirror 6      ←→   Rust core    │
│  Yjs CRDT documents                SQLite index │
│                                    File watcher │
│                                    git, Zola    │
└────────────────────┬────────────────────────────┘
                     │ y-websocket
┌────────────────────▼────────────────────────────┐
│  Collaboration server (FastAPI + pycrdt)        │
│                                                 │
│  Rooms, accounts, snapshots. One process.       │
│  SQLite or Postgres. No cloud dependencies.     │
│  Holds no git credentials — the app commits.    │
└─────────────────────────────────────────────────┘
```

| Path | What lives there |
|---|---|
| `src/editor/` | CodeMirror setup and extensions |
| `src/workflow/` | Draft / Write / Revise stage views |
| `src/yjs/` | CRDT documents, annotations, suggestions, anchors |
| `src/review/` | Readability, grammar, inclusive-language linting |
| `src/data/` | Ports-and-adapters data boundary |
| `src/features/` | Feature registry — the only wiring point for optional features |
| `src/ipc/` | Generated Rust↔TypeScript command contract |
| `src-tauri/src/` | Rust core: SQLite, watcher, indexer, git, grammar, export |
| `server/` | Collaboration server |
| `themes/` | Publishing themes |

Two conventions are load-bearing and enforced by tests:

**Ports and adapters.** Every data port in [`src/data/ports.ts`](src/data/ports.ts)
has at least two implementations — a real one and an in-memory fake — so UI
components render without a network. Components never import a backend SDK
directly.

**The feature registry.** Nothing outside `src/features/` may import a feature
module by path. A feature can be deleted by removing its directory and its line
from the manifest, and the app still boots. Each feature carries a `selfTest()`
that the build gate runs.

---

## Roadmap

Frontmatter is mid-way through becoming git-native. Today the local app and the
collaboration layer are separate systems; the work in progress joins them so
that live collaborative edits land as real commits in your repository.

- [x] Local workspaces, SQLite index, full-text search, snapshots
- [x] Editor, workflow stages, prose linting, publishing
- [x] Real-time collaboration over Yjs
- [ ] Connect a git provider (GitHub, GitLab, Gitea) and open a repo
- [ ] Commit and push as your connected identity
- [x] Standalone server with built-in accounts and no cloud dependencies
- [ ] **Git-backed rooms** — collaborative edits committed to your repo
- [ ] Teams derived from repository collaborators
- [ ] Publish straight to GitHub / GitLab Pages
- [x] Remove Firebase entirely

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
development setup, testing requirements, and the architectural conventions
above. Security issues go to [SECURITY.md](SECURITY.md), not the public issue
tracker.

## License

Frontmatter is licensed under the **GNU Affero General Public License v3.0 or
later** — see [LICENSE](LICENSE).

The AGPL means you may use, modify, self-host, and redistribute Frontmatter
freely. If you run a modified version as a network service for others, you must
offer those users its source. Third-party components ship under their own
licenses, listed in [NOTICE](NOTICE).

For a commercial license that lifts the AGPL's source-sharing requirement,
contact [licensing@frontmatter.app](mailto:licensing@frontmatter.app).
