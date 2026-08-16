# Contributing to Frontmatter

Thanks for wanting to help. This document covers the setup, the conventions the
codebase enforces, and what a reviewable change looks like.

## Setup

```bash
# --recursive matters: the publishing themes are a submodule.
git clone --recursive https://github.com/frontmatter-app/frontmatter.git
cd frontmatter

npm install
./scripts/fetch-zola.sh     # bundled site generator, not committed

npm run tauri dev
```

Two things are deliberately not in the main repository, and forgetting either
produces a confusing failure rather than a clear one:

- **`themes/` is a submodule.** Without `--recursive` it is an empty directory
  and the publish wizard fails for every site type. Fix an existing clone with
  `git submodule update --init`.
- **The Zola binary is not committed** (~34 MB, platform-specific).
  `./scripts/fetch-zola.sh` downloads it. Without it, publishing fails and the
  Rust theme-build tests silently skip themselves.

You need Node 20+, stable Rust, the [Tauri 2
prerequisites](https://v2.tauri.app/start/prerequisites/), and `git` on your
`PATH`. You do not need a `.env` or an account — the app runs fully local with
empty config.

## Tests are a build gate, not a suggestion

`npm run dev` and `npm run build` both run the full suite first, via the
`predev` and `prebuild` hooks. **A failing test stops the dev server from
starting.** This is deliberate; please do not route around it.

```bash
npm test           # everything: web + rust
npm run test:web   # vitest
npm run test:rust  # cargo test
npm run test:watch # vitest in watch mode
npm run lint       # tsc --noEmit
```

Firestore security rules have their own suite, kept out of `npm test` because it
needs Java and the Firebase emulator:

```bash
npm run test:rules
```

Tests live next to the code they cover (`foo.ts` → `foo.test.ts`), not in a
separate tree.

## Conventions the tests enforce

Three architectural rules are checked automatically. Breaking one fails the
build rather than producing a review comment.

### 1. The IPC contract is generated, and Rust owns it

`src/ipc/generated.ts` is produced from the `#[tauri::command]` functions in
`src-tauri/`. Never edit it by hand. After changing any command signature:

```bash
npm run ipc:gen
```

`src/ipc/contract.test.ts` fails if the checked-in file is stale, and asserts
snake_case command names with camelCase arguments. This exists because a
`short_hash` / `shortHash` mismatch once shipped silently.

### 2. Ports have at least two implementations

Every port in `src/data/ports.ts` needs a real adapter and an in-memory fake in
`src/data/fakes.ts`. UI components depend on the port types, never on a backend
SDK directly — that is what lets components render in tests with no network and
no live project. Injection goes through `src/data/DataProvider.tsx`.

Adding a data dependency to a component? Add it to a port first.

### 3. Features are independently deletable

Nothing outside `src/features/` may import a feature module by path. The
registry in `src/features/registry.ts` is the only wiring point. A feature must
be removable by deleting its directory and its manifest line, with the app still
booting — `registry.test.ts` and `manifest.test.ts` verify exactly that.

Every feature exports a `selfTest()` proving it is wired correctly. The build
gate runs it.

## Style

Match the surrounding code. A few things that are genuinely house style:

- **Comments explain why, not what.** This codebase documents decisions,
  especially ones that reverse an earlier mistake — see the header of
  `src/cloud/collabProvider.ts` for the tone. If you fix a subtle bug, leave a
  note saying what the old behavior was and why it was wrong. That is often more
  valuable than the fix.
- No `any` in new code where a real type is available.
- Prefer extending an existing utility to adding a parallel one.

## Commits and pull requests

- One logical change per PR. A refactor and a behavior change in the same diff
  are hard to review and harder to revert.
- Write commit subjects in the imperative mood, describing the outcome:
  *"Lift the selected review card off the page"*, not *"fixed card"*.
- Explain the *why* in the body. If there is a failure mode you are preventing,
  describe it.
- Include tests. New behavior needs coverage; a bug fix needs a test that fails
  without it.
- Run `npm test` before opening the PR — CI runs the same thing.

## Third-party licenses

Frontmatter is AGPL-3.0. Contributions are accepted under that license.

Adding a dependency means updating [NOTICE](NOTICE). Before you do:

- **Check the license is compatible.** Permissive (MIT, BSD, ISC, Apache-2.0) is
  fine. Copyleft needs discussion first. Anything non-OSI-approved is a no.
- **Prefer no new dependency.** This project has removed more dependencies than
  it has added lately.

The bundled Zola binary deserves specific care: **its version pin in
`scripts/fetch-zola.sh` is a licensing decision.** Zola relicensed from MIT to
EUPL-1.2 after v0.19.2, which is the version we redistribute. Bumping it changes
the license of a binary we ship. See NOTICE section 1.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
